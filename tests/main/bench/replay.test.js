/**
 * @file tests/main/bench/replay.test.js
 * @description `bench/replay.js` turns a recorded run directory back into the
 *   report that run produced. What is pinned here is not "replay works" but the
 *   specific ways a replay could produce a plausible report that is not the one
 *   the run wrote:
 *
 *   - a rebuild that differs from the live-run report while still looking sane —
 *     so the golden case asserts BYTES against a real recording, not fields;
 *   - a join window quietly defaulted when the recording carries none, which would
 *     turn "this run measured no window" into a recall figure;
 *   - a tick count read as absent rather than as the zero it was, which would turn
 *     a structural gap into a coverage result;
 *   - a malformed line skipped instead of refused, which drops an expectation or
 *     credits the sensor with less than it recorded;
 *   - a report rebuilt across two runs' files, naming one run and counting another.
 *
 *   Two further blocks were added with the renderer fingerprint. **Provenance**
 *   pins that a report's bytes and the identity of the renderer that produced
 *   them are reported as two facts and never folded into one: identical bytes
 *   under renderer skew are still identical bytes, a difference under a renderer
 *   match is still a difference with no cause invented for it, and a recording
 *   that pins no renderer is `legacy-unversioned` rather than retrofitted. **The
 *   golden** pins the current renderer's own output as a separate committed
 *   artefact, so that when a rendered string next changes the golden moves and
 *   the recording does not.
 *
 *   The last block is a gate on the module rather than on its output: replay must
 *   read nothing outside the run directory once it is running, and its module
 *   graph must not reach the sensor or the actor. An import-time dependency is
 *   invisible to an fs spy installed in a test body, so the graph — and the one
 *   pair of reads that does happen at load — is proven in a child process instead.
 *
 *   The fixtures under `tests/fixtures/bench/` are two real arm-A runs, copied
 *   verbatim; `tests/fixtures/bench/README.md` states their provenance, and
 *   `tests/main/bench/fixture-immutability.test.js` is the gate that keeps them
 *   the bytes those runs wrote.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import catalogue from '../../../bench/lib/catalogue.js';
import join from '../../../bench/lib/join.js';
import observed from '../../../bench/lib/observed.js';
import report from '../../../bench/lib/report.js';
import replay from '../../../bench/replay.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const REPLAY_SOURCE = path.join(REPO, 'bench', 'replay.js');
const FIXTURES = path.join(REPO, 'tests', 'fixtures', 'bench', 'runs');

/**
 * A complete arm-A run: four inputs and the report they produced.
 *
 * The name is historical. This directory is a RECORDING — its `run-report.json`
 * is the file that run wrote — and the current renderer's golden is the separate
 * committed artefact at {@link CURRENT_RENDERER_GOLDEN}.
 * @type {string}
 */
const GOLDEN = path.join(FIXTURES, '2026-08-13T19-26-29Z-S1-agent-lifecycle-A');

/** @type {string} A real run recorded before `sensor.scanInterval` existed. */
const PRE_INTERVAL = path.join(FIXTURES, '2026-08-13T17-11-03Z-S1-agent-lifecycle-A');

/** @type {string} What THIS renderer makes of that recording — derived, and regenerable. */
const CURRENT_RENDERER_GOLDEN = path.join(
  REPO,
  'tests',
  'fixtures',
  'bench',
  'goldens',
  '2026-08-13T19-26-29Z-S1-agent-lifecycle-A.golden-report.current.json',
);

/** @type {string} Scratch directory, made fresh per test. */
let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-bench-replay-test-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/**
 * Call `replay.main` with the console captured, so a test can assert on what the
 * CLI said as well as on what it returned.
 * @param {string[]} argv
 * @returns {{code: number, out: string, err: string}}
 */
