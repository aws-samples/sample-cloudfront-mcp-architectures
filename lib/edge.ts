import {
  aws_cloudfront as cloudfront,
  aws_ecr_assets as ecrAssets,
  aws_secretsmanager as secretsmanager,
  App,
  Aws,
  CfnOutput,
  Stack,
  StackProps,
  Tags,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { readFileSync } from 'fs';
import * as path from 'path';
import { McpAuth } from './auth';

// The pieces every pattern stack composes: the hello image, the secret origin header, the viewer-request function, the
// distribution and its outputs. The AWS WAF web ACLs are in waf.ts, the token issuer in auth.ts.

export interface PatternStackProps extends StackProps {
  // AWS WAF Bot Control on the edge web ACL, on unless -c botControl=false. It is billed separately (see waf.ts).
  botControl?: boolean;
}

// The CDK app of one pattern: its stack in us-east-1, where a CloudFront-scope web ACL must live.
export function patternApp(id: string, make: (app: App, id: string, props: PatternStackProps) => Stack): void {
  const app = new App();
  const botControl = !['false', false].includes(app.node.tryGetContext('botControl'));
  const stack = make(app, id, { env: { region: 'us-east-1' }, botControl });
  Tags.of(stack).add('auto-delete', 'no');
}

// The hello MCP server (server/) as a container image, built and pushed by the CDK.
export type HelloImage = ecrAssets.DockerImageAsset;
export function helloImage(scope: Construct, platform = ecrAssets.Platform.LINUX_ARM64): HelloImage {
  return new ecrAssets.DockerImageAsset(scope, 'HelloImage', { directory: path.join(__dirname, '..', 'server'), platform });
}

// Secret header CloudFront sends to the origin; the regional web ACL on the origin blocks requests without it.
export function originSecret(scope: Construct): string {
  return new secretsmanager.Secret(scope, 'OriginVerifySecret', {
    generateSecretString: { excludePunctuation: true, passwordLength: 32 },
  }).secretValue.unsafeUnwrap();
}

export interface ViewerFunctionProps {
  auth: McpAuth;
  // Answer the RFC 9728 metadata at the edge with this scope, for an origin whose own names the wrong resource URL.
  // Default: the origin serves it.
  answerMetadata?: boolean;
}

// Token pre-filter, claims header and x-forwarded-host (lib/viewer-request.js); the origin then checks the signature.
export function viewerFunction(scope: Construct, { auth, answerMetadata = false }: ViewerFunctionProps): cloudfront.Function {
  return new cloudfront.Function(scope, 'ViewerRequest', {
    functionName: `${Aws.STACK_NAME}-ViewerRequest`, // function names are unique per account: one per stack
    code: cloudfront.FunctionCode.fromInline(readFileSync(path.join(__dirname, 'viewer-request.js'), 'utf8')
      .replace("'JWT_ISSUER'", `'${auth.issuer}'`)
      .replace("'METADATA_SCOPE'", `'${answerMetadata ? auth.scope : ''}'`)),
    runtime: cloudfront.FunctionRuntime.JS_2_0,
  });
}

export interface McpDistributionProps {
  comment: string;
  // The CloudFront-scope web ACL (waf.ts edgeWebAcl).
  webAclId: string;
  origin: cloudfront.IOrigin;
  viewerFunction: cloudfront.IFunction;
}

// The pattern's distribution: MCP at /mcp, never cached; the RFC 9728 metadata at /.well-known/*, cached.
export function mcpDistribution(scope: Construct, { comment, webAclId, origin, viewerFunction: fn }: McpDistributionProps): cloudfront.Distribution {
  const behavior: cloudfront.BehaviorOptions = {
    origin,
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
    allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
    cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
    originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
    functionAssociations: [{ function: fn, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
  };
  return new cloudfront.Distribution(scope, 'Distribution', {
    comment,
    webAclId,
    defaultBehavior: behavior,
    additionalBehaviors: {
      '/.well-known/*': { ...behavior, allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS, cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED },
    },
  });
}

// The MCP URL and what a client needs to get a token from Amazon Cognito with the client credentials grant.
export function mcpOutputs(scope: Construct, distribution: cloudfront.Distribution, auth: McpAuth): void {
  new CfnOutput(scope, 'McpUrl', { value: `https://${distribution.distributionDomainName}/mcp` });
  new CfnOutput(scope, 'Scope', { value: auth.scope });
  new CfnOutput(scope, 'TokenUrl', { value: auth.tokenUrl });
  new CfnOutput(scope, 'UserPoolId', { value: auth.userPool.userPoolId });
  new CfnOutput(scope, 'ClientId', { value: auth.client.userPoolClientId });
}
