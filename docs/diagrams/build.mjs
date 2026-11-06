// Writes docs/diagrams/<name>/<name>.drawio for every diagram. Then: node docs/diagrams/export.mjs
// Every diagram fits a 1560 x 720 canvas (about 2:1), so it reads on one screen: the edge on the left, the Region on
// the right, two icon rows, and short labels under 64 px icons.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { diagram, ICON } from './drawio.mjs';

const here = import.meta.dirname;
// The MCP mark, from github.com/modelcontextprotocol (docs/favicon.svg, CC BY 4.0); see docs/diagrams/README.md.
const MCP_ICON = readFileSync(path.join(here, 'assets', 'mcp.svg'), 'utf8');

const W = 1560;
const H = 720;
const R1 = 220; // top icon row (icon y); labels take about 60 px under the icon
const R2 = 460; // second row
const cx = (x) => x + ICON / 2; // centre of an icon placed at x

// Shared left side of every pattern: the MCP client, the AWS Cloud opening and the edge box with 1 AWS WAF, 2 the
// distribution and 3 the CloudFront Function. Returns the ids edges attach to.
function edgeSide(d, { functionNote = 'viewer request', functionEdge = '401 or x-jwt-claims' } = {}) {
  const client = d.icon({ key: 'client', label: 'MCP client', sub: 'agent, Bearer token', image: MCP_ICON, x: 40, y: R1 });
  d.group('awsCloud', 'AWS Cloud', { x: 170, y: 40, w: W - 200, h: H - 70 });
  d.group('edge', 'Amazon CloudFront edge (global)', { x: 200, y: 90, w: 420, h: H - 150 });
  const waf = d.icon({ key: 'waf', cat: 'security', label: 'AWS WAF', sub: 'EdgeWaf:<br>MCP rule stack', shape: 'waf', x: 250, y: R1, num: 1 });
  const cf = d.icon({ key: 'cf', cat: 'networking', label: 'Amazon CloudFront', sub: 'the distribution', shape: 'cloudfront', x: 450, y: R1, num: 2 });
  const fn = d.icon({ key: 'cff', cat: 'networking', label: 'CloudFront Function', sub: functionNote, shape: 'cloudfront_functions', resource: true, x: 450, y: R2, num: 3 });
  d.edge(client, waf, { label: 'POST /mcp', dy: 16 });
  d.edge(waf, cf, { label: 'allowed', dy: -14 });
  d.edge(cf, fn, { exit: [0.5, 1], entry: [0.5, 0], both: true, elbow: 'vertical', label: functionEdge, at: 0, dy: 0, dx: 76 });
  return { client, waf, cf, fn };
}

// The Region box on the right, from x = 650 to the edge of the cloud.
function region(d, label = 'us-east-1') {
  d.group('region', label, { x: 650, y: 90, w: W - 200 + 170 - 650 - 30, h: H - 150 });
}

