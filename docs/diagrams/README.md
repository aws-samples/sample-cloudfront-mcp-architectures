# Diagrams

Each folder holds one diagram: `<name>.drawio` (the source, editable in [draw.io](https://app.diagrams.net)) and two
exports embedded in the READMEs, `<name>.svg` and `<name>.png`.

| Diagram | Shows |
|---|---|
| [pattern-mcp-agentcore-cloudfront](pattern-mcp-agentcore-cloudfront/pattern-mcp-agentcore-cloudfront.svg) | Secret header and regional AWS WAF on the AgentCore Gateway, Gateway JWT authorizer, Runtime behind it |
| [pattern-mcp-api-gateway-cloudfront](pattern-mcp-api-gateway-cloudfront/pattern-mcp-api-gateway-cloudfront.svg) | VPC origin, internal NLB, `execute-api` VPC endpoint, private REST API with a Cognito authorizer, Lambda |
| [pattern-mcp-eks-cloudfront](pattern-mcp-eks-cloudfront/pattern-mcp-eks-cloudfront.svg) | VPC origin, internal ALB with regional AWS WAF, pods on EKS Auto Mode bound with a TargetGroupBinding, NAT gateway |
| [pattern-mcp-web-function-cloudfront](pattern-mcp-web-function-cloudfront/pattern-mcp-web-function-cloudfront.svg) | Origin access control (SigV4) on the web function's regional endpoint |
| [mcp-auth-flow](mcp-auth-flow/mcp-auth-flow.svg) | The MCP authorization flow: 401 and discovery, the token, then the authorized call, numbered as in the root README |

The pattern diagrams follow the style of the [AWS Security Reference Architecture examples](https://github.com/aws-samples/aws-security-reference-architecture-examples):
official AWS Architecture Icons from draw.io's AWS4 library, AWS Cloud, Region, VPC and subnet boundaries in their
standard colors, and a black number on every resource that matches a numbered line in the pattern's README, which is
the legend. `drawio.mjs` emits the XML. `build.mjs` defines each diagram against it.

To change a diagram, edit its definition in `build.mjs`, then regenerate and export:

```bash
node docs/diagrams/build.mjs      # writes every <name>.drawio
node docs/diagrams/export.mjs     # <name>.png and <name>.svg. Needs Docker (headless draw.io in a container)
```

`export.mjs` accepts diagram names to export a subset. The exports are rendered locally. Nothing leaves the machine.

The MCP client icon is the MCP mark from the [modelcontextprotocol](https://github.com/modelcontextprotocol/modelcontextprotocol)
repository (`docs/favicon.svg`), used under CC BY 4.0 and kept in `assets/mcp.svg`.
