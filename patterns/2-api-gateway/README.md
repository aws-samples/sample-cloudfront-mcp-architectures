# Pattern 2: Amazon API Gateway

Its own CloudFront distribution (`/mcp`) → CloudFront VPC origin → internal Network Load Balancer → `execute-api` VPC
endpoint → private API Gateway REST API → AWS Lambda running the hello image with Lambda Web Adapter.

A private API made reachable from the internet without exposing it. The REST API has no public endpoint; CloudFront
reaches it through a VPC origin, an internal NLB and an interface VPC endpoint, with TLS end to end. A Cognito
authorizer on every method verifies the token, so Lambda never runs for a bad one. The private path adds fixed cost (NLB
and endpoint in two Availability Zones), and the REST API's 29-second timeout rules out long SSE streams.

## Deployed resource details

![Pattern 2: the edge (AWS WAF, the distribution, the CloudFront Function) and the Region (internal NLB and execute-api endpoint in isolated subnets, the private REST API with its regional AWS WAF and Cognito authorizer, Lambda, Amazon Cognito and the origin secret), numbered as below](../../docs/diagrams/pattern-2-api-gateway/pattern-2-api-gateway.svg)

1. **AWS WAF at the edge** inspects the `POST /mcp` before anything else runs: IP reputation, rate limits, body size,
   protocol version, tool allowlist, and SSRF, SQL and XSS in tool arguments. Floods stop here, before they can cost a
   Lambda invocation.
2. **The CloudFront distribution** receives what the web ACL allowed and sends it through the VPC origin over HTTPS,
   with the secret `x-origin-verify` header added. `/mcp` is not cached.
3. **The CloudFront Function** decodes the Bearer token and answers `401` at the edge for a missing, malformed, expired
   or foreign token. For a good token it writes the decoded claims into `x-jwt-claims`; it cannot verify the signature.
4. **The internal NLB** has private IPs only and passes TCP 443 straight through, so the TLS session runs from
   CloudFront to the endpoint without being terminated in between.
5. **The `execute-api` VPC endpoint** is the only way into the API: the API's resource policy allows invocation only
   from this endpoint (`aws:SourceVpce`), and the public `execute-api` hostname answers 403.
6. **The private REST API** runs the regional web ACL (7) and then its Cognito authorizer, which verifies the token's
   signature and the `mcp/api-gateway` scope on every method before Lambda is invoked.
7. **AWS WAF on the stage** admits only requests with the secret header and an `mcp/` scope in `x-jwt-claims`. An NLB
   takes no web ACL, so the stage is where the regional check lives.
8. **AWS Lambda** runs the hello image through Lambda Web Adapter and answers the `tools/call`.
9. **Amazon Cognito** issues the tokens and publishes the keys the authorizer (6) verifies against.
10. **Secrets Manager** holds the random `x-origin-verify` value; at deploy the stack reads it into the distribution's
    origin header (2) and the regional web ACL's rule (7).

### The edge

Global. Every request enters the edge location nearest the client, where TLS ends and where 1 to 3 run, in that order,
before the Region sees anything.

#### 1. AWS WAF web ACL `EdgeWaf`

