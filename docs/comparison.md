# Comparing the patterns

Every pattern puts the same hello-world MCP server behind its own CloudFront distribution, with the same edge web ACL,
CloudFront Function and Amazon Cognito token flow. They differ in the origin, which decides how the origin is locked,
where authentication fits, what it costs and whether calls see cold starts.

| | AgentCore | API Gateway | EKS | Web Function |
|---|---|---|---|---|
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

- **The least to run, building on Amazon Bedrock:** AgentCore. Accept a public endpoint locked by a WAF-checked secret
  header, and tool names prefixed with the target (`hello___hello`).
- **Pay per request with API keys, usage plans or an existing API Gateway estate:** API Gateway.
- **You run containers on Kubernetes and want the MCP server next to the services it calls:** EKS. No cold start, but
  you pay for capacity while idle.
- **Pay-per-use compute with no VPC, and an origin lock that rests on IAM rather than a shared secret:** Web Function.
