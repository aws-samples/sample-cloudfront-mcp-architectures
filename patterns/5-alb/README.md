# Pattern 5: Application Load Balancer

Its own CloudFront distribution (`/mcp`) → CloudFront VPC origin → internal Application Load Balancer → one AWS Fargate
task, in a VPC with two Availability Zones and no NAT gateway.

The common production shape for container workloads, with no public origin to protect. The ALB has only private IPs,
its security group admits only the CloudFront origin-facing prefix list, and it carries the regional web ACL, so a
workload inside the VPC cannot skip the edge rules either. The task verifies the token itself. It costs while idle: the
task, the ALB and four interface endpoints.

## Deployed resource details

![Pattern 5: the edge (AWS WAF, the distribution, the CloudFront Function) and the Region (regional AWS WAF, internal ALB, Fargate task and VPC endpoints in isolated subnets; Amazon Cognito and the origin secret), numbered as below](../../docs/diagrams/pattern-5-alb/pattern-5-alb.svg)

### 1.0 Amazon CloudFront edge

Global. Every request enters the edge location nearest the client, where TLS ends and where these three run, in this
order, before the Region sees anything.

#### 1.1 AWS WAF web ACL `EdgeWaf`

- CloudFront scope, shared by every pattern distribution in the stack ([lib/waf.ts](../../lib/waf.ts)). It runs before
  the CloudFront Function and before any origin, so a blocked request costs no origin work and no function invocation.
