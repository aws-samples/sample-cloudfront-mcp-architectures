// Synthesizes each pattern stack and checks what they have in common: one distribution behind the edge web ACL with the
// viewer function on /mcp and /.well-known/*, a Cognito issuer with the pattern's scope, the outputs a client needs, and
// the origin lock each pattern claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { register } from 'tsx/cjs/api';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';

// The stacks are CommonJS (they use __dirname, as cdk.json runs them), so load them through tsx's CommonJS hook.
register();
const require = createRequire(import.meta.url);
const stacks = {
  agentcore: { module: '../patterns/pattern-mcp-agentcore-cloudfront/stack.ts', cls: 'PatternMcpAgentCoreCloudFrontStack', scope: 'mcp/agentcore' },
  'api-gateway': { module: '../patterns/pattern-mcp-api-gateway-cloudfront/stack.ts', cls: 'PatternMcpApiGatewayCloudFrontStack', scope: 'mcp/api-gateway' },
  eks: { module: '../patterns/pattern-mcp-eks-cloudfront/stack.ts', cls: 'PatternMcpEksCloudFrontStack', scope: 'mcp/eks' },
  'web-function': { module: '../patterns/pattern-mcp-web-function-cloudfront/stack.ts', cls: 'PatternMcpWebFunctionCloudFrontStack', scope: 'mcp/web-function' },
};

const synth = (name, props = {}) => {
  const { module, cls } = stacks[name];
  const Stack = require(module)[cls];
  const stack = new Stack(new App(), 'Test', { env: { account: '111111111111', region: 'us-east-1' }, ...props });
  return Template.fromStack(stack);
};
const templates = Object.fromEntries(Object.keys(stacks).map((n) => [n, synth(n)]));

for (const [name, { scope }] of Object.entries(stacks)) {
  test(`${name}: one distribution behind the edge web ACL, with the viewer function on both behaviors`, () => {
    const t = templates[name];
    t.resourceCountIs('AWS::CloudFront::Distribution', 1);
    t.resourceCountIs('AWS::CloudFront::Function', 1);
    t.hasResourceProperties('AWS::WAFv2::WebACL', { Scope: 'CLOUDFRONT', DefaultAction: { Allow: {} } });
    const [dist] = Object.values(t.findResources('AWS::CloudFront::Distribution'));
    const cfg = dist.Properties.DistributionConfig;
    assert.ok(cfg.WebACLId, 'the distribution carries the edge web ACL');
    const behaviors = [cfg.DefaultCacheBehavior, ...cfg.CacheBehaviors];
    assert.deepEqual(cfg.CacheBehaviors.map((b) => b.PathPattern), ['/.well-known/*']);
    for (const b of behaviors) {
      assert.equal(b.ViewerProtocolPolicy, 'https-only');
      assert.equal(b.FunctionAssociations.length, 1);
      assert.equal(b.FunctionAssociations[0].EventType, 'viewer-request');
    }
    assert.equal(cfg.DefaultCacheBehavior.CachePolicyId, '4135ea2d-6df8-44a3-9df3-4b5a84be39ad', '/mcp is CachingDisabled');
    assert.equal(cfg.CacheBehaviors[0].CachePolicyId, '658327ea-f89d-4fab-a63d-7e88639e58f6', '/.well-known is CachingOptimized');
  });

  test(`${name}: its own Cognito issuer with the ${scope} scope, and the outputs a client needs`, () => {
    const t = templates[name];
    t.resourceCountIs('AWS::Cognito::UserPool', 1);
    const [, scopeName] = scope.split('/');
    t.hasResourceProperties('AWS::Cognito::UserPoolResourceServer', { Identifier: 'mcp', Scopes: [Match.objectLike({ ScopeName: scopeName })] });
    t.hasResourceProperties('AWS::Cognito::UserPoolClient', { AllowedOAuthFlows: ['client_credentials'], GenerateSecret: true, AllowedOAuthScopes: [{ 'Fn::Join': ['', [Match.anyValue(), `/${scopeName}`]] }] });
    t.hasOutput('Scope', { Value: scope });
    for (const o of ['McpUrl', 'TokenUrl', 'UserPoolId', 'ClientId']) t.hasOutput(o, {});
  });

  test(`${name}: Bot Control can be switched off`, () => {
    const t = synth(name, { botControl: false });
    const [acl] = Object.values(t.findResources('AWS::WAFv2::WebACL', { Properties: { Scope: 'CLOUDFRONT' } }));
    assert.ok(!acl.Properties.Rules.some((r) => r.Name === 'BotControlCommon'));
  });
}

