import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, options, fixture, end, sha } from './resource-supervisor-fixtures.js';
const require = createRequire(import.meta.url);
const supervisor = require('../../../bench/lib/resource-supervisor');
afterEach(cleanup);
describe('supervisor lifecycle and pipe boundaries (CI only)', () => {
  it('does not spawn after a synchronous injected deadline already completed observation', async () => {
    const opts = options(),
      f = fixture();
    let ns = 0n;
    f.deps.nowNs = () => {
      const value = ns;
      ns += 100000000n;
      return value;
    };
    f.deps.setTimer = (fn) => {
      fn();
      return 1;
    };
    const result = await supervisor.superviseSelfResources(opts, f.deps);
    expect(result.exitCode).toBe(3);
    expect(f.deps.spawn).not.toHaveBeenCalled();
    expect(result.receipt.supervision.cause).toBe('wall-limit');
  });
  it('waits for the last pipe user close callback when child close is delivered first', async () => {
    const opts = options(),
      f = fixture(),
      pending = supervisor.superviseSelfResources(opts, f.deps);
    f.child.emit('spawn');
    f.child.emit('exit', 0, null);
    f.child.stdout.emit('end');
    f.child.stderr.emit('end');
    f.child.stdout.emit('close');
    f.child.emit('close', 0, null);
    expect(f.child.stderr.destroy).not.toHaveBeenCalled();
    f.child.stderr.emit('close');
    const result = await pending;
    expect(result.exitCode).toBe(0);
    expect(result.receipt.supervision.stderr).toMatchObject({
      ended: true,
      closed: true,
      destroyRequested: false,
      complete: true,
    });
  });
  it.each(['nonzero-exit', 'missing-spawn', 'unfinished-pipe'])(
    'independently refuses incomplete success evidence: %s',
    async (mode) => {
      const opts = options(),
        f = fixture(),
        pending = supervisor.superviseSelfResources(opts, f.deps);
      if (mode !== 'missing-spawn') f.child.emit('spawn');
      if (mode === 'unfinished-pipe') {
        f.child.emit('exit', 0, null);
        f.child.stdout.emit('end');
        f.child.stdout.emit('close');
        f.child.stderr.emit('close');
        f.child.emit('close', 0, null);
      } else end(f.child, mode === 'nonzero-exit' ? 7 : 0);
      const result = await pending;
      expect(result.exitCode).toBe(3);
      expect(result.receipt.supervision.cause).toBe(null);
      expect(result.receipt.supervision.exit.observed).toBe(true);
      expect(result.receipt.supervision.close.observed).toBe(true);
      expect(result.receipt.supervision.exit.code).toBe(mode === 'nonzero-exit' ? 7 : 0);
      expect(result.receipt.supervision.spawnObserved).toBe(mode !== 'missing-spawn');
      expect(result.receipt.supervision.stdout.complete).toBe(true);
      expect(result.receipt.supervision.stderr.complete).toBe(mode !== 'unfinished-pipe');
      expect(f.child.kill).not.toHaveBeenCalled();
    },
  );
  it.each(['exact-cap', 'pipe-error'])(
    'isolates stream admission at %s with a zero exit',
    async (mode) => {
      const opts = options(),
        f = fixture(),
        pending = supervisor.superviseSelfResources(opts, f.deps);
      const payload = Buffer.alloc(mode === 'exact-cap' ? 16384 : 32, 113);
      f.child.emit('spawn');
      f.child.stdout.emit('data', payload);
      if (mode === 'pipe-error') f.child.stdout.emit('error', Error('private-pipe-error'));
      end(f.child);
      const result = await pending;
      expect(result.exitCode).toBe(mode === 'exact-cap' ? 0 : 3);
      expect(result.receipt.supervision.stdout).toMatchObject({
        observedBytes: payload.length,
        hashBytes: payload.length,
        sha256: sha(payload),
        overflow: false,
        errorObserved: mode === 'pipe-error',
        complete: mode === 'exact-cap',
      });
      expect(result.receipt.supervision.cause).toBe(mode === 'pipe-error' ? 'stream-error' : null);
      expect(JSON.stringify(result.receipt)).not.toContain('private-pipe-error');
    },
  );
  it.each(['late-zero', 'kill-false', 'kill-throws', 'unconfirmed'])(
    'latches wall-limit and never interprets kill as termination: %s',
    async (mode) => {
      const opts = options(),
        f = fixture();
      if (mode === 'kill-false') f.child.kill.mockReturnValue(false);
      if (mode === 'kill-throws')
        f.child.kill.mockImplementation(() => {
          throw Error('private-kill-error');
        });
      const pending = supervisor.superviseSelfResources(opts, f.deps);
      f.child.emit('spawn');
      f.tick(100);
      if (mode === 'late-zero') end(f.child);
      else f.tick(20);
      const result = await pending;
      expect(result.exitCode).toBe(3);
      expect(result.receipt.supervision.cause).toBe('wall-limit');
      expect(f.child.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
      if (mode !== 'late-zero') {
        expect(result.receipt.supervision.confirmation).toBe('exit-unconfirmed');
        expect(f.child.unref).toHaveBeenCalledTimes(1);
        expect(f.child.stdout.destroy).toHaveBeenCalledTimes(1);
        expect(() => f.child.emit('error', Error('private-late-error'))).not.toThrow();
      }
      expect(JSON.stringify(result.receipt)).not.toContain('private-');
    },
  );
  it('covers parent start time spent inside spawn before a late successful child', async () => {
    const opts = options(),
      f = fixture();
    f.deps.spawn.mockImplementation(() => {
      f.tick(101);
      return f.child;
    });
    const pending = supervisor.superviseSelfResources(opts, f.deps);
    f.child.emit('spawn');
    end(f.child);
    const result = await pending;
    expect(result.exitCode).toBe(3);
    expect(result.receipt.supervision.cause).toBe('wall-limit');
    expect(f.child.kill).toHaveBeenCalledTimes(1);
  });
  it.each(['overflow', 'deadline'])(
    'never kills an already exited child during late stdio %s',
    async (mode) => {
      const opts = options(),
        f = fixture(),
        pending = supervisor.superviseSelfResources(opts, f.deps);
      f.child.emit('spawn');
      f.child.emit('exit', 0, null);
      if (mode === 'overflow') f.child.stdout.emit('data', Buffer.alloc(16385, 97));
      else f.tick(100);
      for (const name of ['stdout', 'stderr']) {
        f.child[name].emit('end');
        f.child[name].emit('close');
      }
      f.child.emit('close', 0, null);
      const result = await pending;
      expect(result.exitCode).toBe(3);
      expect(f.child.kill).not.toHaveBeenCalled();
      expect(result.receipt.supervision.cause).toBe(
        mode === 'overflow' ? 'output-overflow' : 'wall-limit',
      );
      if (mode === 'overflow')
        expect(result.receipt.supervision.stdout).toMatchObject({
          observedBytes: 16385,
          hashBytes: 16384,
          sha256: sha(Buffer.alloc(16384, 97)),
          complete: false,
        });
    },
  );
  it('kills at most once for cooperative cancellation and keeps cancellation after late zero exit', async () => {
    const opts = options(),
      f = fixture(),
      controller = new AbortController();
    const pending = supervisor.superviseSelfResources(
      { ...opts, signal: controller.signal },
      f.deps,
    );
    f.child.emit('spawn');
    controller.abort();
    f.child.stdout.emit('data', Buffer.alloc(20000));
    end(f.child);
    const result = await pending;
    expect(result.exitCode).toBe(3);
    expect(result.receipt.supervision.cause).toBe('cancelled');
    expect(f.child.kill).toHaveBeenCalledTimes(1);
  });
  it.each(['throw', 'error', 'mismatch', 'stdio-open'])(
    'retains distinct lifecycle failure: %s',
    async (mode) => {
      const opts = options(),
        f = fixture();
      if (mode === 'throw')
        f.deps.spawn.mockImplementation(() => {
          throw Error('private-spawn-error');
        });
      const pending = supervisor.superviseSelfResources(opts, f.deps);
      if (mode === 'error') {
        f.child.emit('error', Error('private-spawn-error'));
        f.child.emit('close', null, null);
        f.tick(20);
      }
      if (mode === 'mismatch') {
        f.child.emit('spawn');
        f.child.emit('exit', 0, null);
        f.child.emit('close', 1, null);
        f.tick(20);
      }
      if (mode === 'stdio-open') {
        f.child.emit('spawn');
        f.child.emit('exit', 0, null);
        f.tick(20);
      }
      const result = await pending;
      expect(result.exitCode).toBe(3);
      if (mode === 'stdio-open')
        expect(result.receipt.supervision.confirmation).toBe('exit-observed-close-unconfirmed');
      if (mode === 'mismatch') expect(result.receipt.supervision.cause).toBe('lifecycle-mismatch');
      if (mode === 'throw' || mode === 'error')
        expect(result.receipt.supervision.exit.observed).toBe(false);
      expect(JSON.stringify(result.receipt)).not.toContain('private-');
    },
  );
});
