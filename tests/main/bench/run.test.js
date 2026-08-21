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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import join from '../../../bench/lib/join.js';
import manifest from '../../../bench/lib/manifest.js';
import report from '../../../bench/lib/report.js';
import run from '../../../bench/run.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');

/**
 * A complete recorded arm-A run, read but never written by this file.
 * @type {string}
 */
const RECORDING = path.join(
  REPO,
  'tests',
  'fixtures',
  'bench',
  'runs',
  '2026-08-13T19-26-29Z-S1-agent-lifecycle-A',
);

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

describe('manifest — recorded paths and host block', () => {
  it('rewrites the clone root and the Users account segment, and leaves other strings alone', () => {
    expect(manifest.neutralizePath(`${manifest.ROOT}\\bench\\runs\\x\\stage\\claude.exe`)).toBe(
      `${manifest.RECORDED_REPO_ROOT}\\bench\\runs\\x\\stage\\claude.exe`,
    );
    expect(
      manifest.neutralizePath('C:\\Users\\alice\\AppData\\Local\\Temp\\aegis-bench\\settings.json'),
    ).toBe('C:\\Users\\user\\AppData\\Local\\Temp\\aegis-bench\\settings.json');
    expect(manifest.neutralizePath('C:\\Program Files\\nodejs\\node.exe')).toBe(
      'C:\\Program Files\\nodejs\\node.exe',
    );
  });

  it('embeds the rewrite in a source sentence, so a scan-interval origin cannot leak a home path', () => {
    const source = `scanIntervalSec in C:\\Users\\someone\\AppData\\Local\\Temp\\p\\settings.json`;
    expect(manifest.neutralizePath(source)).toBe(
      'scanIntervalSec in C:\\Users\\user\\AppData\\Local\\Temp\\p\\settings.json',
    );
  });

  it('records host.platform and nothing else about the workstation', () => {
    const record = manifest.collect({
      runId: 'test-host-block',
      scenario: 'S1-agent-lifecycle',
      arm: 'A',
      startedAt: '2026-08-13T19:26:29.876Z',
    });
    expect(Object.keys(record.host)).toEqual(['platform']);
    expect(record.host.platform.source).toBe('process.platform');
    expect(record.host.cpuModel).toBeUndefined();
    expect(record.host.cpuCount).toBeUndefined();
    expect(record.host.totalMemBytes).toBeUndefined();
    expect(record.host.osVersion).toBeUndefined();
    expect(record.host.windowsBuild).toBeUndefined();
    expect(record.host.osRelease).toBeUndefined();
  }, 30_000);
});

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

  // The load-time read is a DISK read, and the record has to say that rather than
  // the stronger thing it is tempting to say. `join.js` is in the module cache
  // before `report.js` opens it, and `report.js` reads its own file while it is
  // executing, so under a concurrent edit of the tree the digests are the on-disk
  // bytes at that instant and not the bytes Node compiled. Taking the hash at load
  // buys the narrowest window available without loader introspection — it does not
  // buy identity with the loaded bytes, and the string must not claim it does.
  it('says the hashes are a disk observation, and claims no identity with the loaded bytes', () => {
    const source = report.RENDERER_FINGERPRINT.source;
    expect(source).toMatch(/read from disk once/);
    expect(source).toMatch(/join\.js is already in the module cache when this read happens/);
    expect(source).toMatch(/report\.js reads its own file while executing/);
    expect(source).toMatch(/concurrent modification of the working tree/);
    expect(source).toMatch(/can differ from the bytes Node compiled/);
    expect(source).toMatch(/closest observation available/);
    expect(source).not.toMatch(/the bytes this process then executed/);
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

/**
 * `serializeReport` is the ONE definition of a report's bytes, and a replay's
 * output is pinned to it by `tests/main/bench/replay.test.js`. The live run's
 * output was not: `run.js` calls the same function from `writeReport`, and that
 * held by inspection of a single line rather than by anything that could go red.
 * A live report written with `JSON.stringify(report, null, 2)` and no trailing
 * newline, or written as latin1, would have been a silent one-byte divergence
 * between the two ways a report comes into existence — and the whole replay
 * contract is a byte comparison against what a live run wrote.
 *
 * So this exercises the real write path: `run.writeReport` builds the report,
 * serializes it and calls `fs.writeFileSync` exactly as a live run does, into a
 * scratch directory, and the FILE'S BYTES are held against `serializeReport`'s
 * output for the very object it returned. Nothing re-implements the serializer;
 * the expectation is produced by the one definition under test.
 *
 * Its inputs are a real recorded run's own files — the catalogue, the observation
 * set and the capture record `observed.meta.json`, which is the capture-record
 * shape `writeReport` reads `sensor.scanInterval` and
 * `sensor.ticksWhileProcessAlive` out of. The recording is opened read-only and
 * nothing is written back into it.
 *
 * **What this does not cover**, stated rather than implied: the call from `main`
 * to `writeReport`. `main` reaches it only through a completed arm-A capture — a
 * started sensor, a stopped sensor and a read audit chain — which no unit test can
 * stand up. That link is one call site with no branch in it; everything from the
 * report object to the bytes on disk is what is pinned here.
 */
describe('run — the bytes the live run actually writes', () => {
  /** @type {string} Where the report under test is written. Never the recording. */
  let outDir;

  beforeEach(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-bench-write-parity-'));
  });

  afterEach(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  /**
   * @param {string} name - An NDJSON file in the recording.
   * @returns {Object[]} One ECS document per non-empty line.
   */
  function readRecordedNdjson(name) {
    return fs
      .readFileSync(path.join(RECORDING, name), 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  }

  /**
   * Run the live write path into the scratch directory, with the console it
   * prints its `written <file>` line on captured.
   * @returns {{built: Object, bytes: Buffer, file: string}}
   */
  function writeLiveReport() {
    const meta = JSON.parse(fs.readFileSync(path.join(RECORDING, 'observed.meta.json'), 'utf8'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    let built;
    try {
      built = run.writeReport({
        dir: outDir,
        runId: meta.runId,
        scenario: meta.scenario,
        arm: meta.arm,
        expected: readRecordedNdjson('expected.ndjson'),
        capture: { events: readRecordedNdjson('observed.ndjson'), record: meta },
      });
    } finally {
      log.mockRestore();
    }
    const file = path.join(outDir, join.REPORT_FILENAME);
    return { built, bytes: fs.readFileSync(file), file };
  }

  it('writes exactly serializeReport(report) — byte for byte, not merely equal JSON', () => {
    const { built, bytes } = writeLiveReport();
    const expected = Buffer.from(report.serializeReport(built), 'utf8');

    expect(bytes.length).toBe(expected.length);
    expect(bytes.equals(expected)).toBe(true);
  });

  it('wrote a whole report, so the comparison above is over a real payload', () => {
    const { built, bytes } = writeLiveReport();

    expect(built.runId).toBe('2026-08-13T19-26-29Z-S1-agent-lifecycle-A');
    expect(built.schemaVersion).toBe(join.SCHEMA_VERSION);
    expect(Object.keys(built.categories)).toEqual([...join.CATEGORIES]);
    // Multi-byte UTF-8 is in those bytes — the report's source strings carry `—`,
    // `×` and `∈` — so the comparison is over a payload where the write encoding
    // is observable, not over an ASCII file where latin1 and utf8 agree.
    expect(bytes.includes(Buffer.from('—', 'utf8'))).toBe(true);
    expect(bytes.length).toBeGreaterThan(Buffer.byteLength(JSON.stringify(built)));
  });

  it('writes it under the one report name, into the directory it was given', () => {
    const { file } = writeLiveReport();

    expect(fs.readdirSync(outDir)).toEqual([join.REPORT_FILENAME]);
    expect(path.dirname(file)).toBe(outDir);
  });
});
