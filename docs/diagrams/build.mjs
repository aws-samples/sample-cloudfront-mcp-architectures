// Writes docs/diagrams/<name>/<name>.drawio for every diagram. Then: node docs/diagrams/export.mjs
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { diagram, NODE } from './drawio.mjs';

const here = import.meta.dirname;
// The MCP mark, from github.com/modelcontextprotocol (docs/favicon.svg, CC BY 4.0); see docs/diagrams/README.md.
const MCP_ICON = readFileSync(path.join(here, 'assets', 'mcp.svg'), 'utf8');
const FLOW = 300; // top of the main flow row; icon centre is FLOW + 54
const ROW2 = FLOW + 170; // second row, under the flow
const CY = FLOW + 54;
const right = (x) => x + NODE;
const mid = (a, b) => (right(a) + b) / 2;
const BADGE_Y = (rowY) => rowY + 54 - 14 - 32; // above the arrow between two nodes on that row

// Pattern diagrams (SRA style). R is the icon row the request flows along, R2 the row under it.
const R = 240;
const R2 = R + 190;

// Shared left side of every pattern: the MCP client, the AWS Cloud opening and the edge box with 1 AWS WAF, 2 the
// distribution and 3 the CloudFront Function. Returns the ids edges attach to.
function edgeSra(d, { cloudW, pattern, functionNote = 'viewer request', functionEdge = '401 or x-jwt-claims' }) {
  const client = d.icon({ key: 'client', label: 'MCP client', sub: 'agent, Bearer token', image: MCP_ICON, x: 60, y: R });
  d.group('awsCloud', 'AWS Cloud', { x: 200, y: 40, w: cloudW, h: 620 });
  d.group('edge', 'Amazon CloudFront edge (global)', { x: 240, y: 90, w: 400, h: 530 });
  const waf = d.icon({ key: 'waf', cat: 'security', label: 'AWS WAF', sub: 'EdgeWaf: MCP rule stack<br>for every caller', shape: 'waf', x: 300, y: R, num: 1 });
  const cf = d.icon({ key: 'cf', cat: 'networking', label: 'Amazon CloudFront', sub: pattern, shape: 'cloudfront', x: 500, y: R, num: 2 });
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
// Pattern 5: ALB
write('pattern-5-alb', diagram({
  name: 'pattern-5-alb',
  titleBlock: false,
  width: 1760, height: 700,
  build(d) {
    const { cf } = edgeSra(d, { cloudW: 1520, pattern: 'pattern 5 distribution' });
    d.group('region', 'us-east-1', { x: 700, y: 90, w: 980, h: 530 });
    d.group('vpc', 'VPC 10.1.0.0/16, two Availability Zones, no NAT gateway', { x: 740, y: 140, w: 660, h: 450 });
    d.group('privateSubnet', 'Isolated subnets', { x: 770, y: 180, w: 600, h: 390 });
    const owaf = d.icon({ key: 'owaf', cat: 'security', label: 'AWS WAF', sub: 'OriginWaf: only this distribution<br>(secret header, mcp/ scope)', shape: 'waf', x: 820, y: R, num: 4 });
    const alb = d.icon({ key: 'alb', cat: 'networking', label: 'Internal ALB', sub: 'private IPs, HTTP :80', shape: 'application_load_balancer', resource: true, x: 1000, y: R, num: 5 });
    const task = d.icon({ key: 'task', cat: 'compute', label: 'AWS Fargate task', sub: 'hello MCP server', shape: 'fargate', x: 1180, y: R, num: 6 });
    const vpce = d.icon({ key: 'vpce', cat: 'networking', label: 'VPC endpoints', sub: 'ECR, Logs, S3, cognito-idp', shape: 'endpoints', resource: true, x: 1180, y: R2, num: 7 });
    const cog = d.icon({ key: 'cognito', cat: 'security', label: 'Amazon Cognito', sub: 'user pool, scope mcp/alb', shape: 'cognito', x: 1500, y: R2, num: 8 });
    originSecret(d, cf, { x: 1500, num: 9 });
    d.edge(cf, owaf, { label: 'VPC origin, HTTP :80<br>x-origin-verify, x-jwt-claims', dy: 34 });
    d.edge(owaf, alb, { label: 'allowed' });
    d.edge(alb, task, { label: ':8000' });
    d.edge(task, vpce, { exit: [0.5, 1], entry: [0.5, 0], elbow: 'vertical', label: 'image, logs, JWKS', at: 0, dy: 0, dx: 70 });
    d.edge(vpce, cog, { label: 'AWS PrivateLink' });
  },
}));

// ---------------------------------------------------------------------------------------------------------------------
// Pattern 1: AgentCore
write('pattern-1-agentcore', diagram({
  name: 'pattern-1-agentcore',
  titleBlock: false,
  width: 1620, height: 700,
  build(d) {
    const { cf } = edgeSra(d, { cloudW: 1380, pattern: 'pattern 1 distribution', functionNote: 'viewer request,<br>answers the metadata', functionEdge: '401, metadata<br>or x-jwt-claims' });
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
// Pattern 2: API Gateway
write('pattern-2-api-gateway', diagram({
  name: 'pattern-2-api-gateway',
  titleBlock: false,
  width: 1980, height: 700,
  build(d) {
    const { cf } = edgeSra(d, { cloudW: 1740, pattern: 'pattern 2 distribution' });
    d.group('region', 'us-east-1', { x: 700, y: 90, w: 1200, h: 530 });
    d.group('vpc', 'VPC 10.1.0.0/16, shared with pattern 5, no NAT gateway', { x: 740, y: 140, w: 480, h: 270 });
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
// Pattern 3: EKS (guidance; nothing in the stack)
write('pattern-3-eks', diagram({
  name: 'pattern-3-eks',
  titleBlock: false,
  width: 1860, height: 700,
  build(d) {
    const { cf } = edgeSra(d, { cloudW: 1620, pattern: 'a distribution for this pattern' });
    d.group('region', 'your Region', { x: 700, y: 90, w: 1080, h: 530 });
    d.group('vpc', 'Your VPC', { x: 740, y: 140, w: 820, h: 450 });
    d.group('privateSubnet', 'Private subnets', { x: 770, y: 180, w: 760, h: 390 });
    d.group('generic', 'Amazon EKS cluster', { x: 1170, y: 200, w: 340, h: 350 });
    const owaf = d.icon({ key: 'owaf', cat: 'security', label: 'AWS WAF', sub: 'regional web ACL:<br>secret header, scope', shape: 'waf', x: 820, y: R, num: 4 });
    const alb = d.icon({ key: 'alb', cat: 'networking', label: 'Internal ALB', sub: 'VPC origin target', shape: 'application_load_balancer', resource: true, x: 1000, y: R, num: 5 });
    const pods = d.icon({ key: 'pods', cat: 'containers', label: 'MCP server pods', sub: 'verify the token', shape: 'container_1', resource: true, x: 1230, y: R, num: 6 });
    const lbc = d.icon({ key: 'lbc', cat: 'containers', label: 'AWS Load Balancer Controller', sub: 'registers pod IPs', shape: 'eks', x: 1400, y: R2, num: 7 });
    const cog = d.icon({ key: 'cognito', cat: 'security', label: 'Amazon Cognito', sub: 'or your identity provider', shape: 'cognito', x: 1660, y: R2, num: 8 });
    d.edge(cf, owaf, { label: 'VPC origin<br>x-origin-verify, x-jwt-claims', dy: 34 });
    d.edge(owaf, alb, { label: 'allowed' });
    d.edge(alb, pods, { label: 'target type ip' });
    d.edge(lbc, alb, { exit: [0, 0.5], entry: [0.5, 1], elbow: 'horizontal', color: '#999999', dashed: true, label: 'TargetGroupBinding', at: -0.3, dy: 14 });
    d.edge(pods, cog, { exit: [1, 0.5], entry: [0.5, 0], elbow: 'horizontal', label: 'JWKS', at: 0.2, dy: -12, points: [[1688, 268]] });
  },
}));

// ---------------------------------------------------------------------------------------------------------------------
// Pattern 4: Web Function
write('pattern-4-web-function', diagram({
  name: 'pattern-4-web-function',
  titleBlock: false,
  width: 1560, height: 700,
  build(d) {
    const { cf } = edgeSra(d, { cloudW: 1320, pattern: 'pattern 4 distribution' });
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
// Overview: the whole stack
write('overview', diagram({
  name: 'overview',
  title: 'Remote MCP servers behind Amazon CloudFront: the stack',
  subtitle: 'One CDK stack, one CloudFront distribution per pattern, all behind one CloudFront-scope AWS WAF web ACL, with one Amazon Cognito issuer',
  width: 1980, height: 900,
  build(d) {
    const rows = [
      { key: 'p1', y: 190, dist: 'pattern 1, /mcp', origin: { key: 'gw', cat: 'aiml', category: 'MCP gateway', label: 'AgentCore Gateway', sub: 'JWT authorizer, Runtime behind', shape: 'bedrock_agentcore' } },
      { key: 'p2', y: 350, dist: 'pattern 2, /mcp', origin: { key: 'apigw', cat: 'networking', category: 'API', label: 'Amazon API Gateway', sub: 'private REST API via VPC origin, Lambda', shape: 'api_gateway' } },
      { key: 'p4', y: 510, dist: 'pattern 4, /mcp', origin: { key: 'wf', cat: 'compute', category: 'Compute', label: 'Lambda Web Function', sub: 'IamAuth endpoint, OAC', shape: 'lambda' } },
      { key: 'p5', y: 670, dist: 'pattern 5, /mcp', origin: { key: 'alb', cat: 'networking', category: 'Load balancing', label: 'Internal ALB', sub: 'VPC origin, Fargate task', shape: 'application_load_balancer', resource: true } },
    ];
    const client = d.actor({ key: 'client', label: 'MCP client', sub: 'agent, Bearer token', x: 40, y: 430 });
    d.group('awsCloud', 'AWS Cloud', { x: 220, y: 140, w: 1260, h: 700 });
    d.text('<b>Edge</b>', { x: 280, y: 160, w: 280, color: '#8C4FFF' });
    const waf = d.service({ key: 'waf', cat: 'security', category: 'Edge security', label: 'AWS WAF', sub: 'EdgeWaf, one web ACL for all four', shape: 'waf', x: 280, y: 430 });
    d.group('region', 'us-east-1', { x: 760, y: 150, w: 700, h: 680 });
    const cog = d.service({ key: 'cognito', cat: 'security', category: 'Identity', label: 'Amazon Cognito', sub: 'one scope per pattern', shape: 'cognito', x: 1240, y: 430 });
    d.edge(client, waf, { label: 'POST /mcp' });
    d.badge(1, mid(40, 280) - 14, BADGE_Y(430));
    for (const r of rows) {
      const cf = d.service({ key: `cf-${r.key}`, cat: 'networking', category: 'Content delivery', label: 'Amazon CloudFront', sub: r.dist, shape: 'cloudfront', x: 480, y: r.y });
      const o = d.service({ ...r.origin, x: 840, y: r.y });
      d.edge(waf, cf, { exit: [1, 0.5], entry: [0, 0.5] });
      d.edge(cf, o, { label: 'origin lock, see pattern' });
      d.edge(o, cog, { exit: [1, 0.5], entry: [0, 0.5], color: '#999999', dashed: true });
    }
    d.badge(2, 480 + 60 - 14, 150);
    d.badge(3, 840 + 60 - 14, 150);
    d.badge(4, 1240 + 60 - 14, 390);
    d.legend([
      { title: 'One edge web ACL', text: 'Every distribution shares EdgeWaf: the full MCP rule stack from the blog (IP reputation, rate limits per IP, initialize and tool, Bot Control, body size, protocol version, tool allowlist, SSRF, SQLi and XSS in arguments). A viewer-request CloudFront Function on each pattern distribution pre-filters tokens.' },
      { title: 'One distribution per pattern', text: 'Each serves MCP at its root /mcp and the RFC 9728 metadata at /.well-known/oauth-protected-resource/mcp, so you can lift out the one pattern you need.' },
      { title: 'One origin type per pattern', text: 'Every pattern ends in the same hello-world MCP server; they differ in the origin and in how it is locked to CloudFront: a WAF-checked secret header (1), VPC origin and private network (2, 5), or OAC with SigV4 (4). Pattern 3 (EKS) is guidance on the pattern 5 model.' },
      { title: 'One Cognito issuer', text: 'A single user pool issues client-credentials tokens with one scope per pattern (mcp/agentcore, mcp/api-gateway, mcp/web-function, mcp/alb). The edge decodes; each origin verifies the signature and its own scope.' },
    ], { x: 1520 });
  },
}));

// ---------------------------------------------------------------------------------------------------------------------
// MCP authorization flow
write('mcp-auth-flow', diagram({
  name: 'mcp-auth-flow',
  title: 'MCP authorization flow: decoded at the edge, verified at the origin',
  subtitle: 'What an MCP client does from the first unauthenticated call to an authorized tools/call, and where each step is answered',
  width: 1900, height: 620,
  build(d) {
    const client = d.actor({ key: 'client', label: 'MCP client', sub: 'agent', x: 40, y: FLOW });
    d.group('awsCloud', 'AWS Cloud', { x: 220, y: 150, w: 1060, h: 440 });
    const waf = d.service({ key: 'waf', cat: 'security', category: 'Edge security', label: 'AWS WAF', sub: 'EdgeWaf', shape: 'waf', x: 280, y: FLOW });
    const fn = d.service({ key: 'cff', cat: 'networking', category: 'Edge compute', label: 'CloudFront Function', sub: 'decodes, does not verify', shape: 'cloudfront_functions', resource: true, x: 480, y: FLOW });
    const origin = d.service({ key: 'origin', cat: 'compute', category: 'Origin', label: 'MCP server', sub: 'verifies signature and scope', shape: 'fargate', x: 760, y: FLOW });
    const cog = d.service({ key: 'cognito', cat: 'security', category: 'Identity', label: 'Amazon Cognito', sub: 'authorization server', shape: 'cognito', x: 1080, y: FLOW });
    d.edge(client, waf, { label: 'every request' });
    d.edge(waf, fn, { exit: [1, 0.5], entry: [0, 0.5] });
    d.edge(fn, client, { exit: [0.5, 0], entry: [0.5, 0], elbow: 'vertical', label: '401 WWW-Authenticate: Bearer resource_metadata=...', at: 0, dy: -14, points: [[540, 220], [100, 220]] });
    d.badge(1, 130, 196);
    d.edge(fn, origin, { label: 'x-jwt-claims, x-forwarded-host' });
    d.badge(2, mid(480, 760) - 14, BADGE_Y(FLOW));
    d.edge(client, cog, { exit: [0.5, 1], entry: [0.5, 1], elbow: 'vertical', label: 'client credentials, scope=mcp/&lt;pattern&gt;  \u2192  access token', at: 0, dy: 14, points: [[100, 560], [1140, 560]] });
    d.badge(3, 600, 536);
    d.edge(origin, cog, { label: 'JWKS' });
    d.badge(4, mid(760, 1080) - 14, BADGE_Y(FLOW));
    d.legend([
      { title: 'Discovery: 401 from the edge', text: 'A request without a usable token gets 401 with WWW-Authenticate: Bearer resource_metadata="https://&lt;distribution&gt;/.well-known/oauth-protected-resource/mcp" from the CloudFront Function, after the web ACL. The origin serves that RFC 9728 document (cached by CloudFront); on pattern 1 the function answers it.' },
      { title: 'Edge pre-filter', text: 'The function decodes the JWT and refuses a missing, malformed, expired, wrong-issuer or non-access token at the edge. It does not check the signature (CloudFront Functions have no RSA verify), so it replaces any client-sent x-jwt-claims with the decoded payload for the regional WAF.' },
      { title: 'Token from Cognito', text: 'The client follows the metadata to the issuer and requests a client-credentials token with the pattern\u2019s scope. Scopes stand in for an audience: a token for one pattern is refused by the others.' },
      { title: 'Verified at the origin', text: 'Each origin checks the RS256 signature against the Cognito JWKS and requires its own scope: the AgentCore Gateway authorizer, the API Gateway Cognito authorizer, or the hello server itself (web function, ALB). A tampered payload passes the edge and fails here.' },
    ], { x: 1320 });
  },
}));
