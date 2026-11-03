import { aws_ec2 as ec2, aws_ecr as ecr, aws_wafv2 as wafv2 } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { McpAuth } from './auth';

export const ORIGIN_VERIFY_HEADER = 'x-origin-verify';
// Set by lib/viewer-request.js to the decoded JWT payload; any client-sent copy is replaced.
export const CLAIMS_HEADER = 'x-jwt-claims';
// MCP revisions whose clients send the mcp-protocol-version header. Add new revisions here.
const MCP_PROTOCOL_VERSIONS = '^(2025-06-18|2025-11-25)$';
// Tools callers may invoke. AgentCore Gateway prefixes tool names with "<target>___".
const ALLOWED_TOOLS = '^([A-Za-z0-9-]+___)?hello$';
// Tools the edge labels mcp:tool:<name> on a tools/call. The per-tool rate limit aggregates on the label, the Bot
// Control composition rule matches it, and the SQL rules key off it (use cases 5, 7 and 8). hello is the sample's only
// tool, so it stands in for an expensive one. query_database and execute_sql are the blog's examples: the hello server
// has neither and the allowlist above blocks them, so their rules are inert here until you expose such a tool. Keep them
// as the shape to copy: a read-only tool whose SQL-shaped argument is screened, and an admin tool exempt from the parser.
export const TOOL_LABELS: Record<string, string> = {
  hello: ALLOWED_TOOLS,
  query_database: '^query_database$',
  execute_sql: '^execute_sql$',
};
export const TOOL_LABEL_NAMESPACE = 'mcp:tool:';
const MAX_BODY_BYTES = 32 * 1024;
// Per IP on /mcp, per 5 minutes (use case 9).
const IP_RATE_LIMIT = 1000;
// initialize per IP, per 5 minutes: opening a session costs the origin more than a tool call, so the limit is scoped
// to the method read from the body rather than to the request count.
const INITIALIZE_RATE_LIMIT = 100;
// Per tool and IP, per 5 minutes (use case 8). Under the IP cap, so one caller's loop on one tool trips this first.
const TOOL_RATE_LIMIT = 200;
const RATE_WINDOW_SECONDS = 300;

const visibility = (metricName: string) => ({ cloudWatchMetricsEnabled: true, metricName, sampledRequestsEnabled: true });
const jsonValue = (path: string, value: string, invalidFallbackBehavior: 'MATCH' | 'NO_MATCH') => ({
  byteMatchStatement: {
    fieldToMatch: { jsonBody: { matchPattern: { includedPaths: [path] }, matchScope: 'VALUE', invalidFallbackBehavior, oversizeHandling: 'MATCH' } },
    positionalConstraint: 'EXACTLY',
    searchString: value,
    textTransformations: [{ priority: 0, type: 'NONE' }],
  },
});
const uriPath = (positionalConstraint: string, searchString: string) => ({
  byteMatchStatement: { fieldToMatch: { uriPath: {} }, positionalConstraint, searchString, textTransformations: [{ priority: 0, type: 'NONE' }] },
});
// Every pattern serves MCP at exactly /mcp; /.well-known/oauth-protected-resource/mcp must not match.
const uriIsMcp = uriPath('EXACTLY', '/mcp');
// The method is read from the JSON-RPC body: current SDK clients send no mcp-method header.
const toolsCall = jsonValue('/method', 'tools/call', 'NO_MATCH');
const label = (scope: 'LABEL' | 'NAMESPACE', key: string) => ({ labelMatchStatement: { scope, key } });

// One Count rule per tool in TOOL_LABELS stamps mcp:tool:<name>. Labels cannot be read out of the body, so the
// body-based stand-in for the blog's mcp-name header is one rule per tool. Used by both web ACLs: a label match sees
// only labels added earlier in the same web ACL.
const pascal = (tool: string) => tool.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join('');
const toolLabelRules = (firstPriority: number): wafv2.CfnWebACL.RuleProperty[] => Object.entries(TOOL_LABELS).map(([tool, regexString], i) => ({
  name: `LabelTool${pascal(tool)}`,
  priority: firstPriority + i,
  action: { count: {} },
  ruleLabels: [{ name: `${TOOL_LABEL_NAMESPACE}${tool}` }],
  statement: {
    andStatement: {
      statements: [toolsCall, {
        regexMatchStatement: {
          fieldToMatch: { jsonBody: { matchPattern: { includedPaths: ['/params/name'] }, matchScope: 'VALUE', invalidFallbackBehavior: 'NO_MATCH', oversizeHandling: 'NO_MATCH' } },
          regexString,
          textTransformations: [{ priority: 0, type: 'NONE' }],
        },
      }],
    },
  },
  visibilityConfig: visibility(`LabelTool${pascal(tool)}`),
}));