// The Secrets Manager secret at the top right of the Region, and its dashed line over the boxes to the distribution.
// `row` R2 puts it on the second row; the line then leaves to the left, up the gap between the edge and the Region.
function originSecret(d, cf, { x, num, row = R1 }) {
  const secret = d.icon({ key: 'secret', cat: 'security', label: 'Secrets Manager', sub: 'x-origin-verify value', shape: 'secrets_manager', x, y: row, num });
  const label = 'x-origin-verify value, read at deploy into the origin header and the OriginWaf rule';
  if (row === R1) {
    d.edge(secret, cf, { exit: [0.5, 0], entry: [0.5, 0], elbow: 'vertical', color: '#999999', dashed: true, label, at: 0, dy: -12, points: [[cx(x), 66], [cx(450), 66]] });
  } else {
    d.edge(secret, cf, { exit: [0, 0.5], entry: [0.5, 0], elbow: 'horizontal', color: '#999999', dashed: true, at: 0, points: [[635, row + ICON / 2], [635, 66], [cx(450), 66]] });
  }
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
  width: W, height: H,
  build(d) {
    const { cf } = edgeSide(d, { functionNote: 'viewer request,<br>answers the metadata', functionEdge: '401, metadata<br>or x-jwt-claims' });
    region(d);
    d.group('generic', 'Amazon Bedrock AgentCore', { x: 880, y: 150, w: 420, h: 220 });
    const owaf = d.icon({ key: 'owaf', cat: 'security', label: 'AWS WAF', sub: 'OriginWaf: secret header,<br>mcp/ scope', shape: 'waf', x: 700, y: R1, num: 4 });
    const gw = d.icon({ key: 'gw', cat: 'aiml', label: 'AgentCore Gateway', sub: 'JWT authorizer,<br>target hello', shape: 'bedrock_agentcore', x: 930, y: R1, num: 5 });
    const rt = d.icon({ key: 'rt', cat: 'aiml', label: 'AgentCore Runtime', sub: 'hello image,<br>IAM inbound', shape: 'bedrock_agentcore', x: 1170, y: R1, num: 6 });
    const cog = d.icon({ key: 'cognito', cat: 'security', label: 'Amazon Cognito', sub: 'user pool,<br>scope mcp/agentcore', shape: 'cognito', x: 930, y: R2, num: 7 });
    originSecret(d, cf, { x: 1400, num: 8 });
    d.edge(cf, owaf, { label: 'HTTPS to the public Gateway<br>x-origin-verify, x-jwt-claims', dy: 34 });
    d.edge(owaf, gw, { label: 'allowed', dy: -14 });
    d.edge(gw, rt, { label: 'SigV4, Gateway role only', dy: -14 });
    d.edge(gw, cog, { exit: [0.5, 1], entry: [0.5, 0], elbow: 'vertical', label: 'JWKS, discovery URL', at: 0.5, dy: 0, dx: 90 });
  },
}));

// ---------------------------------------------------------------------------------------------------------------------
// Amazon API Gateway
write('pattern-mcp-api-gateway-cloudfront', diagram({
  name: 'pattern-mcp-api-gateway-cloudfront',
  titleBlock: false,
  width: W, height: H,
  build(d) {
    const { cf } = edgeSide(d);
    region(d);
    d.group('vpc', 'VPC, two AZs, no NAT gateway', { x: 670, y: 140, w: 400, h: 240 });
    d.group('privateSubnet', 'Isolated subnets', { x: 690, y: 180, w: 360, h: 180 });
    const nlb = d.icon({ key: 'nlb', cat: 'networking', label: 'Internal NLB', sub: 'TCP 443 passthrough', shape: 'network_load_balancer', resource: true, x: 720, y: R1, num: 4 });
    const vpce = d.icon({ key: 'vpce', cat: 'networking', label: 'execute-api endpoint', sub: 'interface VPC endpoint', shape: 'endpoints', resource: true, x: 920, y: R1, num: 5 });
    const apigw = d.icon({ key: 'apigw', cat: 'networking', label: 'Amazon API Gateway', sub: 'private REST API,<br>Cognito authorizer', shape: 'api_gateway', x: 1140, y: R1, num: 6 });
    const owaf = d.icon({ key: 'owaf', cat: 'security', label: 'AWS WAF', sub: 'OriginWaf on the stage:<br>secret header, mcp/ scope', shape: 'waf', x: 1140, y: R2, num: 7 });
    const lambda = d.icon({ key: 'lambda', cat: 'compute', label: 'AWS Lambda', sub: 'hello image,<br>Web Adapter', shape: 'lambda', x: 1380, y: R1, num: 8 });
    const cog = d.icon({ key: 'cognito', cat: 'security', label: 'Amazon Cognito', sub: 'user pool,<br>scope mcp/api-gateway', shape: 'cognito', x: 1380, y: R2, num: 9 });
    originSecret(d, cf, { x: 720, num: 10, row: R2 });
    d.edge(cf, nlb, { label: 'VPC origin, HTTPS<br>x-origin-verify, x-jwt-claims', dy: 34 });
    d.edge(nlb, vpce, { label: 'TLS end to end', dy: -14 });
    d.edge(vpce, apigw, { label: 'aws:SourceVpce only', dy: -14 });
    d.edge(owaf, apigw, { exit: [0.5, 0], entry: [0.5, 1], elbow: 'vertical', color: '#DD344C', dashed: true, label: 'runs on the stage,<br>before the authorizer', at: 0, dy: 0, dx: -96 });
    d.edge(apigw, lambda, { label: 'token valid', dy: -14 });
    d.edge(apigw, cog, { exit: [1, 0.8], entry: [0, 0.5], elbow: 'horizontal', label: 'verifies signature, scope', at: 0.2, dy: 14 });
  },
}));

