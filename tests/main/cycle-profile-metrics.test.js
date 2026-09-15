import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createMetrics } = require('../../bench/cycle-profile/metrics.cjs');
const { limits } = require('../../bench/cycle-profile/limits.cjs');

it('bounds long diagnostic runs and keeps a finite watchdog/sample budget', () => {
  expect(limits()).toEqual({ durationMs: 180000, watchdogMs: 210000, sampleMs: 1000 });
  expect(limits('7200')).toEqual({ durationMs: 7200000, watchdogMs: 7230000, sampleMs: 5000 });
  for (const value of ['', '0', '179', '7201', 'Infinity', 'NaN', '180.5'])
    expect(() => limits(value)).toThrow();
});

describe('cycle timing recorder', () => {
  it('attributes concurrent async work to the correct stage', async () => {
    const meter = createMetrics(() => 0);
    let release;
    const barrier = new Promise((resolve) => {
      release = resolve;
    });
    const observe = (label) =>
      meter.wrap(label, async () => {
        await barrier;
        return meter.current();
      })();
    const first = observe('first'),
      second = observe('second');
    expect(meter.current()).toBe('startup-or-unwrapped');
    release();
    expect(await Promise.all([first, second])).toEqual(['first', 'second']);
  });
  it('preserves a synchronous failure and counts it once', () => {
    const meter = createMetrics(() => 0);
    const error = new Error('private-failure');
    expect(() =>
      meter.wrap('failure', () => {
        throw error;
      })(),
    ).toThrow(error);
    expect(meter.snapshot()[0]).toMatchObject({ calls: 1, failures: 1 });
    expect(JSON.stringify(meter.snapshot())).not.toContain('private');
  });
  it('preserves receivers and results without retaining private arguments or values', () => {
    let now = 0;
    const meter = createMetrics(() => now);
    const secret = { commandLine: 'private-command', path: 'private-path' };
    const receiver = {
      run: meter.wrap('stage', function (value) {
        expect(this).toBe(receiver);
        now = 4;
        return value;
      }),
    };
    expect(receiver.run(secret)).toBe(secret);
    expect(meter.snapshot()).toEqual([
      expect.objectContaining({ calls: 1, totalMs: 4, failures: 0 }),
    ]);
    expect(JSON.stringify(meter.snapshot())).not.toContain('private');
  });
  it('preserves promise identity and rejection without recording exception text', async () => {
    let now = 0;
    const meter = createMetrics(() => now);
    let reject;
    const promise = new Promise((_, fail) => {
      reject = fail;
    });
    const returned = meter.wrap('async', () => promise)();
    expect(returned).toBe(promise);
    now = 8;
    const error = new Error('private-error');
    reject(error);
    await expect(returned).rejects.toBe(error);
    expect(meter.snapshot()[0]).toMatchObject({ totalMs: 8, failures: 1 });
    expect(JSON.stringify(meter.snapshot())).not.toContain('private-error');
  });
  it('caps timing samples, retains totals and classifies work by its start', () => {
    let now = 0;
    const meter = createMetrics(() => now, 10, 2);
    const work = meter.wrap('work', () => {
      now += 4;
    });
    work();
    work();
    work();
    work();
    expect(meter.snapshot()).toEqual([
      expect.objectContaining({
        phase: 'startup',
        calls: 3,
        sampled: 2,
        truncated: true,
        totalMs: 12,
      }),
      expect.objectContaining({
        phase: 'steady',
        calls: 1,
        sampled: 1,
        truncated: false,
        totalMs: 4,
      }),
    ]);
  });
});
