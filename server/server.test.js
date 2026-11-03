import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { app } from './server.js';

test('tools/call hello returns a greeting', async (t) => {
  const http = app.listen(0);
  t.after(() => http.close());
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${http.address().port}/mcp`)));
  const result = await client.callTool({ name: 'hello', arguments: { name: 'edge' } });
  assert.deepEqual(result.content, [{ type: 'text', text: 'Hello, edge' }]);
  await client.close();
});

test('listens on AWS_LAMBDA_HTTP_ENDPOINT when loaded as a web function entry point', async (t) => {
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, ['--input-type=module', '-e', "import './server.js'"], {
    cwd: import.meta.dirname,
    env: { ...process.env, AWS_LAMBDA_HTTP_ENDPOINT: '127.0.0.1:18731' },
  });
  t.after(() => child.kill());
  await new Promise((resolve) => child.stdout.once('data', resolve));
  assert.equal(await (await fetch('http://127.0.0.1:18731/')).text(), 'ok');
});