// ---------------------------------------------------------------------------------------------------------------------
// Amazon EKS
write('pattern-mcp-eks-cloudfront', diagram({
  name: 'pattern-mcp-eks-cloudfront',
  titleBlock: false,
  width: W, height: H,
  build(d) {
    const { cf } = edgeSide(d);
    region(d);
    d.group('vpc', 'VPC, two Availability Zones', { x: 670, y: 140, w: 700, h: 480 });
    d.group('privateSubnet', 'Private subnets', { x: 690, y: 180, w: 480, h: 420 });
    d.group('publicSubnet', 'Public subnets', { x: 1190, y: 180, w: 160, h: 420 });
    d.group('generic', 'EKS Auto Mode cluster', { x: 1012, y: 150, w: 168, h: 440 });
    const owaf = d.icon({ key: 'owaf', cat: 'security', label: 'AWS WAF', sub: 'OriginWaf: secret header,<br>mcp/ scope', shape: 'waf', x: 720, y: R1, num: 4 });
    const alb = d.icon({ key: 'alb', cat: 'networking', label: 'Internal ALB', sub: 'private IPs, HTTP :80,<br>target group of pod IPs', shape: 'application_load_balancer', resource: true, x: 890, y: R1, num: 5 });
    const pods = d.icon({ key: 'pods', cat: 'containers', label: 'MCP server pods', sub: 'hello image,<br>verify the token', shape: 'container_1', resource: true, x: 1063, y: R1, num: 6 });
    const nat = d.icon({ key: 'nat', cat: 'networking', label: 'NAT gateway', sub: 'image pulls, JWKS', shape: 'nat_gateway', resource: true, x: 1238, y: R1, num: 7 });
    const cog = d.icon({ key: 'cognito', cat: 'security', label: 'Amazon Cognito', sub: 'user pool,<br>scope mcp/eks', shape: 'cognito', x: 1420, y: R2, num: 8 });
    originSecret(d, cf, { x: 1420, num: 9 });
    d.edge(cf, owaf, { label: 'VPC origin, HTTP :80<br>x-origin-verify, x-jwt-claims', dy: 34 });
    d.edge(owaf, alb, { label: 'allowed', dy: -14 });
    d.edge(alb, pods, { label: ':8000', dy: -14 });
    d.edge(pods, alb, { exit: [0.5, 1], entry: [0.5, 1], elbow: 'vertical', color: '#999999', dashed: true, label: 'TargetGroupBinding:<br>Auto Mode registers<br>the pod IPs', at: 0, dy: 34, points: [[cx(1063), R2 + 10], [cx(890), R2 + 10]] });
    d.edge(pods, nat, { label: 'egress', dy: -14 });
    d.edge(nat, cog, { exit: [0.5, 1], entry: [0, 0.5], elbow: 'vertical', label: 'JWKS', at: 0.6, dy: -12, points: [[cx(1238), R2 + 32]] });
  },
}));

