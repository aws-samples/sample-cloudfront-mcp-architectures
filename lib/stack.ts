import {
  aws_cloudfront as cloudfront,
  aws_ecr as ecr,
  aws_ecr_assets as ecrAssets,
  aws_secretsmanager as secretsmanager,
  Aws,
  CfnOutput,
  CfnParameter,
  Stack,
  StackProps,
} from 'aws-cdk-lib';
import { readFileSync } from 'fs';
import { Construct } from 'constructs';
import * as path from 'path';
import { agentCoreOrigin } from '../patterns/1-agentcore/origin';
import { apiGatewayOrigin } from '../patterns/2-api-gateway/origin';
import { albOrigin } from '../patterns/5-alb/origin';
import { webFunctionOrigin } from '../patterns/4-web-function/origin';
import { mcpAuth, PATTERN_SCOPES } from './auth';
import { sharedVpc } from './vpc';
import { edgeWebAcl, originWebAcl } from './waf';

export type Pattern = 'agentcore' | 'api-gateway' | 'web-function' | 'alb';

export interface CloudFrontMcpSamplesProps extends StackProps {
  // Only this pattern and the shared pieces it needs, with its image or code as parameters instead of CDK assets: the
  // template under cfn/. Unset: every pattern.
  pattern?: Pattern;
  // AWS WAF Bot Control on the edge web ACL, on unless -c botControl=false. It is billed separately.
  botControl?: boolean;
}

export class CloudFrontMcpSamplesStack extends Stack {
  constructor(scope: Construct, id: string, props: CloudFrontMcpSamplesProps = {}) {
    super(scope, id, props);
    const { pattern, botControl } = props;
    const has = (p: Pattern) => !pattern || pattern === p;
    // Shared pieces, created on first use, so a single-pattern template holds only what its pattern needs.
    const once = <T,>(make: () => T) => { let value: T | undefined; return () => (value ??= make()); };

    // One hello MCP server image, run by every compute origin. A template takes an image you push to your own repository.
    const image = once(() => pattern
      ? {
        repository: ecr.Repository.fromRepositoryName(this, 'HelloRepository', new CfnParameter(this, 'ImageRepository', {
          description: 'Amazon ECR repository in this account and Region holding the hello image (linux/arm64)',
        }).valueAsString),
        imageTag: new CfnParameter(this, 'ImageTag', { default: 'latest', description: 'Tag of the hello image' }).valueAsString,
      }
      : new ecrAssets.DockerImageAsset(this, 'HelloImage', {
        directory: path.join(__dirname, '..', 'server'),
        platform: ecrAssets.Platform.LINUX_ARM64,
      }));

    // Secret header CloudFront sends to every origin; the regional web ACL on each origin blocks requests without it.
    const originSecret = once(() => new secretsmanager.Secret(this, 'OriginVerifySecret', {
      generateSecretString: { excludePunctuation: true, passwordLength: 32 },
    }).secretValue.unsafeUnwrap());
    const originWaf = once(() => originWebAcl(this, originSecret()));
    const vpc = once(() => sharedVpc(this));
    const auth = mcpAuth(this, { stackIdDomain: !!pattern });
    const origin = () => ({ image: image(), originSecret: originSecret(), originWafArn: originWaf().attrArn, vpc: vpc(), auth });

    const webAclId = edgeWebAcl(this, { botControl }).attrArn;

    // Token pre-filter, claims header and x-forwarded-host; each origin then checks the token's signature.
    const viewerFunction = (id: string, metadataScope: string) => new cloudfront.Function(this, id, {
      functionName: `${Aws.STACK_NAME}-${id}`, // function names are unique per account: one per stack, so a template deploys twice
      code: cloudfront.FunctionCode.fromInline(readFileSync(path.join(__dirname, 'viewer-request.js'), 'utf8')
        .replace("'JWT_ISSUER'", `'${auth.issuer}'`)
        .replace("'METADATA_SCOPE'", `'${metadataScope}'`)),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });
    const viewerRequest = once(() => viewerFunction('ViewerRequest', ''));

    // One distribution per pattern, each serving MCP at its root /mcp, so a customer can lift out the one they pick.
    const mcpBehavior = (origin: cloudfront.IOrigin, fn: cloudfront.IFunction): cloudfront.BehaviorOptions => ({
      origin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      functionAssociations: [{ function: fn, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
    });
    // Each origin serves its own RFC 9728 metadata at /.well-known/oauth-protected-resource/mcp; CloudFront caches it.
    const mcpDistribution = (id: string, comment: string, origin: cloudfront.IOrigin, fn = viewerRequest()) => new cloudfront.Distribution(this, id, {
      comment,
      webAclId,
      defaultBehavior: mcpBehavior(origin, fn),
      additionalBehaviors: {
        '/.well-known/*': { ...mcpBehavior(origin, fn), allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS, cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED },
      },
    });
    const mcpUrl = (d: cloudfront.Distribution) => `https://${d.distributionDomainName}/mcp`;

    if (has('agentcore')) {
      // AgentCore Gateway's own metadata names the Gateway's hostname as the resource, so this distribution's function answers it.
      const distribution = mcpDistribution('AgentCoreDistribution', 'Pattern 1: remote MCP server on Amazon Bedrock AgentCore',
        agentCoreOrigin(this, origin()), viewerFunction('AgentCoreViewerRequest', PATTERN_SCOPES.agentCore));
      new CfnOutput(this, 'AgentCoreMcp', { value: mcpUrl(distribution) });
    }
    if (has('api-gateway')) {
      const distribution = mcpDistribution('ApiGatewayDistribution', 'Pattern 2: remote MCP server on Amazon API Gateway', apiGatewayOrigin(this, origin()));
      new CfnOutput(this, 'ApiGatewayMcp', { value: mcpUrl(distribution) });
    }
    if (has('web-function')) {
      const webFunction = webFunctionOrigin(this, {
        auth,
        // Unset: the pattern uploads the server code itself, through a CDK asset.
        code: pattern && {
          bucket: new CfnParameter(this, 'CodeBucket', { description: 'Versioned S3 bucket holding the server zip; its policy must let lambda.amazonaws.com read it' }).valueAsString,
          key: new CfnParameter(this, 'CodeKey', { default: 'hello.zip', description: 'Key of the server zip' }).valueAsString,
          versionId: new CfnParameter(this, 'CodeVersionId', { description: 'Version ID of the server zip' }).valueAsString,
        },
      });
      const distribution = mcpDistribution('WebFunctionDistribution', 'Pattern 4: remote MCP server on a Lambda Web Function', webFunction.origin);
      webFunction.grant(distribution);
      new CfnOutput(this, 'WebFunctionMcp', { value: mcpUrl(distribution) });
    }
    if (has('alb')) {
      const distribution = mcpDistribution('AlbDistribution', 'Pattern 5: remote MCP server behind an Application Load Balancer', albOrigin(this, origin()));
      new CfnOutput(this, 'AlbMcp', { value: mcpUrl(distribution) });
    }

    // Get a token from Amazon Cognito with the client credentials grant (see the README).
    new CfnOutput(this, 'TokenUrl', { value: auth.tokenUrl });
    new CfnOutput(this, 'UserPoolId', { value: auth.userPool.userPoolId });
    new CfnOutput(this, 'ClientId', { value: auth.client.userPoolClientId });
  }
}
