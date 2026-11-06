import { aws_cognito as cognito, Duration, Names, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface McpAuth {
  userPool: cognito.IUserPool;
  client: cognito.IUserPoolClient;
  // https://cognito-idp.<region>.amazonaws.com/<pool id>: the `iss` of every token and the authorization server in the
  // pattern's /.well-known metadata.
  issuer: string;
  // The client-credentials token endpoint.
  tokenUrl: string;
  // The OAuth scope a token needs for this pattern, as Amazon Cognito names it: <resource server>/<scope>.
  scope: string;
}

// An Amazon Cognito user pool that issues RS256 access tokens with the pattern's scope to one machine-to-machine client.
// The scope stands in for an audience: Cognito binds `aud` to a resource (RFC 8707) only in user sign-in flows, not in
// client-credentials grants. A pool holds one prefix domain and prefixes are unique per Region, so the prefix derives
// from the stack.
export function mcpAuth(scope: Construct, oauthScope: string): McpAuth {
  const [identifier, scopeName] = oauthScope.split('/');
  const userPool = new cognito.UserPool(scope, 'McpUserPool', { removalPolicy: RemovalPolicy.DESTROY });
  const resourceServerScope = new cognito.ResourceServerScope({ scopeName, scopeDescription: `Call the MCP tools of ${scopeName}` });
  const resourceServer = userPool.addResourceServer('McpResourceServer', { identifier, scopes: [resourceServerScope] });
  const domain = userPool.addDomain('McpDomain', {
    cognitoDomain: { domainPrefix: Names.uniqueResourceName(userPool, { maxLength: 40, separator: '-' }).toLowerCase() },
  });
  const client = userPool.addClient('McpClient', {
    generateSecret: true,
    accessTokenValidity: Duration.minutes(5), // the shortest Amazon Cognito allows
    oAuth: { flows: { clientCredentials: true }, scopes: [cognito.OAuthScope.resourceServer(resourceServer, resourceServerScope)] },
  });

  return { userPool, client, issuer: userPool.userPoolProviderUrl, tokenUrl: `${domain.baseUrl()}/oauth2/token`, scope: oauthScope };
}