// Use cases 5, 6 and 7 of the blog, on the string values under /params/arguments of a tools/call: destructive SQL in
// query_database's query, SSRF targets, then the SQLi and XSS parsers. They need the tool labels ahead of them.
// oversizeHandling NO_MATCH needs a body size preflight ahead of these rules; without one, pass MATCH to fail closed.
const argumentRules = (firstPriority: number, action: wafv2.CfnWebACL.RuleActionProperty, oversizeHandling: 'MATCH' | 'NO_MATCH') => {
  const fieldToMatch = { jsonBody: { matchPattern: { includedPaths: ['/params/arguments'] }, matchScope: 'VALUE', invalidFallbackBehavior: 'NO_MATCH', oversizeHandling } };
  const textTransformations = [{ priority: 0, type: 'URL_DECODE' }, { priority: 1, type: 'HTML_ENTITY_DECODE' }, { priority: 2, type: 'LOWERCASE' }];
  const argumentsMatch = (regexString: string, lowercase: boolean) => ({
    regexMatchStatement: {
      fieldToMatch,
      regexString,
      textTransformations: lowercase ? [{ priority: 0, type: 'URL_DECODE' }, { priority: 1, type: 'LOWERCASE' }] : [{ priority: 0, type: 'URL_DECODE' }],
    },
  });
  return [
    {
      // query_database is meant to read. Write or destroy keywords in its query mean something upstream was corrupted,
      // most likely a prompt injection. COMPRESS_WHITE_SPACE catches "D R O P"; a missing query argument is a match,
      // so a call that omits it is treated as a policy violation rather than let through uninspected.
      name: 'BlockDestructiveSQL',
      priority: firstPriority,
      action,
      statement: { andStatement: { statements: [label('LABEL', `${TOOL_LABEL_NAMESPACE}query_database`), {
        regexMatchStatement: {
          fieldToMatch: { jsonBody: { matchPattern: { includedPaths: ['/params/arguments/query'] }, matchScope: 'VALUE', invalidFallbackBehavior: 'MATCH', oversizeHandling } },
          regexString: '\\b(DROP|TRUNCATE|ALTER|GRANT|REVOKE|CREATE|DELETE\\s+FROM|INSERT\\s+INTO|UPDATE\\s+.+\\s+SET)\\b',
          textTransformations: [{ priority: 0, type: 'COMPRESS_WHITE_SPACE' }, { priority: 1, type: 'UPPERCASE' }],
        },
      }] } },
      visibilityConfig: visibility('BlockDestructiveSQL'),
    },
    {
      // Defense in depth, not the primary SSRF control: one URL_DECODE pass, so decimal or octal IPs and double encoding
      // get past it. Lock the tool executor's egress (security groups, IMDSv2, VPC endpoint policies) as well.
      name: 'BlockMCPSSRF',
      priority: firstPriority + 1,
      action,
      statement: { andStatement: { statements: [toolsCall, { orStatement: { statements: [
        // Cloud metadata endpoints and cluster-internal DNS names.
        argumentsMatch('(169\\.254\\.169\\.254|metadata\\.google\\.internal|kubernetes\\.default(\\.svc)?|\\.(local|internal)([^a-z0-9.-]|$))', true),
        // IPv4 loopback, link-local and private ranges.
        argumentsMatch('\\b(10|127|169\\.254|172\\.(1[6-9]|2[0-9]|3[01])|192\\.168)\\.\\d{1,3}\\.\\d{1,3}\\b', false),
        // IPv6 loopback, IPv4-mapped, unique-local and link-local prefixes.
        argumentsMatch('(::1|::ffff:|f[cd][0-9a-f]{2}:|fe80:)', true),
      ] } }] } },
      visibilityConfig: visibility('BlockMCPSSRF'),
    },
    {
      // LOW catches OR 1=1, UNION SELECT, stacked statements and the like without flagging ordinary filter values. A
      // tool that takes raw SQL on purpose (execute_sql) is exempt by label; design the others to take structured
      // arguments, as no sensitivity level can tell a safe SELECT from an unintended one.
      name: 'MCPSQLiProtection',
      priority: firstPriority + 2,
      action,
      statement: { andStatement: { statements: [
        toolsCall,
        { notStatement: { statement: label('LABEL', `${TOOL_LABEL_NAMESPACE}execute_sql`) } },
        { sqliMatchStatement: { fieldToMatch, sensitivityLevel: 'LOW', textTransformations } },
      ] } },
      visibilityConfig: visibility('MCPSQLiProtection'),
    },
    {
      name: 'MCPXSSProtection',
      priority: firstPriority + 3,
      action,
      statement: { andStatement: { statements: [toolsCall, { xssMatchStatement: { fieldToMatch, textTransformations } }] } },
      visibilityConfig: visibility('MCPXSSProtection'),
    },
  ];
};

