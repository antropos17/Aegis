/**
 * @file tests/main/bench/metrics.test.js
 * @description The gate on `bench/lib/metrics.js` — the arithmetic B2.5 turns one
 *   completed run into, and the honesty conditions on it.
 *
 *   What it pins, in the order the module is read in:
 *
 *   - **The catalogue is the fixed point.** Two arcs leave it and no metric is
 *     ever computed by matching the oracle against the sensor.
 *   - **An unconfirmed row is not ground truth.** It leaves every recall and every
 *     precision denominator, it is reported by count and by reason, and it is
 *     never a sensor miss.
 *   - **A category the oracle cannot observe is unmeasurable, never zero.** Both
 *     ways of being unobservable are covered: no Sysmon event exists for the
 *     category at all, and the configuration THIS RUN recorded did not enable the
 *     one that does.
 *   - **The module reaches for nothing.** No filesystem API, and nothing under
 *     `src/` anywhere in its module graph — the measurement column may not import
 *     the thing it measures.
 *   - **Byte determinism.** The same inputs produce the same bytes, twice, with
 *     no instant of scoring anywhere in them.
 *
 *   The fixtures under `tests/fixtures/bench/derived/M*` are DERIVED MODELS, not
 *   recordings: no process ran, no sensor ran and no Sysmon channel was read. What
 *   they pin is this arithmetic, and nothing in this file is an accuracy figure
 *   about the AEGIS sensor. See `tests/fixtures/bench/derived/README.md`.
 */
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

import { describe, it, expect } from 'vitest';

import join from '../../../bench/lib/join.js';
import metrics from '../../../bench/lib/metrics.js';
import paths from '../../../bench/lib/paths.js';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const DERIVED = path.join(REPO, 'tests', 'fixtures', 'bench', 'derived');

/** @type {ReadonlyArray<string>} The three models this block added. */
const MODELS = Object.freeze([
  'M1-fully-confirmed',
  'M2-unconfirmed-rows',
  'M3-category-unmeasurable',
]);

/**
 * Read one derived model's six files and hand them to the module the way
 * `bench/score.js` does.
 * @param {string} id - A directory under `tests/fixtures/bench/derived/`.
 * @returns {{metrics: Object, matched: Object[]}}
 */
function score(id) {
  const dir = path.join(DERIVED, id);
  const ndjson = (name) =>
    fs
      .readFileSync(path.join(dir, name), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line));
  const json = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  const meta = json('observed.meta.json');
  return metrics.buildMetrics({
    runId: meta.runId,
    scenario: meta.scenario,
    arm: meta.arm,
    expected: ndjson('expected.ndjson'),
    oracle: ndjson('oracle-sysmon.ndjson'),
    loss: json('oracle-loss.json'),
    observed: ndjson('observed.ndjson'),
    // The same three-intervals rule bench/lib/report.js applies, spelled out here
    // rather than imported, so this file exercises the metrics and not the window.
    maxLatency: { value: meta.sensor.scanInterval.value * 3 * 1000, source: 'test' },
    ticksWhileProcessAlive: meta.sensor.ticksWhileProcessAlive,
    inputs: [],
  });
}