test('patterns with a regional web ACL associate it with the origin, and the secret header reaches both', () => {
  for (const name of ['agentcore', 'api-gateway', 'eks']) {
    const t = templates[name];
    t.resourceCountIs('AWS::SecretsManager::Secret', 1);
    t.hasResourceProperties('AWS::WAFv2::WebACL', { Scope: 'REGIONAL', DefaultAction: { Block: {} } });
    t.resourceCountIs('AWS::WAFv2::WebACLAssociation', 1);
    const [dist] = Object.values(t.findResources('AWS::CloudFront::Distribution'));
    const [origin] = dist.Properties.DistributionConfig.Origins;
    assert.ok(origin.OriginCustomHeaders.some((h) => h.HeaderName === 'x-origin-verify'), `${name}: x-origin-verify on the origin`);
  }
});

test('web function: locked by OAC and a resource policy on this distribution, no secret and no regional web ACL', () => {
  const t = templates['web-function'];
  t.resourceCountIs('AWS::SecretsManager::Secret', 0);
  t.resourceCountIs('AWS::WAFv2::WebACL', 1);
  // The code bucket is private and encrypted: it is never served to a client, only read by Lambda.
  t.hasResourceProperties('AWS::S3::Bucket', {
    PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
    BucketEncryption: { ServerSideEncryptionConfiguration: [Match.objectLike({ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } })] },
  });
  t.hasResourceProperties('AWS::CloudFront::OriginAccessControl', { OriginAccessControlConfig: Match.objectLike({ OriginAccessControlOriginType: 'lambda', SigningBehavior: 'always-amz-auth' }) });
  t.hasResourceProperties('AWS::Lambda::WebFunctionEndpoint', { AuthType: 'IamAuth', EndpointType: 'HomeRegion' });
  t.hasResourceProperties('AWS::Lambda::ResourcePolicy', {
    PolicyDocument: { Statement: [Match.objectLike({ Principal: { Service: 'cloudfront.amazonaws.com' }, Action: 'lambda:InvokeWebFunctionEndpoint' })] },
  });
});

test('eks: Auto Mode cluster, internal ALB in the stack, pods bound to its target group, one NAT gateway', () => {
  const t = templates.eks;
  t.hasResourceProperties('AWS::EKS::Cluster', { ComputeConfig: Match.objectLike({ Enabled: true, NodePools: ['system', 'general-purpose'] }) });
  t.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', { Scheme: 'internal', Type: 'application' });
  t.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', { TargetType: 'ip', Port: 8000 });
  t.resourceCountIs('AWS::EC2::NatGateway', 1);
  t.hasResourceProperties('AWS::CloudFront::VpcOrigin', {});
  const [manifest] = Object.values(t.findResources('Custom::AWSCDK-EKS-KubernetesResource'));
  const text = JSON.stringify(manifest.Properties.Manifest);
  for (const kind of ['Namespace', 'Deployment', 'Service', 'TargetGroupBinding']) assert.ok(text.includes(`\\"kind\\":\\"${kind}\\"`), kind);
  assert.ok(text.includes('JWT_VERIFY') && text.includes('mcp/eks'), 'the pods verify the token with the eks scope');
});

test('api gateway: private REST API reachable only through the VPC endpoint, Cognito authorizer with the scope', () => {
  const t = templates['api-gateway'];
  t.hasResourceProperties('AWS::ApiGateway::RestApi', { EndpointConfiguration: Match.objectLike({ Types: ['PRIVATE'] }) });
  t.hasResourceProperties('AWS::ApiGateway::Authorizer', { Type: 'COGNITO_USER_POOLS' });
  t.hasResourceProperties('AWS::ApiGateway::Method', { AuthorizationType: 'COGNITO_USER_POOLS', AuthorizationScopes: ['mcp/api-gateway'] });
  t.hasResourceProperties('AWS::ApiGateway::Method', { AuthorizationType: 'NONE', HttpMethod: 'GET' }); // discovery
  t.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', { Scheme: 'internal', Type: 'network' });
  t.resourceCountIs('AWS::EC2::NatGateway', 0);
});

test('agentcore: Gateway with a Cognito authorizer on the scope, Runtime invoked only by the Gateway role', () => {
  const t = templates.agentcore;
  t.hasResourceProperties('AWS::BedrockAgentCore::Gateway', {
    AuthorizerType: 'CUSTOM_JWT',
    AuthorizerConfiguration: { CustomJWTAuthorizer: Match.objectLike({ AllowedScopes: ['mcp/agentcore'] }) },
  });
  t.hasResourceProperties('AWS::BedrockAgentCore::Runtime', { ProtocolConfiguration: 'MCP' });
  t.hasResourceProperties('AWS::IAM::Policy', { PolicyDocument: { Statement: [Match.objectLike({ Action: 'bedrock-agentcore:InvokeAgentRuntime' })] } });
});
