// Viewer request on the pattern's distribution: a pre-filter in front of the origin's own token check.
// 1. Decode the Bearer JWT and answer 401 for anything malformed, expired, from another issuer or not an access token.
//    The signature is checked at the origin: CloudFront Functions have HMAC but no RS256 verify.
// 2. Replace any client-sent x-jwt-claims with the decoded claims, so the origin's AWS WAF can match on them. A forged
//    payload gets past this step but fails the origin's signature check.
// 3. Set x-forwarded-host, so the origin can name its public URL in its /.well-known metadata.
// 4. With METADATA_SCOPE set, answer the RFC 9728 metadata here instead: for an origin that publishes its own with the
//    wrong resource URL (AgentCore Gateway names its own hostname, not this distribution's).
// The stack replaces these at synth: the Amazon Cognito user pool's issuer URL and the scope ('' leaves the metadata to
// the origin).
const ISSUER = 'JWT_ISSUER';
const METADATA_SCOPE = 'METADATA_SCOPE';

function handler(event) {
  const request = event.request;
  const host = request.headers.host.value;
  request.headers['x-forwarded-host'] = { value: host };
  if (METADATA_SCOPE && request.uri === '/.well-known/oauth-protected-resource/mcp') {
    const metadata = { resource: `https://${host}/mcp`, authorization_servers: [ISSUER], bearer_methods_supported: ['header'], scopes_supported: [METADATA_SCOPE] };
    return {
      statusCode: 200,
      statusDescription: 'OK',
      headers: { 'content-type': { value: 'application/json' }, 'cache-control': { value: 'public, max-age=3600' } },
      body: JSON.stringify(metadata),
    };
  }
  if (request.uri.startsWith('/.well-known/')) return request; // discovery needs no token

  const claims = decode(request.headers.authorization);
  if (!claims) {
    const headers = { 'www-authenticate': { value: `Bearer resource_metadata="https://${host}/.well-known/oauth-protected-resource/mcp"` } };
    return { statusCode: 401, statusDescription: 'Unauthorized', headers };
  }
  // Assigning replaces the whole header, including any multiValue copies the client sent.
  request.headers['x-jwt-claims'] = { value: JSON.stringify(claims) };
  return request;
}

// Returns the payload of a well-formed, unexpired access token from ISSUER, or null. Does not check the signature.
function decode(authorization) {
  const match = authorization && /^Bearer [\w-]+\.([\w-]+)\.[\w-]+$/.exec(authorization.value);
  if (!match) return null;
  try {
    const claims = JSON.parse(Buffer.from(match[1], 'base64url').toString());
    const now = Date.now() / 1000;
    if (claims.iss !== ISSUER || claims.token_use !== 'access') return null;
    if (typeof claims.exp !== 'number' || claims.exp <= now) return null;
    return claims;
  } catch (e) {
    return null;
  }
}
