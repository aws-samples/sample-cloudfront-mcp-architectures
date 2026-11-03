// Synthesizes both web ACLs and checks the rule stack from the blog: names, order, labels and the Bot Control toggle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'tsx/esm/api';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';

// waf.ts imports './auth' with no extension, as tsc expects; tsx resolves it the way cdk.json does.
register();
const { edgeWebAcl, originWebAcl, TOOL_LABELS, TOOL_LABEL_NAMESPACE } = await import('./waf.ts');

const synth = (make) => {
  const stack = new Stack(new App(), 'Test', { env: { region: 'us-east-1' } });
  make(stack);
  const [acl] = Object.values(Template.fromStack(stack).findResources('AWS::WAFv2::WebACL'));
  return acl.Properties;
};
const edge = (props) => synth((stack) => edgeWebAcl(stack, props));
const names = (acl) => [...acl.Rules].sort((a, b) => a.Priority - b.Priority).map((r) => r.Name);
const rule = (acl, name) => acl.Rules.find((r) => r.Name === name);
const labelRule = (acl, tool) => acl.Rules.find((r) => r.RuleLabels?.some((l) => l.Name === `${TOOL_LABEL_NAMESPACE}${tool}`));
const toolLabelNames = ['LabelToolHello', 'LabelToolQueryDatabase', 'LabelToolExecuteSql'];
const argumentRuleNames = ['BlockDestructiveSQL', 'BlockMCPSSRF', 'MCPSQLiProtection', 'MCPXSSProtection'];

test('edge rules run in the blog order, with distinct priorities', () => {
  const acl = edge();
  assert.deepEqual(names(acl), [
    'AmazonIpReputation', 'RateLimitPerIp', 'RateLimitInitializePerIp', 'BotControlCommon',
    'MCPBodySizePreflight', 'BlockJsonRpcBatch', 'RequireMCPProtocolVersion', 'BlockUnapprovedMCPTools',
    ...toolLabelNames, 'BlockUnverifiedBotOnHighCostTool', ...argumentRuleNames, 'RateLimitPerTool',
  ]);
  assert.equal(new Set(acl.Rules.map((r) => r.Priority)).size, acl.Rules.length);
  assert.equal(acl.AssociationConfig.RequestBody.CLOUDFRONT.DefaultSizeInspectionLimit, 'KB_32');
});

test('origin rules label the tool, screen the arguments, then allow CloudFront with an mcp/ scope', () => {
  const acl = synth((stack) => originWebAcl(stack, 'secret'));
  assert.deepEqual(names(acl), [...toolLabelNames, ...argumentRuleNames, 'AllowCloudFrontWithMcpScope']);
  assert.deepEqual(acl.DefaultAction, { Block: {} });
  // No size preflight here, so a body the ACL cannot fully see is a match.
  for (const name of argumentRuleNames) assert.ok(JSON.stringify(rule(acl, name)).includes('"OversizeHandling":"MATCH"'), name);
});

test('every tool label is stamped in Count before the rules that read it', () => {
  const acl = edge();
  const rateLimit = rule(acl, 'RateLimitPerTool');
  assert.deepEqual(rateLimit.Statement.RateBasedStatement.CustomKeys, [{ LabelNamespace: { Namespace: TOOL_LABEL_NAMESPACE } }, { IP: {} }]);
  assert.equal(rateLimit.Statement.RateBasedStatement.EvaluationWindowSec, 300);
  for (const tool of Object.keys(TOOL_LABELS)) {
    const r = labelRule(acl, tool);
    assert.ok(r, `no rule labels ${tool}`);
    assert.deepEqual(r.Action, { Count: {} });
    assert.equal(r.Statement.AndStatement.Statements[0].ByteMatchStatement.SearchString, 'tools/call');
    for (const reader of ['BlockDestructiveSQL', 'MCPSQLiProtection', 'BlockUnverifiedBotOnHighCostTool', 'RateLimitPerTool']) {
      assert.ok(r.Priority < rule(acl, reader).Priority, `${r.Name} must run before ${reader}`);
    }
  }
  assert.ok(new RegExp(TOOL_LABELS.hello).test('hello___hello') && !new RegExp(TOOL_LABELS.hello).test('query_database'));
});

