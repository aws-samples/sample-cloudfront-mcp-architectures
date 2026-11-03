import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import express from 'express';
import { createApp } from './server.js';

// A local issuer that serves a JWKS, and RS256 tokens signed with its key or with an unknown one.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }] };

async function setup(t) {
  const idp = express().get('/.well-known/jwks.json', (_q, r) => r.json(jwks)).listen(0);
  const issuer = `http://127.0.0.1:${idp.address().port}`;
  const mcp = createApp({ issuer, scope: 'mcp/alb', verify: true }).listen(0);
  t.after(() => { idp.close(); mcp.close(); });
  const now = Math.floor(Date.now() / 1000);
  const token = (claims, { key = privateKey, kid = 'k1', alg = 'RS256' } = {}) => {
    const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const input = `${part({ alg, kid })}.${part({ iss: issuer, token_use: 'access', scope: 'mcp/alb', client_id: 'c1', exp: now + 60, ...claims })}`;
    return `${input}.${sign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`;
  };
  const call = (bearer) => fetch(`http://127.0.0.1:${mcp.address().port}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-forwarded-host': 'd111111abcdef8.cloudfront.net', ...(bearer && { authorization: `Bearer ${bearer}` }) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'hello', arguments: { name: 'edge' } } }),
  });
  return { issuer, token, call, base: `http://127.0.0.1:${mcp.address().port}` };
}

test('a valid Cognito-style access token reaches the hello tool', async (t) => {
  const { token, call } = await setup(t);
  const res = await call(token({}));
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Hello, edge/);
});

test('401 with resource_metadata for a missing, forged, wrong-issuer, ID, expired or alg-swapped token', async (t) => {
  const { token, call } = await setup(t);
  for (const bad of [undefined, token({}, { key: other }), token({ iss: 'https://evil.example' }), token({ token_use: 'id' }),
    token({ exp: 1 }), token({}, { alg: 'HS256' }), token({}, { kid: 'unknown' }), 'a.b.c']) {
    const res = await call(bad);
    assert.equal(res.status, 401, String(bad));
    assert.match(res.headers.get('www-authenticate'),
      /resource_metadata="https:\/\/d111111abcdef8\.cloudfront\.net\/\.well-known\/oauth-protected-resource\/mcp"/);
  }
});

test('403 for a token issued for another pattern', async (t) => {
  const { token, call } = await setup(t);
  assert.equal((await call(token({ scope: 'mcp/api-gateway' }))).status, 403);
});

test('protected-resource metadata names the viewer-facing resource and the issuer', async (t) => {
  const { issuer, base } = await setup(t);
  const res = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`, { headers: { 'x-forwarded-host': 'd111111abcdef8.cloudfront.net' } });
  assert.equal(res.headers.get('cache-control'), 'public, max-age=3600');
  assert.deepEqual(await res.json(), {
    resource: 'https://d111111abcdef8.cloudfront.net/mcp',
    authorization_servers: [issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp/alb'],
  });
});
