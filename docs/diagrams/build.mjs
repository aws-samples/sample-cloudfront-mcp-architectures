// Writes docs/diagrams/<name>/<name>.drawio for every diagram. Then: node docs/diagrams/export.mjs
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { diagram } from './drawio.mjs';

const here = import.meta.dirname;
// The MCP mark, from github.com/modelcontextprotocol (docs/favicon.svg, CC BY 4.0); see docs/diagrams/README.md.
const MCP_ICON = readFileSync(path.join(here, 'assets', 'mcp.svg'), 'utf8');

// Pattern diagrams (SRA style). R is the icon row the request flows along, R2 the row under it.
const R = 240;
const R2 = R + 190;

// Shared left side of every pattern: the MCP client, the AWS Cloud opening and the edge box with 1 AWS WAF, 2 the
// distribution and 3 the CloudFront Function. Returns the ids edges attach to.
function edgeSra(d, { cloudW, functionNote = 'viewer request', functionEdge = '401 or x-jwt-claims' }) {
  const client = d.icon({ key: 'client', label: 'MCP client', sub: 'agent, Bearer token', image: MCP_ICON, x: 60, y: R });
  d.group('awsCloud', 'AWS Cloud', { x: 200, y: 40, w: cloudW, h: 620 });
  d.group('edge', 'Amazon CloudFront edge (global)', { x: 240, y: 90, w: 400, h: 530 });
  const waf = d.icon({ key: 'waf', cat: 'security', label: 'AWS WAF', sub: 'EdgeWaf: MCP rule stack<br>for every caller', shape: 'waf', x: 300, y: R, num: 1 });
  const cf = d.icon({ key: 'cf', cat: 'networking', label: 'Amazon CloudFront', sub: 'the pattern distribution', shape: 'cloudfront', x: 500, y: R, num: 2 });
  const fn = d.icon({ key: 'cff', cat: 'networking', label: 'CloudFront Function', sub: functionNote, shape: 'cloudfront_functions', resource: true, x: 500, y: R2, num: 3 });
  d.edge(client, waf, { label: 'POST /mcp' });
  d.edge(waf, cf, { label: 'allowed', dy: -14 });
  d.edge(cf, fn, { exit: [0.5, 1], entry: [0.5, 0], both: true, elbow: 'vertical', label: functionEdge, at: 0, dy: 0, dx: 74 });
  return { client, waf, cf, fn };
}

// The Secrets Manager secret at the right of the Region, and its dashed line over the boxes to the distribution.
function originSecret(d, cf, { x, num }) {
  const secret = d.icon({ key: 'secret', cat: 'security', label: 'Secrets Manager', sub: 'x-origin-verify value', shape: 'secrets_manager', x, y: R, num });
  d.edge(secret, cf, { exit: [0.5, 0], entry: [0.5, 0], elbow: 'vertical', color: '#999999', dashed: true, label: 'x-origin-verify value, read at deploy into the origin header and the OriginWaf rule', at: 0, dy: -12, points: [[x + 28, 72], [528, 72]] });
  return secret;
}

