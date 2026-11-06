import { Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { mcpAuth } from '../../lib/auth';
import { helloImage, mcpDistribution, mcpOutputs, originSecret, PatternStackProps, viewerFunction } from '../../lib/edge';
import { mcpVpc } from '../../lib/vpc';
import { edgeWebAcl, originWebAcl } from '../../lib/waf';
import { apiGatewayOrigin } from './origin';

// Remote MCP server on a private Amazon API Gateway REST API, behind its own CloudFront distribution.
export class PatternMcpApiGatewayCloudFrontStack extends Stack {
  constructor(scope: Construct, id: string, props: PatternStackProps = {}) {
    super(scope, id, props);
    const auth = mcpAuth(this, 'mcp/api-gateway');
    const secret = originSecret(this);
    const origin = apiGatewayOrigin(this, {
      image: helloImage(this),
      originSecret: secret,
      originWafArn: originWebAcl(this, secret).attrArn,
      vpc: mcpVpc(this, { natGateways: 0 }), // the NLB and the execute-api endpoint need no egress
      auth,
    });
    const distribution = mcpDistribution(this, {
      comment: 'Remote MCP server on Amazon API Gateway',
      webAclId: edgeWebAcl(this, { botControl: props.botControl }).attrArn,
      origin,
      viewerFunction: viewerFunction(this, { auth }),
    });
    mcpOutputs(this, distribution, auth);
  }
}