// Blocks answer in JSON-RPC, with the WAF request ID to correlate with WAF logs.
const blockAsJsonRpc = {
  block: {
    customResponse: {
      responseCode: 403,
      customResponseBodyKey: 'jsonRpcBlocked',
      responseHeaders: [{ name: 'x-mcp-waf-request-id', value: '${awswaf:request_id:}' }],
    },
  },
};

// Use case 2 of the blog: AWS WAF Bot Control at the COMMON level labels each caller (verified bot, Web Bot Auth
// result, cloud provider, HTTP library, ...). Its five sub-rules that block ordinary agent traffic are set to Count, so
// they still label but no longer block. Scoped to /mcp: Bot Control is billed per request it evaluates, and the
// /.well-known metadata gains nothing from it.
const botControlRules = (priority: number, compositionPriority: number): wafv2.CfnWebACL.RuleProperty[] => [
  {
    name: 'BotControlCommon',
    priority,
    overrideAction: { none: {} },
    statement: {
      managedRuleGroupStatement: {
        vendorName: 'AWS',
        name: 'AWSManagedRulesBotControlRuleSet',
        managedRuleGroupConfigs: [{ awsManagedRulesBotControlRuleSet: { inspectionLevel: 'COMMON' } }],
        ruleActionOverrides: ['SignalNonBrowserUserAgent', 'CategoryHttpLibrary', 'SignalAutomatedBrowser', 'CategoryAI', 'SignalKnownBotDataCenter']
          .map((name) => ({ name, actionToUse: { count: {} } })),
        scopeDownStatement: uriIsMcp,
      },
    },
    visibilityConfig: visibility('BotControlCommon'),
  },
  {
    // Identity x tool: a caller whose Web Bot Auth signature is invalid or unknown, calling an expensive tool. Count
    // first, as the blog advises: watch the labels your callers pick up for a soak window, then change count to block.
    name: 'BlockUnverifiedBotOnHighCostTool',
    priority: compositionPriority,
    action: { count: {} },
    statement: {
      andStatement: {
        statements: [
          toolsCall,
          label('NAMESPACE', TOOL_LABEL_NAMESPACE),
          { orStatement: { statements: [
            label('LABEL', 'awswaf:managed:aws:bot-control:bot:web_bot_auth:invalid'),
            label('LABEL', 'awswaf:managed:aws:bot-control:bot:web_bot_auth:unknown_bot'),
          ] } },
        ],
      },
    },
    visibilityConfig: visibility('BlockUnverifiedBotOnHighCostTool'),
  },
];

export interface EdgeWafProps {
  // AWS WAF Bot Control (use case 2), on unless set to false. It carries a monthly subscription and a per-request
  // charge on top of the web ACL; see https://aws.amazon.com/waf/pricing/.
  botControl?: boolean;
}

