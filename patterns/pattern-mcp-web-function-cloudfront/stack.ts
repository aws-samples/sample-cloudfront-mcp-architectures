import { Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { mcpAuth } from '../../lib/auth';
import { mcpDistribution, mcpOutputs, PatternStackProps, viewerFunction } from '../../lib/edge';
import { edgeWebAcl } from '../../lib/waf';
import { webFunctionOrigin } from './origin';

// Remote MCP server on a Lambda Web Function, behind its own CloudFront distribution. No VPC, no secret header and no
// regional web ACL: the origin lock is IAM, through origin access control.
export class PatternMcpWebFunctionCloudFrontStack extends Stack {
  constructor(scope: Construct, id: string, props: PatternStackProps = {}) {
    super(scope, id, props);
    const auth = mcpAuth(this, 'mcp/web-function');
    const webFunction = webFunctionOrigin(this, auth);
    const distribution = mcpDistribution(this, {
      comment: 'Remote MCP server on a Lambda Web Function',
      webAclId: edgeWebAcl(this, { botControl: props.botControl }).attrArn,
      origin: webFunction.origin,
      viewerFunction: viewerFunction(this, { auth }),
    });
    webFunction.grant(distribution);
    mcpOutputs(this, distribution, auth);
  }
}