function main(argv) {
  const out = [];
  const err = [];
  const log = vi.spyOn(console, 'log').mockImplementation((m) => out.push(String(m)));
  const error = vi.spyOn(console, 'error').mockImplementation((m) => err.push(String(m)));
  try {
    return { code: replay.main(argv), out: out.join('\n'), err: err.join('\n') };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

/**
 * Copy a recorded run into the scratch directory, so a test may edit it.
 * @param {string} from - A fixture run directory.
 * @param {string[]} [omit] - File names to leave behind.
 * @returns {string} The copy's path.
 */
function copyRun(from, omit = []) {
  const to = path.join(tmp, path.basename(from));
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (omit.includes(name)) continue;
    fs.copyFileSync(path.join(from, name), path.join(to, name));
  }
  return to;
}

/**
 * @param {string} dir - A run directory.
 * @param {string} name - A file in it.
 * @returns {Object} Its parsed JSON.
 */
function readJson(dir, name) {
  return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
}

/**
 * @param {string} dir - A run directory.
 * @param {string} name - A file in it.
 * @param {Object} value - What to write, in the harness's own 2-space shape.
 * @returns {void}
 */
function writeJson(dir, name, value) {
  fs.writeFileSync(path.join(dir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/**
 * @param {string} dir - A run directory.
 * @param {string} name - An NDJSON file in it.
 * @returns {Object[]}
 */
function readNdjson(dir, name) {
  return fs
    .readFileSync(path.join(dir, name), 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

/**
 * @param {string} dir - A run directory.
 * @param {string} name - An NDJSON file in it.
 * @param {Object[]} events
 * @returns {void}
 */
function writeNdjson(dir, name, events) {
  fs.writeFileSync(path.join(dir, name), catalogue.serialize(events), 'utf8');
}

/**
 * Rebuild into the scratch directory, leaving the recording untouched.
 * @param {string} dir - A run directory.
 * @param {string} label - A file name for the output.
 * @returns {{code: number, out: string, err: string, file: string}}
 */
function rebuildTo(dir, label) {
  const file = path.join(tmp, label);
  return { ...main([dir, '--out', file]), file };
}

describe('replay — the report a live run wrote, rebuilt from its files', () => {
  // A byte observation and only that. The recorded report is preserved evidence,
  // so equality with it is directly observable and holds whatever the recording
  // says about renderers — including nothing, which is this fixture's case. What
  // that recording never captured is WHICH renderer wrote those bytes, and that
  // is the separate verdict pinned under `renderer provenance` below.
  it('reproduces the recorded report byte for byte', () => {
    const rebuilt = rebuildTo(GOLDEN, 'rebuilt.json');
    expect(rebuilt.code).toBe(0);

    const recorded = fs.readFileSync(path.join(GOLDEN, join.REPORT_FILENAME));
    const produced = fs.readFileSync(rebuilt.file);
    expect(produced.length).toBe(recorded.length);
    expect(produced.equals(recorded)).toBe(true);
  });

  it('reproduces the numbers that run measured, not merely a well-formed report', () => {
    const rebuilt = rebuildTo(GOLDEN, 'rebuilt.json');
    const report = JSON.parse(fs.readFileSync(rebuilt.file, 'utf8'));

    expect(report.runId).toBe('2026-08-13T19-26-29Z-S1-agent-lifecycle-A');
    expect(report.scenario).toBe('S1-agent-lifecycle');
    expect(report.arm).toBe('A');
    expect(report.join.maxLatencyMs).toBe(30000);
    expect(report.join.maxLatencySource).toContain('10 s × 3 scan intervals');
    expect(report.join.unavailable).toBeNull();
    expect(report.processObservable).toBe(true);
    expect(report.ticksWhileProcessAlive).toBe(3);

    for (const category of join.CATEGORIES) {
      expect(report.categories[category].recall).toBe('1/1');
      expect(report.categories[category].recallValue).toBe(1);
    }
    expect(report.categories['process/start'].latencyMs.points).toEqual([9989]);
    expect(report.categories['process/end'].latencyMs.points).toEqual([14927]);
    expect(report.categories['file/creation'].latencyMs.points).toEqual([12]);
    expect(report.categories['file/deletion'].latencyMs.points).toEqual([104]);
    expect(report.missed).toEqual([]);
    expect(report.unmatchedObserved).toEqual([]);
  });

  it('compares against the report already in the directory instead of overwriting it', () => {
    const before = fs.readFileSync(path.join(GOLDEN, join.REPORT_FILENAME));
    const result = main([GOLDEN]);

    expect(result.code).toBe(0);
    expect(result.out).toMatch(/identical to the run-report\.json already in the run directory/);
    expect(result.out).not.toMatch(/^written /m);
    expect(fs.readFileSync(path.join(GOLDEN, join.REPORT_FILENAME)).equals(before)).toBe(true);
  });

  it('writes the report when the directory holds none', () => {
    const dir = copyRun(GOLDEN, [join.REPORT_FILENAME]);
    const result = main([dir]);

    expect(result.code).toBe(0);
    expect(result.out).toMatch(/^written /m);
    const written = fs.readFileSync(path.join(dir, join.REPORT_FILENAME));
    expect(written.equals(fs.readFileSync(path.join(GOLDEN, join.REPORT_FILENAME)))).toBe(true);
  });
});

describe('replay — determinism', () => {
  it('produces the same bytes twice from the same input', () => {
    const first = rebuildTo(GOLDEN, 'first.json');
    const second = rebuildTo(GOLDEN, 'second.json');

    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    expect(fs.readFileSync(first.file).equals(fs.readFileSync(second.file))).toBe(true);
  });

  it('produces the same bytes from a separate process invocation', () => {
    const file = path.join(tmp, 'child.json');
    execFileSync(process.execPath, [REPLAY_SOURCE, GOLDEN, '--out', file], { encoding: 'utf8' });

    const recorded = fs.readFileSync(path.join(GOLDEN, join.REPORT_FILENAME));
    expect(fs.readFileSync(file).equals(recorded)).toBe(true);
  });
});

describe('replay — the current-renderer golden', () => {
  /**
   * The golden is what THIS renderer makes of that recording, committed on its
   * own outside the run directory. Today it is byte-identical to the recorded
   * report, and that is a coincidence with a date on it: the moment a rendered
   * string changes, this file is regenerated and the recording is not. Which of
   * the two moved is then the finding, and neither has to be guessed at.
   *
   * `--out` is the only way to produce it, and it writes exactly the report —
   * no envelope, no provenance smuggled into the report shape. What the artefact
   * is, is carried by where it lives and what it is called.
   */
  it('is the report this renderer builds from that recording, byte for byte', () => {
    const rebuilt = rebuildTo(GOLDEN, 'against-golden.json');
    expect(rebuilt.code).toBe(0);

    const produced = fs.readFileSync(rebuilt.file);
    const committed = fs.readFileSync(CURRENT_RENDERER_GOLDEN);
    expect(produced.length).toBe(committed.length);
    expect(produced.equals(committed)).toBe(true);
  });

  it('is a report and nothing but a report — replay adds no field of its own', () => {
    const golden = JSON.parse(fs.readFileSync(CURRENT_RENDERER_GOLDEN, 'utf8'));
    expect(golden.schemaVersion).toBe(join.SCHEMA_VERSION);
    expect(golden.runId).toBe('2026-08-13T19-26-29Z-S1-agent-lifecycle-A');
    expect(Object.keys(golden)).toEqual(
      Object.keys(JSON.parse(fs.readFileSync(path.join(GOLDEN, join.REPORT_FILENAME), 'utf8'))),
    );
  });

  it('lives outside the recording, so a golden can move without a recording moving', () => {
    expect(path.dirname(CURRENT_RENDERER_GOLDEN)).not.toBe(GOLDEN);
    expect(path.basename(CURRENT_RENDERER_GOLDEN)).toMatch(/golden-report\.current\.json$/);
    expect(fs.readdirSync(GOLDEN)).not.toContain(path.basename(CURRENT_RENDERER_GOLDEN));
  });
});

describe('replay — renderer provenance, kept apart from the bytes', () => {
  /** @type {Object} A fingerprint that is well-formed and is not this renderer's. */
  const SKEWED = { ...report.RENDERER_FINGERPRINT, joinSha256: '0'.repeat(64) };

  /**
   * A copy of the recording whose manifest pins a renderer.
   *
   * The manifest is edited in the SCRATCH copy and never in the fixture: the two
   * committed recordings pin no renderer, which is the honest state of both, and
   * back-filling one would be inventing the fact this whole block exists to keep
   * from being invented.
   * @param {Object|null} block - What `manifest.reportRenderer` should hold.
   * @param {boolean} [doctor] - Also alter the recorded report, so the rebuild differs from it.
   * @returns {string} The copy's path.
   */
  function pinned(block, doctor = false) {
    const dir = copyRun(GOLDEN);
    const manifest = readJson(dir, replay.MANIFEST_FILENAME);
    if (block === null) delete manifest.reportRenderer;
    else manifest.reportRenderer = block;
    writeJson(dir, replay.MANIFEST_FILENAME, manifest);
    if (doctor) {
      const file = path.join(dir, join.REPORT_FILENAME);
      fs.writeFileSync(
        file,
        fs
          .readFileSync(file, 'utf8')
          .replace('"ticksWhileProcessAlive": 3', '"ticksWhileProcessAlive": 7'),
        'utf8',
      );
    }
    return dir;
  }

  it('match + identical bytes: the historical bytes, from the renderer that wrote them', () => {
    const result = main([pinned(report.RENDERER_FINGERPRINT)]);

    expect(result.code).toBe(0);
    expect(result.out).toMatch(/identical to the run-report\.json already in the run directory/);
    expect(result.out).toMatch(
      /renderer match — the recording pins the report-renderer source bytes/,
    );
    expect(result.out).toMatch(/the historical report bytes were reproduced exactly/);
  });

  it('skew + identical bytes: the historical bytes all the same, and the skew named', () => {
    const result = main([pinned(SKEWED)]);

    expect(result.code).toBe(0);
    expect(result.out).toMatch(/identical to the run-report\.json already in the run directory/);
    expect(result.out).toMatch(
      /renderer skew — the recording pins report-renderer source bytes this replay did not run/,
    );
    expect(result.out).toMatch(
      /the historical report bytes were reproduced exactly, skew or no skew/,
    );
    expect(result.out).not.toMatch(/renderer match/);
  });

  it('names both digests under skew, so the reader sees what differed', () => {
    const result = main([pinned(SKEWED)]);

    expect(result.out).toMatch(
      new RegExp(`bench/lib/join\\.js\\s+recorded ${'0'.repeat(64)} · this tree [0-9a-f]{64}`),
    );
    // report.js agreed, so it is not listed: the block names the files that differ.
    expect(result.out).not.toMatch(/bench\/lib\/report\.js\s+recorded/);
  });

  it('legacy + identical bytes: the bytes are evidence, the renderer identity was never recorded', () => {
    const result = main([GOLDEN]);

    expect(result.code).toBe(0);
    expect(result.out).toMatch(
      /legacy-unversioned — this recording carries no manifest\.reportRenderer block/,
    );
    expect(result.out).toMatch(/the historical report bytes were reproduced exactly/);
    expect(result.out).toMatch(
      /what this recording never captured is the identity of the renderer/,
    );
    expect(result.out).not.toMatch(/renderer match/);
  });

  it('match + differing bytes: skew is ruled OUT, and no other cause is invented', () => {
    const result = main([pinned(report.RENDERER_FINGERPRINT, true)]);

    expect(result.code).toBe(1);
    expect(result.err).toMatch(/the rebuilt report differs from/);
    expect(result.err).toMatch(/renderer skew is NOT the explanation for the difference above/);
    expect(result.err).toMatch(/no other cause is inferred here/);
  });

  it('skew + differing bytes: a candidate explanation, stated as one', () => {
    const result = main([pinned(SKEWED, true)]);

    expect(result.code).toBe(1);
    expect(result.err).toMatch(/the rebuilt report differs from/);
    expect(result.err).toMatch(/stated next to the byte difference above rather than as its cause/);
    expect(result.err).toMatch(/candidate explanation, and nothing here establishes it/);
  });

  it('legacy + differing bytes: the divergence stands alone, with nothing attributed to it', () => {
    const result = main([pinned(null, true)]);

    expect(result.code).toBe(1);
    expect(result.err).toMatch(/the rebuilt report differs from/);
    expect(result.err).toMatch(
      /The byte difference above stands on its own, and no cause is attributed to it here/,
    );
  });

  it('reads a fingerprint of an unknown schema version as skew, never as a match', () => {
    const result = main([pinned({ ...report.RENDERER_FINGERPRINT, schemaVersion: 99 })]);

    expect(result.code).toBe(0);
    expect(result.out).toMatch(/renderer skew/);
    expect(result.out).toMatch(/is schema version 99, and this replay reads version 1/);
    expect(result.out).not.toMatch(/renderer match/);
  });

  it('refuses to compare digests taken with two different algorithms', () => {
    const result = main([pinned({ ...report.RENDERER_FINGERPRINT, algorithm: 'sha1' })]);

    expect(result.out).toMatch(/renderer skew/);
    expect(result.out).toMatch(/two digests of different algorithms cannot be compared/);
  });

  it('prints ABSENT for a digest the recording never captured', () => {
    const result = main([pinned({ ...report.RENDERER_FINGERPRINT, joinSha256: null })]);

    expect(result.out).toMatch(/renderer skew/);
    expect(result.out).toMatch(/bench\/lib\/join\.js\s+recorded ABSENT · this tree [0-9a-f]{64}/);
  });

  it('is a verdict on the manifest alone: no report in the directory changes it', () => {
    const dir = pinned(SKEWED);
    fs.rmSync(path.join(dir, join.REPORT_FILENAME));

    const result = main([dir]);
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/renderer skew/);
    expect(result.out).toMatch(/no recorded report was held up against this rebuild/);
    expect(result.out).not.toMatch(/reproduced exactly/);
  });

  it('classifies without any of it: an absent block and a null one read the same', () => {
    expect(report.classifyRenderer(undefined).provenance).toBe(report.RENDERER_PROVENANCE.LEGACY);
    expect(report.classifyRenderer(null).provenance).toBe(report.RENDERER_PROVENANCE.LEGACY);
    expect(report.classifyRenderer(report.RENDERER_FINGERPRINT).provenance).toBe(
      report.RENDERER_PROVENANCE.MATCH,
    );
    expect(report.classifyRenderer(SKEWED).differences).toEqual([
      {
        field: 'joinSha256',
        file: 'bench/lib/join.js',
        recorded: '0'.repeat(64),
        current: report.RENDERER_FINGERPRINT.joinSha256,
      },
    ]);
  });
});

describe('replay — a process the sensor was never shown', () => {
  /**
   * No recorded run can serve this case: the only real zero-tick arm-A run is the
   * `PRE_INTERVAL` fixture, which predates `sensor.scanInterval` and is therefore
   * refused rather than scored (see the block below). Adding that field to it
   * would be inventing a measurement.
   *
   * So the input is DERIVED from the golden recording by exactly two edits, both
   * of which are what a real zero-tick run would have recorded:
   *
   * 1. `sensor.ticksWhileProcessAlive` → 0 — no completed scan fell inside the
   *    scenario's process lifetime;
   * 2. the two process observations are dropped from `observed.ndjson` — a sensor
   *    that never scanned the process cannot have reported its start or its end.
   *
   * The second edit is not cosmetic. With the observations left in, the join takes
   * the `note` branch — the tick accounting and the observations disagree — and
   * not the structural one. The file categories are untouched, and stay 1/1, which
   * is what keeps this a statement about the process categories alone.
   * @returns {string} The derived run directory.
   */
  function zeroTickRun() {
    const dir = copyRun(GOLDEN, [join.REPORT_FILENAME]);
    const meta = readJson(dir, replay.META_FILENAME);
    meta.sensor.ticksWhileProcessAlive = 0;
    writeJson(dir, replay.META_FILENAME, meta);
    writeNdjson(
      dir,
      replay.OBSERVED_FILENAME,
      readNdjson(dir, replay.OBSERVED_FILENAME).filter((e) => e.event.category[0] !== 'process'),
    );
    return dir;
  }

  it('names the process categories structurally unobservable and derives no number', () => {
    const dir = zeroTickRun();
    const result = main([dir]);

    expect(result.code).toBe(0);
    const report = readJson(dir, join.REPORT_FILENAME);
    expect(report.processObservable).toBe(false);
    expect(report.ticksWhileProcessAlive).toBe(0);
    for (const category of join.PROCESS_CATEGORIES) {
      expect(report.categories[category].recall).toBe('0/1 (structurally unobservable)');
      expect(report.categories[category].recallValue).toBeNull();
      expect(report.categories[category].recallUnavailable).toMatch(
        /no scan tick fell inside the process lifetime/,
      );
      expect(report.categories[category].note).toBeUndefined();
    }
    expect(report.categories['file/creation'].recall).toBe('1/1');
    expect(report.categories['file/deletion'].recall).toBe('1/1');
    expect(result.out).toMatch(/processObservable false/);
  });

  it('is a valid run: the phase alignment failed, not the sensor and not the replay', () => {
    expect(main([zeroTickRun()]).code).toBe(0);
  });
});

describe('replay — what it refuses', () => {
  for (const name of Object.keys(replay.REQUIRED_FILES)) {
    it(`refuses a run directory with no ${name}, and writes no report`, () => {
      const dir = copyRun(GOLDEN, [join.REPORT_FILENAME, name]);
      const result = main([dir]);

      expect(result.code).toBe(1);
      expect(result.err).toContain(name);
      expect(result.err).toMatch(/is missing/);
      expect(fs.existsSync(path.join(dir, join.REPORT_FILENAME))).toBe(false);
    });
  }

  it('refuses a run directory that is not there', () => {
    const result = main([path.join(tmp, 'no-such-run')]);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/cannot be read as a run directory/);
  });

  it('refuses a path that is a file', () => {
    const file = path.join(tmp, 'not-a-run');
    fs.writeFileSync(file, '', 'utf8');
    const result = main([file]);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/is not a directory/);
  });

  it('refuses a malformed interior line, naming the file and the line number', () => {
    const dir = copyRun(GOLDEN, [join.REPORT_FILENAME]);
    const lines = fs.readFileSync(path.join(dir, replay.OBSERVED_FILENAME), 'utf8').split('\n');
    lines[1] = '{"@timestamp": "2026-08-13T19:28:1';
    fs.writeFileSync(path.join(dir, replay.OBSERVED_FILENAME), lines.join('\n'), 'utf8');

    const result = main([dir]);
    expect(result.code).toBe(1);
    expect(result.err).toContain(replay.OBSERVED_FILENAME);
    expect(result.err).toMatch(/line 2 does not parse/);
    expect(fs.existsSync(path.join(dir, join.REPORT_FILENAME))).toBe(false);
  });

  it('refuses a JSON file that does not parse', () => {
    const dir = copyRun(GOLDEN, [join.REPORT_FILENAME]);
    fs.writeFileSync(path.join(dir, replay.META_FILENAME), '{ "sensor": ', 'utf8');

    const result = main([dir]);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/is not valid JSON/);
  });

  it('refuses an event carrying no instant, rather than joining around it', () => {
    const dir = copyRun(GOLDEN, [join.REPORT_FILENAME]);
    const events = readNdjson(dir, replay.CATALOGUE_FILENAME);
    delete events[0]['@timestamp'];
    writeNdjson(dir, replay.CATALOGUE_FILENAME, events);

    const result = main([dir]);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/the join refused this run's own files/);
    expect(result.err).toMatch(/which is not a UTC instant/);
    expect(fs.existsSync(path.join(dir, join.REPORT_FILENAME))).toBe(false);
  });

  it('refuses a real run recorded before the scan interval was, and never defaults one', () => {
    const result = main([PRE_INTERVAL]);

    expect(result.code).toBe(1);
    expect(result.err).toMatch(/carries no sensor\.scanInterval/);
    expect(result.err).toMatch(/it is never defaulted/);
    expect(fs.existsSync(path.join(PRE_INTERVAL, join.REPORT_FILENAME))).toBe(false);
  });

  it('refuses a capture record with no tick accounting', () => {
    const dir = copyRun(GOLDEN, [join.REPORT_FILENAME]);
    const meta = readJson(dir, replay.META_FILENAME);
    delete meta.sensor.ticksWhileProcessAlive;
    writeJson(dir, replay.META_FILENAME, meta);

    const result = main([dir]);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/ticksWhileProcessAlive/);
    expect(fs.existsSync(path.join(dir, join.REPORT_FILENAME))).toBe(false);
  });

  it('refuses a directory whose two files describe different runs', () => {
    const dir = copyRun(GOLDEN, [join.REPORT_FILENAME]);
    const meta = readJson(dir, replay.META_FILENAME);
    meta.runId = '2026-08-13T19-23-06Z-S1-agent-lifecycle-A';
    writeJson(dir, replay.META_FILENAME, meta);

    const result = main([dir]);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/disagree about runId/);
    expect(result.err).toMatch(/describe different runs/);
  });

  it('refuses an empty observation set', () => {
    const dir = copyRun(GOLDEN, [join.REPORT_FILENAME]);
    fs.writeFileSync(path.join(dir, replay.OBSERVED_FILENAME), '', 'utf8');

    const result = main([dir]);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/holds no event/);
    expect(result.err).toMatch(/indistinguishable from a sensor that ran and saw nothing/);
  });
});

