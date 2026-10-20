import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { sampleSelfResources } = require('../../../bench/lib/self-resource-sampler.js');

function fixture() {
  let ns = 0n;
  const waits = [];
  const cleared = [];
  let cpu = 0;
  return {
    waits,
    cleared,
    advance(us) {
      ns += BigInt(us) * 1000n;
    },
    deps: {
      nowNs: () => ns,
      cpuUsage: () => {
        ns += 10_000n;
        return { user: ++cpu * 100, system: cpu * 20 };
      },
      rss: () => {
        ns += 20_000n;
        return 4096;
      },
      setTimer: (fn, ms) => {
        waits.push(ms);
        ns += BigInt(Math.ceil(ms * 1000)) * 1000n;
        queueMicrotask(fn);
        return waits.length;
      },
      clearTimer: (id) => cleared.push(id),
    },
  };
}
const options = (extra = {}) => ({ runId: 'fixture-1', durationMs: 4000, ...extra });

describe('bounded own-process raw resource sampler', () => {
  it('uses only the calling process cumulative CPU and current RSS APIs by default', async () => {
    const clock = vi.spyOn(process.hrtime, 'bigint').mockReturnValue(1000n);
    const cpu = vi.spyOn(process, 'cpuUsage').mockReturnValue({ user: 78, system: 91 });
    const rss = vi.spyOn(process.memoryUsage, 'rss').mockReturnValue(22222);
    const resource = vi.spyOn(process, 'resourceUsage').mockImplementation(() => {
      throw Error('maxRSS-is-not-current-RSS');
    });
    try {
      const r = await sampleSelfResources(options({ durationMs: 1000 }));
      expect(r.readingMode).toBe('own-process');
      expect(r.samples[0].cpu).toMatchObject({ userUs: 78, systemUs: 91, reason: null });
      expect(r.samples[0].rss).toMatchObject({ residentBytes: 22222, reason: null });
      expect(cpu).toHaveBeenCalledWith();
      expect(rss).toHaveBeenCalledOnce();
      expect(resource).not.toHaveBeenCalled();
      expect(clock).toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
  it('preserves individually bracketed raw counters and source units on a one-second grid', async () => {
    const f = fixture();
    const r = await sampleSelfResources(options(), f.deps);
    expect(r.version).toBe('self-resource-samples/1');
    expect(r.readingMode).toBe('injected');
    expect(r.cadenceUs).toBe(1_000_000);
    expect(r.units).toEqual({ clock: 'us', cpu: 'us', rss: 'bytes' });
    expect(r.sources).toEqual({
      clock: 'process.hrtime.bigint',
      cpu: 'process.cpuUsage',
      rss: 'process.memoryUsage.rss',
    });
    expect(r.samples.map((s) => s.scheduledUs)).toEqual([0, 1_000_000, 2_000_000, 3_000_000]);
    expect(r.samples[0]).toEqual({
      scheduledUs: 0,
      actualUs: 0,
      latenessUs: 0,
      cpu: { beforeUs: 0, afterUs: 10, userUs: 100, systemUs: 20, reason: null },
      rss: { beforeUs: 10, afterUs: 30, residentBytes: 4096, reason: null },
    });
    expect(r.stopReason).toBeNull();
    expect(r.complete).toBe(true);
    expect(r.missed).toEqual([]);
    expect(f.waits).toEqual([999.97, 999.97, 999.97]);
    expect(r).not.toHaveProperty('lifetimes');
    expect(r).not.toHaveProperty('populationKnown');
  });
  it('does not access even the clock when cancelled before collection starts', async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const f = fixture();
    f.deps.nowNs = () => {
      calls++;
      return 0n;
    };
    const r = await sampleSelfResources(options({ signal: controller.signal }), f.deps);
    expect(calls).toBe(0);
    expect(r.samples).toEqual([]);
    expect(r.stopReason).toBe('cancelled');
    expect(r.unattempted).toEqual({ firstScheduledUs: 0, count: 4, reason: 'cancelled' });
    expect(r.clock.reason).toBe('not-observed');
  });
  it('skips overdue grid points, retains lateness, and never replays a catchup burst', async () => {
    const f = fixture();
    const timer = f.deps.setTimer;
    let late = true;
    f.deps.setTimer = (fn, ms) =>
      timer(() => {
        if (late) {
          f.advance(1_700_000);
          late = false;
        }
        fn();
      }, ms);
    const r = await sampleSelfResources(options(), f.deps);
    expect(r.samples.map((s) => s.scheduledUs)).toEqual([0, 2_000_000, 3_000_000]);
    expect(r.samples[1].latenessUs).toBe(700_000);
    expect(r.missed).toEqual([{ scheduledUs: 1_000_000, reason: 'scheduler-late' }]);
    expect(f.waits).toEqual([999.97, 299.97]);
    expect(r.complete).toBe(false);
    expect(r.unattempted).toBeNull();
  });
  it('retains points missed while a synchronous acquisition was running', async () => {
    const f = fixture();
    let first = true;
    f.deps.cpuUsage = () => {
      if (first) {
        f.advance(2_500_000);
        first = false;
      }
      return { user: 10, system: 5 };
    };
    const r = await sampleSelfResources(options(), f.deps);
    expect(r.samples[0].cpu).toMatchObject({ beforeUs: 0, afterUs: 2_500_000 });
    expect(r.samples.map((s) => s.scheduledUs)).toEqual([0, 2_000_000, 3_000_000]);
    expect(r.missed).toEqual([{ scheduledUs: 1_000_000, reason: 'scheduler-late' }]);
    expect(r.samples[1].latenessUs).toBe(500_020);
  });
  it.each([
    null,
    () => {
      throw new Error('private-path');
    },
  ])('makes a missing or failed clock explicit', async (clock) => {
    const f = fixture();
    f.deps.nowNs = clock;
    const r = await sampleSelfResources(options(), f.deps);
    expect(r.clock.reason).toBe('clock-unavailable');
    expect(r.stopReason).toBe('clock-unavailable');
    expect(r.samples).toEqual([]);
    expect(r.unattempted.count).toBe(4);
    expect(JSON.stringify(r)).not.toContain('private-path');
  });
  it('keeps clock regressions and unavailable end brackets explicit', async () => {
    const f = fixture();
    let reads = 0;
    f.deps.nowNs = () => (++reads <= 3 ? 2000n : 1000n);
    const r = await sampleSelfResources(options(), f.deps);
    expect(r.samples[0].cpu).toEqual({
      beforeUs: 0,
      afterUs: null,
      userUs: 100,
      systemUs: 20,
      reason: 'clock-regressed',
    });
    expect(r.samples[0].rss.residentBytes).toBeNull();
    expect(r.stopReason).toBe('clock-regressed');
    expect(r.complete).toBe(false);
  });
  it.each([null, -1n, 1, Number.NaN, '1000'])(
    'refuses a non-bigint or negative clock reading %s',
    async (value) => {
      const f = fixture();
      f.deps.nowNs = () => value;
      expect((await sampleSelfResources(options(), f.deps)).stopReason).toBe('clock-unavailable');
    },
  );
  it('refuses relative clock overflow without rounding it into evidence', async () => {
    const f = fixture();
    let reads = 0;
    f.deps.nowNs = () => (++reads === 1 ? 0n : (BigInt(Number.MAX_SAFE_INTEGER) + 1n) * 1000n);
    const r = await sampleSelfResources(options(), f.deps);
    expect(r.samples).toEqual([]);
    expect(r.stopReason).toBe('clock-unavailable');
  });
  it('retains sub-microsecond clock ordering before flooring to declared microseconds', async () => {
    const f = fixture();
    let reads = 0;
    f.deps.nowNs = () => (++reads <= 3 ? 1500n : 1499n);
    const r = await sampleSelfResources(options(), f.deps);
    expect(r.clock.reason).toBe('clock-regressed');
  });
  it.each([
    null,
    () => {
      throw new Error('secret-counter');
    },
  ])('retains unavailable CPU APIs as null rather than measured zero', async (api) => {
    const f = fixture();
    f.deps.cpuUsage = api;
    const r = await sampleSelfResources(options({ durationMs: 1000 }), f.deps);
    expect(r.samples[0].cpu).toMatchObject({
      userUs: null,
      systemUs: null,
      reason: 'api-unavailable',
    });
    expect(r.samples[0].rss.residentBytes).toBe(4096);
    expect(r.complete).toBe(false);
    expect(JSON.stringify(r)).not.toContain('secret-counter');
  });
  it.each([NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1, undefined, Promise.resolve(1)])(
    'refuses invalid RSS evidence %s',
    async (value) => {
      const f = fixture();
      f.deps.rss = () => value;
      const r = await sampleSelfResources(options({ durationMs: 1000 }), f.deps);
      expect(r.samples[0].rss).toMatchObject({ residentBytes: null, reason: 'invalid-reading' });
      expect(r.complete).toBe(false);
    },
  );
  it('does not mistake a resourceUsage maxRSS-shaped object for current RSS', async () => {
    const f = fixture();
    f.deps.rss = () => ({ maxRSS: 12345 });
    const r = await sampleSelfResources(options({ durationMs: 1000 }), f.deps);
    expect(r.samples[0].rss.residentBytes).toBeNull();
  });
  it.each([
    { user: NaN, system: 5 },
    { user: 5, system: -1 },
    { user: 5, system: 1.5 },
    { user: Number.MAX_SAFE_INTEGER + 1, system: 0 },
    Promise.resolve({ user: 1, system: 1 }),
  ])('refuses invalid CPU counters %s', async (value) => {
    const f = fixture();
    f.deps.cpuUsage = () => value;
    const r = await sampleSelfResources(options({ durationMs: 1000 }), f.deps);
    expect(r.samples[0].cpu).toMatchObject({
      userUs: null,
      systemUs: null,
      reason: 'invalid-reading',
    });
  });
  it('contains a throwing CPU field accessor without leaking its message', async () => {
    const f = fixture();
    f.deps.cpuUsage = () => ({
      get user() {
        throw Error('private-counter');
      },
      system: 0,
    });
    const r = await sampleSelfResources(options({ durationMs: 1000 }), f.deps);
    expect(r.samples[0].cpu.reason).toBe('invalid-reading');
    expect(JSON.stringify(r)).not.toContain('private-counter');
  });
  it('retains actual zero counters and RSS distinctly from unavailable readings', async () => {
    const f = fixture();
    f.deps.cpuUsage = () => ({ user: 0, system: 0 });
    f.deps.rss = () => 0;
    const r = await sampleSelfResources(options({ durationMs: 1000 }), f.deps);
    expect(r.complete).toBe(true);
    expect(r.samples[0].cpu).toMatchObject({ userUs: 0, systemUs: 0, reason: null });
    expect(r.samples[0].rss).toMatchObject({ residentBytes: 0, reason: null });
  });
  it('retains raw CPU counter regressions without inventing deltas or admission', async () => {
    const f = fixture();
    let user = 10;
    f.deps.cpuUsage = () => ({ user: user--, system: 0 });
    const r = await sampleSelfResources(options({ durationMs: 2000 }), f.deps);
    expect(r.samples.map((s) => s.cpu.userUs)).toEqual([10, 9]);
    expect(r).not.toHaveProperty('intervals');
    expect(r).not.toHaveProperty('cpuPercent');
  });
  it('bounds a caller sample limit and retains all unattempted scheduled points', async () => {
    const f = fixture();
    const r = await sampleSelfResources(options({ maxSamples: 1 }), f.deps);
    expect(r.samples).toHaveLength(1);
    expect(r.unattempted).toEqual({
      firstScheduledUs: 1_000_000,
      count: 3,
      reason: 'sample-limit',
    });
    expect(r.stopReason).toBe('sample-limit');
    expect(f.waits).toEqual([]);
  });
  it('stops acquiring after the declared duration, retaining the overrun bracket', async () => {
    const f = fixture();
    f.deps.rss = () => {
      f.advance(5_000_000);
      return 1;
    };
    const r = await sampleSelfResources(options(), f.deps);
    expect(r.samples).toHaveLength(1);
    expect(r.samples[0].rss.afterUs).toBe(5_000_010);
    expect(r.stopReason).toBe('duration-limit');
    expect(r.clock.lastObservedUs).toBe(5_000_010);
    expect(r.unattempted).toEqual({
      firstScheduledUs: 1_000_000,
      count: 3,
      reason: 'duration-limit',
    });
  });
  it('R2 acquisition admission skips RSS when an already-running CPU read overruns', async () => {
    const f = fixture();
    let rssCalls = 0;
    f.deps.cpuUsage = () => {
      f.advance(1_000_001);
      return { user: 12, system: 3 };
    };
    f.deps.rss = () => {
      rssCalls++;
      return 99;
    };
    const r = await sampleSelfResources(options({ durationMs: 1000 }), f.deps);
    expect(rssCalls).toBe(0);
    expect(r.samples[0].cpu).toMatchObject({
      beforeUs: 0,
      afterUs: 1_000_001,
      userUs: 12,
      systemUs: 3,
    });
    expect(r.samples[0].rss).toMatchObject({
      beforeUs: 1_000_001,
      residentBytes: null,
      reason: 'duration-limit',
    });
    expect(r.stopReason).toBe('duration-limit');
    expect(r.complete).toBe(false);
  });
  it('R2 acquisition admission checks the CPU bracket after an earlier scheduler check', async () => {
    const f = fixture();
    let clocks = 0,
      cpuCalls = 0,
      rssCalls = 0;
    f.deps.nowNs = () => (++clocks <= 2 ? 0n : 1_000_000_000n);
    f.deps.cpuUsage = () => {
      cpuCalls++;
      return { user: 12, system: 3 };
    };
    f.deps.rss = () => {
      rssCalls++;
      return 99;
    };
    const r = await sampleSelfResources(options({ durationMs: 1000 }), f.deps);
    expect(cpuCalls).toBe(0);
    expect(rssCalls).toBe(0);
    expect(r.samples[0]).toMatchObject({
      actualUs: 0,
      cpu: { beforeUs: 1_000_000, userUs: null, systemUs: null, reason: 'duration-limit' },
      rss: { residentBytes: null, reason: 'duration-limit' },
    });
    expect(r.stopReason).toBe('duration-limit');
    expect(r.complete).toBe(false);
  });
  it('R2 acquisition admission refuses completion when CPU ends exactly at the excluded endpoint', async () => {
    const f = fixture();
    let rssCalls = 0;
    f.deps.cpuUsage = () => {
      f.advance(1_000_000);
      return { user: 12, system: 3 };
    };
    f.deps.rss = () => {
      rssCalls++;
      return 99;
    };
    const r = await sampleSelfResources(options({ durationMs: 1000 }), f.deps);
    expect(r.complete).toBe(false);
    expect(rssCalls).toBe(0);
    expect(r.samples[0].cpu).toMatchObject({ afterUs: 1_000_000, userUs: 12, systemUs: 3 });
    expect(r.samples[0].rss).toMatchObject({ residentBytes: null, reason: 'duration-limit' });
    expect(r.stopReason).toBe('duration-limit');
  });
  it('R2 acquisition admission keeps both readings admitted just inside the endpoint', async () => {
    const f = fixture();
    let rssCalls = 0;
    f.deps.cpuUsage = () => {
      f.advance(999_998);
      return { user: 12, system: 3 };
    };
    f.deps.rss = () => {
      rssCalls++;
      f.advance(1);
      return 99;
    };
    const r = await sampleSelfResources(options({ durationMs: 1000 }), f.deps);
    expect(rssCalls).toBe(1);
    expect(r.samples[0].rss).toEqual({
      beforeUs: 999_998,
      afterUs: 999_999,
      residentBytes: 99,
      reason: null,
    });
    expect(r.complete).toBe(true);
    expect(r.stopReason).toBeNull();
  });
  it('starts no new read after a delayed timer reaches the duration limit', async () => {
    const f = fixture();
    const timer = f.deps.setTimer;
    f.deps.setTimer = (fn, ms) =>
      timer(() => {
        f.advance(10_000_000);
        fn();
      }, ms);
    const r = await sampleSelfResources(options(), f.deps);
    expect(r.samples).toHaveLength(1);
    expect(r.stopReason).toBe('duration-limit');
    expect(r.clock.lastObservedUs).toBe(11_000_000);
  });
  it('bounds serialized output, closes the pending schedule, and retains a refusal reason', async () => {
    const f = fixture();
    const r = await sampleSelfResources(
      options({ durationMs: 60_000, maxOutputBytes: 2048 }),
      f.deps,
    );
    expect(Buffer.byteLength(JSON.stringify(r))).toBeLessThanOrEqual(2048);
    expect(r.stopReason).toBe('output-limit');
    expect(r.unattempted.count).toBeGreaterThan(0);
    expect(r.complete).toBe(false);
  });
  it('cancels and removes a waiting timer without claiming an in-flight native cancellation', async () => {
    const f = fixture();
    const controller = new AbortController();
    f.deps.setTimer = () => {
      queueMicrotask(() => controller.abort());
      return 'timer-1';
    };
    const r = await sampleSelfResources(options({ signal: controller.signal }), f.deps);
    expect(f.cleared).toEqual(['timer-1']);
    expect(r).toMatchObject({
      stopReason: 'cancelled',
      pendingTimer: false,
      inFlightReading: false,
      cleanupReason: null,
    });
    expect(r.samples).toHaveLength(1);
  });
  it('reports failed timer cancellation as pending rather than claiming cleanup', async () => {
    const f = fixture();
    const controller = new AbortController();
    f.deps.setTimer = () => {
      queueMicrotask(() => controller.abort());
      return 'timer-1';
    };
    f.deps.clearTimer = () => {
      throw Error('private-timer');
    };
    const r = await sampleSelfResources(options({ signal: controller.signal }), f.deps);
    expect(r).toMatchObject({
      stopReason: 'cancelled',
      pendingTimer: true,
      cleanupReason: 'timer-cancel-unavailable',
    });
    expect(JSON.stringify(r)).not.toContain('private-timer');
  });
  it('observes cancellation between synchronous readers', async () => {
    const f = fixture();
    const controller = new AbortController();
    let rssCalls = 0;
    f.deps.cpuUsage = () => {
      controller.abort();
      return { user: 3, system: 0 };
    };
    f.deps.rss = () => {
      rssCalls++;
      return 9;
    };
    const r = await sampleSelfResources(options({ signal: controller.signal }), f.deps);
    expect(rssCalls).toBe(0);
    expect(r.samples[0].rss).toMatchObject({ residentBytes: null, reason: 'cancelled' });
    expect(r.stopReason).toBe('cancelled');
  });
  it.each([
    null,
    () => {
      throw Error('private-scheduler');
    },
  ])('refuses unavailable or throwing schedulers', async (timer) => {
    const f = fixture();
    f.deps.setTimer = timer;
    const r = await sampleSelfResources(options(), f.deps);
    expect(r.stopReason).toBe('scheduler-unavailable');
    expect(r.samples).toHaveLength(1);
    expect(JSON.stringify(r)).not.toContain('private-scheduler');
  });
  it('bounds an injected scheduler that wakes early without clock progress', async () => {
    const f = fixture();
    let waits = 0;
    f.deps.setTimer = (fn) => {
      waits++;
      queueMicrotask(fn);
      return waits;
    };
    const r = await sampleSelfResources(options(), f.deps);
    expect(r.stopReason).toBe('scheduler-stalled');
    expect(waits).toBe(240);
    expect(r.samples).toHaveLength(1);
  });
  it('holds the finite maximum even when the caller asks for the largest schedule', async () => {
    const f = fixture();
    const r = await sampleSelfResources(options({ durationMs: 60_000 }), f.deps);
    expect(r.samples).toHaveLength(60);
    expect(r.samples.at(-1).scheduledUs).toBe(59_000_000);
    expect(r.complete).toBe(true);
  });
  it.each([
    { runId: '../private' },
    { runId: 'x'.repeat(65) },
    { runId: '' },
    { durationMs: 0 },
    { durationMs: 1001 },
    { durationMs: 61_000 },
    { durationMs: Infinity },
    { maxSamples: 0 },
    { maxSamples: 61 },
    { maxSamples: 1.5 },
    { maxOutputBytes: 2047 },
    { maxOutputBytes: 131073 },
    { pid: 42 },
    { path: 'private' },
    { signal: {} },
    { extra: 'private' },
  ])('rejects unsafe IDs, open input, target PIDs, or unbounded options %s', async (extra) => {
    await expect(sampleSelfResources(options(extra), fixture().deps)).rejects.toThrow(
      'self-resource-input-invalid',
    );
  });
  it('rejects accessor input without executing it', async () => {
    let calls = 0;
    const input = options();
    Object.defineProperty(input, 'durationMs', {
      get() {
        calls++;
        return 1000;
      },
    });
    await expect(sampleSelfResources(input, fixture().deps)).rejects.toThrow(
      'self-resource-input-invalid',
    );
    expect(calls).toBe(0);
  });
  it('rejects unknown dependency surfaces and invalid readers', async () => {
    await expect(sampleSelfResources(options(), { spawn: () => 1 })).rejects.toThrow(
      'self-resource-input-invalid',
    );
    await expect(sampleSelfResources(options(), { cpuUsage: 1 })).rejects.toThrow(
      'self-resource-input-invalid',
    );
  });
  it('retains unavailable timer state if an injected scheduler throws without returning a handle', async () => {
    const f = fixture();
    f.deps.setTimer = () => {
      throw Error('private-scheduler');
    };
    const r = await sampleSelfResources(options(), f.deps);
    expect(r).toMatchObject({
      stopReason: 'scheduler-unavailable',
      pendingTimer: null,
      cleanupReason: 'timer-state-unavailable',
    });
  });
  it('cannot silently ignore nonenumerable injected readers', async () => {
    const deps = {};
    Object.defineProperty(deps, 'nowNs', { value: null });
    const r = await sampleSelfResources(options(), deps);
    expect(r.readingMode).toBe('injected');
    expect(r.stopReason).toBe('clock-unavailable');
  });
  it('contains a throwing input proxy with a closed error', async () => {
    const input = new Proxy(
      {},
      {
        ownKeys() {
          throw Error('private-input');
        },
      },
    );
    await expect(sampleSelfResources(input)).rejects.toThrow('self-resource-input-invalid');
  });
});
