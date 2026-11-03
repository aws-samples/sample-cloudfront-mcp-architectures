import { aws_cognito as cognito, Aws, Duration, Fn, Names, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';

// One OAuth scope per pattern, so a token for one pattern is refused by the others. Amazon Cognito names scopes
// <resource server>/<scope>. Scopes stand in for an audience: Cognito binds `aud` to a resource (RFC 8707) only in
// user sign-in flows, not in client-credentials grants.
export const PATTERN_SCOPES = {
  agentCore: 'mcp/agentcore',
  apiGateway: 'mcp/api-gateway',
  webFunction: 'mcp/web-function',
  alb: 'mcp/alb',
} as const;

export interface McpAuth {
  userPool: cognito.IUserPool;
  client: cognito.IUserPoolClient;
  // https://cognito-idp.<region>.amazonaws.com/<pool id>: the `iss` of every token and the authorization server in each
  // pattern's /.well-known metadata.
  issuer: string;
  // The client-credentials token endpoint.
  tokenUrl: string;
}

// An Amazon Cognito user pool that issues RS256 access tokens with a pattern's scope to one machine-to-machine client.
// Domain prefixes are unique across all accounts in a Region, so a template that many accounts deploy (stackIdDomain) takes
// its stack's UUID. The CDK stack keeps its name: a pool holds one prefix domain, so CloudFormation cannot replace it.
export function mcpAuth(scope: Construct, { stackIdDomain = false } = {}): McpAuth {
  const userPool = new cognito.UserPool(scope, 'McpUserPool', { removalPolicy: RemovalPolicy.DESTROY });
  const scopes = Object.values(PATTERN_SCOPES).map((s) => new cognito.ResourceServerScope({
    scopeName: s.split('/')[1],
    scopeDescription: `Call the MCP tools of ${s.split('/')[1]}`,
  }));
  const resourceServer = userPool.addResourceServer('McpResourceServer', { identifier: 'mcp', scopes });
  const domain = userPool.addDomain('McpDomain', {
    cognitoDomain: {
      domainPrefix: stackIdDomain
        ? Fn.join('-', ['mcp', Fn.select(2, Fn.split('/', Aws.STACK_ID))])
        : Names.uniqueResourceName(userPool, { maxLength: 40, separator: '-' }).toLowerCase(),
    },
  });
  const client = userPool.addClient('McpClient', {
    generateSecret: true,
    accessTokenValidity: Duration.minutes(5), // the shortest Amazon Cognito allows
    oAuth: { flows: { clientCredentials: true }, scopes: scopes.map((s) => cognito.OAuthScope.resourceServer(resourceServer, s)) },
  });

  return { userPool, client, issuer: userPool.userPoolProviderUrl, tokenUrl: `${domain.baseUrl()}/oauth2/token` };
}
