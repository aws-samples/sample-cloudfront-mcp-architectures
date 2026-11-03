// Synthesizes one CloudFormation template per pattern from the CDK app (-c pattern=<p>).
// node cfn/synth.mjs writes cfn/<p>.yaml; cfn/synth.test.mjs fails when a committed template drifts from the CDK code.
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

export const PATTERNS = ['agentcore', 'api-gateway', 'web-function', 'alb'];
export const root = path.join(import.meta.dirname, '..');

export async function synth(pattern) {
  const out = await mkdtemp(path.join(tmpdir(), `cfn-${pattern}-`)); // its own cdk.out, so patterns synthesize in parallel
  try {
    const { stdout } = await promisify(execFile)('npx', ['cdk', 'synth', '-c', `pattern=${pattern}`, '-o', out,
      '--path-metadata', 'false', '--version-reporting', 'false'], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  await Promise.all(PATTERNS.map(async (p) => writeFile(path.join(root, 'cfn', `${p}.yaml`), await synth(p))));
  console.log(`wrote ${PATTERNS.map((p) => `cfn/${p}.yaml`).join(', ')}`);
}
