# Diagrams

Each folder holds one diagram: `<name>.drawio` (the source, editable in [draw.io](https://app.diagrams.net) or draw.io
desktop) and two exports embedded in the READMEs, `<name>.svg` and `<name>.png`.

| Diagram | Shows |
|---|---|
| [overview](overview/overview.svg) | The stack: the four pattern distributions behind one CloudFront web ACL, their origins and the Amazon Cognito issuer |
| [pattern-1-agentcore](pattern-1-agentcore/pattern-1-agentcore.svg) | Pattern 1: secret header and regional AWS WAF on the AgentCore Gateway, Gateway JWT authorizer, Runtime behind it |
| [pattern-2-api-gateway](pattern-2-api-gateway/pattern-2-api-gateway.svg) | Pattern 2: VPC origin, internal NLB, `execute-api` VPC endpoint, private REST API with a Cognito authorizer, Lambda |
| [pattern-3-eks](pattern-3-eks/pattern-3-eks.svg) | Pattern 3: VPC origin, internal ALB with regional AWS WAF, MCP server pods on Amazon EKS registered by the AWS Load Balancer Controller |
| [pattern-4-web-function](pattern-4-web-function/pattern-4-web-function.svg) | Pattern 4: origin access control (SigV4) on the web function's regional endpoint |
| [pattern-5-alb](pattern-5-alb/pattern-5-alb.svg) | Pattern 5: VPC origin, internal ALB with regional AWS WAF, Fargate task, VPC endpoints instead of NAT |
| [mcp-auth-flow](mcp-auth-flow/mcp-auth-flow.svg) | The MCP authorization flow: 401 and discovery, the token, then the authorized calls |

The pattern diagrams follow the style of the [AWS Security Reference Architecture examples](https://github.com/aws-samples/aws-security-reference-architecture-examples):
official AWS Architecture Icons from draw.io's AWS4 library, AWS Cloud, Region, VPC and subnet boundaries in their
standard colors, and a black number on every resource that matches a numbered line and a heading in the pattern's
README, which is the legend. The request flow is drawn as labeled arrows. The overview and the authorization flow use
category-tinted containers with a legend inside the image. `drawio.mjs` encodes both; `build.mjs` defines each diagram
against it.

To change a diagram, edit its definition in `build.mjs` (or edit the `.drawio` directly in draw.io for a one-off), then
regenerate and export:

```bash
node docs/diagrams/build.mjs      # writes every <name>.drawio
node docs/diagrams/export.mjs     # <name>.png and <name>.svg; needs Docker (headless draw.io in a container)
```

`export.mjs` accepts diagram names to export a subset. The exports are rendered locally; nothing leaves the machine.

`assets/mcp.svg` is the Model Context Protocol mark, copied from
[modelcontextprotocol/modelcontextprotocol](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/favicon.svg)
(documentation assets, CC BY 4.0). It stands for the MCP client in the diagrams.
