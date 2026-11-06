# Lambda Web Function behind CloudFront (your own MCP server)

In this pattern, CloudFront signs each origin request with origin access control (OAC) and sends it to the regional
endpoint of a [Lambda Web Function](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html), which runs the
hello MCP server from a zip file.

This pattern has the strongest origin lock that you can get without a private network. The endpoint is public but
requires `IamAuth`. CloudFront signs every origin request with SigV4, and the function's resource policy grants the
invoke permission only to this distribution, so Lambda refuses anything else before your code runs. Nothing in front
of the function checks tokens, so the server verifies them itself. You pay for use only, with no VPC, load balancer, or
NAT gateway. The function runs Node.js from a zip file only, and this pattern has one web ACL layer rather than two.

The following diagram shows the resources that the stack creates, numbered as in the list that follows it.

![Web Function pattern: the edge with origin access control, then a Lambda Web Function with its resource policy, code bucket, and Cognito](../../docs/diagrams/pattern-mcp-web-function-cloudfront/pattern-mcp-web-function-cloudfront.svg)

1. **AWS WAF at the edge** runs the MCP rule stack. For the rules, see
   [AWS WAF at the edge](../../README.md#aws-waf-at-the-edge). It is the only web ACL in this pattern, because AWS WAF
   has no regional association for a web function endpoint. With OAC as the lock, a request that skips the edge never
   reaches the code, so it can't skip the web ACL either.
2. **The CloudFront distribution** sends allowed requests to the function's `HomeRegion` endpoint
   (`*.lambda-web.us-east-1.on.aws`) over HTTPS. A `MultiRegion` endpoint needs a `sigv4a` OAC instead. This origin
   type doesn't support Lambda@Edge origin triggers, but it does support CloudFront Functions.
3. **The CloudFront Function** decodes the Bearer token and answers `401` at the edge for a missing, malformed, expired
   or foreign token, and sets `x-jwt-claims` and `x-forwarded-host`.
4. **Origin access control** makes CloudFront sign every origin request and keep the viewer's `Authorization` header,
   so the bearer token still reaches the server. It uses origin type `lambda`, signing protocol `sigv4`, and signing
   behavior `always-amz-auth`, the only behavior that web function origins support. For more information, see
   [Restrict access to an AWS Lambda Web Function origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda-web.html).
5. **The Lambda Web Function** consists of three native resources: an `AWS::Lambda::WebFunction`, a
   `WebFunctionRevision` that holds the `server/` code as a zip file on `nodejs24.x` pinned to an object version, and a
   `WebFunctionEndpoint` with `IamAuth`. Lambda checks the SigV4 signature against the resource policy (6) before the
   code runs. The runtime loads `server.js` through `AWS_LAMBDA_NODEJS_ENTRYPOINT`, and the server listens on
   `AWS_LAMBDA_HTTP_ENDPOINT`, so no Lambda Web Adapter is needed. The server then verifies the token's RS256 signature
   and the `mcp/web-function` scope, in [server/auth.js](../../server/auth.js), and answers the `tools/call`. A code
   change creates a new revision, and the endpoint domain stays the same. You can cap the origin with `ThrottleConfig`
   and `ScalingConfig` on the endpoint. Both are unset here.
6. **The resource policy** grants `lambda:InvokeWebFunctionEndpoint` to `cloudfront.amazonaws.com` only when
   `aws:SourceArn` is this distribution. Another distribution, even in the same account, is refused.
7. **The versioned S3 bucket** holds the zip file. Lambda reads it with its own service principal, so the bucket policy
   grants `s3:GetObject` and `s3:GetObjectVersion` scoped to this function's revisions. The CDK bootstrap bucket can't
   carry that policy, which is why the stack creates its own.
8. **Amazon Cognito** issues the tokens and publishes the keys the server verifies against.

## Deploy

Install the dependencies once at the repository root, then deploy from this directory. This app doesn't need Docker.

```bash
npm ci
cd patterns/pattern-mcp-web-function-cloudfront
npx cdk deploy
```

To call the server, get a token with the `mcp/web-function` scope and call `hello`, as shown in
[Getting a token](../../README.md#getting-a-token).
