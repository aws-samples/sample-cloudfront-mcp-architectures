import { aws_bedrockagentcore as agentcore, aws_cloudfront as cloudfront, aws_cloudfront_origins as origins, aws_wafv2 as wafv2, Aws, Fn, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { PATTERN_SCOPES } from '../../lib/auth';
import { ORIGIN_VERIFY_HEADER, OriginProps } from '../../lib/waf';

// CloudFront -> AgentCore Gateway -> AgentCore Runtime (hello image, MCP protocol).
// The Gateway endpoint is public; the regional web ACL on the Gateway blocks any request that lacks CloudFront's secret header,
// and the Gateway's Amazon Cognito authorizer checks each token's signature and scope.
// The Gateway calls the Runtime with SigV4 from its own role, so the Runtime accepts nothing else.
export function agentCoreOrigin(scope: Construct, { image, originSecret, originWafArn, auth }: OriginProps): cloudfront.IOrigin {
  const { region, account, partition } = Stack.of(scope);

  // Names derive from the stack name, so the template deploys beside another copy in one account.
  // shortcut: a Runtime name is at most 48 characters of [a-zA-Z0-9_], and the viewer function name 64, so keep the stack name to 40 characters.
  const runtime = new agentcore.Runtime(scope, 'AgentCoreHello', {
    runtimeName: Fn.join('_', Fn.split('-', `${Aws.STACK_NAME}-hello`)),
    agentRuntimeArtifact: agentcore.AgentRuntimeArtifact.fromEcrRepository(image.repository, image.imageTag),
    protocolConfiguration: agentcore.ProtocolType.MCP, // serves POST :8000/mcp; inbound auth defaults to IAM
  });

  const gateway = new agentcore.Gateway(scope, 'AgentCoreGateway', {
    gatewayName: `${Aws.STACK_NAME}-hello`,
    authorizerConfiguration: agentcore.GatewayAuthorizer.usingCognito({
      userPool: auth.userPool,
      allowedClients: [auth.client],
      allowedScopes: [PATTERN_SCOPES.agentCore],
    }),
    // The default is 2025-03-26 only; match the versions the edge web ACL lets through.
    protocolConfiguration: agentcore.GatewayProtocol.mcp({
      supportedVersions: [agentcore.MCPProtocolVersion.MCP_2025_06_18, agentcore.MCPProtocolVersion.of('2025-11-25')],
    }),
  });
  runtime.grantInvokeRuntime(gateway.role);

  // The Runtime's MCP endpoint takes its own URL-encoded ARN in the path.
  const encodedArn = `arn%3A${partition}%3Abedrock-agentcore%3A${region}%3A${account}%3Aruntime%2F${runtime.agentRuntimeId}`;
  const target = gateway.addMcpServerTarget('AgentCoreHelloTarget', {
    gatewayTargetName: 'hello', // the Gateway prefixes tools with their target: clients call `hello___hello`
    endpoint: `https://bedrock-agentcore.${region}.amazonaws.com/runtimes/${encodedArn}/invocations?qualifier=DEFAULT`,
    credentialProviderConfigurations: [agentcore.GatewayCredentialProvider.fromIamRole({ service: 'bedrock-agentcore', region })],
  });
  // Creating the target lists the Runtime's tools, so the role's invoke policy must exist first.
  target.node.addDependency(gateway.role);

  new wafv2.CfnWebACLAssociation(scope, 'AgentCoreGatewayWafAssociation', {
    resourceArn: gateway.gatewayArn,
    webAclArn: originWafArn,
  });

  return new origins.HttpOrigin(`${gateway.gatewayId}.gateway.bedrock-agentcore.${region}.amazonaws.com`, {
    customHeaders: { [ORIGIN_VERIFY_HEADER]: originSecret },
  });
}
