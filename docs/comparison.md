# Comparing the patterns

Every pattern puts the same hello-world MCP server behind its own CloudFront distribution, serving MCP at
`https://<distribution>.cloudfront.net/mcp`, with a CloudFront-scope AWS WAF web ACL (`EdgeWaf`, shared by every
distribution in the stack) and, where the origin supports it, the regional web ACL `OriginWaf`. They differ in the origin, which decides how the origin is locked,
where authentication fits, how rate limiting works, what it costs and whether calls see cold starts.

| | Pattern | MCP URL (stack output) | Origin |
|---|---|---|---|
| 1 | [AgentCore](../patterns/1-agentcore/README.md) | `AgentCoreMcp` | Amazon Bedrock AgentCore Gateway, with AgentCore Runtime behind it |
| 2 | [API Gateway](../patterns/2-api-gateway/README.md) | `ApiGatewayMcp` | Private Amazon API Gateway REST API behind a VPC origin and an internal NLB, with AWS Lambda running the server image (Lambda Web Adapter) |
| 3 | [EKS](../patterns/3-eks/README.md) | none (guidance only) | Internal ALB or NLB through a VPC origin, with pods on Amazon EKS |
| 4 | [Web function](../patterns/4-web-function/README.md) | `WebFunctionMcp` | Lambda Web Function on its regional endpoint, locked with CloudFront origin access control |
| 5 | [ALB](../patterns/5-alb/README.md) | `AlbMcp` | Internal ALB through a VPC origin, with one AWS Fargate task |

## Side by side

| | 1 AgentCore | 2 API Gateway | 3 EKS | 4 Web function | 5 ALB + Fargate |
|---|---|---|---|---|---|
| **Origin can be private** | Not in this sample: the Gateway has an AWS PrivateLink endpoint, and a Gateway resource-based policy on `aws:SourceVpce` can close the public endpoint, but a VPC origin needs a load balancer in front of the endpoint (not built) | Yes: a private REST API, reached through a VPC origin to an internal NLB that passes TCP 443 through to an `execute-api` VPC endpoint | Yes: VPC origin to an internal ALB or NLB | No: the regional endpoint is public, but it refuses requests that CloudFront did not sign | Yes: VPC origin to an internal ALB |
| **AWS WAF at both layers** | Yes: CloudFront web ACL, plus the regional web ACL on the AgentCore Gateway | Yes: CloudFront web ACL, plus a regional web ACL on the REST API stage (the NLB takes none) | Yes with an ALB; with an NLB, only the CloudFront web ACL (an in-cluster gateway filters instead) | No: only the CloudFront web ACL | Yes: CloudFront web ACL, plus a regional web ACL on the ALB |
| **Origin lock** | Public Gateway endpoint: a regional WAF web ACL on the Gateway blocks requests without CloudFront's secret origin header. The Runtime accepts only the Gateway's role (SigV4) | No public endpoint: private REST API whose resource policy allows only the VPC endpoint; internal NLB security group from the CloudFront origin-facing prefix list; regional WAF on the stage blocks requests without CloudFront's secret origin header | No public endpoint: VPC origin to an internal load balancer, security group from CloudFront's VPC origin group, optional secret header rule | Public regional endpoint behind CloudFront origin access control (OAC): CloudFront signs every origin request with SigV4, and the web function's resource-based policy grants `cloudfront.amazonaws.com` `lambda:InvokeWebFunctionEndpoint` only for this distribution. Lambda@Edge origin-request and origin-response triggers are not supported on this behavior | No public endpoint: VPC origin to an internal ALB, security group from CloudFront's VPC origin group |
| **Strength of the lock** | Shared secret, enforced by WAF before the Gateway calls a target | Network, resource policy and security group, plus the shared secret | Network and security group | IAM (SigV4), enforced by Lambda before your code runs | Network and security group |
| **Where auth sits** | Edge pre-filter (decode, 401), then the AgentCore Gateway Cognito JWT authorizer | Edge pre-filter, then the regional WAF on the decoded scope, then a Cognito authorizer on the REST API | Edge, ALB JWT verification (HTTPS listener), an in-cluster gateway or the server | Edge pre-filter, then the hello server verifies the token (no regional WAF) | Edge pre-filter, then the regional WAF on the decoded scope, then the hello server (ALB JWT verification needs an HTTPS listener) |
| **Caching** | `/mcp` `CachingDisabled`; protected-resource metadata answered by the CloudFront Function (`FunctionGeneratedResponse`), because the Gateway's own document names the Gateway's hostname | `/mcp` `CachingDisabled`; metadata from the hello server, cached by `/.well-known/*` (`CachingOptimized`) | Same as pattern 5 | Same as pattern 2 | Same as pattern 2 |
| **Rate limiting** | CloudFront WAF rate rules, plus regional WAF on the Gateway | CloudFront WAF, plus API Gateway stage and usage-plan throttling per API key | CloudFront WAF, regional WAF on the ALB, in-cluster gateway limits | CloudFront WAF, plus an optional request-rate cap (`ThrottleConfig`) and environment cap (`ScalingConfig`) on the endpoint | CloudFront WAF, regional WAF on the ALB |
| **Cost shape** | Pay per use (Gateway calls, Runtime CPU and memory while a session runs) | Pay per request (API Gateway, Lambda), plus fixed: internal NLB and an `execute-api` interface endpoint in two Availability Zones | Fixed: EKS control plane, nodes or pods, load balancer | Pay per use | Fixed: Fargate task, ALB, VPC interface endpoints |
| **Idle cost** | None | None | Highest | None | Yes, while the task runs |
| **Cold start** | On a new Runtime session | On a new Lambda execution environment; the Web Adapter adds the server's own start-up time | None, pods stay running | Yes; measured at about 1.2 s to first byte on a direct cold call in a related sample | None, the task stays running |
| **Operations** | Least: managed MCP endpoint and runtime | Low | Most: cluster, nodes, controller, add-ons | Low | Moderate: one service, one VPC |
| **Stack in this repo** | Yes | Yes | No | Yes | Yes |

