# Amazon Bedrock AgentCore behind CloudFront

CloudFront → Amazon Bedrock AgentCore Gateway → AgentCore Runtime running the hello image.

The managed path: nothing to run and no VPC. The Gateway is a public endpoint, so a regional AWS WAF web ACL on it
accepts only requests carrying CloudFront's secret header. The Gateway's own JWT authorizer verifies the token before
any target is called, and the Runtime accepts only the Gateway's role. The first call after idle sees a cold start, and
tool names arrive as `<target>___<tool>` (`hello___hello`).

![AgentCore pattern: the edge (AWS WAF, the distribution, the CloudFront Function) and the Region (regional AWS WAF on the AgentCore Gateway, the Gateway, the Runtime, Amazon Cognito and the origin secret), numbered as below](../../docs/diagrams/pattern-mcp-agentcore-cloudfront/pattern-mcp-agentcore-cloudfront.svg)

1. **AWS WAF at the edge** runs the MCP rule stack ([root README](../../README.md#aws-waf-at-the-edge)) before
   anything else. Its tool allowlist accepts `hello___hello`, the Gateway's name for the tool, and the Gateway is
   configured for protocol versions `2025-06-18` and `2025-11-25`, the ones the edge lets through (its default is
   `2025-03-26` only).
2. **The CloudFront distribution** forwards to the Gateway's public hostname,
   `<gateway-id>.gateway.bedrock-agentcore.<region>.amazonaws.com`, over HTTPS, with the secret `x-origin-verify`
   header (8) added. CloudFront adds a custom domain and an edge web ACL to a managed endpoint that has neither.
3. **The CloudFront Function** decodes the Bearer token and answers `401` at the edge for a missing, malformed, expired
   or foreign token. It also answers `GET /.well-known/oauth-protected-resource/mcp` itself, because the Gateway's own
   document names the Gateway's hostname as `resource`, and an MCP client must refuse a document whose `resource`
   differs from the URL it called.
4. **AWS WAF on the Gateway** (`OriginWaf`) is the origin lock. The Gateway endpoint is public and takes no security
   group or resource policy that can name CloudFront, so the shared secret checked here is what keeps direct callers
   out: a call straight to the Gateway gets 403 and never reaches the Runtime. The web ACL also requires an `mcp/`
   scope in `x-jwt-claims`. A private alternative, not built: the Gateway's AWS PrivateLink endpoint plus a resource
   policy on `aws:SourceVpce`, which would need a load balancer in front of the endpoint for the VPC origin.
5. **The AgentCore Gateway** verifies the token's signature and the `mcp/agentcore` scope with its Cognito authorizer
   (`GatewayAuthorizer.usingCognito`, allowing only the stack's app client), then calls its one MCP server target,
   `hello`, signing with its own role.
6. **The AgentCore Runtime** runs the hello image with the MCP protocol (`POST :8000/mcp`). Its inbound authorizer is
   IAM: only the Gateway's role, with `bedrock-agentcore:InvokeAgentRuntime`, can invoke it. It starts a session on
   demand, hence the cold start.
7. **Amazon Cognito** issues the tokens and publishes the discovery document and keys the Gateway verifies against.
8. **Secrets Manager** holds the random `x-origin-verify` value, read at deploy into the origin header (2) and the
   `OriginWaf` rule (4). Rotate it by updating the secret and redeploying.

## Deploy

```bash
npm ci                                      # at the repository root, once
cd patterns/pattern-mcp-agentcore-cloudfront
npx cdk deploy
```

Needs Docker for the image. The Runtime, Gateway and CloudFront Function take their names from the stack name. Keep it
to 40 characters (a Runtime name holds 48, a function name 64). Then get a token with scope `mcp/agentcore` and call
`hello___hello` as in the [root README](../../README.md#deploy).