describe('replay — an absent window is carried, not filled in', () => {
  it('writes the report, reads every recall as unavailable, and exits 1', () => {
    const dir = copyRun(GOLDEN, [join.REPORT_FILENAME]);
    const meta = readJson(dir, replay.META_FILENAME);
    meta.sensor.scanInterval = {
      value: null,
      source: 'scanIntervalSec in <profile>, then the settled scan cadence',
      unavailable: 'neither source answered',
    };
    writeJson(dir, replay.META_FILENAME, meta);

    const result = main([dir]);
    expect(result.code).toBe(1);

    const report = readJson(dir, join.REPORT_FILENAME);
    expect(report.join.maxLatencyMs).toBeNull();
    expect(report.join.unavailable).toMatch(/never defaulted/);
    for (const category of join.CATEGORIES) {
      expect(report.categories[category].recall).toMatch(/^unavailable — /);
      expect(report.categories[category].recallValue).toBeNull();
      expect(report.categories[category].matched).toBeNull();
    }
  });

  it('refuses an interval that is neither seconds nor a recorded absence', () => {
    const dir = copyRun(GOLDEN, [join.REPORT_FILENAME]);
    const meta = readJson(dir, replay.META_FILENAME);
    meta.sensor.scanInterval = { value: 'ten', source: 'a string' };
    writeJson(dir, replay.META_FILENAME, meta);

    const result = main([dir]);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/neither a number of seconds nor the null/);
  });
});

