import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PATTERNS, root, synth } from './synth.mjs';

for (const pattern of PATTERNS) {
  test(`cfn/${pattern}.yaml matches cdk synth`, async () => {
    const committed = await readFile(path.join(root, 'cfn', `${pattern}.yaml`), 'utf8');
    assert.ok(committed === await synth(pattern), `cfn/${pattern}.yaml is stale: run npm run cfn and commit the result`);
  });
}
