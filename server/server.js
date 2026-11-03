import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { z } from 'zod';
import { cognitoVerifier, metadataUrl, protectedResourceMetadata } from './auth.js';

function helloServer() {
  const server = new McpServer({ name: 'hello', version: '1.0.0' });
  server.registerTool(
    'hello',
    { description: 'Say hello to someone', inputSchema: { name: z.string() } },
    async ({ name }) => ({ content: [{ type: 'text', text: `Hello, ${name}` }] }),
  );
  return server;
}

// issuer: the token issuer (Amazon Cognito user pool URL) to advertise in /.well-known; none means no auth at all.
// scope: the scope a token needs for this server; tokens for other patterns carry other scopes.
// verify: also check the bearer token here, for origins that have no token check in front of them.
export function createApp({ issuer, scope, verify } = {}) {
  const app = express();
  app.use(express.json());

  // Health check for load balancers and the Lambda Web Adapter readiness probe.
  app.get('/', (_req, res) => res.send('ok'));

  if (issuer) {
    app.get('/.well-known/oauth-protected-resource/mcp', (req, res) => {
      res.set('cache-control', 'public, max-age=3600').json(protectedResourceMetadata(req, issuer, scope));
    });
  }
  const verifier = issuer && verify && cognitoVerifier(issuer);
  // Built per request: the metadata URL in the 401 depends on the viewer's host.
  const auth = verifier
    ? (req, res, next) => requireBearerAuth({ verifier, requiredScopes: [scope], resourceMetadataUrl: metadataUrl(req) })(req, res, next)
    : (_req, _res, next) => next();

  // Stateless Streamable HTTP: a fresh server per request, no session to pin to one task.
  app.post('/mcp', auth, handleMcp);
  return app;
}

async function handleMcp(req, res) {
  const server = helloServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

export const app = createApp({ issuer: process.env.JWT_ISSUER, scope: process.env.JWT_SCOPE, verify: process.env.JWT_VERIFY === 'true' });

// Lambda Web Functions load this file as the entry point and pass the listen address in AWS_LAMBDA_HTTP_ENDPOINT (host:port).
const webFunctionEndpoint = process.env.AWS_LAMBDA_HTTP_ENDPOINT;
if (webFunctionEndpoint || import.meta.url === `file://${process.argv[1]}`) {
  const [host, port] = webFunctionEndpoint ? webFunctionEndpoint.split(':') : [undefined, process.env.PORT ?? 8000];
  app.listen(Number(port), host, () => console.log(`hello MCP server on ${host ?? ''}:${port}/mcp`));
}