describe('replay — what it does not refuse', () => {
  it('carries a category the report does not score into missed, with the reason', () => {
    const dir = copyRun(GOLDEN, [join.REPORT_FILENAME]);
    const events = readNdjson(dir, replay.CATALOGUE_FILENAME);
    events[0].event.category = ['network'];
    events[0].event.type = ['connection'];
    writeNdjson(dir, replay.CATALOGUE_FILENAME, events);

    const result = main([dir]);
    expect(result.code).toBe(0);

    const report = readJson(dir, join.REPORT_FILENAME);
    const unscored = report.missed.filter((m) => m.category === null);
    expect(unscored).toHaveLength(1);
    expect(unscored[0].reason).toMatch(/carries no category this report scores/);
    expect(report.categories['file/creation'].expected).toBe(0);
    expect(result.out).toMatch(/1 expected row\(s\) carry a category this report does not score/);
  });

  it('rebuilds a run whose first step failed and whose catalogue is empty', () => {
    const dir = copyRun(GOLDEN, [join.REPORT_FILENAME]);
    fs.writeFileSync(path.join(dir, replay.CATALOGUE_FILENAME), '', 'utf8');

    const result = main([dir]);
    expect(result.code).toBe(0);

    const report = readJson(dir, join.REPORT_FILENAME);
    for (const category of join.CATEGORIES) {
      expect(report.categories[category].recall).toBe('0/0');
      expect(report.categories[category].recallValue).toBeNull();
    }
    expect(report.unmatchedObserved).toHaveLength(4);
  });
});