Where the origin can be private, prefer it, and keep AWS WAF at both layers: the CloudFront web ACL
drops floods and bad bots at the edge, and the regional web ACL on the origin enforces the secret
header and tighter, origin-specific rules on what is left.

## What CloudFront adds, per pattern

All patterns get the same base from CloudFront: one domain and TLS certificate for every MCP
server (one distribution each), AWS WAF and AWS Shield Standard at the edge, warm connections from edge locations to the
origin, a token pre-filter at the edge, and cached `/.well-known/` OAuth metadata. What changes is what the origin
lacks on its own.

| Pattern | What CloudFront adds beyond the base |
|---|---|
| 1 AgentCore | A custom domain and edge WAF in front of a managed endpoint that has neither; one front door for a gateway that serves one Region |
| 2 API Gateway | Edge WAF in front of the regional WAF, so floods stop at the edge; a VPC origin makes a private API reachable from the internet without exposing it |
| 3 EKS | A way in without a public load balancer; edge WAF before cluster capacity is used; failover between clusters |
| 4 Web function | Edge WAF and rate limits; an edge function can route to more than one Region |
| 5 ALB + Fargate | A way in without a public load balancer or NAT gateway; edge WAF before the task is used |

## Choosing a pattern

- **You want the least to run, and you build on Amazon Bedrock:** pattern 1. AgentCore Gateway
  also brings tool targets, its own authorizer and policy. Accept a public endpoint locked by a WAF-checked secret header, and tool names prefixed with the target (`hello___hello`).
- **You want pay-per-request and API keys, usage plans or an existing API Gateway estate:**
  pattern 2.
- **You already run EKS and want the MCP server next to the services it calls:** pattern 3. The
  origin is private and has no cold start, but you pay for capacity while idle.
- **You want a private origin and a container without a cluster:** pattern 5.
- **You want pay-per-use compute with no VPC, and an origin lock that rests on IAM rather than a
  shared secret:** pattern 4.

## Things every pattern shares

- **Stateless MCP.** The sample server runs Streamable HTTP in stateless mode, so any instance can
  answer any call and no pattern needs sticky sessions.
- **No caching of MCP calls.** `/mcp` uses `CachingDisabled` and forwards all viewer headers except
  `Host`. `/.well-known/*` uses `CachingOptimized`, so discovery after a `401` is answered at the edge.
- **One distribution per pattern.** Each serves MCP at its root `/mcp`, so a pattern can be copied out
  on its own.
- **Every pattern requires an Amazon Cognito access token.** The CloudFront Function decodes it and answers `401`
  at the edge for a missing, expired or foreign token, pointing at the origin's cached `/.well-known` metadata. It
  cannot verify RS256, so each origin checks the signature with its native verifier, or in the hello server where the
  origin has none. See [Authentication](../README.md#authentication).
