// Writes docs/diagrams/<name>/<name>.drawio for every diagram. Then: node docs/diagrams/export.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { diagram, NODE } from './drawio.mjs';

const here = import.meta.dirname;
const FLOW = 300; // top of the main flow row; icon centre is FLOW + 54
const ROW2 = FLOW + 170; // second row, under the flow
const CY = FLOW + 54;
const right = (x) => x + NODE;
const mid = (a, b) => (right(a) + b) / 2;
const BADGE_Y = (rowY) => rowY + 54 - 14 - 32; // above the arrow between two nodes on that row

// Shared left side: client, AWS Cloud opening, edge WAF, CloudFront, CloudFront Function. Returns ids and x positions.
function edge(d, { cloudW, cloudH = 560, pattern, scope, functionNote = '401, x-jwt-claims' }) {
  const client = d.actor({ key: 'client', label: 'MCP client', sub: 'agent, Bearer token', x: 40, y: FLOW });
  d.group('awsCloud', 'AWS Cloud', { x: 220, y: 150, w: cloudW, h: cloudH });
  d.text('<b>Edge</b>', { x: 280, y: 200, w: 280, color: '#8C4FFF' });
  const waf = d.service({ key: 'waf', cat: 'security', category: 'Edge security', label: 'AWS WAF', sub: 'EdgeWaf, MCP rule stack', shape: 'waf', x: 280, y: FLOW });
  const cf = d.service({ key: 'cf', cat: 'networking', category: 'Content delivery', label: 'Amazon CloudFront', sub: pattern, shape: 'cloudfront', x: 440, y: FLOW });
  const fn = d.service({ key: 'cff', cat: 'networking', category: 'Edge compute', label: 'CloudFront Function', sub: functionNote, shape: 'cloudfront_functions', resource: true, x: 440, y: ROW2 });
  d.edge(client, waf, { label: 'POST /mcp' });
  d.badge(1, mid(40, 280) - 14, BADGE_Y(FLOW));
  d.edge(waf, cf, { label: 'allowed' });
  d.badge(2, mid(280, 440) - 14, BADGE_Y(FLOW));
  d.edge(cf, fn, { exit: [0.5, 1], entry: [0.5, 0], both: true, elbow: 'vertical' });
  d.badge(3, 440 + 60 + 14, FLOW + NODE + 8);
  return { client, waf, cf, fn, scope };
}

// The regional Cognito issuer, below the flow at the far right of the Region.
function cognito(d, { x, y = ROW2, scope }) {
  return d.service({ key: 'cognito', cat: 'security', category: 'Identity', label: 'Amazon Cognito', sub: `user pool, scope ${scope}`, shape: 'cognito', x, y });
}