// CloudFront-scope web ACL with the rule stack from
// https://aws.amazon.com/blogs/networking-and-content-delivery/protect-mcp-endpoints-at-the-edge-with-amazon-cloudfront-and-aws-waf/
// (all nine use cases), with two more that belong in front of any public API: the AWS managed IP reputation list ahead
// of everything, and a rate limit scoped to the initialize method. The method and tool name are read from the
// JSON-RPC body, because current SDK clients send no mcp-method or mcp-name header. Priorities step by 10 so a rule can
// be inserted without renumbering.
export function edgeWebAcl(scope: Construct, props: EdgeWafProps = {}): wafv2.CfnWebACL {
  const allowedTools = new wafv2.CfnRegexPatternSet(scope, 'AllowedMcpTools', {
    scope: 'CLOUDFRONT',
    regularExpressionList: [ALLOWED_TOOLS],
  });
  const protocolVersions = new wafv2.CfnRegexPatternSet(scope, 'McpProtocolVersions', {
    scope: 'CLOUDFRONT',
    regularExpressionList: [MCP_PROTOCOL_VERSIONS],
  });

  return new wafv2.CfnWebACL(scope, 'EdgeWaf', {
    scope: 'CLOUDFRONT',
    defaultAction: { allow: {} },
    visibilityConfig: visibility('EdgeWaf'),
    associationConfig: { requestBody: { CLOUDFRONT: { defaultSizeInspectionLimit: 'KB_32' } } },
    customResponseBodies: {
      jsonRpcBlocked: {
        contentType: 'APPLICATION_JSON',
        content: '{"jsonrpc":"2.0","error":{"code":-32600,"message":"Request blocked by AWS WAF"},"id":null}',
      },
    },
    rules: [
      {
        // Known-bad sources (Amazon threat intelligence) stop before anything is counted or inspected. Its block is a
        // plain 403, not JSON-RPC. The AWSManagedIPDDoSList sub-rule stays at its default of Count.
        name: 'AmazonIpReputation',
        priority: 10,
        overrideAction: { none: {} },
        statement: { managedRuleGroupStatement: { vendorName: 'AWS', name: 'AWSManagedRulesAmazonIpReputationList' } },
        visibilityConfig: visibility('AmazonIpReputation'),
      },
      {
        name: 'RateLimitPerIp',
        priority: 20,
        action: blockAsJsonRpc,
        statement: { rateBasedStatement: { limit: IP_RATE_LIMIT, evaluationWindowSec: RATE_WINDOW_SECONDS, aggregateKeyType: 'IP', scopeDownStatement: uriIsMcp } },
        visibilityConfig: visibility('RateLimitPerIp'),
      },
      {
        // Session opens are the costly protocol call; cap them separately and lower than tool calls.
        name: 'RateLimitInitializePerIp',
        priority: 30,
        action: blockAsJsonRpc,
        statement: { rateBasedStatement: { limit: INITIALIZE_RATE_LIMIT, evaluationWindowSec: RATE_WINDOW_SECONDS, aggregateKeyType: 'IP', scopeDownStatement: { andStatement: { statements: [uriIsMcp, jsonValue('/method', 'initialize', 'NO_MATCH')] } } } },
        visibilityConfig: visibility('RateLimitInitializePerIp'),
      },
      ...(props.botControl === false ? [] : botControlRules(50, 110)),
      {
        name: 'MCPBodySizePreflight',
        priority: 60,
        action: blockAsJsonRpc,
        statement: {
          sizeConstraintStatement: {
            fieldToMatch: { body: { oversizeHandling: 'MATCH' } },
            comparisonOperator: 'GT',
            size: MAX_BODY_BYTES,
            textTransformations: [{ priority: 0, type: 'NONE' }],
          },
        },
        visibilityConfig: visibility('MCPBodySizePreflight'),
      },
      {
        // JSON-RPC batches would hide a tools/call from the /method checks below; MCP 2025-06-18 dropped batching.
        name: 'BlockJsonRpcBatch',
        priority: 70,
        action: blockAsJsonRpc,
        statement: {
          regexMatchStatement: {
            fieldToMatch: { body: { oversizeHandling: 'MATCH' } },
            regexString: '^\\s*\\[',
            textTransformations: [{ priority: 0, type: 'NONE' }],
          },
        },
        visibilityConfig: visibility('BlockJsonRpcBatch'),
      },
      {
        // initialize is exempt: the client learns the version from its response, so it cannot send the header yet.
        name: 'RequireMCPProtocolVersion',
        priority: 80,
        action: blockAsJsonRpc,
        statement: {
          andStatement: {
            statements: [
              uriIsMcp,
              { notStatement: { statement: { regexPatternSetReferenceStatement: {
                arn: protocolVersions.attrArn,
                fieldToMatch: { singleHeader: { Name: 'mcp-protocol-version' } },
                textTransformations: [{ priority: 0, type: 'NONE' }],
              } } } },
              { notStatement: { statement: jsonValue('/method', 'initialize', 'NO_MATCH') } },
            ],
          },
        },
        visibilityConfig: visibility('RequireMCPProtocolVersion'),
      },
      {
        // Unparseable JSON counts as a tools/call with an unapproved tool: fail closed.
        name: 'BlockUnapprovedMCPTools',
        priority: 90,
        action: blockAsJsonRpc,
        statement: {
          andStatement: {
            statements: [
              jsonValue('/method', 'tools/call', 'MATCH'),
              { notStatement: { statement: { regexPatternSetReferenceStatement: {
                arn: allowedTools.attrArn,
                fieldToMatch: { jsonBody: { matchPattern: { includedPaths: ['/params/name'] }, matchScope: 'VALUE', invalidFallbackBehavior: 'NO_MATCH', oversizeHandling: 'MATCH' } },
                textTransformations: [{ priority: 0, type: 'NONE' }],
              } } } },
            ],
          },
        },
        visibilityConfig: visibility('BlockUnapprovedMCPTools'),
      },
      ...toolLabelRules(100),
      ...argumentRules(120, blockAsJsonRpc, 'NO_MATCH'),
      {
        // Use case 8: per tool and IP, so one caller cannot spend a tool's whole budget. Each distinct label under
        // mcp:tool: is one aggregation instance. IP is a coarse stand-in for identity; per-user limits belong at the
        // origin, after the token is verified.
        name: 'RateLimitPerTool',
        priority: 160,
        action: blockAsJsonRpc,
        statement: {
          rateBasedStatement: {
            limit: TOOL_RATE_LIMIT,
            evaluationWindowSec: RATE_WINDOW_SECONDS,
            aggregateKeyType: 'CUSTOM_KEYS',
            customKeys: [{ labelNamespace: { namespace: TOOL_LABEL_NAMESPACE } }, { ip: {} }],
            scopeDownStatement: label('NAMESPACE', TOOL_LABEL_NAMESPACE),
          },
        },
        visibilityConfig: visibility('RateLimitPerTool'),
      },
    ],
  });
}

