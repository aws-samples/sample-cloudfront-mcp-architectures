// Exports every docs/diagrams/<name>/<name>.drawio to <name>.png and <name>.svg with headless draw.io in a container.
// Usage: node docs/diagrams/export.mjs [name ...]   (default: every folder holding a .drawio)
// Needs Docker; pulls rlespinasse/drawio-export on first run. The export runs locally; nothing leaves the machine.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = import.meta.dirname;
const names = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(here).filter((n) => statSync(path.join(here, n)).isDirectory() && existsSync(path.join(here, n, `${n}.drawio`)));

const work = mkdtempSync(path.join(tmpdir(), 'drawio-'));
try {
  for (const n of names) copyFileSync(path.join(here, n, `${n}.drawio`), path.join(work, `${n}.drawio`));
  const run = (args) => execFileSync('docker', ['run', '--rm', '-v', `${work}:/data`, 'rlespinasse/drawio-export:latest', ...args], { stdio: 'inherit' });
  run(['-f', 'png', '-s', '2', '-b', '20']);
  run(['-f', 'svg', '-b', '20']);
  for (const n of names) {
    for (const ext of ['png', 'svg']) {
      // drawio-export names files <file>-<page>.<ext>; the page is named after the diagram.
      copyFileSync(path.join(work, 'export', `${n}-${n}.${ext}`), path.join(here, n, `${n}.${ext}`));
      console.log(`docs/diagrams/${n}/${n}.${ext}`);
    }
  }
} finally {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* files written by the container's user; left in tmp */ }
}
