import { aws_ecr_assets as ecrAssets, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { mcpAuth } from '../../lib/auth';
import { helloImage, mcpDistribution, mcpOutputs, originSecret, PatternStackProps, viewerFunction } from '../../lib/edge';
import { mcpVpc } from '../../lib/vpc';
import { edgeWebAcl, originWebAcl } from '../../lib/waf';
import { eksOrigin } from './origin';

// Remote MCP server on Amazon EKS behind an internal Application Load Balancer, behind its own CloudFront distribution.
export class PatternMcpEksCloudFrontStack extends Stack {
  constructor(scope: Construct, id: string, props: PatternStackProps = {}) {
    super(scope, id, props);
    const auth = mcpAuth(this, 'mcp/eks');
    const secret = originSecret(this);
    const origin = eksOrigin(this, {
      image: helloImage(this, ecrAssets.Platform.LINUX_AMD64), // Auto Mode's general-purpose node pool is amd64
      originSecret: secret,
      originWafArn: originWebAcl(this, secret).attrArn,
      vpc: mcpVpc(this, { natGateways: 1 }), // nodes pull images and the pods fetch the Cognito keys through it
      auth,
    });
    const distribution = mcpDistribution(this, {
      comment: 'Remote MCP server on Amazon EKS',
      webAclId: edgeWebAcl(this, { botControl: props.botControl }).attrArn,
      origin,
      viewerFunction: viewerFunction(this, { auth }),
    });
    mcpOutputs(this, distribution, auth);
  }
}