function write(name, xml) {
  const dir = path.join(here, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${name}.drawio`), xml);
  console.log(`wrote docs/diagrams/${name}/${name}.drawio`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Pattern 5: ALB. SRA style: bare icons, "n.m" index badges, legend in patterns/5-alb/README.md (Deployed resource
// details), no title block. Boxes: 1.0 the edge, 2.0 the Region.
write('pattern-5-alb', diagram({
  name: 'pattern-5-alb',
  titleBlock: false,
  width: 1760, height: 700,
  build(d) {
    const R = 240; // icon row (top of the icon); the flow runs along it
    const R2 = R + 190; // second row
    const client = d.icon({ key: 'client', label: 'MCP client', sub: 'agent, Bearer token', shape: 'client', x: 60, y: R });
    d.group('awsCloud', 'AWS Cloud', { x: 200, y: 40, w: 1520, h: 620 });

    // 1.0 Edge
    d.group('edge', 'Amazon CloudFront edge (global)', { x: 240, y: 90, w: 400, h: 530, num: '1.0' });
    const waf = d.icon({ key: 'waf', cat: 'security', label: 'AWS WAF', sub: 'EdgeWaf web ACL', shape: 'waf', x: 300, y: R, num: '1.1' });
    const cf = d.icon({ key: 'cf', cat: 'networking', label: 'Amazon CloudFront', sub: 'pattern 5 distribution', shape: 'cloudfront', x: 500, y: R, num: '1.2' });
    const fn = d.icon({ key: 'cff', cat: 'networking', label: 'CloudFront Function', sub: 'viewer request', shape: 'cloudfront_functions', resource: true, x: 500, y: R2, num: '1.3' });

    // 2.0 Region
    d.group('region', 'us-east-1', { x: 700, y: 90, w: 980, h: 530, num: '2.0' });
    d.group('vpc', 'VPC 10.1.0.0/16, two Availability Zones, no NAT gateway', { x: 740, y: 140, w: 660, h: 450 });
    d.group('privateSubnet', 'Isolated subnets', { x: 770, y: 180, w: 600, h: 390 });
    const owaf = d.icon({ key: 'owaf', cat: 'security', label: 'AWS WAF', sub: 'OriginWaf web ACL', shape: 'waf', x: 820, y: R, num: '2.1' });
    const alb = d.icon({ key: 'alb', cat: 'networking', label: 'Internal ALB', sub: 'private IPs, HTTP :80', shape: 'application_load_balancer', resource: true, x: 1000, y: R, num: '2.2' });
    const task = d.icon({ key: 'task', cat: 'compute', label: 'AWS Fargate task', sub: 'hello MCP server', shape: 'fargate', x: 1180, y: R, num: '2.3' });
    const vpce = d.icon({ key: 'vpce', cat: 'networking', label: 'VPC endpoints', sub: 'ECR, Logs, S3, cognito-idp', shape: 'endpoints', resource: true, x: 1180, y: R2, num: '2.4' });
    const cog = d.icon({ key: 'cognito', cat: 'security', label: 'Amazon Cognito', sub: 'user pool, scope mcp/alb', shape: 'cognito', x: 1500, y: R2, num: '2.5' });
    const secret = d.icon({ key: 'secret', cat: 'security', label: 'Secrets Manager', sub: 'x-origin-verify value', shape: 'secrets_manager', x: 1500, y: R, num: '2.6' });

    // Request flow
    d.edge(client, waf, { label: 'POST /mcp' });
    d.edge(waf, cf, { label: 'allowed' });
    d.edge(cf, fn, { exit: [0.5, 1], entry: [0.5, 0], both: true, elbow: 'vertical', label: '401 or x-jwt-claims', at: 0, dy: 0, dx: 74 });
    d.edge(cf, owaf, { label: 'VPC origin, HTTP :80<br>x-origin-verify, x-jwt-claims', dy: 34 });
    d.edge(owaf, alb, { label: 'allowed' });
    d.edge(alb, task, { label: ':8000' });
    d.edge(task, vpce, { exit: [0.5, 1], entry: [0.5, 0], elbow: 'vertical', label: 'image, logs, JWKS', at: 0, dy: 0, dx: 70 });
    d.edge(vpce, cog, { label: 'AWS PrivateLink' });
    d.edge(secret, cf, { exit: [0.5, 0], entry: [0.5, 0], elbow: 'vertical', color: '#999999', dashed: true, label: 'x-origin-verify value, read at deploy into the origin header and the OriginWaf rule', at: 0, dy: -12, points: [[1528, 72], [528, 72]] });
  },
}));

// ---------------------------------------------------------------------------------------------------------------------
// Pattern 1: AgentCore
write('pattern-1-agentcore', diagram({
  name: 'pattern-1-agentcore',
  title: 'Pattern 1: Remote MCP server on Amazon Bedrock AgentCore',
  subtitle: 'CloudFront in front of an AgentCore Gateway; a regional AWS WAF admits only CloudFront; the Gateway verifies the OAuth token and calls the Runtime over IAM',
  width: 2100, height: 760,
  build(d) {
    const { cf } = edge(d, { cloudW: 1220, pattern: 'pattern 1 distribution, /mcp', scope: 'mcp/agentcore', functionNote: '401, metadata' });
    d.group('region', 'us-east-1', { x: 620, y: 200, w: 780, h: 480 });
    d.text('<b>Amazon Bedrock AgentCore</b>', { x: 700, y: 250, w: 420, color: '#01A88D' });
    const owaf = d.service({ key: 'owaf', cat: 'security', category: 'Origin security', label: 'AWS WAF', sub: 'OriginWaf on the Gateway', shape: 'waf', x: 700, y: FLOW });
    const gw = d.service({ key: 'gw', cat: 'aiml', category: 'MCP gateway', label: 'AgentCore Gateway', sub: 'JWT authorizer, target hello', shape: 'bedrock_agentcore', x: 880, y: FLOW });
    const rt = d.service({ key: 'rt', cat: 'aiml', category: 'Agent runtime', label: 'AgentCore Runtime', sub: 'hello image, IAM inbound', shape: 'bedrock_agentcore', x: 1120, y: FLOW });
    const cog = cognito(d, { x: 1120, scope: 'mcp/agentcore' });
    d.edge(cf, owaf, { label: 'public Gateway endpoint, HTTPS<br>x-origin-verify', dy: 34 });
    d.badge(4, mid(440, 700) - 14, BADGE_Y(FLOW));
    d.edge(owaf, gw, { label: 'secret header present' });
    d.badge(5, mid(700, 880) - 14, BADGE_Y(FLOW));
    d.edge(gw, rt, { label: 'SigV4, Gateway role only' });
    d.badge(6, mid(880, 1120) - 14, BADGE_Y(FLOW));
    d.edge(gw, cog, { exit: [0.5, 1], entry: [0, 0.5], elbow: 'vertical', label: 'JWKS, discovery URL', at: 0.3, dy: -12 });
    d.legend([
      { title: 'AWS WAF at the edge', text: 'The CloudFront-scope web ACL runs first: IP reputation, rate limits, Bot Control labels, body size, protocol version, tool allowlist and argument inspection. Tool names arrive as hello___hello, which the allowlist accepts.' },
      { title: 'CloudFront distribution', text: 'One front door with a custom domain and edge WAF for a managed endpoint that has neither. /mcp is not cached.' },
      { title: 'CloudFront Function (viewer request)', text: 'Pre-filters the token and answers the protected-resource metadata itself: the Gateway\u2019s own document names the Gateway hostname rather than the distribution.' },
      { title: 'Public Gateway endpoint, locked by a secret', text: 'The Gateway endpoint is public, so CloudFront sends the secret x-origin-verify header on every origin request.' },
      { title: 'Regional AWS WAF on the Gateway', text: 'Default block; only requests with the secret header and an mcp/ scope in x-jwt-claims pass. The lock is the shared secret, checked before the Gateway calls a target.' },
      { title: 'Gateway authorizer, then the Runtime', text: 'The Gateway\u2019s custom JWT authorizer verifies the Cognito token and the mcp/agentcore scope, then invokes the Runtime with SigV4. The Runtime\u2019s inbound authorizer is IAM and admits only the Gateway\u2019s role.' },
    ], { x: 1480 });
  },
}));

// ---------------------------------------------------------------------------------------------------------------------
// Pattern 2: API Gateway
write('pattern-2-api-gateway', diagram({
  name: 'pattern-2-api-gateway',
  title: 'Pattern 2: Remote MCP server on a private Amazon API Gateway REST API',
  subtitle: 'CloudFront reaches a private REST API through a VPC origin, an internal NLB and an execute-api VPC endpoint; a Cognito authorizer verifies the token before Lambda runs',
  width: 2360, height: 760,
  build(d) {
    const { cf } = edge(d, { cloudW: 1480, pattern: 'pattern 2 distribution, /mcp', scope: 'mcp/api-gateway' });
    d.group('region', 'us-east-1', { x: 620, y: 200, w: 1040, h: 480 });
    d.group('vpc', 'VPC 10.1.0.0/16, shared with pattern 5, no NAT gateway', { x: 650, y: 240, w: 460, h: 220 });
    d.group('privateSubnet', 'Isolated subnets', { x: 680, y: 275, w: 400, h: 170 });
    const nlb = d.service({ key: 'nlb', cat: 'networking', category: 'Load balancing', label: 'Internal NLB', sub: 'TCP 443 passthrough', shape: 'network_load_balancer', resource: true, x: 720, y: FLOW });
    const vpce = d.service({ key: 'vpce', cat: 'networking', category: 'Private connectivity', label: 'execute-api endpoint', sub: 'interface VPC endpoint', shape: 'endpoints', resource: true, x: 920, y: FLOW });
    const owaf = d.service({ key: 'owaf', cat: 'security', category: 'Origin security', label: 'AWS WAF', sub: 'OriginWaf on the stage', shape: 'waf', x: 920, y: ROW2 + 20 });
    const apigw = d.service({ key: 'apigw', cat: 'networking', category: 'API', label: 'Amazon API Gateway', sub: 'private REST API, Cognito authorizer', shape: 'api_gateway', x: 1160, y: FLOW });
    const lambda = d.service({ key: 'lambda', cat: 'compute', category: 'Compute', label: 'AWS Lambda', sub: 'hello image, Web Adapter', shape: 'lambda', x: 1380, y: FLOW });
    const cog = cognito(d, { x: 1380, scope: 'mcp/api-gateway' });
    d.edge(cf, nlb, { label: 'VPC origin, HTTPS<br>x-origin-verify, x-jwt-claims', dy: 34 });
    d.badge(4, mid(440, 720) - 14, BADGE_Y(FLOW));
    d.edge(nlb, vpce, { label: 'TLS end to end' });
    d.badge(5, mid(720, 920) - 14, BADGE_Y(FLOW));
    d.edge(vpce, apigw, { label: 'aws:SourceVpce only' });
    d.badge(6, mid(920, 1160) - 14, BADGE_Y(FLOW));
    d.edge(owaf, apigw, { exit: [1, 0.5], entry: [0.25, 1], elbow: 'horizontal', color: '#DD344C', dashed: true, label: 'associated with the stage', at: -0.3, dy: -12 });
    d.edge(apigw, lambda, { label: 'token valid' });
    d.badge(7, mid(1160, 1380) - 14, BADGE_Y(FLOW));
    d.edge(apigw, cog, { exit: [0.75, 1], entry: [0, 0.5], elbow: 'vertical', label: 'verifies token, scope', at: 0.3, dy: 14 });
    d.legend([
      { title: 'AWS WAF at the edge', text: 'The CloudFront-scope web ACL stops floods, bad bots, oversized bodies, unapproved tools and injection in tool arguments before a request can cost a Lambda invocation.' },
      { title: 'CloudFront distribution', text: 'A public entry point for an API that is otherwise reachable only from inside the VPC. /mcp is not cached.' },
      { title: 'CloudFront Function (viewer request)', text: 'Token pre-filter with 401 and resource_metadata, x-jwt-claims and x-forwarded-host for the origin.' },
      { title: 'VPC origin to an internal NLB', text: 'The NLB has only private IPs; its security group admits 443 from the CloudFront origin-facing prefix list. It passes TCP through, so TLS runs end to end from CloudFront to the endpoint.' },
      { title: 'execute-api VPC endpoint', text: 'The NLB targets the endpoint\u2019s network interface IPs. The REST API is private: its resource policy allows execute-api:Invoke only through this endpoint, and the public hostname answers 403.' },
      { title: 'Regional AWS WAF and Cognito authorizer on the stage', text: 'OriginWaf requires the secret header and an mcp/ scope; the Cognito authorizer on every method verifies the token signature and the mcp/api-gateway scope. A bad token never reaches Lambda.' },
      { title: 'Lambda runs the hello image', text: 'The same arm64 container as the other patterns, through Lambda Web Adapter. REST APIs buffer responses and time out at 29 s, so the server answers JSON rather than a long SSE stream.' },
    ], { x: 1740 });
  },
}));

// ---------------------------------------------------------------------------------------------------------------------
// Pattern 4: Web Function
write('pattern-4-web-function', diagram({
  name: 'pattern-4-web-function',
  title: 'Pattern 4: Remote MCP server on a Lambda Web Function',
  subtitle: 'CloudFront signs every origin request with origin access control; the web function\u2019s IamAuth endpoint refuses anything else; the server verifies the OAuth token',
  width: 2040, height: 760,
  build(d) {
    const { cf } = edge(d, { cloudW: 1140, pattern: 'pattern 4 distribution, /mcp', scope: 'mcp/web-function' });
    d.group('region', 'us-east-1', { x: 620, y: 200, w: 700, h: 480 });
    const wf = d.service({ key: 'wf', cat: 'compute', category: 'Compute', label: 'Lambda Web Function', sub: 'regional IamAuth endpoint, hello server', shape: 'lambda', x: 900, y: FLOW });
    const oac = d.service({ key: 'oac', cat: 'security', category: 'Origin access', label: 'Origin access control', sub: 'CloudFront signs with SigV4', shape: 'identity_and_access_management', x: 900, y: ROW2 });
    const cog = cognito(d, { x: 1140, y: FLOW, scope: 'mcp/web-function' });
    d.edge(cf, wf, { label: 'HTTPS, signed with SigV4<br>x-jwt-claims, x-forwarded-host', dy: 34 });
    d.badge(4, mid(440, 900) - 14, BADGE_Y(FLOW));
    d.edge(oac, wf, { exit: [0.5, 0], entry: [0.5, 1], elbow: 'vertical', color: '#DD344C', dashed: true, label: 'IamAuth: resource policy allows<br>only this distribution', at: 0, dy: 0, dx: 108 });
    d.edge(wf, cog, { label: 'JWKS' });
    d.badge(5, mid(900, 1140) - 14, BADGE_Y(FLOW));
    d.legend([
      { title: 'AWS WAF at the edge', text: 'The only AWS WAF layer in this pattern: a web function endpoint takes no regional web ACL. With OAC as the lock, a request that skips the edge never reaches the code, so it cannot skip the web ACL either.' },
      { title: 'CloudFront distribution', text: 'Supplies the WAF, rate limits, custom domain and warm origin connections the regional endpoint lacks. No Lambda@Edge origin triggers on this behavior.' },
      { title: 'CloudFront Function (viewer request)', text: 'Token pre-filter with 401 and resource_metadata, x-jwt-claims and x-forwarded-host for the origin.' },
      { title: 'Origin access control (SigV4)', text: 'The endpoint is public but takes IamAuth. CloudFront signs every origin request, and the function\u2019s resource policy grants cloudfront.amazonaws.com lambda:InvokeWebFunctionEndpoint only for this distribution. Lambda refuses anything else before your code runs.' },
      { title: 'The server verifies the token', text: 'Nothing in front of the function checks tokens, so the hello server verifies the RS256 signature and the mcp/web-function scope against the Cognito JWKS and serves the protected-resource metadata. Node.js from a zip; pay per use, nothing to run while idle.' },
    ], { x: 1400 });
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