describe('replay — a recorded report is evidence, not a scratch file', () => {
  it('reports a difference, writes nothing, and exits 1', () => {
    const dir = copyRun(GOLDEN);
    const recordedPath = path.join(dir, join.REPORT_FILENAME);
    const doctored = fs
      .readFileSync(recordedPath, 'utf8')
      .replace('"ticksWhileProcessAlive": 3', '"ticksWhileProcessAlive": 7');
    fs.writeFileSync(recordedPath, doctored, 'utf8');

    const result = main([dir]);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/the rebuilt report differs from/);
    expect(result.err).toMatch(/first difference at byte \d+/);
    expect(result.err).toMatch(/nothing was written/);
    expect(fs.readFileSync(recordedPath, 'utf8')).toBe(doctored);
  });
});

describe('replay — invocation', () => {
  it('refuses an unknown flag with the usage, and reads nothing', () => {
    const result = main([GOLDEN, '--force']);
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/unknown argument "--force"/);
    expect(result.err).toMatch(/Usage:/);
  });

  it('refuses a second run directory', () => {
    const result = main([GOLDEN, PRE_INTERVAL]);
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/two run directories given/);
  });

  it('refuses an --out with no value', () => {
    expect(main([GOLDEN, '--out']).code).toBe(2);
  });

  it('refuses an invocation with no run directory', () => {
    const result = main([]);
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/no run directory given/);
  });

  it('prints the usage on --help', () => {
    const result = main(['--help']);
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/rebuild run-report\.json from a recorded run directory/);
  });
});