describe('bench/lib/metrics — oracle coverage bounds what may be scored', () => {
  it('marks a category this oracle has no event for unmeasurable, by name and not by zero', () => {
    for (const category of ['file/read', 'file/append']) {
      const cover = metrics.coverageFor(category, {
        collected: true,
        enabledEventIds: [1, 2, 3, 5, 11, 22, 26],
      });
      expect(cover.measurable).toBe(false);
      expect(cover.eventId).toBeNull();
      expect(cover.reasonCode).toBe(metrics.UNCONFIRMED_REASON.CATEGORY_UNMEASURABLE);
      expect(cover.reason).toMatch(/UNMEASURABLE under this oracle — not undetected/);
    }
    // The static blind set is checked BEFORE the configuration, so a category no
    // event observes never reads as one that could be switched on.
    expect(metrics.coverageFor('file/read', { collected: false, enabledEventIds: null }).reason).toBe(
      metrics.ORACLE_BLIND['file/read'],
    );
  });

  it('reads the configuration the RUN recorded, not the committed config file', () => {
    const enabled = metrics.coverageFor('file/deletion', {
      collected: true,
      enabledEventIds: [1, 2, 3, 5, 11, 22, 26],
    });
    expect(enabled.measurable).toBe(true);
    expect(enabled.eventId).toBe(26);

    const disabled = metrics.coverageFor('file/deletion', {
      collected: true,
      enabledEventIds: [1, 2, 3, 5, 11, 22],
      configSha256: 'deadbeef',
    });
    expect(disabled.measurable).toBe(false);
    expect(disabled.reason).toMatch(/does not enable EID 26 FileDeleteDetected \(config sha256 dea/);
    expect(disabled.reason).toMatch(/evidence about the configuration and not about the machine/);
  });

  it('refuses to guess coverage from a run that recorded no configuration', () => {
    const cover = metrics.coverageFor('process/start', { collected: true, enabledEventIds: null });
    expect(cover.measurable).toBe(false);
    expect(cover.reason).toMatch(/An absent configuration is not an empty one/);
  });

  it('names an oracle that never collected as the run-level fact it is', () => {
    const cover = metrics.coverageFor('process/start', { collected: false, enabledEventIds: [1] });
    expect(cover.reasonCode).toBe(metrics.UNCONFIRMED_REASON.ORACLE_NOT_COLLECTED);
  });

  it('reports the contradiction when records exist in a category the config excludes', () => {
    const cover = metrics.coverageFor('file/deletion', {
      collected: true,
      enabledEventIds: [1, 11],
      recordsPresent: 2,
    });
    expect(cover.measurable).toBe(false);
    expect(cover.contradiction).toMatch(/2 oracle record\(s\) of it are in the file/);
    expect(cover.contradiction).toMatch(/no row is confirmed off a record/);
  });

  it('leaves a measurable category free of a contradiction note', () => {
    const cover = metrics.coverageFor('file/creation', {
      collected: true,
      enabledEventIds: [11],
      recordsPresent: 3,
    });
    expect(cover.measurable).toBe(true);
    expect(cover.contradiction).toBeUndefined();
  });

  it('carries the bound of each confirming event beside its id', () => {
    expect(metrics.ORACLE_COVERAGE['process/start'].bound).toMatch(/pid alone is NOT a fallback/);
    expect(metrics.ORACLE_COVERAGE['process/end'].bound).toMatch(/no image to key on/);
    expect(metrics.ORACLE_COVERAGE['file/creation'].bound).toMatch(/EID 11 carries no hash/);
    expect(metrics.ORACLE_COVERAGE['file/deletion'].bound).toMatch(/EID 23 FileDelete is never/);
    // Every category the report scores has an entry, and no entry exists for one
    // it does not — the two sets are the same set.
    expect(Object.keys(metrics.ORACLE_COVERAGE).sort()).toEqual([...join.CATEGORIES].sort());
  });
});

describe('bench/lib/metrics — what confirms a catalogue row', () => {
  const at = '2026-08-20T12:00:00.000Z';

  it('keys process/start on pid AND executable, so a same-pid coincidence confirms nothing', () => {
    const key = (executable) =>
      metrics.oracleKeyOf(
        { '@timestamp': at, process: { pid: 4242, executable } },
        'process/start',
      );
    expect(key('X:\\a\\claude.exe')).toBe(key('x:/a/CLAUDE.EXE'));
    expect(key('X:\\a\\claude.exe')).not.toBe(key('X:\\a\\cursor.exe'));
    // An EID 1 with no Image cannot satisfy the key, and no narrower one is used.
    expect(metrics.oracleKeyOf({ process: { pid: 4242 } }, 'process/start')).toBeNull();
  });

  it('keys process/end on pid alone, because EID 5 exposes nothing else', () => {
    expect(metrics.oracleKeyOf({ process: { pid: 7 } }, 'process/end')).toBe('pid:7');
    expect(metrics.oracleKeyOf({ process: {} }, 'process/end')).toBeNull();
  });

  it('keys a file category on the path and never on the pid the catalogue happens to carry', () => {
    const row = { file: { path: 'X:\\a\\b.exe' }, process: { pid: 900 } };
    expect(metrics.oracleKeyOf(row, 'file/creation')).toBe('path:x:\\a\\b.exe');
    expect(metrics.oracleKeyOf({ process: { pid: 900 } }, 'file/deletion')).toBeNull();
  });

  it('folds an un-neutralized oracle path onto a neutralized catalogue path', () => {
    // The catalogue and the capture are written through the recording rewrite and
    // the oracle file is not (bench/lib/oracles/sysmon.js applies none), so on a
    // live run the two columns name one file with two different roots. Built from
    // the real clone root at test time, because a committed fixture cannot carry
    // a path that is machine-dependent by definition.
    const tail = ['bench', 'runs', 'r1', 'stage', 'claude.exe'];
    const oracleSide = path.join(paths.ROOT, ...tail);
    const catalogueSide = path.join(paths.RECORDED_REPO_ROOT, ...tail);
    expect(metrics.foldPath(oracleSide)).toBe(metrics.foldPath(catalogueSide));
    // The fold moves a root, not a name: two different files stay two files.
    expect(metrics.foldPath(oracleSide)).not.toBe(
      metrics.foldPath(path.join(paths.RECORDED_REPO_ROOT, 'bench', 'runs', 'r1', 'stage', 'x.exe')),
    );
    expect(metrics.PATH_COMPARISON).toMatch(/FINDING, recorded and not fixed here/);
  });

  it('confirms nearest-first, one record per row, and never twice', () => {
    const row = (i, ms) => ({
      '@timestamp': `2026-08-20T12:00:0${ms}.000Z`,
      ecs: { version: '8.11.0' },
      event: { kind: 'event', category: ['file'], type: ['creation'], action: 'file-created' },
      file: { path: 'X:\\a\\b.exe' },
      bench: { step: `s${i}` },
    });
    const catalogue = metrics.indexForConfirmation([row(1, 0), row(2, 4)], 'catalogue');
    const oracle = metrics.indexForConfirmation([row(3, 5), row(4, 1)], 'oracle');
    const coverage = { 'file/creation': { measurable: true } };
    const pairs = metrics.assignConfirmations(catalogue, oracle, coverage);
    expect(pairs).toHaveLength(2);
    // 0↔1 is 1 s and 4↔5 is 1 s; both beat the 4 s and 5 s cross pairings, and
    // neither side is used twice.
    expect(pairs.map((p) => [p.catalogue.i, p.oracle.i, p.stampDeltaMs])).toEqual([
      [0, 1, 1000],
      [1, 0, 1000],
    ]);
  });

  it('produces no candidate at all in an unmeasurable category', () => {
    const doc = {
      '@timestamp': '2026-08-20T12:00:00.000Z',
      event: { kind: 'event', category: ['file'], type: ['deletion'], action: 'file-deleted' },
      file: { path: 'X:\\a\\b.exe' },
    };
    const pairs = metrics.assignConfirmations(
      metrics.indexForConfirmation([doc], 'catalogue'),
      metrics.indexForConfirmation([doc], 'oracle'),
      { 'file/deletion': { measurable: false, reasonCode: 'category-unmeasurable', reason: 'x' } },
    );
    expect(pairs).toEqual([]);
  });

  it('refuses a column whose row carries no instant, naming the side and the index', () => {
    expect(() => metrics.indexForConfirmation([{ '@timestamp': 'soon' }], 'oracle')).toThrow(
      /oracle event 0 carries @timestamp "soon"/,
    );
    expect(() => metrics.indexForConfirmation(null, 'catalogue')).toThrow(
      /the catalogue column is not an array of events/,
    );
  });

  it('declares no confirmation window and no epsilon, and says why', () => {
    expect(metrics.CONFIRMATION_WINDOW).toMatch(/none, and no epsilon/);
    expect(metrics.CONFIRMATION_WINDOW).toMatch(/guest-clock uncertainty is a different quantity/);
    expect(metrics.STAMP_DELTA_MEANING).toMatch(/It is NOT a latency and NOT a measured clock/);
  });
});

describe('bench/lib/metrics — M1, a run the oracle confirmed end to end', () => {
  const built = score('M1-fully-confirmed');

  it('confirms every row and scores every category as coverage', () => {
    for (const category of join.CATEGORIES) {
      const truth = built.metrics.groundTruth[category];
      expect(built.metrics.oracle.coverage[category].measurable).toBe(true);
      expect(truth.confirmed).toBe(truth.catalogued);
      expect(truth.unconfirmed).toBe(0);
      expect(truth.confirmationRateValue).toBe(1);
      expect(truth.unconfirmedRows).toEqual([]);
      expect(built.metrics.sensor[category].recallValue).toBe(1);
      expect(built.metrics.sensor[category].precisionValue).toBe(1);
    }
    expect(built.metrics.groundTruth['file/creation'].catalogued).toBe(2);
    expect(built.metrics.sensor['file/creation'].recall).toBe('2/2');
  });

  it('records the stamp delta of each confirmation without calling it a latency', () => {
    for (const row of built.matched) {
      expect(row.oracle.verdict).toBe(metrics.VERDICT.CONFIRMED);
      expect(row.groundTruth).toBe(true);
      expect(Number.isFinite(row.oracle.stampDeltaMs)).toBe(true);
      expect(row.oracle.record.eventId).toBe(metrics.ORACLE_COVERAGE[row.category].eventId);
    }
    // The guid rides beside a process confirmation as evidence, and no key used it.
    const end = built.matched.find((row) => row.category === 'process/end');
    expect(end.oracle.record.processGuid).toMatch(/^\{/);
    expect(end.oracle.key).toBe('pid:4242');
  });

  it('carries every catalogue row into matched.ndjson, verdicts and all', () => {
    expect(built.matched).toHaveLength(5);
    expect(built.matched.every((row) => row.unit === 'expectation')).toBe(true);
    expect(built.matched.every((row) => row.sensor.detectionCategory === metrics.DETECTION.TELEMETRY)).toBe(true);
  });
});

describe('bench/lib/metrics — M2, the rows the oracle did not confirm', () => {
  const built = score('M2-unconfirmed-rows');
  const truth = built.metrics.groundTruth['file/creation'];
  const sensor = built.metrics.sensor['file/creation'];

  it('keeps an unconfirmed row out of the recall denominator, and never calls it a miss', () => {
    expect(truth.catalogued).toBe(3);
    expect(truth.confirmed).toBe(1);
    expect(truth.unconfirmed).toBe(2);
    // The whole point: 3 rows were catalogued, 1 is ground truth, and the sensor
    // saw that one. Recall is 1/1 — not 1/3, and not 1/2.
    expect(sensor.groundTruth).toBe(1);
    expect(sensor.recall).toBe('1/1');
    expect(sensor.recallValue).toBe(1);
    expect(sensor.notDetected).toBe(0);
  });

  it('keeps an unconfirmed row the sensor DID see out of the precision denominator too', () => {
    // E3 is unconfirmed and observed. Its observation is neither a true positive
    // nor a false positive: there is no ground truth for it to be either against.
    expect(sensor.observationsInWindow).toBe(3);
    expect(sensor.truePositives).toBe(1);
    expect(sensor.matchedUnconfirmed).toBe(1);
    expect(sensor.unaccounted).toBe(1);
    expect(sensor.precisionDenominator).toBe(2);
    expect(sensor.precision).toBe('1/2');
    expect(sensor.precisionValue).toBe(0.5);
    // The partition is exact: every observation is one of the three.
    expect(sensor.truePositives + sensor.matchedUnconfirmed + sensor.unaccounted).toBe(
      sensor.observationsInWindow,
    );
  });

  it('reports each unconfirmed row separately, by count and by reason', () => {
    expect(truth.unconfirmedRows.map((row) => [row.expect, row.reasonCode])).toEqual([
      ['E2', metrics.UNCONFIRMED_REASON.NO_ORACLE_RECORD_FOR_KEY],
      ['E3', metrics.UNCONFIRMED_REASON.NO_ORACLE_RECORD_FOR_KEY],
    ]);
    expect(truth.unconfirmedRows[0].reason).toMatch(
      /The oracle looked and did not see it, so the row states an intent the oracle did not confirm/,
    );
    for (const row of built.matched.filter((r) => ['E2', 'E3'].includes(r.expected.expect))) {
      expect(row.groundTruth).toBe(false);
      expect(row.oracle.verdict).toBe(metrics.VERDICT.UNCONFIRMED);
    }
  });

  it('states precision as a lower bound and names the refinement it refuses', () => {
    expect(sensor.precisionBound).toBe('lower');
    expect(sensor.precisionBoundReason).toMatch(/diff of two live streams and is refused/);
    expect(built.metrics.rejected.oracleVsSensorCorroboration).toMatch(/^REJECTED\./);
    expect(sensor.unaccountedObserved).toHaveLength(1);
    expect(sensor.unaccountedObserved[0].key).toMatch(/stray\.exe$/);
  });

  it('gives a category the catalogue never expected 0/0 and no number', () => {
    for (const category of ['process/end', 'file/deletion']) {
      const empty = built.metrics.groundTruth[category];
      expect(empty.catalogued).toBe(0);
      expect(empty.confirmationRate).toBe('0/0');
      expect(empty.confirmationRateValue).toBeNull();
      expect(built.metrics.sensor[category].recall).toBe('0/0');
      expect(built.metrics.sensor[category].recallValue).toBeNull();
      expect(built.metrics.sensor[category].recallUnavailable).toMatch(
        /the catalogue holds no row in this category/,
      );
    }
  });

  it('separates "nothing was catalogued" from "nothing was confirmed"', () => {
    const nothingConfirmed = metrics.sensorBlock({
      category: 'file/creation',
      rows: [
        { oracle: { verdict: metrics.VERDICT.UNCONFIRMED }, sensor: { detectionCategory: 'None' } },
      ],
      observed: [],
      coverage: { measurable: true },
      state: { scored: true, unavailable: null },
      processObservable: null,
    });
    expect(nothingConfirmed.recall).toBe('0/0');
    expect(nothingConfirmed.recallUnavailable).toMatch(
      /all 1 catalogue row\(s\) of this category are unconfirmed/,
    );
  });
});

describe('bench/lib/metrics — M3, a category the configured oracle cannot see', () => {
  const built = score('M3-category-unmeasurable');
  const truth = built.metrics.groundTruth['file/deletion'];
  const sensor = built.metrics.sensor['file/deletion'];

  it('marks the category unmeasurable rather than scoring it zero', () => {
    expect(built.metrics.oracle.coverage['file/deletion'].measurable).toBe(false);
    expect(built.metrics.oracle.coverage['file/deletion'].eventId).toBe(26);
    expect(truth.catalogued).toBe(1);
    expect(truth.confirmed).toBeNull();
    expect(truth.unconfirmed).toBeNull();
    expect(truth.confirmationRate).toBe('unmeasurable — category-unmeasurable');
    expect(truth.confirmationRateValue).toBeNull();
  });

  it('derives no sensor figure from it, even though the sensor observed the event', () => {
    // The row IS in observed.ndjson: the sensor saw the deletion. Nothing
    // independent established that it happened, so no recall and no precision
    // follows — and least of all a 1.
    expect(sensor.observationsInWindow).toBe(1);
    expect(sensor.groundTruth).toBeNull();
    expect(sensor.detected).toBeNull();
    expect(sensor.recallValue).toBeNull();
    expect(sensor.precisionValue).toBeNull();
    expect(sensor.recallUnavailable).toMatch(/does not enable EID 26/);
  });

  it('leaves the categories the same run CAN measure fully scored', () => {
    expect(built.metrics.oracle.coverage['file/creation'].measurable).toBe(true);
    expect(built.metrics.sensor['file/creation'].recall).toBe('1/1');
  });
});

describe('bench/lib/metrics — the vocabulary, and what it refuses to borrow', () => {
  const built = score('M1-fully-confirmed');

  it('uses the ATT&CK Evaluations detection categories and no invented ones', () => {
    expect(built.metrics.vocabulary.source).toMatch(/MITRE ATT&CK Evaluations/);
    expect(built.metrics.vocabulary.detectionCategories).toEqual(['Telemetry', 'None']);
    expect(built.metrics.vocabulary.detectionCategoriesNotUsed).toMatch(/Analytic Coverage tier/);
    expect(metrics.MODIFIERS_FROM_EVALUATIONS).toEqual(['delayed-beyond-bound']);
    expect(metrics.MODIFIERS_BENCH_LOCAL).toEqual([
      'stamped-before-the-expectation',
      'observation-taken-by-a-nearer-expectation',
    ]);
    expect(built.metrics.vocabulary.modifiersBenchLocalReason).toMatch(
      /named locally and marked as local/,
    );
  });

  it('carries no aggregate figure anywhere, and says so', () => {
    expect(built.metrics.vocabulary.noAggregate).toMatch(/no accuracy figure, no F1/);
    const text = metrics.serializeMetrics(built.metrics);
    for (const banned of ['"accuracy"', '"f1"', '"fScore"', '"overall"', '"total"', '"score":']) {
      expect(text.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it('labels a None with the modifier that says which kind of None it is', () => {
    const built10ms = metrics.buildMetrics({
      runId: 'r',
      scenario: 's',
      arm: 'A',
      expected: [
        {
          '@timestamp': '2026-08-20T12:00:00.000Z',
          event: { kind: 'event', category: ['file'], type: ['creation'], action: 'c' },
          file: { path: 'X:\\a\\late.exe' },
          bench: { step: 'late', expect: 'E1' },
        },
      ],
      oracle: [
        {
          '@timestamp': '2026-08-20T12:00:00.001Z',
          event: { kind: 'event', category: ['file'], type: ['creation'], action: 'c' },
          file: { path: 'X:\\a\\late.exe' },
          bench: { eventId: 11 },
        },
      ],
      loss: { collection: { ran: true }, config: { enabledEventIds: [11] } },
      observed: [
        {
          '@timestamp': '2026-08-20T12:05:00.000Z',
          event: { kind: 'event', category: ['file'], type: ['creation'], action: 'c' },
          file: { path: 'X:\\a\\late.exe' },
          bench: {},
        },
      ],
      maxLatency: { value: 30000, source: 'test' },
      ticksWhileProcessAlive: 1,
      inputs: [],
    });
    const row = built10ms.matched[0];
    expect(row.groundTruth).toBe(true);
    expect(row.sensor.detectionCategory).toBe('None');
    expect(row.sensor.modifier).toBe(metrics.DETECTION_MODIFIER.DELAYED);
    expect(row.sensor.reason).toMatch(/The bound produced this None, not the sensor/);
    expect(built10ms.metrics.sensor['file/creation'].recall).toBe('0/1');
  });
});

describe('bench/lib/metrics — the module reaches for nothing', () => {
  it('names no filesystem API in its own source', () => {
    const source = fs.readFileSync(path.join(REPO, 'bench', 'lib', 'metrics.js'), 'utf8');
    // The same gate tests/main/bench/join.test.js puts on join.js: a module that
    // could reach the disk could also reach for a fact it was not handed.
    for (const forbidden of ["require('fs')", 'require("fs")', 'readFileSync', 'writeFileSync']) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('resolves nothing under src/ anywhere in its module graph', () => {
    // Walked from the source rather than off require.cache: the cache holds
    // whatever this whole suite loaded, and the question is what THIS module
    // reaches — the measurement column may not import the thing it measures.
    const graph = new Set();
    const visit = (file) => {
      if (graph.has(file)) return;
      graph.add(file);
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/require\('(\.[^']+)'\)/g)) {
        visit(require.resolve(path.resolve(path.dirname(file), match[1])));
      }
    };
    visit(path.join(REPO, 'bench', 'lib', 'metrics.js'));
    expect([...graph].some((file) => file.includes(`${path.sep}src${path.sep}`))).toBe(false);
    expect([...graph].map((file) => path.basename(file)).sort()).toEqual([
      'join.js',
      'metrics.js',
      'paths.js',
    ]);
  });

  it('has no instant of scoring in its output, and produces the same bytes twice', () => {
    for (const id of MODELS) {
      const first = metrics.serializeMetrics(score(id).metrics);
      expect(metrics.serializeMetrics(score(id).metrics)).toBe(first);
      const matchedFirst = metrics.serializeMatched(score(id).matched);
      expect(metrics.serializeMatched(score(id).matched)).toBe(matchedFirst);
      // Every instant in the output belongs to a row of one of the three columns.
      // A run scored a year from now must produce these same bytes, so no instant
      // may come from the clock: the modelled rows all sit in 2026-08-20.
      const instants = first.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g) || [];
      expect(instants.length).toBeGreaterThan(0);
      for (const instant of instants) expect(instant.startsWith('2026-08-20T')).toBe(true);
    }
  });

  it('renders an empty catalogue as an empty file, never as a line', () => {
    expect(metrics.serializeMatched([])).toBe('');
  });
});