// Regional web ACL for origins (AgentCore Gateway, API Gateway stage, ALBs): only requests carrying CloudFront's secret
// header get through, and tool arguments are checked again for callers inside the VPC. No size preflight here, and the
// ALB inspects only 8 KB, so the argument rules fail closed on larger bodies.
export function originWebAcl(scope: Construct, originSecret: string): wafv2.CfnWebACL {
  return new wafv2.CfnWebACL(scope, 'OriginWaf', {
    scope: 'REGIONAL',
    defaultAction: { block: {} },
    visibilityConfig: visibility('OriginWaf'),
    rules: [...toolLabelRules(0), ...argumentRules(10, { block: {} }, 'MATCH'), {
      // Resource-level check on the claims the edge decoded. The origin still verifies the token's signature, so a
      // forged payload that passes here is refused there. Discovery carries no token.
      name: 'AllowCloudFrontWithMcpScope',
      priority: 20,
      action: { allow: {} },
      statement: {
        andStatement: {
          statements: [
            {
              byteMatchStatement: {
                fieldToMatch: { singleHeader: { Name: ORIGIN_VERIFY_HEADER } },
                positionalConstraint: 'EXACTLY',
                searchString: originSecret,
                textTransformations: [{ priority: 0, type: 'NONE' }],
              },
            },
            { orStatement: { statements: [
              {
                // Some pattern's scope: this web ACL is shared, so each origin checks that the scope is its own.
                // `scope` is space-separated. JSON.stringify puts no spaces around ':' and escapes '"' inside values.
                regexMatchStatement: {
                  fieldToMatch: { singleHeader: { Name: CLAIMS_HEADER } },
                  regexString: '"scope":"([^"]* )?mcp/[a-z-]+( [^"]*)?"',
                  textTransformations: [{ priority: 0, type: 'NONE' }],
                },
              },
              // CONTAINS, not STARTS_WITH: behind API Gateway the path carries the stage, /prod/.well-known/...
              uriPath('CONTAINS', '/.well-known/oauth-protected-resource/'),
            ] } },
          ],
        },
      },
      visibilityConfig: visibility('AllowCloudFrontWithMcpScope'),
    }],
  });
}

// What every pattern's origin function receives from the stack.
export interface OriginProps {
  // The hello image: a CDK image asset, or a repository and tag the CloudFormation template takes as parameters.
  image: { repository: ecr.IRepository; imageTag: string };
  originSecret: string;
  originWafArn: string;
  vpc: ec2.IVpc;
  auth: McpAuth;
}
