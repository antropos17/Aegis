import fs from 'node:fs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createPipe } = require('../../../src/main/claude-hook-windows-io-wire');
const { qualifyAssets } = require('../../../src/main/session-context-windows-assets');
const report = 'X:/tmp/aegis-ten-hour-20261019/reports/05-windows-context-reader';
const assets = qualifyAssets(JSON.parse(fs.readFileSync(`${report}/assets.json`, 'utf8')));
const rows = [];
const canary = 'PRIVATE_TRANSPORT_CANARY';
async function run(name, executable, args, body, env, cwd) {
  const child = spawn(executable, args, {
    env,
    cwd,
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pipe = createPipe(child, { requestMs: 250, sessionMs: 1500, cleanupMs: 1500 });
  let error;
  try {
    await pipe.request(body);
  } catch (caught) {
    error = caught;
  } finally {
    const closed = await pipe.close();
    assert.equal(closed.exit, 'confirmed');
    assert.equal(closed.streams, 'confirmed');
    assert.ok(child.exitCode !== null || child.signalCode !== null);
    assert.ok(child.stdin.closed && child.stdout.closed && child.stderr.closed);
    assert.ok(!JSON.stringify(closed).includes(canary));
  }
  assert.ok(error);
  assert.ok(!String(error).includes(canary));
  assert.ok(!String(error).includes(Buffer.from(canary).toString('base64')));
  rows.push({ name, result: 'PASS', originalChildExit: 'confirmed', streams: 'confirmed' });
}
for (const mode of ['stall', 'stderr', 'abrupt', 'malformed', 'wrongid', 'overframe', 'late'])
  await run(
    `transport-${mode}`,
    process.execPath,
    ['sidecar/session-context-reader/native-fixture/transport-child.cjs', mode],
    { op: 'open' },
    { SystemRoot: process.env.SystemRoot, WINDIR: process.env.SystemRoot },
    process.cwd(),
  );
for (const [name, body] of [
  ['unsupported-write', { op: 'write' }],
  ['read-before-open', { op: 'read', length: 1, position: 0 }],
  ['stat-before-open', { op: 'stat', scope: 'path' }],
  ['extra-open-field', { op: 'open', path: 'X:\\unused', extra: true }],
])
  await run(`native-grammar-${name}`, assets.executable, [], body, assets.env, assets.cwd);
fs.writeFileSync(`${report}/transport-controls.json`, JSON.stringify(rows, null, 2));
console.log(
  JSON.stringify({
    controls: rows.length,
    result: 'PASS',
    cleanup: 'confirmed',
    canaryInErrorsOrStatus: false,
  }),
);
