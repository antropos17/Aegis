/**
 * @file tests/main/bench/run.test.js
 * @description The join window is the parameter every recall figure in
 *   `run-report.json` is a statement about, so how `run.js` arrives at it is
 *   pinned here rather than left to the one path a passing run happens to take.
 *
 *   Both sources are covered, and the second one deliberately: every arm-A run so
 *   far has resolved the interval out of the profile's `settings.json`, so the
 *   settled-cadence fallback would otherwise be a mechanism documented in the
 *   README that nothing has ever executed (memory-bank/ai-mistakes.md #20, #21).
 *   The warmup tick in that fixture is what makes it a real test: counted, it
 *   would move the median off the configured interval.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import run from '../../../bench/run.js';

/** @type {string} A run-scoped profile directory, made fresh per test. */
let profileDir;

beforeEach(() => {
  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-bench-run-test-'));
});

afterEach(() => {
  fs.rmSync(profileDir, { recursive: true, force: true });
});

/**
 * A sensor handle with only the fields the interval resolution reads.
 * @param {Object} over - Overrides.
 * @returns {Object}
 */
function handle(over = {}) {
  return { profileDir, steadyCadence: false, steadyAt: null, ticks: [], ...over };
}

describe('run — the scan interval the join window is built from', () => {
  it('reads scanIntervalSec out of the profile the run created', () => {
    fs.writeFileSync(
      path.join(profileDir, run.SETTINGS_FILENAME),
      JSON.stringify({ scanIntervalSec: 10, darkMode: false }),
      'utf8',
    );

    const interval = run.resolveScanInterval(handle());
    expect(interval.value).toBe(10);
    expect(interval.source).toContain(run.SETTINGS_FILENAME);
    expect(interval.unavailable).toBeUndefined();
  });

  it('falls back to the settled cadence, ignoring the startup schedule before it', () => {
    // No settings file at all. The first tick is a warmup scan 40 s out; counting
    // it would put the median at 11 s and describe the wrong regime.
    const interval = run.resolveScanInterval(
      handle({
        steadyCadence: true,
        steadyAt: '2026-08-13T19:24:40.000Z',
        ticks: [
          '2026-08-13T19:24:00.000Z',
          '2026-08-13T19:24:40.000Z',
          '2026-08-13T19:24:51.000Z',
          '2026-08-13T19:25:01.000Z',
        ],
      }),
    );

    expect(interval.value).toBe(10);
    expect(interval.source).toMatch(/median gap \(10000 ms\) between the 3 scan ticks/);
    expect(interval.source).toMatch(/after its cadence settled/);
  });

  it('records the interval as absent when neither source answered', () => {
    const interval = run.resolveScanInterval(handle({ steadyCadence: false }));
    expect(interval.value).toBeNull();
    expect(interval.unavailable).toMatch(/never reported a settled cadence/);
  });

  it('ignores a settings file that carries no usable scanIntervalSec', () => {
    fs.writeFileSync(
      path.join(profileDir, run.SETTINGS_FILENAME),
      JSON.stringify({ scanIntervalSec: 0 }),
      'utf8',
    );
    expect(run.resolveScanInterval(handle()).value).toBeNull();
  });
});

describe('run — the join bound', () => {
  it('is three scan intervals, in milliseconds, naming where the interval came from', () => {
    const bound = run.maxLatencyFrom({ value: 10, source: 'scanIntervalSec in <profile>' });
    expect(bound.value).toBe(10 * run.MAX_LATENCY_INTERVALS * 1000);
    expect(bound.source).toContain('scanIntervalSec in <profile>');
    expect(bound.unavailable).toBeUndefined();
  });

  it('carries an absent interval forward as an absent window, never a default', () => {
    const bound = run.maxLatencyFrom({
      value: null,
      source: 'two sources tried',
      unavailable: 'neither answered',
    });
    expect(bound.value).toBeNull();
    expect(bound.unavailable).toMatch(/never defaulted/);
  });
});
