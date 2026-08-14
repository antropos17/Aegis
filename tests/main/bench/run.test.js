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
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import manifest from '../../../bench/lib/manifest.js';
import report from '../../../bench/lib/report.js';
import run from '../../../bench/run.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');

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

describe('run — the report renderer the run records', () => {
  /**
   * The digest, computed here with plain `crypto` over the file's bytes.
   *
   * Deliberately not `report.RENDERER_FILES` put through the same helper that
   * produced the value under test: a fingerprint checked against its own
   * producer agrees with itself no matter what either of them computes.
   * @param {string} relative - Repository-relative path.
   * @returns {string}
   */
  function sha256Of(relative) {
    return crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(REPO, relative)))
      .digest('hex');
  }

  it('is the sha256 of exactly bench/lib/join.js and bench/lib/report.js', () => {
    expect(report.RENDERER_FINGERPRINT.joinSha256).toBe(sha256Of('bench/lib/join.js'));
    expect(report.RENDERER_FINGERPRINT.reportHelperSha256).toBe(sha256Of('bench/lib/report.js'));
    expect(report.RENDERER_FINGERPRINT.algorithm).toBe('sha256');
    expect(report.RENDERER_FINGERPRINT.schemaVersion).toBe(
      report.RENDERER_FINGERPRINT_SCHEMA_VERSION,
    );
    expect(report.RENDERER_FINGERPRINT.unavailable).toBeUndefined();
    expect(Object.keys(report.RENDERER_FILES)).toEqual(['joinSha256', 'reportHelperSha256']);
  });

  it('is frozen, so nothing can edit the record of what this process is running', () => {
    expect(Object.isFrozen(report.RENDERER_FINGERPRINT)).toBe(true);
  });

  it('states what it does not cover, in the record itself and not only in a README', () => {
    expect(report.RENDERER_FINGERPRINT.covers).toContain('bench/lib/join.js');
    expect(report.RENDERER_FINGERPRINT.covers).toContain('bench/lib/report.js');
    expect(report.RENDERER_FINGERPRINT.covers).toMatch(/NOT covered/);
    expect(report.RENDERER_FINGERPRINT.covers).toMatch(/Node version/);
    expect(report.RENDERER_FINGERPRINT.covers).toMatch(/platform/);
    expect(report.RENDERER_FINGERPRINT.source).toMatch(
      /while bench\/lib\/report\.js was being loaded/,
    );
  });

  // The two below call the real `manifest.collect()`, which spawns `reg query`,
  // `tasklist` and three `git` invocations — that is the module's whole job, and
  // stubbing the probes would leave the placement of this field pinned against a
  // manifest nothing wrote. They are therefore slow, and slower still under a
  // loaded full-suite run, so the bound is stated rather than left at the 5 s
  // default that a parallel suite can walk into (ai-mistakes #26).
  const COLLECT_TIMEOUT_MS = 30_000;

  it(
    'goes into the manifest as handed in, not re-read there',
    () => {
      const record = manifest.collect({
        runId: '2026-08-13T19-26-29Z-S1-agent-lifecycle-A',
        scenario: 'S1-agent-lifecycle',
        arm: 'A',
        startedAt: '2026-08-13T19:26:29.876Z',
        reportRenderer: report.RENDERER_FINGERPRINT,
      });
      expect(record.reportRenderer).toBe(report.RENDERER_FINGERPRINT);
    },
    COLLECT_TIMEOUT_MS,
  );

  it(
    'is null in a manifest whose caller supplied none, and is never reconstructed',
    () => {
      const record = manifest.collect({
        runId: '2026-08-13T19-26-29Z-S1-agent-lifecycle-A',
        scenario: 'S1-agent-lifecycle',
        arm: 'A',
        startedAt: '2026-08-13T19:26:29.876Z',
      });
      expect(record.reportRenderer).toBeNull();
      expect(report.classifyRenderer(record.reportRenderer).provenance).toBe(
        report.RENDERER_PROVENANCE.LEGACY,
      );
    },
    COLLECT_TIMEOUT_MS,
  );
});
