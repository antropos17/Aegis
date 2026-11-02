import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

const root = path.resolve(import.meta.dirname, '../..');
const evidence =
  process.env.AEGIS_READ_PACING_OUTPUT ?? path.join(os.tmpdir(), 'aegis-etw-read-pacing');
const evidenceRoot = path.resolve(evidence);
const output = path.join(evidenceRoot, 'managed-' + crypto.randomUUID());
const compiler = path.join(
  process.env.WINDIR ?? 'C:/Windows',
  'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
);
const available = process.platform === 'win32' && fs.existsSync(compiler);
const fixture = path.join(root, 'tests/fixtures/etw-read-process.cs');
const harness = path.join(root, 'tests/fixtures/etw-read-pacing-tests.cs');
const executable = path.join(output, 'managed-pacing-tests.exe');
const env = { ...process.env, TEMP: path.join(output, 'temp'), TMP: path.join(output, 'temp') };

function compileManagedFixture() {
  fs.mkdirSync(env.TEMP, { recursive: true });
  const args = [
    '/nologo',
    '/target:exe',
    '/platform:x64',
    '/langversion:5',
    '/warnaserror+',
    '/main:ManagedPacingTests',
    '/out:' + executable,
    fixture,
    harness,
  ];
  const startedAt = new Date().toISOString();
  const stdout = execFileSync(compiler, args, {
    env,
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 4096,
    encoding: 'utf8',
  });
  fs.writeFileSync(
    path.join(output, 'compile.json'),
    JSON.stringify(
      {
        compiler,
        args,
        startedAt,
        completedAt: new Date().toISOString(),
        exitCode: 0,
        stdout,
        fixtureSha256: crypto.createHash('sha256').update(fs.readFileSync(fixture)).digest('hex'),
        harnessSha256: crypto.createHash('sha256').update(fs.readFileSync(harness)).digest('hex'),
        nativeCalls: false,
      },
      null,
      2,
    ),
  );
}

function check(mode) {
  const result = spawnSync(executable, [mode], {
    env,
    windowsHide: true,
    timeout: 10000,
    maxBuffer: 4096,
    encoding: 'utf8',
  });
  fs.writeFileSync(
    path.join(output, mode + '.json'),
    JSON.stringify(
      {
        mode,
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        error: result.error?.message,
        nativeCalls: false,
        clock: 'virtual monotonic milliseconds; regression inputs, not measured VM latency',
      },
      null,
      2,
    ),
  );
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout.trim());
}

describe.skipIf(!available)('actual read fixture pacing with a managed monotonic clock', () => {
  beforeAll(compileManagedFixture);
  afterAll(() => {
    if (
      !process.env.AEGIS_READ_PACING_OUTPUT &&
      path.dirname(path.resolve(output)) === evidenceRoot
    ) {
      fs.rmSync(output, { recursive: true, force: true });
    }
  });

  it('keeps 160 modeled reads inside the command budget when scheduler wakes round up', () => {
    expect(check('rounded-budget')).toMatchObject({ modeledReads: 160 });
  });

  it('retains the nominal 3.2 second observation window', () => {
    expect(check('regular')).toMatchObject({ modeledReads: 160, elapsedMilliseconds: 3200 });
  });

  it('accounts for read work that already exceeds the cadence without extra pauses', () => {
    expect(check('io-budget')).toMatchObject({
      modeledReads: 160,
      elapsedMilliseconds: 4000,
      pauseCalls: 0,
    });
  });

  it('rechecks the monotonic clock after an early wake', () => {
    expect(check('early-wake')).toMatchObject({ modeledReads: 160, elapsedMilliseconds: 3200 });
  });

  it('does not pause when the target has already elapsed', () => {
    expect(check('already-late')).toMatchObject({ elapsedMilliseconds: 5000, pauseCalls: 0 });
  });

  it('absorbs an in-loop stall while retaining the observation window and read count', () => {
    expect(check('mid-read-stall')).toMatchObject({ modeledReads: 160, elapsedMilliseconds: 3200 });
  });
});