- The MCP rule stack from the AWS blog: IP reputation, rate limits per IP, per `initialize` and per tool, Bot Control
  labels, body size, JSON-RPC batch, protocol version, tool allowlist, then SSRF, destructive SQL, SQLi and XSS in tool
  arguments. The rule-by-rule table is in the [root README](../../README.md#aws-waf-at-the-edge).
- Inspects up to 32 KB of body behind a size preflight, so the argument rules can use `OversizeHandling: NO_MATCH`.
- Blocks answer a JSON-RPC error with HTTP 403 and an `x-mcp-waf-request-id` header.

#### 1.2 Amazon CloudFront distribution

- Serves MCP at its root `/mcp` with `CachingDisabled` and `ALL_VIEWER_EXCEPT_HOST_HEADER`, so the `Authorization`
  header and the JSON-RPC body reach the origin unchanged. `/.well-known/*` uses `CachingOptimized`, so the RFC 9728
  metadata is answered at the edge after the first fetch.
- Its origin is a [VPC origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html)
  to the internal ALB (2.2) over HTTP on port 80 inside the AWS network. Every origin request carries the secret
  `x-origin-verify` header (2.6). Use HTTPS with a certificate for your own domain on the ALB if your compliance rules
  require encryption to the origin.
- The stack output `AlbMcp` is this distribution's `https://<distribution>.cloudfront.net/mcp`.

#### 1.3 CloudFront Function (viewer request)

- [lib/viewer-request.js](../../lib/viewer-request.js), runtime 2.0. Decodes the Bearer JWT and answers `401` with
  `WWW-Authenticate: Bearer resource_metadata="https://<distribution>/.well-known/oauth-protected-resource/mcp"` for a
  token that is missing, malformed, expired, from another issuer or not an access token, without calling the origin.
- Does not check the signature: CloudFront Functions offer HMAC but no RSA verify. That check is 2.3's.
- Replaces any client-sent `x-jwt-claims` header with the decoded payload, so 2.1 can match on the scope, and sets
  `x-forwarded-host` so the server can name the distribution in its metadata.

### 2.0 us-east-1

The Region holds the VPC with the origin, plus the Cognito issuer and the origin secret. Resources 2.1 to 2.4 are in the
VPC's isolated subnets; 2.5 and 2.6 are regional services reached over AWS PrivateLink or at deploy time.

#### 2.1 AWS WAF web ACL `OriginWaf`

- Regional, on the ALB, shared with the AgentCore Gateway (pattern 1) and the REST API stage (pattern 2).
- Default block. Allows a request only with CloudFront's secret `x-origin-verify` header and an `mcp/` scope in
  `x-jwt-claims` (or the protected-resource metadata path, which carries no token). Ahead of that allow it repeats the
  tool labels and the four argument rules (destructive SQL, SSRF, SQLi, XSS), so a caller inside the VPC cannot skip
  them.
- An ALB inspects only the first 8 KB of a body and this web ACL has no size preflight, so its argument rules use
  `OversizeHandling: MATCH` and block a body they cannot fully see. The edge (1.1) inspects 32 KB, so a legitimate body
  between 8 and 32 KB is blocked here; raise the argument sizes your tools accept with that in mind, or inspect
  arguments at the edge only.
- Blocks are plain 403s, not the JSON-RPC error the edge returns: a client that came through CloudFront never sees them.

#### 2.2 Internal Application Load Balancer

- Internal scheme: private IPs only, unreachable from the internet. CloudFront reaches it through the VPC origin, which
  places elastic network interfaces in the VPC.
- Its security group allows port 80 only from the CloudFront managed prefix list
  `com.amazonaws.global.cloudfront.origin-facing` (VPC origin traffic keeps CloudFront's source IPs). The task security
  group allows traffic from the ALB only.
- HTTP listener on port 80, forwarding to the task on 8000. ALB JWT verification (`ListenerAction.authenticateJwt`) would
  be the native token check, but it works only on HTTPS listeners ("Actions of type 'jwt-validation' are supported only
  on HTTPS listeners"), and an HTTPS VPC origin needs a certificate for a domain you own. With one, move the check here.

#### 2.3 AWS Fargate task

- One task in an Amazon ECS service, running the hello MCP server image ([server/](../../server/), arm64, stateless
  Streamable HTTP on port 8000).
- Verifies each Cognito access token itself (`JWT_VERIFY=true`, [server/auth.js](../../server/auth.js)): RS256
  signature against the user pool's JWKS and the scope `mcp/alb`. A token for another pattern's scope is refused here
  even though 2.1 let it through (2.1 checks only for some `mcp/` scope, because the web ACL is shared).
- Serves the RFC 9728 protected-resource metadata at `/.well-known/oauth-protected-resource/mcp`, naming the
  distribution (from `x-forwarded-host`) as `resource` and the Cognito issuer as its authorization server.

#### 2.4 VPC endpoints

- No NAT gateway. The task pulls its image through interface endpoints for Amazon ECR (API and Docker) and an Amazon S3
  gateway endpoint, writes to Amazon CloudWatch Logs through an interface endpoint, and fetches the JWKS through a
  `cognito-idp` interface endpoint.
- The `cognito-idp` endpoint is not offered in every Availability Zone, so [lib/vpc.ts](../../lib/vpc.ts) pins the VPC
  to AZs that have it. AZ names map to different physical AZs in each account; check yours before you deploy.
- The VPC (`10.1.0.0/16`) is shared with pattern 2, whose internal NLB and `execute-api` endpoint sit in the same
  isolated subnets. CloudFront VPC origins require an internet gateway on the VPC, so it also has public subnets with
  nothing in them.

#### 2.5 Amazon Cognito user pool

- The one issuer for the stack ([lib/auth.ts](../../lib/auth.ts)): a resource server `mcp` with one scope per pattern
  and one app client using the client credentials grant. This pattern's scope is `mcp/alb`.
- The stack outputs `TokenUrl`, `UserPoolId` and `ClientId`; the [root README](../../README.md#deploy) shows how to
  get a token. See [Authentication](../../README.md#authentication) for why scopes stand in for an audience.

#### 2.6 AWS Secrets Manager secret

- A 32-character random value generated at deploy. The stack reads it into two places: the `x-origin-verify` custom
  header on the distribution's origin (1.2) and the matching rule in `OriginWaf` (2.1). Rotate it by changing both
  together.

## Deploy with CloudFormation

Push the hello image first ([Deploy with CloudFormation](../../README.md#deploy-with-cloudformation) in the root
README has the commands), then deploy [`cfn/alb.yaml`](../../cfn/alb.yaml) from the repository root:

```bash
aws cloudformation deploy --region us-east-1 --template-file cfn/alb.yaml --stack-name cloudfront-mcp-alb \
  --parameter-overrides ImageRepository=cloudfront-mcp-hello --capabilities CAPABILITY_IAM --tags auto-delete=no
```

The stack outputs `AlbMcp` and, for a token with scope `mcp/alb`, `TokenUrl`, `UserPoolId` and `ClientId`.

## Trade-offs

- The common production setup for container workloads, and no public origin to protect.
- Two AWS WAF layers, with the regional one on the ALB enforcing the secret header and the scope.
- Costs while idle: the Fargate task, the ALB and four interface endpoints in two Availability Zones.
- Token verification sits in the server rather than the ALB, until you bring a certificate for an HTTPS listener.
