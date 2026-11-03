import { createPublicKey, verify } from 'node:crypto';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';

// RFC 9728 document for this server. The host is the viewer's, set by the viewer-request CloudFront Function.
export function protectedResourceMetadata(req, issuer, scope) {
  return {
    resource: `https://${publicHost(req)}/mcp`,
    authorization_servers: [issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: [scope],
  };
}

export const metadataUrl = (req) => `https://${publicHost(req)}/.well-known/oauth-protected-resource/mcp`;
const publicHost = (req) => req.headers['x-forwarded-host'] ?? req.headers.host;

// OAuthTokenVerifier for Amazon Cognito access tokens (RS256), keys from the issuer's JWKS.
export function cognitoVerifier(issuer) {
  let keys = new Map();
  let fetchedAt = 0;
  const keyFor = async (kid) => {
    if (!keys.has(kid) && Date.now() - fetchedAt > 30_000) { // refetch on an unknown kid (rotation), at most every 30 s
      const { keys: jwks } = await (await fetch(`${issuer}/.well-known/jwks.json`)).json();
      keys = new Map(jwks.map((jwk) => [jwk.kid, createPublicKey({ key: jwk, format: 'jwk' })]));
      fetchedAt = Date.now();
    }
    return keys.get(kid);
  };

  return {
    async verifyAccessToken(token) {
      const [h, p, s] = token.split('.');
      const part = (b64) => { try { return JSON.parse(Buffer.from(b64, 'base64url')); } catch { return undefined; } };
      const header = h && part(h);
      const claims = p && part(p);
      if (!header || !claims || !s || header.alg !== 'RS256') throw new InvalidTokenError('Malformed token');
      const key = await keyFor(header.kid);
      if (!key || !verify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'))) {
        throw new InvalidTokenError('Bad signature');
      }
      if (claims.iss !== issuer || claims.token_use !== 'access') throw new InvalidTokenError('Wrong issuer or token type');
      return { token, clientId: claims.client_id, scopes: claims.scope?.split(' ') ?? [], expiresAt: claims.exp };
    },
  };
}
