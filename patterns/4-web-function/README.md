# Pattern 4: Lambda Web Function

Its own CloudFront distribution (`/mcp`) → CloudFront, signing with origin access control (OAC) → regional endpoint of a
[Lambda Web Function](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html) → the hello MCP server.

![Pattern 4: CloudFront signs with OAC, Lambda Web Function regional IamAuth endpoint, revision running the hello server](../../docs/diagrams/pattern-4-web-function/pattern-4-web-function.svg)

## What gets deployed

All native CloudFormation resources; no custom resource:

| Resource | Purpose |
|---|---|
| `AWS::Lambda::WebFunction` | The function container |
| `AWS::S3::Bucket` and a `BucketDeployment` | Versioned code bucket. Lambda reads the zip with its own service principal (`lambda.amazonaws.com`), so the bucket policy grants it `s3:GetObject` and `s3:GetObjectVersion`, scoped to this function's revisions. The CDK bootstrap bucket cannot carry that policy |
| `AWS::Lambda::WebFunctionRevision` | Immutable code and configuration: the `server/` code as a zip on `nodejs24.x`, pinned to the object version the deployment wrote |
| `AWS::Lambda::WebFunctionEndpoint` | `HomeRegion` endpoint `mcp`, auth type `IamAuth`, 100 % of traffic on the revision |
| `AWS::Lambda::ResourcePolicy` | Lets `cloudfront.amazonaws.com` call `lambda:InvokeWebFunctionEndpoint` for this distribution only |
| `AWS::CloudFront::OriginAccessControl` | Origin type `lambda`, signing protocol `sigv4`, signing behavior `always-amz-auth` |

Web functions run a zip on a managed Node.js runtime, not a container image. The revision ships the same
`server.js` that the other patterns run in the shared image; the runtime loads it through
`AWS_LAMBDA_NODEJS_ENTRYPOINT`, and the server listens on the address in `AWS_LAMBDA_HTTP_ENDPOINT`. No Lambda Web
Adapter is needed: the runtime forwards plain HTTP to the server.

A code change creates a new revision (its build configuration is create-only), CloudFormation points the endpoint at
it, then deletes the old one. The endpoint domain name does not change.

## How the origin is locked down

Following [Restrict access to an AWS Lambda Web Function origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda-web.html):

- The endpoint uses `IamAuth`, so Lambda rejects any request without a valid SigV4 signature before the code runs.
- The OAC makes CloudFront sign every origin request. Web function origins support only `always-amz-auth`: CloudFront
  signs every request and keeps the viewer's `Authorization` header, so a bearer token still reaches the server.
- The resource-based policy grants `lambda:InvokeWebFunctionEndpoint` on the endpoint ARN to the CloudFront service
  principal, with an `aws:SourceArn` condition naming this distribution. Another distribution, even in the same
  account, is refused.
- The endpoint is `HomeRegion`, so its hostname ends in `.lambda-web.us-east-1.on.aws` and OAC signs it with plain
  SigV4. A `MultiRegion` endpoint (`.lambda-web.global.on.aws`) needs a `sigv4a` OAC, and OAC is not supported when
  the global endpoint includes opt-in Regions.

The endpoint stays publicly resolvable; the lock is IAM, not the network. No shared secret is involved.

Constraints that come with OAC on this origin:

- Use an origin request policy that does not forward the viewer `Host` header (`AllViewerExceptHostHeader` here).
  The endpoint expects its own hostname and returns 404 otherwise.
- Lambda@Edge origin-request and origin-response triggers are not supported on the behavior. CloudFront Functions
  (viewer request and response) are, which is where the token pre-filter lives.
- If the server reads the viewer's `Authorization` header on `GET` or `HEAD`, add it to the cache policy, or
  CloudFront removes it. MCP calls are `POST`, so the hello path does not need this.

## AWS WAF and rate limiting

AWS WAF has no regional association for a web function endpoint, so only the CloudFront web ACL (`EdgeWaf`,
`lib/waf.ts`) filters this path: the MCP rules from
[Protect MCP endpoints at the edge](https://aws.amazon.com/blogs/networking-and-content-delivery/protect-mcp-endpoints-at-the-edge-with-amazon-cloudfront-and-aws-waf/)
and the per-IP rate limit, described in the [root README](../../README.md#aws-waf-at-the-edge). With OAC as
the lock, a request that skips the edge never reaches the code, so it cannot skip the web ACL either.

For a ceiling at the origin, set `ThrottleConfig.RateLimit` (requests per second) and `ScalingConfig.MaxEnvironments`
on the endpoint. This sample leaves both unset.

## Authentication

In the hello server. Nothing in front of a web function checks bearer tokens, and the endpoint's IAM auth is used by
origin access control, so the server verifies each Cognito access token itself (`JWT_VERIFY=true`,
[server/auth.js](../../server/auth.js)): RS256 signature against the user pool's JWKS, issuer, token type and the
scope `mcp/web-function`. It also serves the protected-resource metadata. The CloudFront Function in front answers `401` for
a missing, expired or foreign token. There is no regional WAF on this pattern, so nothing matches on `x-jwt-claims`
before the server. See [Authentication](../../README.md#authentication).

## Deploy with CloudFormation

[`cfn/web-function.yaml`](../../cfn/web-function.yaml) takes the server zip as parameters, as a stack cannot create the
bucket and upload to it before the revision reads it. Create a versioned bucket whose policy lets Lambda read the zip
for this function's revisions, upload the zip, then deploy from the repository root:

```bash
export AWS_REGION=us-east-1
account=$(aws sts get-caller-identity --query Account --output text)
bucket=cloudfront-mcp-code-$account
aws s3api create-bucket --bucket "$bucket"
aws s3api put-bucket-versioning --bucket "$bucket" --versioning-configuration Status=Enabled
aws s3api put-bucket-policy --bucket "$bucket" --policy '{"Version":"2012-10-17","Statement":[{"Effect":"Allow",
  "Principal":{"Service":"lambda.amazonaws.com"},"Action":["s3:GetObject","s3:GetObjectVersion"],
  "Resource":"arn:aws:s3:::'"$bucket"'/*","Condition":{"ArnLike":{"aws:SourceArn":
  "arn:aws:lambda:us-east-1:'"$account"':web-function/CloudFrontMcpWebFunction-hello/revision/*"}}}]}'
(cd server && npm ci --omit=dev && zip -qr ../hello.zip server.js auth.js package.json node_modules)
version=$(aws s3api put-object --bucket "$bucket" --key hello.zip --body hello.zip --query VersionId --output text)
aws cloudformation deploy --template-file cfn/web-function.yaml --stack-name cloudfront-mcp-web-function \
  --parameter-overrides CodeBucket="$bucket" CodeVersionId="$version" --capabilities CAPABILITY_IAM --tags auto-delete=no
```

New code is a new object version: upload it and deploy again with its `CodeVersionId`. The stack outputs
`WebFunctionMcp` and, for a token with scope `mcp/web-function`, `TokenUrl`, `UserPoolId` and `ClientId`.

## Trade-offs

- Pay per use and nothing to run while idle: no VPC, no load balancer, no NAT.
- The strongest lock without a private network: IAM, checked by Lambda before your code runs.
- Cold starts on a new execution environment.
- Node.js only, from a zip. The container image used by the other patterns does not run here.
- One web ACL layer instead of two, and no Lambda@Edge origin triggers.
