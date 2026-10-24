import { createRequire } from 'node:module';
import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, options, fixture } from './resource-supervisor-fixtures.js';
const require = createRequire(import.meta.url);
const supervisor = require('../../../bench/lib/resource-supervisor');
afterEach(cleanup);
describe('supervisor public preflight and pre-cancellation (CI only)', () => {
  it.each(['accessor', 'nonordinary-options', 'nonfunction-dependency'])(
    'refuses %s before filesystem, timers and child activity',
    async (mode) => {
      const opts = options(),
        f = fixture(),
        spawn = f.deps.spawn;
      let getterCalls = 0;
      if (mode === 'accessor')
        Object.defineProperty(opts, 'runId', {
          enumerable: true,
          get() {
            getterCalls++;
            return 'private-getter-value';
          },
        });
      if (mode === 'nonordinary-options')
        Object.setPrototypeOf(opts, { private: 'unsupported-prototype' });
      if (mode === 'nonfunction-dependency') f.deps.spawn = 'private-spawn-value';
      const inspect = vi.spyOn(fs, 'lstatSync');
      f.deps.setTimer = vi.fn(f.deps.setTimer);
      f.deps.clearTimer = vi.fn(f.deps.clearTimer);
      f.deps.nowNs = vi.fn(f.deps.nowNs);
      await expect(supervisor.superviseSelfResources(opts, f.deps)).rejects.toThrow(
        /^resource-supervisor-input-invalid$/,
      );
      expect(getterCalls).toBe(0);
      expect(inspect).not.toHaveBeenCalled();
      expect(f.deps.setTimer).not.toHaveBeenCalled();
      expect(f.deps.clearTimer).not.toHaveBeenCalled();
      expect(f.deps.nowNs).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
      expect(f.child.kill).not.toHaveBeenCalled();
    },
  );
  it('retains cancellation from a genuinely pre-aborted signal without timers or an owned child', async () => {
    const opts = options(),
      f = fixture(),
      controller = new AbortController();
    controller.abort();
    f.deps.setTimer = vi.fn(f.deps.setTimer);
    f.deps.clearTimer = vi.fn(f.deps.clearTimer);
    const result = await supervisor.superviseSelfResources(
      { ...opts, signal: controller.signal },
      f.deps,
    );
    expect(result.exitCode).toBe(3);
    expect(result.receipt.supervision).toMatchObject({
      cause: 'cancelled',
      spawnObserved: false,
      exit: { observed: false },
      close: { observed: false },
      kill: { attempted: false, returned: null },
      confirmation: 'exit-unconfirmed',
    });
    expect(f.deps.setTimer).not.toHaveBeenCalled();
    expect(f.deps.clearTimer).not.toHaveBeenCalled();
    expect(f.deps.spawn).not.toHaveBeenCalled();
    expect(f.child.kill).not.toHaveBeenCalled();
    expect(f.timers.size).toBe(0);
  });
});