test('destructive SQL is blocked only on query_database, and execute_sql skips the SQLi parser', () => {
  const acl = edge();
  const destructive = rule(acl, 'BlockDestructiveSQL');
  const [onTool, keywords] = destructive.Statement.AndStatement.Statements;
  assert.deepEqual(onTool.LabelMatchStatement, { Scope: 'LABEL', Key: `${TOOL_LABEL_NAMESPACE}query_database` });
  assert.deepEqual(keywords.RegexMatchStatement.FieldToMatch.JsonBody.MatchPattern.IncludedPaths, ['/params/arguments/query']);
  assert.equal(keywords.RegexMatchStatement.FieldToMatch.JsonBody.InvalidFallbackBehavior, 'MATCH', 'a missing query argument is a violation');
  const regex = new RegExp(keywords.RegexMatchStatement.RegexString);
  const transformed = (q) => q.replace(/\s+/g, ' ').toUpperCase();
  assert.ok(regex.test(transformed('drop table users')) && regex.test(transformed('delete  from users')));
  assert.ok(!regex.test(transformed('select id from users where id = 42')));
  const sqli = rule(acl, 'MCPSQLiProtection');
  assert.deepEqual(sqli.Statement.AndStatement.Statements[1].NotStatement.Statement.LabelMatchStatement,
    { Scope: 'LABEL', Key: `${TOOL_LABEL_NAMESPACE}execute_sql` });
  assert.equal(sqli.Statement.AndStatement.Statements[2].SqliMatchStatement.SensitivityLevel, 'LOW');
});

test('SSRF rule inspects tool arguments only on a tools/call, after the size preflight', () => {
  const acl = edge();
  const ssrf = rule(acl, 'BlockMCPSSRF');
  const [method, targets] = ssrf.Statement.AndStatement.Statements;
  assert.equal(method.ByteMatchStatement.SearchString, 'tools/call');
  assert.equal(targets.OrStatement.Statements.length, 3);
  for (const { RegexMatchStatement } of targets.OrStatement.Statements) {
    assert.deepEqual(RegexMatchStatement.FieldToMatch.JsonBody.MatchPattern.IncludedPaths, ['/params/arguments']);
    assert.equal(RegexMatchStatement.FieldToMatch.JsonBody.OversizeHandling, 'NO_MATCH');
  }
  assert.ok(rule(acl, 'MCPBodySizePreflight').Priority < ssrf.Priority);
  const [imds, ipv4, ipv6] = targets.OrStatement.Statements.map((s) => new RegExp(s.RegexMatchStatement.RegexString));
  assert.ok(imds.test('http://169.254.169.254/latest/meta-data/') && imds.test('http://db.internal/'));
  assert.ok(ipv4.test('10.1.2.3') && ipv4.test('172.31.0.1') && !ipv4.test('172.32.0.1') && !ipv4.test('8.8.8.8'));
  assert.ok(ipv6.test('http://[::1]/') && ipv6.test('fd12:3456::1'));
  assert.ok(!imds.test('edge') && !ipv4.test('edge') && !ipv6.test('edge'));
});

test('initialize has its own, lower, per-IP rate limit', () => {
  const acl = edge();
  const init = rule(acl, 'RateLimitInitializePerIp').Statement.RateBasedStatement;
  const ip = rule(acl, 'RateLimitPerIp').Statement.RateBasedStatement;
  assert.ok(init.Limit < ip.Limit);
  assert.equal(init.ScopeDownStatement.AndStatement.Statements[1].ByteMatchStatement.SearchString, 'initialize');
});

test('Bot Control is on by default, labels agent traffic instead of blocking it, and can be switched off', () => {
  assert.ok(!names(edge({ botControl: false })).includes('BotControlCommon'));
  assert.ok(!names(edge({ botControl: false })).includes('BlockUnverifiedBotOnHighCostTool'));
  const acl = edge();
  const bot = rule(acl, 'BotControlCommon');
  const group = bot.Statement.ManagedRuleGroupStatement;
  assert.equal(group.Name, 'AWSManagedRulesBotControlRuleSet');
  assert.deepEqual(group.ManagedRuleGroupConfigs, [{ AWSManagedRulesBotControlRuleSet: { InspectionLevel: 'COMMON' } }]);
  assert.equal(group.ScopeDownStatement.ByteMatchStatement.SearchString, '/mcp');
  assert.deepEqual(group.RuleActionOverrides.map((o) => o.Name).sort(),
    ['CategoryAI', 'CategoryHttpLibrary', 'SignalAutomatedBrowser', 'SignalKnownBotDataCenter', 'SignalNonBrowserUserAgent']);
  assert.ok(group.RuleActionOverrides.every((o) => 'Count' in o.ActionToUse));
  const composition = rule(acl, 'BlockUnverifiedBotOnHighCostTool');
  assert.deepEqual(composition.Action, { Count: {} }, 'soak in Count before promoting to Block');
  assert.ok(bot.Priority < labelRule(acl, 'hello').Priority && labelRule(acl, 'hello').Priority < composition.Priority);
  assert.ok(composition.Priority < rule(acl, 'BlockMCPSSRF').Priority);
  assert.equal(rule(acl, 'AmazonIpReputation').Statement.ManagedRuleGroupStatement.Name, 'AWSManagedRulesAmazonIpReputationList');
});
