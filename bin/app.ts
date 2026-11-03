import { App, BootstraplessSynthesizer, Tags } from 'aws-cdk-lib';
import { CloudFrontMcpSamplesStack, Pattern } from '../lib/stack';

const app = new App();
// us-east-1: the CloudFront-scope WAF web ACL must live there.
const env = { region: 'us-east-1' };
// -c pattern=<p>: one pattern's stack for the template in cfn/. BootstraplessSynthesizer refuses CDK assets, so the
// template deploys with plain CloudFormation; it also skips the bootstrap version check.
const PATTERN_STACKS: Record<Pattern, string> = {
  agentcore: 'CloudFrontMcpAgentCore',
  'api-gateway': 'CloudFrontMcpApiGateway',
  'web-function': 'CloudFrontMcpWebFunction',
  alb: 'CloudFrontMcpAlb',
};
const pattern: Pattern | undefined = app.node.tryGetContext('pattern');
if (pattern && !PATTERN_STACKS[pattern]) throw new Error(`-c pattern must be one of ${Object.keys(PATTERN_STACKS).join(', ')}`);
// -c botControl=false leaves AWS WAF Bot Control (billed separately, see lib/waf.ts) off the edge web ACL.
const botControl = !['false', false].includes(app.node.tryGetContext('botControl'));
const stack = pattern
  ? new CloudFrontMcpSamplesStack(app, PATTERN_STACKS[pattern], { env, pattern, botControl, synthesizer: new BootstraplessSynthesizer() })
  : new CloudFrontMcpSamplesStack(app, 'CloudFrontMcpSamples', { env, botControl });
Tags.of(stack).add('auto-delete', 'no');
