import { expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { runGuardian } = require('../fixtures/mcp-crash-custody/bounded-runner.cjs');
const proof =
  [
    'GATE expectedParentChain=true exactSystemHosts=true finalMembershipStable=true heldRootIdentity=true',
    'PASS held-root terminated, outer Job empty, all held members signaled',
    'CLEANUP jobEmpty=True heldCount=6 heldExited=True',
  ].join('\n') + '\n';
const env = {
  ...(process.platform === 'win32'
    ? { SystemRoot: process.env.SystemRoot || process.env.SYSTEMROOT }
    : {}),
  TEMP: os.tmpdir(),
  TMP: os.tmpdir(),
  HOME: os.tmpdir(),
  USERPROFILE: os.tmpdir(),
  APPDATA: os.tmpdir(),
  LOCALAPPDATA: os.tmpdir(),
  NODE_DISABLE_COMPILE_CACHE: '1',
};
const child = (source, onReady = () => {}, extra = {}) =>
  runGuardian({
    command: process.execPath,
    args: ['-e', source],
    cwd: os.tmpdir(),
    env,
    onReady,
    deadlineMs: 1500,
    waitMs: 1000,
    ...extra,
  });
const afterReady = (text, suffix = 'process.exit(0)') =>
  `process.stdout.write('READY\\n'); process.stdin.once('data', () => process.stdout.write(${JSON.stringify(text)}, () => ${suffix}));`;

it('accepts complete framed cleanup only after the owner fixture confirms readiness', async () => {
  const ready = vi.fn();
  const result = await child(afterReady(proof), ready);
  expect(ready).toHaveBeenCalledOnce();
  expect(result.status).toBe('confirmed');
});

it('treats a hanging child as unknown even after it prints a complete success-looking frame', async () => {
  const result = await child(afterReady(proof, 'setTimeout(() => {}, 10000)'), () => {}, {
    deadlineMs: 500,
  });
  expect(result).toMatchObject({ status: 'cleanup-unknown', reason: 'deadline' });
});

it.each([
  ['truncated', proof.slice(0, -1)],
  ['contradictory', 'PASS contradictory\n' + proof],
  ['missing cleanup', proof.split('\n').slice(0, 2).join('\n') + '\n'],
])('refuses %s output', async (_name, output) => {
  expect((await child(afterReady(output))).status).toBe('cleanup-unknown');
});

it('refuses invalid encoding, stderr evidence, output overflow and a synchronous spawn error', async () => {
  expect((await child('process.stdout.write(Buffer.from([255])); process.exit(0); ')).status).toBe(
    'cleanup-unknown',
  );
  expect(
    (await child(`process.stderr.write(${JSON.stringify(proof)}); process.exit(0);`)).status,
  ).toBe('cleanup-unknown');
  const overflow = await child(
    "process.stdout.write('x'.repeat(9000)); setTimeout(() => {}, 10000);",
  );
  expect(overflow).toMatchObject({ status: 'cleanup-unknown', reason: 'output-overflow' });
  const unavailable = await runGuardian({ command: null, args: [], cwd: os.tmpdir(), env });
  expect(unavailable).toMatchObject({ status: 'cleanup-unknown', reason: 'spawn-error' });
});

it('never authorizes the crash command when the independent readiness check fails', async () => {
  const result = await child(
    "process.stdout.write('READY\\n'); setTimeout(() => {}, 10000);",
    () => {
      throw Error('fixture effect not observed');
    },
  );
  expect(result).toMatchObject({ status: 'cleanup-unknown', reason: 'ready-check-failed' });
});

it('cancels the held guardian and refuses to start another after teardown', async () => {
  const controller = new AbortController();
  const active = child(
    "process.stdout.write('READY\\n'); setTimeout(() => {}, 10000);",
    () => controller.abort(),
    { signal: controller.signal },
  );
  expect(await active).toMatchObject({ status: 'cleanup-unknown', reason: 'cancelled' });
  const ready = vi.fn();
  const after = await child(afterReady(proof), ready, { signal: controller.signal });
  expect(after).toMatchObject({ status: 'cleanup-unknown', reason: 'cancelled' });
  expect(ready).not.toHaveBeenCalled();
});
