import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import childProcess from 'node:child_process';

const require = createRequire(import.meta.url);
const report = 'X:/tmp/aegis-ten-hour-20261019/reports/05-windows-context-reader';
const hostRoot = path.win32.normalize(`${report}/build`);
const runtimeRoot = 'C:\\Program Files\\dotnet';
const digest = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const pins = (root) =>
  fs.readdirSync(root).map((name) => ({ name, sha256: digest(path.join(root, name)) }));
const assets = {
  hostRoot,
  hostFiles: pins(hostRoot),
  runtimeRoot,
  runtimeVersion: '10.0.10',
  runtimeFiles: pins(path.join(runtimeRoot, 'shared/Microsoft.NETCore.App/10.0.10')),
  hostFxrSha256: digest(path.join(runtimeRoot, 'host/fxr/10.0.10/hostfxr.dll')),
};
fs.writeFileSync(`${report}/assets.json`, JSON.stringify(assets, null, 2));
const fixtureRoot = `${report}/owned-fixtures`;
fs.mkdirSync(fixtureRoot, { recursive: true });
const target = path.win32.normalize(`${fixtureRoot}/selected.jsonl`);
const bytes = fs.readFileSync('tests/fixtures/session-context/claude.jsonl');
fs.writeFileSync(target, bytes, { flag: 'wx' });
let child;
const originalSpawn = childProcess.spawn;
childProcess.spawn = (...args) => {
  child = originalSpawn(...args);
  return child;
};
const {
  createWindowsSessionContextReader,
} = require('../../../src/main/session-context-windows-reader');
const { createSessionContext } = require('../../../src/main/session-context');
const owner = createSessionContext({ digestKey: Buffer.alloc(32, 7) });
let parsed = false;
const reader = createWindowsSessionContextReader({
  assets,
  requestMs: 3000,
  sessionMs: 30000,
  cleanupMs: 3000,
  adapter: {
    parse(source, raw, selection) {
      assert.ok(child && child.exitCode !== null);
      assert.ok(child.stdin.closed && child.stdout.closed && child.stderr.closed);
      const unlocked = fs.openSync(target, 'r+');
      fs.closeSync(unlocked);
      assert.ok(raw && raw.equals(bytes));
      parsed = true;
      return owner.parse(source, raw, selection);
    },
  },
});
try {
  const result = await reader.read('claude-code', target, {
    sessionId: 'session-local',
    cwd: '/work',
    platform: 'posix',
  });
  assert.equal(result.availability, 'available');
  assert.equal(result.calls[0].toolName, 'Read');
  assert.ok(parsed);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_'));
  console.log(
    JSON.stringify({
      nativeHappyRead: 'PASS',
      originalChildExit: 'confirmed',
      streamsClosed: 'confirmed',
      leaseUnlockedBeforeSynchronousParse: true,
    }),
  );
} finally {
  childProcess.spawn = originalSpawn;
  bytes.fill(0);
  fs.unlinkSync(target);
}
