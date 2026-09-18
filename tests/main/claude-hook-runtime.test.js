import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRunner } from '../../scripts/claude-hook-runtime.mjs';

const roots = [];
const streams = [];
function processDouble(pid) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  streams.push(stdout, stderr);
  return Object.assign(new EventEmitter(), { pid, stdout, stderr, kill: vi.fn(), unref: vi.fn() });
}
function setup({ duringSpawn, spawnError, noPid = false } = {}) {
  vi.useFakeTimers();
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-runtime-'));
  roots.push(owned);
  fs.mkdirSync(path.join(owned, 'work'));
  const child = processDouble(noPid ? undefined : 2468);
  const killer = processDouble(2469);
  const receipt = {};
  const spawnProcess = vi.fn(() => {
    if (spawnProcess.mock.calls.length === 1) {
      duringSpawn?.();
      if (spawnError) throw Error('PRIVATE_SPAWN');
      return child;
    }
    return killer;
  });
  const run = createRunner({
    selected: { claude: 'selected.exe' },
    owned,
    env: {},
    system32: 'system32',
    receipt,
    spawnProcess,
  });
  return { run, child, killer, receipt, spawnProcess, owned };
}
afterEach(() => {
  vi.useRealTimers();
  for (const stream of streams.splice(0)) stream.destroy();
  for (const root of roots.splice(0)) {
    expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
    expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it('keeps the ordinary exit result and removes abort/timer ownership', async () => {
  const t = setup();
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const done = t.run(['--init-only'], { signal: controller.signal });
  t.child.stdout.write('bounded stdout');
  t.child.stderr.write('private stderr');
  t.child.emit('close', 0);
  expect(await done).toMatchObject({
    code: 0,
    timedOut: false,
    cancelled: false,
    exceeded: false,
    stdout: 'bounded stdout',
    stderrBytes: 14,
  });
  controller.abort();
  expect(t.spawnProcess).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(vi.getTimerCount()).toBe(0);
});

it('does not spawn for an already aborted signal', async () => {
  const t = setup();
  const controller = new AbortController();
  controller.abort();
  expect(await t.run([], { signal: controller.signal })).toMatchObject({
    cancelled: true,
    timedOut: false,
    treeCleanupConfirmed: true,
  });
  expect(t.spawnProcess).not.toHaveBeenCalled();
});

it.each([999, 90001, 1500.5, NaN])(
  'rejects invalid timeout %s without spawning',
  async (timeoutMs) => {
    const t = setup();
    expect(await t.run([], { timeoutMs })).toMatchObject({ code: 1, error: 'invalid-timeout' });
    expect(t.spawnProcess).not.toHaveBeenCalled();
  },
);

it.each(['parent-first', 'killer-first'])(
  'waits for both parent and tree killer (%s)',
  async (order) => {
    const t = setup();
    const controller = new AbortController();
    let settled = false;
    const done = t.run([], { signal: controller.signal }).then((r) => {
      settled = true;
      return r;
    });
    controller.abort();
    expect(t.spawnProcess.mock.calls[1][1]).toEqual(['/PID', '2468', '/T', '/F']);
    if (order === 'parent-first') t.child.emit('close', null);
    else t.killer.emit('close', 0);
    await Promise.resolve();
    expect(settled).toBe(false);
    if (order === 'parent-first') t.killer.emit('close', 0);
    else t.child.emit('close', null);
    expect(await done).toMatchObject({
      cancelled: true,
      timedOut: false,
      treeCleanupConfirmed: true,
    });
    expect(t.receipt.unreapedProcess).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  },
);

it('reaps cancellation delivered inside spawn before the child is assigned', async () => {
  const controller = new AbortController();
  const t = setup({ duringSpawn: () => controller.abort() });
  const done = t.run([], { signal: controller.signal });
  t.killer.emit('close', 0);
  t.child.emit('close', null);
  expect(await done).toMatchObject({ cancelled: true, treeCleanupConfirmed: true });
  expect(t.spawnProcess).toHaveBeenCalledTimes(2);
});

it('waits for a late PID after cancellation during spawn', async () => {
  const controller = new AbortController();
  const t = setup({ noPid: true, duringSpawn: () => controller.abort() });
  const done = t.run([], { signal: controller.signal });
  expect(t.spawnProcess).toHaveBeenCalledTimes(1);
  t.child.pid = 1234;
  t.child.emit('spawn');
  t.killer.emit('close', 0);
  t.child.emit('close', null);
  expect(await done).toMatchObject({ treeCleanupConfirmed: true });
  expect(t.spawnProcess.mock.calls[1][1][1]).toBe('1234');
});

it.each(['error', 'nonzero'])(
  'does not claim cleanup after taskkill %s and parent close',
  async (kind) => {
    const t = setup();
    const controller = new AbortController();
    const done = t.run([], { signal: controller.signal });
    controller.abort();
    if (kind === 'error') t.killer.emit('error', Error('PRIVATE_KILL'));
    else t.killer.emit('close', 1);
    t.child.emit('close', 0);
    expect(await done).toMatchObject({ code: 1, treeCleanupConfirmed: false });
    expect(t.receipt).toEqual({ unreapedProcess: true, cleanupUnconfirmed: true });
  },
);

it('bounds cleanup when taskkill hangs even if the parent already closed', async () => {
  const t = setup();
  const controller = new AbortController();
  const done = t.run([], { signal: controller.signal });
  controller.abort();
  t.child.emit('close', 0);
  await vi.advanceTimersByTimeAsync(3000);
  expect(await done).toMatchObject({
    cancelled: true,
    timedOut: false,
    treeCleanupConfirmed: false,
  });
  t.killer.emit('close', 0);
  expect(t.receipt.cleanupUnconfirmed).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not settle confirmed when taskkill succeeds but the parent never closes', async () => {
  const t = setup();
  const done = t.run([], { timeoutMs: 1000 });
  await vi.advanceTimersByTimeAsync(1000);
  t.killer.emit('close', 0);
  await vi.advanceTimersByTimeAsync(3000);
  expect(await done).toMatchObject({
    timedOut: true,
    cancelled: false,
    treeCleanupConfirmed: false,
  });
  expect(t.child.unref).toHaveBeenCalled();
  expect(t.child.stdout.destroyed).toBe(true);
});

it.each([undefined, 90000])('uses bounded normal or explicit timeout %s', async (timeoutMs) => {
  const t = setup();
  const done = t.run([], timeoutMs === undefined ? undefined : { timeoutMs });
  const delay = timeoutMs ?? 20000;
  await vi.advanceTimersByTimeAsync(delay - 1);
  expect(t.spawnProcess).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  t.child.emit('close', null);
  t.killer.emit('close', 0);
  expect(await done).toMatchObject({
    timedOut: true,
    cancelled: false,
    treeCleanupConfirmed: true,
  });
});

it.each(['stdout', 'stderr'])('caps %s and starts one cleanup only', async (stream) => {
  const t = setup();
  const done = t.run([]);
  t.child[stream].emit('data', Buffer.alloc(32769, 65));
  t.child[stream].emit('data', Buffer.alloc(32769, 65));
  t.child.emit('close', null);
  t.killer.emit('close', 0);
  const result = await done;
  expect(result).toMatchObject({ exceeded: true, timedOut: false, treeCleanupConfirmed: true });
  expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(32768);
  expect(t.spawnProcess).toHaveBeenCalledTimes(2);
});

it('bounds scratch growth with no private output in the result', async () => {
  const t = setup();
  const file = fs.openSync(path.join(t.owned, 'budget-fixture'), 'w');
  fs.ftruncateSync(file, 16 * 1024 ** 2 + 1);
  fs.closeSync(file);
  const done = t.run([]);
  await vi.advanceTimersByTimeAsync(1000);
  t.child.emit('close', null);
  t.killer.emit('close', 0);
  expect(await done).toMatchObject({ exceeded: true, treeCleanupConfirmed: true });
});

it('also bounds decoded stdout when invalid UTF-8 would expand it', async () => {
  const t = setup();
  const done = t.run([]);
  t.child.stdout.emit('data', Buffer.alloc(32768, 255));
  t.child.emit('close', null);
  t.killer.emit('close', 0);
  expect(await done).toMatchObject({ exceeded: true, stdout: '', treeCleanupConfirmed: true });
});

it('preserves scratch when starting taskkill throws', async () => {
  const t = setup();
  const controller = new AbortController();
  const done = t.run([], { signal: controller.signal });
  t.spawnProcess.mockImplementation(() => {
    throw Error('PRIVATE_KILL_SPAWN');
  });
  controller.abort();
  t.child.emit('close', 0);
  expect(await done).toMatchObject({ cancelled: true, treeCleanupConfirmed: false });
  expect(t.receipt.unreapedProcess).toBe(true);
});

it.each(['throw', 'event'])('returns fixed spawn failure for %s', async (kind) => {
  const t = setup({ spawnError: kind === 'throw', noPid: true });
  const done = t.run([]);
  if (kind === 'event') t.child.emit('error', Error('PRIVATE_EXCEPTION'));
  const result = await done;
  expect(result).toMatchObject({ error: 'spawn-failed', code: 1, treeCleanupConfirmed: true });
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
  expect(vi.getTimerCount()).toBe(0);
});
