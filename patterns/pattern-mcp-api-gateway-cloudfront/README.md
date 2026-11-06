# Amazon API Gateway behind CloudFront

CloudFront → VPC origin → internal Network Load Balancer → `execute-api` VPC endpoint → private API Gateway REST API →
AWS Lambda running the hello image with Lambda Web Adapter.

A private API made reachable from the internet without exposing it. The REST API has no public endpoint. CloudFront
reaches it through a VPC origin, an internal NLB and an interface VPC endpoint, with TLS end to end. A Cognito
authorizer on every method verifies the token, so Lambda never runs for a bad one. The private path adds fixed cost (NLB
and endpoint in two Availability Zones), and the REST API's 29-second timeout rules out long SSE streams.

![API Gateway pattern: the edge (AWS WAF, the distribution, the CloudFront Function) and the Region (internal NLB and execute-api endpoint in isolated subnets, the private REST API with its regional AWS WAF and Cognito authorizer, Lambda, Amazon Cognito and the origin secret), numbered as below](../../docs/diagrams/pattern-mcp-api-gateway-cloudfront/pattern-mcp-api-gateway-cloudfront.svg)

1. **AWS WAF at the edge** runs the MCP rule stack ([root README](../../README.md#aws-waf-at-the-edge)) before
   anything else. Floods stop here, before they can cost a Lambda invocation.
2. **The CloudFront distribution** sends allowed requests through a
   [VPC origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html)
   to the NLB over HTTPS, with the secret `x-origin-verify` header (10) added. The origin domain is the API's own
   hostname, `<api-id>.execute-api.<region>.amazonaws.com`: CloudFront validates the endpoint's certificate against it
   and the Host header routes to this API. That hostname has no public DNS.
3. **The CloudFront Function** decodes the Bearer token and answers `401` at the edge for a missing, malformed, expired
   or foreign token. For a good token it sets `x-jwt-claims` for the regional web ACL (7) and `x-forwarded-host` for
   the server's metadata.
4. **The internal NLB** has private IPs only. Its security group admits port 443 only from the CloudFront managed prefix
   list `com.amazonaws.global.cloudfront.origin-facing` (VPC origin traffic keeps CloudFront's source IPs). It passes
   TCP 443 straight through, so TLS runs from CloudFront to the endpoint without being terminated. CloudFormation does
   not expose the endpoint's IPs, so a small inline Lambda (`endpoint-ips.js`) looks them up once as a custom resource.
5. **The `execute-api` VPC endpoint** is the only way into the API: the API's resource policy allows `execute-api:Invoke`
   only from this endpoint (`aws:SourceVpce`), and the public `execute-api` hostname answers 403. Its security group
   admits only the NLB.
6. **The private REST API** runs the regional web ACL (7), then its Cognito user pools authorizer, which verifies the
   token's signature and the `mcp/api-gateway` scope on every method before Lambda is invoked. Only
   `GET /.well-known/oauth-protected-resource/mcp` has no authorizer. Stage and usage-plan throttling per API key can be
   added here.
7. **AWS WAF on the stage** (`OriginWaf`) admits only requests with the secret header and an `mcp/` scope in
   `x-jwt-claims`. The security groups and the resource policy prove the request came from CloudFront through this
   endpoint, not that it came through *this* distribution with its edge rules. This web ACL does, and a workload inside
   the VPC that calls the NLB directly meets it too. An NLB takes no web ACL, so the stage is where it lives.
8. **AWS Lambda** runs the same arm64 hello image as the other patterns, through Lambda Web Adapter, and answers the
   `tools/call`. REST APIs time out at 29 seconds and buffer responses, so the server answers with JSON rather than a
   long-lived SSE stream. Container cold starts are slower than a zip handler.
9. **Amazon Cognito** issues the tokens and publishes the keys the authorizer verifies against.
10. **Secrets Manager** holds the random `x-origin-verify` value, read at deploy into the origin header (2) and the
    `OriginWaf` rule (7). Rotate it by updating the secret and redeploying.

The VPC (`10.1.0.0/16`, two Availability Zones) has isolated subnets and no NAT gateway: nothing in it needs egress.

## Deploy

```bash
npm ci                                        # at the repository root, once
cd patterns/pattern-mcp-api-gateway-cloudfront
npx cdk deploy
```

Needs Docker for the image. Then get a token with scope `mcp/api-gateway` and call `hello` as in the
[root README](../../README.md#deploy).
