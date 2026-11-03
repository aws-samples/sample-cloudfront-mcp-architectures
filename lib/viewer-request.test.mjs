import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ISSUER = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_example';
const source = readFileSync(new URL('./viewer-request.js', import.meta.url), 'utf8').replace("'JWT_ISSUER'", `'${ISSUER}'`);
const load = (scope) => new Function(`${source.replace("'METADATA_SCOPE'", `'${scope}'`)}; return handler;`)();
const handler = load('');

const now = Math.floor(Date.now() / 1000);
const good = { iss: ISSUER, token_use: 'access', scope: 'mcp/invoke', client_id: 'c1', exp: now + 60 };
const jwt = (claims) => `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const host = 'd111111abcdef8.cloudfront.net';
const call = (headers, uri = '/mcp', method = 'POST') => handler({ request: { method, uri, headers: { host: { value: host }, ...headers } } });
const bearer = (token) => ({ authorization: { value: `Bearer ${token}` } });

test('a well-formed access token passes with its claims and the viewer host, replacing a forged claims header', () => {
  const req = call({ ...bearer(jwt(good)), 'x-jwt-claims': { value: '{"scope":"forged"}', multiValue: [{ value: 'x' }] } });
  assert.equal(req.uri, '/mcp');
  assert.deepEqual(req.headers['x-jwt-claims'], { value: JSON.stringify(good) });
  assert.deepEqual(req.headers['x-forwarded-host'], { value: host });
});

test('401 pointing at the metadata for missing, malformed, expired, foreign-issuer or ID tokens', () => {
  const cases = [{}, { authorization: { value: 'Basic abc' } }, bearer('a.b'), bearer('a.%%%.c'),
    bearer(jwt({ ...good, exp: now - 1 })), bearer(jwt({ ...good, exp: undefined })),
    bearer(jwt({ ...good, iss: 'https://evil.example' })), bearer(jwt({ ...good, token_use: 'id' }))];
  for (const headers of cases) {
    const res = call(headers);
    assert.equal(res.statusCode, 401, JSON.stringify(headers));
    assert.deepEqual(Object.keys(res.headers), ['www-authenticate']);
    assert.equal(res.headers['www-authenticate'].value, `Bearer resource_metadata="https://${host}/.well-known/oauth-protected-resource/mcp"`);
  }
});

test('/.well-known passes without a token and carries the viewer host', () => {
  const req = call({}, '/.well-known/oauth-protected-resource/mcp', 'GET');
  assert.equal(req.uri, '/.well-known/oauth-protected-resource/mcp');
  assert.deepEqual(req.headers['x-forwarded-host'], { value: host });
  assert.equal(req.headers['x-jwt-claims'], undefined);
});

test('an OPTIONS request without a token is a 401 like any other: no CORS is answered at the edge', () => {
  const res = call({}, '/mcp', 'OPTIONS');
  assert.equal(res.statusCode, 401);
  assert.deepEqual(Object.keys(res.headers), ['www-authenticate']);
});

test('with METADATA_SCOPE set, answers the protected-resource metadata for this distribution at the edge', () => {
  const res = load('mcp/agentcore')({ request: { method: 'GET', uri: '/.well-known/oauth-protected-resource/mcp', headers: { host: { value: host } } } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), {
    resource: `https://${host}/mcp`, authorization_servers: [ISSUER], bearer_methods_supported: ['header'], scopes_supported: ['mcp/agentcore'],
  });
});