- CloudFront scope, shared by every pattern distribution in the stack ([lib/waf.ts](../../lib/waf.ts)). The MCP rule
  stack is documented once, in the [root README](../../README.md#aws-waf-at-the-edge). Abusive traffic is dropped
  before it costs a Lambda invocation.

#### 2. Amazon CloudFront distribution

- Origin: a [VPC origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html)
  to the internal NLB (4) over HTTPS. The origin domain is the API's own hostname,
  `<api-id>.execute-api.<region>.amazonaws.com`: CloudFront validates the endpoint's `*.execute-api` certificate against
  it, and the Host header routes the request to this API. The hostname has no public DNS; CloudFront reaches it only
  through the VPC origin.
- Adds the secret `x-origin-verify` header (10) to every origin request.
- What CloudFront adds here: a public entry point to an API that is otherwise reachable only from inside the VPC, the
  edge web ACL in front of the regional one, and TLS termination and connection reuse from edge locations close to the
  client.

#### 3. CloudFront Function (viewer request)

- [lib/viewer-request.js](../../lib/viewer-request.js). Decodes the token and answers `401` with
  `WWW-Authenticate: Bearer resource_metadata=...` for a missing, malformed, expired or foreign token; sets
  `x-jwt-claims` for the regional web ACL (7) and `x-forwarded-host` so the server can name the distribution in its
  metadata.

### The Region (us-east-1)

4 and 5 are in the VPC's isolated subnets (`10.1.0.0/16`, shared with pattern 5, no NAT gateway); 6 to 10 are regional
services.

#### 4. Internal Network Load Balancer

- A VPC origin needs a load balancer, and it needs a security group on it. The NLB's security group allows port 443
  only from the CloudFront managed prefix list `com.amazonaws.global.cloudfront.origin-facing` (VPC origin traffic
  keeps CloudFront's source IPs), and sends only to the endpoint.
- TCP 443 passthrough to the endpoint's network interface IPs, so TLS runs end to end between CloudFront and the
  endpoint. An NLB rather than an ALB: passthrough needs no certificate or HTTP listener of its own, but the NLB cannot
  take a web ACL or inspect requests, so all regional WAF checks sit on the stage (7).
- The NLB targets the endpoint's IPs, which CloudFormation does not expose; a small inline Lambda function
  (`endpoint-ips.js`, `nodejs24.x`) looks them up once as a custom resource. They stay fixed for the endpoint's
  lifetime; if you recreate the endpoint, redeploy.

#### 5. `execute-api` interface VPC endpoint

- The REST API is private: it has no public endpoint, and its resource policy allows `execute-api:Invoke` only through
  this endpoint (`aws:SourceVpce`). A call to the public `execute-api` hostname gets `403 Forbidden`.
- The endpoint security group allows port 443 only from the NLB.

#### 6. Amazon API Gateway private REST API

- A Cognito user pools authorizer on every method checks the access token's signature and requires the scope
  `mcp/api-gateway`, so Lambda never runs for a bad token or another pattern's token. See
  [Authentication](../../README.md#authentication).
- Only `GET /.well-known/oauth-protected-resource/mcp` has no authorizer: the hello server answers it with the
  protected-resource metadata, and CloudFront caches it.
- Rate limiting: the edge rules, plus API Gateway stage and usage-plan throttling per API key if you add keys.

#### 7. AWS WAF web ACL `OriginWaf`

- Regional, on the API stage, shared with the AgentCore Gateway (pattern 1) and the ALB (pattern 5). Default block;
  allows only requests with CloudFront's secret `x-origin-verify` header and an `mcp/` scope in `x-jwt-claims`, and
  repeats the tool labels and the four argument rules ahead of that allow.
- Why it exists alongside the network lock: the security groups and the resource policy prove the request came from
  CloudFront through this endpoint, not that it came through *this* distribution with its edge web ACL and function. A
  workload inside the VPC that calls the NLB or the endpoint directly still meets this web ACL.

#### 8. AWS Lambda

- Runs the same arm64 hello image as the other patterns, through Lambda Web Adapter; no Lambda-specific code. Cold
  starts are slower than a zip handler.
- REST APIs time out at 29 seconds by default and buffer responses, so the server answers with JSON rather than a
  long-lived SSE stream.

#### 9. Amazon Cognito user pool

- The one issuer for the stack ([lib/auth.ts](../../lib/auth.ts)); this pattern's scope is `mcp/api-gateway`. The stack
  outputs `TokenUrl`, `UserPoolId` and `ClientId`; the [root README](../../README.md#deploy) shows how to get a token.

#### 10. AWS Secrets Manager secret

- A 32-character random value generated at deploy, read into the origin header (2) and the `OriginWaf` rule (7). Rotate
  it by updating the secret and redeploying.

## Deploy with CloudFormation

Push the hello image first ([Deploy with CloudFormation](../../README.md#deploy-with-cloudformation) in the root
README has the commands), then deploy [`cfn/api-gateway.yaml`](../../cfn/api-gateway.yaml) from the repository root:

```bash
aws cloudformation deploy --region us-east-1 --template-file cfn/api-gateway.yaml --stack-name cloudfront-mcp-api-gateway \
  --s3-bucket <a bucket of yours in us-east-1> \
  --parameter-overrides ImageRepository=cloudfront-mcp-hello --capabilities CAPABILITY_IAM --tags auto-delete=no
```

The stack outputs `ApiGatewayMcp` and, for a token with scope `mcp/api-gateway`, `TokenUrl`, `UserPoolId` and `ClientId`.
The template is larger than the 51,200 bytes CloudFormation accepts inline, so `--s3-bucket` names any bucket of
yours for the CLI to upload it to.

## Trade-offs

- Same container image as the other patterns, no Lambda-specific code. Cold starts are slower than a zip handler.
- API Gateway REST APIs time out at 29 seconds by default and buffer responses, so this server answers with JSON rather
  than a long-lived SSE stream.
- The private path adds fixed cost: an internal NLB and an `execute-api` interface endpoint in two Availability Zones.
  A regional REST API with only the WAF secret-header lock avoids that cost, but its endpoint stays public.
- An NLB rather than an ALB keeps TLS end to end to the endpoint, but cannot take a web ACL, so all regional WAF checks
  sit on the stage.
- The secret header is a shared secret: rotate it by updating the secret and redeploying.