describe('replay — isolation', () => {
  it('reads nothing outside the run directory once it is running', () => {
    const dir = copyRun(GOLDEN, [join.REPORT_FILENAME]);
    const read = [];
    // Every spy calls through to the original: the point is to observe which paths
    // are read, not to stub the reads out.
    const spies = ['readFileSync', 'existsSync', 'statSync', 'readdirSync'].map((name) => {
      const original = fs[name];
      return vi.spyOn(fs, name).mockImplementation((...args) => {
        read.push(String(args[0]));
        return original.apply(fs, args);
      });
    });

    try {
      expect(main([dir, '--out', path.join(tmp, 'out.json')]).code).toBe(0);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }

    expect(read.length).toBeGreaterThan(0);
    const outside = read.filter((p) => !path.resolve(p).startsWith(path.resolve(dir)));
    expect(outside).toEqual([]);
    expect(read.some((p) => p.endsWith('settings.json'))).toBe(false);
    // The renderer fingerprint is taken while `lib/report.js` loads and frozen
    // there, which is why no join.js or report.js read appears here. That is the
    // property, not an accident of when this spy was installed: a hash taken now
    // would describe the file on disk rather than the code this process is
    // running, and the two differ on exactly the dirty tree every arm-A run so
    // far was measured against. The load-time pair is proven below.
    expect(read.some((p) => p.endsWith('join.js') || p.endsWith('report.js'))).toBe(false);
  });

  it('reads exactly the two renderer files at load, and no run directory', () => {
    const script =
      'const fs=require("fs");const orig=fs.readFileSync;const seen=[];' +
      'fs.readFileSync=(...a)=>{seen.push(String(a[0]));return orig(...a)};' +
      'require(process.argv[1]);console.log(seen.join("\\n"));';
    const seen = execFileSync(process.execPath, ['-e', script, REPLAY_SOURCE], {
      encoding: 'utf8',
    })
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    // Node's own CJS loader reads a module's source through this same call, so
    // each of the three files may appear for that reason as well. What is pinned
    // is the SET: the two renderer files are read while the process is loading,
    // every path read then lives under bench/, and no run directory, settings
    // file or src/ module is opened before a run directory has even been named.
    const names = new Set(seen.map((file) => path.basename(file)));
    expect(names.has('join.js')).toBe(true);
    expect(names.has('report.js')).toBe(true);
    expect([...names].every((n) => ['join.js', 'report.js', 'replay.js'].includes(n))).toBe(true);
    for (const file of seen) {
      expect(path.resolve(file).startsWith(path.join(REPO, 'bench'))).toBe(true);
    }
  });

  it('loads a module graph that cannot reach the sensor or the actor', () => {
    const script = 'require(process.argv[1]); console.log(Object.keys(require.cache).join("\\n"));';
    const loaded = execFileSync(process.execPath, ['-e', script, REPLAY_SOURCE], {
      encoding: 'utf8',
    })
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((file) => path.basename(file));

    expect(loaded).not.toContain('sensor.js');
    expect(loaded).not.toContain('actor.js');
    expect(loaded).not.toContain('run.js');
    expect([...loaded].sort()).toEqual(['join.js', 'replay.js', 'report.js']);
  });

  it('spells the four file names the way the modules that write them do', () => {
    expect(Object.keys(replay.REQUIRED_FILES).sort()).toEqual(
      [
        replay.MANIFEST_FILENAME,
        replay.CATALOGUE_FILENAME,
        replay.OBSERVED_FILENAME,
        replay.META_FILENAME,
      ].sort(),
    );
    expect(replay.CATALOGUE_FILENAME).toBe(catalogue.CATALOGUE_FILENAME);
    expect(replay.OBSERVED_FILENAME).toBe(observed.OBSERVED_FILENAME);
    expect(replay.META_FILENAME).toBe(observed.META_FILENAME);
    // `manifest.json` has no owning constant — `run.js` writes the literal — so it
    // is pinned against a real recording instead.
    expect(fs.existsSync(path.join(GOLDEN, replay.MANIFEST_FILENAME))).toBe(true);
  });
});
