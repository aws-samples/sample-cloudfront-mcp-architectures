# Comparing the patterns

Every pattern puts the same hello-world MCP server behind its own CloudFront distribution, with the same edge web ACL,
CloudFront Function, and Amazon Cognito token flow. The patterns differ in the origin. The origin decides how it is
locked to CloudFront, where authentication fits, what it costs, and whether calls see cold starts.

The following table compares the four patterns.

| | AgentCore | API Gateway | EKS | Web Function |
|---|---|---|---|---|
| **Who runs the MCP server** | AgentCore (managed) | You, on Lambda | You, on EKS Auto Mode | You, on a Lambda Web Function |
| **Origin** | AgentCore Gateway, Runtime behind it | Private REST API through a VPC origin, internal NLB and `execute-api` endpoint, with Lambda running the image | Internal ALB through a VPC origin, with pods on an EKS Auto Mode cluster | Lambda Web Function on its regional endpoint |
| **Origin is private** | No: the Gateway endpoint is public. A PrivateLink endpoint plus a resource policy can close it, but a VPC origin then needs a load balancer in front (not built) | Yes | Yes | No, but the endpoint refuses anything CloudFront did not sign |
| **Origin lock** | Secret header, checked by a regional web ACL before the Gateway calls a target. The Runtime accepts only the Gateway's role | Resource policy on `aws:SourceVpce`, security groups from the CloudFront prefix list, plus the secret header on the stage | Security groups from the CloudFront prefix list, plus the secret header on the ALB | IAM: SigV4 through OAC, enforced by Lambda's resource policy before the code runs |
| **AWS WAF layers** | Edge, plus regional on the Gateway | Edge, plus regional on the API stage (an NLB takes none) | Edge, plus regional on the ALB | Edge only |
| **Token verified by** | Gateway JWT authorizer | Cognito authorizer on every method | The server (ALB JWT verification needs an HTTPS listener) | The server |
| **Rate limiting** | Edge rules, plus the regional web ACL | Edge rules, plus API Gateway throttling and usage plans | Edge rules, plus the regional web ACL and anything in the cluster | Edge rules, plus `ThrottleConfig` and `ScalingConfig` on the endpoint |
| **Cost shape** | Pay per use | Pay per request, plus a fixed NLB and interface endpoint | Fixed: cluster, nodes, ALB, NAT gateway | Pay per use |
| **Cold start** | On a new Runtime session | On a new Lambda environment, plus the container start | None | On a new execution environment |
| **Operations** | Least: a managed MCP endpoint | Low | Most: a cluster, even with Auto Mode | Low |
| **What CloudFront adds** | A custom domain and edge WAF for a managed endpoint that has neither | A public entry point to a private API, and edge WAF ahead of the regional one | A way in without a public load balancer, and edge WAF before cluster capacity is used | Edge WAF and rate limits the endpoint lacks |

## Choosing a pattern

The right pattern depends on what you run today and what you want to operate.

- Choose AgentCore if you want the least to run and you build on Amazon Bedrock. You accept a public endpoint that a
  WAF-checked secret header locks, and tool names prefixed with the target, such as `hello___hello`.
- Choose API Gateway if you want to pay for each request and use API keys, usage plans, or an existing API Gateway
  estate.
- Choose EKS if you run containers on Kubernetes and want the MCP server next to the services that it calls. There is
  no cold start, but you pay for capacity while idle.
- Choose Lambda Web Function if you want pay-per-use compute with no VPC and an origin lock that rests on IAM rather
  than a shared secret.