// ---------------------------------------------------------------------------------------------------------------------
// Lambda Web Function
write('pattern-mcp-web-function-cloudfront', diagram({
  name: 'pattern-mcp-web-function-cloudfront',
  titleBlock: false,
  width: W, height: H,
  build(d) {
    const { cf } = edgeSide(d);
    const oac = d.icon({ key: 'oac', cat: 'security', label: 'Origin access control', sub: 'signs origin requests<br>(SigV4)', shape: 'identity_and_access_management', x: 250, y: R2, num: 4 });
    region(d);
    const wf = d.icon({ key: 'wf', cat: 'compute', label: 'Lambda Web Function', sub: 'IamAuth endpoint,<br>hello server from a zip', shape: 'lambda', x: 860, y: R1, num: 5 });
    const policy = d.icon({ key: 'policy', cat: 'security', label: 'Resource policy', sub: 'invoke: only this<br>distribution', shape: 'identity_and_access_management', x: 860, y: R2, num: 6 });
    const bucket = d.icon({ key: 'code', cat: 'storage', label: 'Amazon S3', sub: 'versioned code bucket', shape: 's3', x: 1110, y: R2, num: 7 });
    const cog = d.icon({ key: 'cognito', cat: 'security', label: 'Amazon Cognito', sub: 'user pool,<br>scope mcp/web-function', shape: 'cognito', x: 1360, y: R1, num: 8 });
    d.edge(oac, cf, { exit: [1, 0.5], entry: [0, 0.9], elbow: 'horizontal', color: '#999999', dashed: true, label: 'attached to the origin', at: -0.6, dy: 14 });
    d.edge(cf, wf, { label: 'HTTPS, signed with SigV4<br>x-jwt-claims, x-forwarded-host', dy: 34 });
    d.edge(policy, wf, { exit: [0.5, 0], entry: [0.5, 1], elbow: 'vertical', color: '#DD344C', dashed: true, label: 'Lambda checks the<br>signature before<br>the code runs', at: 0, dy: 0, dx: -110 });
    d.edge(bucket, wf, { exit: [0.5, 0], entry: [1, 0.75], elbow: 'vertical', color: '#999999', dashed: true, label: 'revision reads the zip', at: 0.5, dy: 14, dx: 40 });
    d.edge(wf, cog, { label: 'JWKS', dy: -14 });
  },
}));

// ---------------------------------------------------------------------------------------------------------------------
// MCP authorization flow: four parties, six numbered arrows, short labels. The README's Authentication section is the legend.
write('mcp-auth-flow', diagram({
  name: 'mcp-auth-flow',
  titleBlock: false,
  width: 1200, height: 620,
  build(d) {
    const Y = 200;
    const client = d.icon({ key: 'client', label: 'MCP client', sub: 'agent', image: MCP_ICON, x: 60, y: Y });
    d.group('awsCloud', 'AWS Cloud', { x: 240, y: 110, w: 920, h: 470 });
    const edge = d.icon({ key: 'edge', cat: 'networking', label: 'CloudFront edge', sub: 'AWS WAF, then the function:<br>decodes the token', shape: 'cloudfront', x: 460, y: Y });
    const origin = d.icon({ key: 'origin', cat: 'compute', label: 'MCP server', sub: 'verifies signature<br>and scope', shape: 'servers', resource: true, x: 800, y: Y });
    const cog = d.icon({ key: 'cognito', cat: 'security', label: 'Amazon Cognito', sub: 'issues the token', shape: 'cognito', x: 800, y: Y + 240 });
    // 1 no token -> 401 with the metadata URL
    d.edge(client, edge, { exit: [1, 0.3], entry: [0, 0.3], both: true, label: '<b>1</b>  POST /mcp, no token \u2192 401', dy: -16 });
    // 2 discovery, cached at the edge
    d.edge(client, edge, { exit: [1, 0.7], entry: [0, 0.7], both: true, label: '<b>2</b>  GET the metadata (cached)', dy: 18 });
    // 3, 4 token from Cognito
    d.edge(client, cog, { exit: [0.5, 1], entry: [0, 0.5], elbow: 'vertical', both: true, label: '<b>3</b>  issuer metadata, then <b>4</b>  POST /oauth2/token \u2192 access token', at: 0.3, dy: 18 });
    // 5 the call with the token, pre-filtered at the edge, 6 verified at the origin
    d.edge(edge, origin, { label: '<b>5</b>  POST /mcp with the token', dy: -16 });
    d.edge(origin, cog, { exit: [0.5, 1], entry: [0.5, 0], elbow: 'vertical', label: '<b>6</b>  fetches the keys (JWKS)', at: 0, dx: 110 });
  },
}));