function write(name, xml) {
  const dir = path.join(here, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${name}.drawio`), xml);
  console.log(`wrote docs/diagrams/${name}/${name}.drawio`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Amazon Bedrock AgentCore
write('pattern-mcp-agentcore-cloudfront', diagram({
  name: 'pattern-mcp-agentcore-cloudfront',
  titleBlock: false,
  width: 1620, height: 700,
  build(d) {
    const { cf } = edgeSra(d, { cloudW: 1380, functionNote: 'viewer request,<br>answers the metadata', functionEdge: '401, metadata<br>or x-jwt-claims' });
    d.group('region', 'us-east-1', { x: 700, y: 90, w: 840, h: 530 });
    d.text('<b>Amazon Bedrock AgentCore</b>', { x: 980, y: 190, w: 300, color: '#01A88D' });
    const owaf = d.icon({ key: 'owaf', cat: 'security', label: 'AWS WAF', sub: 'OriginWaf: only this distribution<br>(secret header, mcp/ scope)', shape: 'waf', x: 780, y: R, num: 4 });
    const gw = d.icon({ key: 'gw', cat: 'aiml', label: 'AgentCore Gateway', sub: 'JWT authorizer, target hello', shape: 'bedrock_agentcore', x: 1000, y: R, num: 5 });
    const rt = d.icon({ key: 'rt', cat: 'aiml', label: 'AgentCore Runtime', sub: 'hello image, IAM inbound', shape: 'bedrock_agentcore', x: 1200, y: R, num: 6 });
    const cog = d.icon({ key: 'cognito', cat: 'security', label: 'Amazon Cognito', sub: 'user pool, scope mcp/agentcore', shape: 'cognito', x: 1200, y: R2, num: 7 });
    originSecret(d, cf, { x: 1400, num: 8 });
    d.edge(cf, owaf, { label: 'public Gateway endpoint, HTTPS<br>x-origin-verify, x-jwt-claims', dy: 34 });
    d.edge(owaf, gw, { label: 'allowed' });
    d.edge(gw, rt, { label: 'SigV4, Gateway role only' });
    d.edge(gw, cog, { exit: [0.5, 1], entry: [0, 0.5], elbow: 'vertical', label: 'JWKS, discovery URL', at: 0.4, dy: -12 });
  },
}));

// ---------------------------------------------------------------------------------------------------------------------
// Amazon API Gateway
write('pattern-mcp-api-gateway-cloudfront', diagram({
  name: 'pattern-mcp-api-gateway-cloudfront',
  titleBlock: false,
  width: 1980, height: 700,
  build(d) {
    const { cf } = edgeSra(d, { cloudW: 1740 });
    d.group('region', 'us-east-1', { x: 700, y: 90, w: 1200, h: 530 });
    d.group('vpc', 'VPC 10.1.0.0/16, two Availability Zones, no NAT gateway', { x: 740, y: 140, w: 480, h: 270 });
    d.group('privateSubnet', 'Isolated subnets', { x: 770, y: 180, w: 420, h: 200 });
    const nlb = d.icon({ key: 'nlb', cat: 'networking', label: 'Internal NLB', sub: 'TCP 443 passthrough', shape: 'network_load_balancer', resource: true, x: 820, y: R, num: 4 });
    const vpce = d.icon({ key: 'vpce', cat: 'networking', label: 'execute-api endpoint', sub: 'interface VPC endpoint', shape: 'endpoints', resource: true, x: 1040, y: R, num: 5 });
    const apigw = d.icon({ key: 'apigw', cat: 'networking', label: 'Amazon API Gateway', sub: 'private REST API,<br>Cognito authorizer', shape: 'api_gateway', x: 1300, y: R, num: 6 });
    const owaf = d.icon({ key: 'owaf', cat: 'security', label: 'AWS WAF', sub: 'OriginWaf on the stage:<br>secret header, mcp/ scope', shape: 'waf', x: 1300, y: R2, num: 7 });
    const lambda = d.icon({ key: 'lambda', cat: 'compute', label: 'AWS Lambda', sub: 'hello image, Web Adapter', shape: 'lambda', x: 1540, y: R, num: 8 });
    const cog = d.icon({ key: 'cognito', cat: 'security', label: 'Amazon Cognito', sub: 'user pool, scope mcp/api-gateway', shape: 'cognito', x: 1540, y: R2, num: 9 });
    originSecret(d, cf, { x: 1760, num: 10 });
    d.edge(cf, nlb, { label: 'VPC origin, HTTPS<br>x-origin-verify, x-jwt-claims', dy: 34 });
    d.edge(nlb, vpce, { label: 'TLS end to end' });
    d.edge(vpce, apigw, { label: 'aws:SourceVpce only' });
    d.edge(owaf, apigw, { exit: [0.5, 0], entry: [0.5, 1], elbow: 'vertical', color: '#DD344C', dashed: true, label: 'runs on the stage,<br>before the authorizer', at: 0, dy: 0, dx: 86 });
    d.edge(apigw, lambda, { label: 'token valid' });
    d.edge(apigw, cog, { exit: [1, 0.9], entry: [0, 0.5], elbow: 'horizontal', label: 'verifies signature, scope', at: 0, dy: 14 });
  },
}));

// ---------------------------------------------------------------------------------------------------------------------
// Amazon EKS
write('pattern-mcp-eks-cloudfront', diagram({
  name: 'pattern-mcp-eks-cloudfront',
  titleBlock: false,
  width: 1880, height: 700,
  build(d) {
    const { cf } = edgeSra(d, { cloudW: 1640 });
    d.group('region', 'us-east-1', { x: 700, y: 90, w: 1100, h: 530 });
    d.group('vpc', 'VPC 10.1.0.0/16, two Availability Zones', { x: 740, y: 140, w: 820, h: 450 });
    d.group('privateSubnet', 'Private subnets', { x: 770, y: 180, w: 570, h: 390 });
    d.group('publicSubnet', 'Public subnets', { x: 1360, y: 180, w: 170, h: 390 });
    d.group('generic', 'Amazon EKS Auto Mode cluster', { x: 1120, y: 200, w: 200, h: 350 });
    const owaf = d.icon({ key: 'owaf', cat: 'security', label: 'AWS WAF', sub: 'OriginWaf: only this distribution<br>(secret header, mcp/ scope)', shape: 'waf', x: 820, y: R, num: 4 });
    const alb = d.icon({ key: 'alb', cat: 'networking', label: 'Internal ALB', sub: 'private IPs, HTTP :80,<br>target group of pod IPs', shape: 'application_load_balancer', resource: true, x: 1000, y: R, num: 5 });
    const pods = d.icon({ key: 'pods', cat: 'containers', label: 'MCP server pods', sub: 'hello image, verify the token', shape: 'container_1', resource: true, x: 1192, y: R, num: 6 });
    const nat = d.icon({ key: 'nat', cat: 'networking', label: 'NAT gateway', sub: 'image pulls, JWKS', shape: 'nat_gateway', resource: true, x: 1400, y: R, num: 7 });
    const cog = d.icon({ key: 'cognito', cat: 'security', label: 'Amazon Cognito', sub: 'user pool, scope mcp/eks', shape: 'cognito', x: 1660, y: R2, num: 8 });
    originSecret(d, cf, { x: 1660, num: 9 });
    d.edge(cf, owaf, { label: 'VPC origin, HTTP :80<br>x-origin-verify, x-jwt-claims', dy: 34 });
    d.edge(owaf, alb, { label: 'allowed' });
    d.edge(alb, pods, { label: ':8000' });
    d.edge(pods, alb, { exit: [0.5, 1], entry: [0.5, 1], elbow: 'vertical', color: '#999999', dashed: true, label: 'TargetGroupBinding: Auto Mode<br>registers the pod IPs', at: 0, dy: 24, points: [[1220, R2 + 40], [1028, R2 + 40]] });
    d.edge(pods, nat, { label: 'egress', dy: -14 });
    d.edge(nat, cog, { exit: [0.5, 1], entry: [0, 0.5], elbow: 'vertical', label: 'JWKS', at: 0.5, dy: -12, points: [[1428, R2 + 28]] });
  },
}));

// ---------------------------------------------------------------------------------------------------------------------
// Lambda Web Function
write('pattern-mcp-web-function-cloudfront', diagram({
  name: 'pattern-mcp-web-function-cloudfront',
  titleBlock: false,
  width: 1560, height: 700,
  build(d) {
    const { cf } = edgeSra(d, { cloudW: 1320 });
    const oac = d.icon({ key: 'oac', cat: 'security', label: 'Origin access control', sub: 'signs origin requests (SigV4)', shape: 'identity_and_access_management', x: 300, y: R2, num: 4 });
    d.group('region', 'us-east-1', { x: 700, y: 90, w: 780, h: 530 });
    const wf = d.icon({ key: 'wf', cat: 'compute', label: 'Lambda Web Function', sub: 'IamAuth endpoint,<br>hello server from a zip', shape: 'lambda', x: 880, y: R, num: 5 });
    const policy = d.icon({ key: 'policy', cat: 'security', label: 'Resource policy', sub: 'invoke: only this distribution', shape: 'identity_and_access_management', x: 880, y: R2, num: 6 });
    const bucket = d.icon({ key: 'code', cat: 'storage', label: 'Amazon S3', sub: 'versioned code bucket', shape: 's3', x: 1100, y: R2, num: 7 });
    const cog = d.icon({ key: 'cognito', cat: 'security', label: 'Amazon Cognito', sub: 'user pool, scope mcp/web-function', shape: 'cognito', x: 1300, y: R, num: 8 });
    d.edge(oac, cf, { exit: [1, 0.5], entry: [0, 0.9], elbow: 'horizontal', color: '#999999', dashed: true, label: 'attached to the origin', at: -0.6, dy: 14 });
    d.edge(cf, wf, { label: 'HTTPS, signed with SigV4<br>x-jwt-claims, x-forwarded-host', dy: 34 });
    d.edge(policy, wf, { exit: [0.5, 0], entry: [0.5, 1], elbow: 'vertical', color: '#DD344C', dashed: true, label: 'Lambda checks the signature<br>before the code runs', at: 0, dy: 0, dx: -100 });
    d.edge(bucket, wf, { exit: [0.5, 0], entry: [1, 0.75], elbow: 'vertical', color: '#999999', dashed: true, label: 'revision reads the zip', at: 0.5, dy: 14, dx: 30 });
    d.edge(wf, cog, { label: 'JWKS', dy: -14 });
  },
}));

// ---------------------------------------------------------------------------------------------------------------------
// MCP authorization flow. Steps in time order, numbered on the arrows; the legend is the README's Authentication section.
write('mcp-auth-flow', diagram({
  name: 'mcp-auth-flow',
  titleBlock: false,
  width: 1560, height: 760,
  build(d) {
    const client = d.icon({ key: 'client', label: 'MCP client', sub: 'agent', image: MCP_ICON, x: 60, y: R });
    d.group('awsCloud', 'AWS Cloud', { x: 200, y: 40, w: 1320, h: 700 });
    d.group('edge', 'Amazon CloudFront edge (global)', { x: 240, y: 90, w: 400, h: 570 });
    const waf = d.icon({ key: 'waf', cat: 'security', label: 'AWS WAF', sub: 'EdgeWaf', shape: 'waf', x: 300, y: R });
    const cf = d.icon({ key: 'cf', cat: 'networking', label: 'Amazon CloudFront', sub: 'the pattern distribution', shape: 'cloudfront', x: 500, y: R });
    const fn = d.icon({ key: 'cff', cat: 'networking', label: 'CloudFront Function', sub: 'decodes, does not verify', shape: 'cloudfront_functions', resource: true, x: 500, y: R2 });
    d.group('region', 'us-east-1', { x: 700, y: 90, w: 780, h: 570 });
    const origin = d.icon({ key: 'origin', cat: 'compute', label: 'MCP server (the origin)', sub: 'verifies signature and scope', shape: 'servers', resource: true, x: 880, y: R });
    const cog = d.icon({ key: 'cognito', cat: 'security', label: 'Amazon Cognito', sub: 'authorization server', shape: 'cognito', x: 1300, y: R });
    // 1: no token, 401 from the edge
    d.edge(client, waf, { label: 'POST /mcp', dy: -14 });
    d.num(1, 140, R - 10);
    d.edge(waf, cf, { label: 'allowed', dy: -14 });
    d.edge(cf, fn, { exit: [0.5, 1], entry: [0.5, 0], both: true, elbow: 'vertical' });
    d.edge(fn, client, { exit: [0, 0.5], entry: [0.5, 1], elbow: 'horizontal', color: '#999999', dashed: true, label: '401<br>WWW-Authenticate: Bearer resource_metadata="https://&lt;distribution&gt;/.well-known/oauth-protected-resource/mcp"', at: -0.5, dy: 22, points: [[88, R2 + 28]] });
    // 2: discovery, served by the origin and cached by CloudFront
    d.edge(cf, origin, { label: 'GET /.well-known/oauth-protected-resource/mcp  (cached)', dy: -36 });
    d.num(2, 466, R - 24);
    // 3 and 4: the issuer's metadata, then a token, straight from the client to Cognito
    d.edge(client, cog, { exit: [0.5, 1], entry: [0.5, 1], elbow: 'vertical', label: 'GET /.well-known/openid-configuration, then POST /oauth2/token  (client credentials, scope=mcp/&lt;pattern&gt;)  \u2192  access token', at: 0, dy: 14, points: [[88, 700], [1328, 700]] });
    d.num(3, 108, 672); d.num(4, 140, 672);
    // 5: the authorized call through the edge, 6: verified at the origin
    d.edge(cf, origin, { label: 'POST /mcp, Bearer token<br>x-jwt-claims, x-forwarded-host', dy: 34 });
    d.num(5, 704, R + 84);
    d.edge(origin, cog, { label: 'JWKS', dy: -14 });
    d.num(6, 1070, R - 10);
  },
}));
