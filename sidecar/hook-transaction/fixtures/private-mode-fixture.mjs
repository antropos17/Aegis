import fs from 'node:fs';
import path from 'node:path';
import { debuglog } from 'node:util';
import { createRequire } from 'node:module';

const [root, assetsFile, mode] = process.argv.slice(2);
if (
  process.argv.length !== 5 ||
  !path.isAbsolute(root) ||
  !['stream', 'child_process', 'net', 'worker', 'node-options'].includes(mode)
)
  throw Error('fixture-selection-invalid');
if (mode !== 'node-options' && !debuglog(mode).enabled)
  throw Error('fixture-debug-mode-not-effective');
for (const key of Object.keys(process.env)) if (/^NODE_DEBUG$/i.test(key)) delete process.env[key];
const require = createRequire(import.meta.url);
const { createWindowsHookIO } = require('../../../src/main/claude-hook-windows-io');
const assets = JSON.parse(fs.readFileSync(assetsFile, 'utf8'));
const targetPath = path.join(root, 'settings-fixture.json');
const backupRoot = path.join(root, 'private-backups');
let refused = false,
  io;
try {
  io = await createWindowsHookIO({
    ownedFixture: true,
    targetPath,
    backupRoot,
    assets,
    requestMs: 3000,
    sessionMs: 10000,
    cleanupMs: 2000,
  });
  // Only the guard-removal mutant reaches this: exercise the real raw pipe canary.
  await io.readTarget();
} catch (error) {
  refused = error.message === 'private-windows-io-failed';
} finally {
  if (io) await io.close();
}
const untouched = !fs.existsSync(backupRoot);
console.log(JSON.stringify({ fixture: 'cached-private-debug-refusal', refused, untouched }));
if (!refused || !untouched) process.exitCode = 1;
