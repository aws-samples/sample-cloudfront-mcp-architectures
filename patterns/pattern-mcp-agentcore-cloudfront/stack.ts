import { Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { mcpAuth } from '../../lib/auth';
import { helloImage, mcpDistribution, mcpOutputs, originSecret, PatternStackProps, viewerFunction } from '../../lib/edge';
import { edgeWebAcl, originWebAcl } from '../../lib/waf';
import { agentCoreOrigin } from './origin';

// Remote MCP server on Amazon Bedrock AgentCore, behind its own CloudFront distribution.
export class PatternMcpAgentCoreCloudFrontStack extends Stack {
  constructor(scope: Construct, id: string, props: PatternStackProps = {}) {
    super(scope, id, props);
    const auth = mcpAuth(this, 'mcp/agentcore');
    const secret = originSecret(this);
    const origin = agentCoreOrigin(this, { image: helloImage(this), originSecret: secret, originWafArn: originWebAcl(this, secret).attrArn, auth });
    const distribution = mcpDistribution(this, {
      comment: 'Remote MCP server on Amazon Bedrock AgentCore',
      webAclId: edgeWebAcl(this, { botControl: props.botControl }).attrArn,
      origin,
      // AgentCore Gateway's own metadata names the Gateway's hostname as the resource, so the function answers it.
      viewerFunction: viewerFunction(this, { auth, answerMetadata: true }),
    });
    mcpOutputs(this, distribution, auth);
  }
}
