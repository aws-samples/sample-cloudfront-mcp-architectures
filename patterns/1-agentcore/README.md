# Pattern 1: Amazon Bedrock AgentCore

Its own CloudFront distribution (`/mcp`, stack output `AgentCoreMcp`) → Amazon Bedrock AgentCore Gateway → AgentCore Runtime running the hello image.

![Pattern 1: CloudFront, regional AWS WAF on the AgentCore Gateway, Gateway JWT authorizer, AgentCore Runtime](../../docs/diagrams/pattern-1-agentcore/pattern-1-agentcore.svg)

## How it works

- AgentCore Runtime runs the shared arm64 hello image with the MCP protocol: the Runtime serves the container's
  `POST :8000/mcp`. Its inbound authorizer is IAM, so only SigV4-signed callers with `bedrock-agentcore:InvokeAgentRuntime`
  can reach it.
- AgentCore Gateway has one MCP server target, `hello`, whose endpoint is the Runtime's invocation URL. The Gateway signs
  calls to the Runtime with its own service role (outbound IAM auth, service `bedrock-agentcore`), and that role is the
  only principal allowed to invoke the Runtime.
- The Gateway prefixes every tool with its target name, so clients call `hello___hello`, not `hello`. The
  CloudFront web ACL's tool allowlist accepts both forms.
- The Gateway accepts MCP protocol versions `2025-06-18` and `2025-11-25`, the ones the edge web ACL lets through. Its
  default is `2025-03-26` only, which the edge would reject.
- CloudFront's origin is the Gateway's own hostname, `<gateway-id>.gateway.bedrock-agentcore.<region>.amazonaws.com`.
  The distribution's default behavior forwards the path as is, so the Gateway receives `/mcp`.

## How the origin is locked down

The Gateway endpoint is public. CloudFront adds the secret header `x-origin-verify` to every origin request, and a
regional AWS WAF web ACL associated with the Gateway allows only requests that carry the exact value (default action:
block). A call straight to the Gateway is answered by the Gateway itself with HTTP 403 and the JSON-RPC error `-32002`
(`Forbidden - Request blocked by AWS WAF`) and never reaches the Runtime. The Gateway's WAF failure mode is left at its
default, `FAIL_CLOSE`.

The Runtime has no lock of its own to CloudFront because CloudFront never calls it: it accepts only the Gateway's role.

### Why not a private origin

A stricter lock is possible but is not built here. The Gateway has an AWS PrivateLink interface endpoint, and a
Gateway resource-based policy can deny requests whose `aws:SourceVpce` is not that endpoint, which closes the public
endpoint. CloudFront cannot use that endpoint directly, though: VPC origins reach only an ALB, an NLB or an EC2
instance. You would need a load balancer in front of the endpoint's network interfaces and a TLS setup where the name
CloudFront checks matches the certificate the origin presents. That is more infrastructure than the other patterns and
was not tested in this sample.

## Where authentication sits

In the Gateway. Its inbound authorizer is `GatewayAuthorizer.usingCognito`: it checks each access token's signature
against the user pool's discovery URL, and allows only the stack's app client and the scope `mcp/agentcore`. CloudFront
forwards the viewer's `Authorization` header (`ALL_VIEWER_EXCEPT_HOST_HEADER`). In front of it, the CloudFront Function
answers `401` for a missing, expired or foreign token without calling the Gateway, and the regional WAF requires the
scope in the decoded claims. See [Authentication](../../README.md#authentication).

The Gateway publishes its own protected-resource metadata, but names its own hostname as `resource`, not the
distribution's `/mcp` that clients call, and an MCP client must refuse a document whose `resource` differs from the URL
it called. So this distribution's CloudFront Function answers `/.well-known/oauth-protected-resource/mcp` itself, with
`resource` set to `https://<distribution>/mcp`, the Cognito issuer and the scope `mcp/agentcore`. The answer comes from
the edge location (`x-cache: FunctionGeneratedResponse`), so the Gateway never sees discovery traffic.

## Rate limiting

CloudFront-scope AWS WAF rate rules at the edge, plus any rate rule you add to the regional web ACL on the Gateway.

## What CloudFront adds

- A custom domain and the edge web ACL (MCP protocol version, body size, tool allowlist, per-IP rate limit) in front of
  a managed endpoint that has neither.
- TLS termination and connection reuse to the regional Gateway from edge locations close to the client.

## Deploy with CloudFormation

Push the hello image first ([Deploy with CloudFormation](../../README.md#deploy-with-cloudformation) in the root
README has the commands), then deploy [`cfn/agentcore.yaml`](../../cfn/agentcore.yaml) from the repository root:

```bash
aws cloudformation deploy --region us-east-1 --template-file cfn/agentcore.yaml --stack-name cloudfront-mcp-agentcore \
  --parameter-overrides ImageRepository=cloudfront-mcp-hello --capabilities CAPABILITY_IAM --tags auto-delete=no
```

The stack outputs `AgentCoreMcp` and, for a token with scope `mcp/agentcore`, `TokenUrl`, `UserPoolId` and `ClientId`.
The Runtime (`<stack name>_hello`, hyphens turned into underscores), the Gateway and the CloudFront Function take their
names from the stack name, so the template deploys beside the CDK stack or another copy in the same account. Keep the
stack name to 40 characters: the Function name holds at most 64 and the Runtime name 48.

## Trade-offs

- The least to run: no VPC, no load balancer, no idle compute. The Runtime starts a session on demand, so the first
  call after idle sees a cold start.
- Tool names change: clients see `<target>___<tool>`. One Gateway can aggregate many targets (MCP servers, Lambda
  functions, OpenAPI or Smithy APIs) behind one MCP endpoint.
- The lock rests on a shared secret checked by WAF, not on the network. Rotate it by updating the secret and redeploying.
