/**
 * @file tests/main/bench/derived-pid-reuse.test.js
 * @description The gate on `tests/fixtures/bench/derived/D1-pid-reuse-same-ms/` — a
 *   DERIVED replay model, not a recorded run, of the residual PID-reuse bound.
 *
 *   What it pins is one information bound and its honesty conditions:
 *
 *   - `bench/lib/join.js` joins a process expectation on `process.pid` alone, because
 *     pid is the only process join key the audit persists. `bench.instanceId` rides
 *     along as evidence and is never a key.
 *   - Two modelled generations that share a pid AND a stored birth millisecond share
 *     one `instanceId` — the `"<pid>:<epochMs>"` format of `src/main/process-identity.js`
 *     — while a generation witness finer than that millisecond still separates them.
 *   - So a pid-only replay can report 2 expected / 2 matched / recall 1 while every
 *     pair it chose crosses a generation boundary. Perfect recall over a pid is not
 *     an answer to a generation-identity question, and this file is the proof that
 *     it is not.
 *
 *   The generation labels live ONLY in the fixture, under `bench.fixture*` names
 *   nothing in AEGIS persists. The report is asserted to carry none of them: the
 *   point is to characterise what the current persisted information can establish,
 *   so a join taught to read a fixture label would dissolve the very bound under
 *   test.
 *
 *   Windows PID reuse inside one millisecond was NOT reproduced here, and cannot be
 *   forced deterministically. Nothing in this file is an accuracy measurement, a
 *   collision rate, or a statement about the sensor. See the fixture's own
 *   `tests/fixtures/bench/derived/README.md`.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import join from '../../../bench/lib/join.js';
import replay from '../../../bench/replay.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const REPLAY_SOURCE = path.join(REPO, 'bench', 'replay.js');

/** @type {string} The derived model — written by hand, never executed. */
const DERIVED = path.join(REPO, 'tests', 'fixtures', 'bench', 'derived', 'D1-pid-reuse-same-ms');

/** @type {string} The recordings, which this case is deliberately not one of. */
const RUNS = path.join(REPO, 'tests', 'fixtures', 'bench', 'runs');

/**
 * The two run directories `tests/main/bench/fixture-immutability.test.js` holds
 * against committed sha256 digests. Listed here as ids only — the digests stay in
 * that file, so there is one place a recorded byte is pinned and not two.
 * @type {ReadonlyArray<string>}
 */
const RECORDED_RUN_IDS = Object.freeze([
  '2026-08-13T17-11-03Z-S1-agent-lifecycle-A',
  '2026-08-13T19-26-29Z-S1-agent-lifecycle-A',
]);

/**
 * Milliseconds between the FILETIME epoch (1601-01-01) and the Unix epoch.
 *
 * Re-declared rather than imported from `src/main/platform/process-snapshot.js`,
 * for the reason `bench/lib/observed.js` re-implements the audit chain: a bench
 * test that imports the module it is characterising cannot find a disagreement
 * with it. The rule being re-derived is `ticksToEpochMs`
 * (`src/main/platform/process-snapshot.js:89`), which FLOORS 100 ns ticks to the
 * epoch-ms `instanceId` is built from.
 * @type {bigint}
 */
const FILETIME_EPOCH_OFFSET_MS = 11644473600000n;

/** @type {string} Scratch directory, made fresh per test. */
let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-bench-derived-test-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/**
 * Call `replay.main` with the console captured.
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
 * Replay the derived case into the scratch directory. `--out` keeps the input
 * evidence and the derived output apart: nothing is ever written into the fixture.
 * @param {string} [label] - File name for the output.
 * @returns {{code: number, out: string, err: string, file: string}}
 */
function rebuildTo(label = 'report.json') {
  const file = path.join(tmp, label);
  return { ...main([DERIVED, '--out', file]), file };
}

/**
 * The report this replay builds from the derived case.
 * @returns {Object}
 */
function buildReport() {
  const rebuilt = rebuildTo();
  expect(rebuilt.code).toBe(0);
  return JSON.parse(fs.readFileSync(rebuilt.file, 'utf8'));
}

/**
 * One of the fixture's NDJSON sides, parsed in file order — the order the report's
 * `index` fields count in.
 * @param {string} name - `expected.ndjson` or `observed.ndjson`.
 * @returns {Object[]}
 */
function fixtureRows(name) {
  return fs
    .readFileSync(path.join(DERIVED, name), 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

describe('derived D1 — the input is a model in the four-file shape replay reads', () => {
  it('is exactly the four files replay reads, and ships no run-report.json', () => {
    expect(fs.readdirSync(DERIVED).sort()).toEqual(Object.keys(replay.REQUIRED_FILES).sort());
    expect(fs.existsSync(path.join(DERIVED, join.REPORT_FILENAME))).toBe(false);
  });

  it('labels itself DERIVED in both JSON files, and says what was not reproduced', () => {
    for (const name of [replay.MANIFEST_FILENAME, replay.META_FILENAME]) {
      const file = JSON.parse(fs.readFileSync(path.join(DERIVED, name), 'utf8'));
      expect(file.derived.kind).toBe('derived-model');
      expect(file.derived.recorded).toBe(false);
      expect(file.derived.notReproduced).toMatch(/PID reuse inside one millisecond was NOT/);
      expect(file.arm).toBe('DERIVED');
      expect(file.runId).toBe('DERIVED-D1-pid-reuse-same-ms');
    }
  });

  it('labels every row of both sides as modelled', () => {
    for (const row of fixtureRows(replay.CATALOGUE_FILENAME)) {
      expect(row.bench.fixtureKind).toBe('derived-model');
    }
    for (const row of fixtureRows(replay.OBSERVED_FILENAME)) {
      // `source` is the field a capture writes ("aegis-audit"), so the observed
      // side says it where a reader already looks for it.
      expect(row.bench.source).toBe('derived-model');
    }
  });

  it('carries no audit provenance, because no audit record was ever read', () => {
    for (const row of fixtureRows(replay.OBSERVED_FILENAME)) {
      expect(row.bench.auditFile).toBeUndefined();
      expect(row.bench.auditSeq).toBeUndefined();
      expect(row.bench.auditType).toBeUndefined();
    }
    for (const pair of buildReport().matched) {
      expect(pair.observed.auditFile).toBeNull();
      expect(pair.observed.auditSeq).toBeNull();
      expect(pair.observed.auditType).toBeNull();
    }
  });
});

describe('derived D1 — replay of the derived case', () => {
  it('succeeds, and produces the same bytes twice', () => {
    const first = rebuildTo('first.json');
    const second = rebuildTo('second.json');

    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    expect(fs.readFileSync(first.file).equals(fs.readFileSync(second.file))).toBe(true);
  });

  it('produces the same bytes from a separate process invocation', () => {
    const here = rebuildTo('here.json');
    const there = path.join(tmp, 'there.json');
    execFileSync(process.execPath, [REPLAY_SOURCE, DERIVED, '--out', there], { encoding: 'utf8' });

    expect(fs.readFileSync(there).equals(fs.readFileSync(here.file))).toBe(true);
  });

  it('writes nothing into the fixture', () => {
    const before = fs.readdirSync(DERIVED).sort();
    rebuildTo();
    expect(fs.readdirSync(DERIVED).sort()).toEqual(before);
  });
});

describe('derived D1 — a pid-only report reads as perfect recall', () => {
  it('reports 2 expected, 2 matched, recall 1 for process/start', () => {
    const block = buildReport().categories['process/start'];

    expect(block.expected).toBe(2);
    expect(block.matched).toBe(2);
    expect(block.missed).toBe(0);
    expect(block.recall).toBe('2/2');
    expect(block.recallValue).toBe(1);
  });

  it('leaves nothing missed and nothing unmatched to hint at the crossing', () => {
    const report = buildReport();

    expect(report.missed).toEqual([]);
    expect(report.unmatchedObserved).toEqual([]);
    expect(report.processObservable).toBe(true);
  });

  it('states its real join key as process.pid, and joins on nothing else', () => {
    const report = buildReport();

    expect(report.join.keys['process/start']).toBe('process.pid');
    expect(report.join.keys['process/end']).toBe('process.pid');
    expect(report.join.keys).toEqual(join.JOIN_KEYS);
    for (const pair of report.matched) {
      expect(pair.key).toBe('pid:4242');
    }
  });
});

describe('derived D1 — the pairs the pid-only join chose cross the generations', () => {
  /**
   * The report's own `expected.index → observed.index` mapping, walked back into
   * the fixture rows and labelled from them.
   *
   * The `@timestamp` on each side is checked against the fixture row it claims, so
   * the mapping is proven rather than assumed: an index that pointed at a different
   * row would fail here instead of quietly relabelling a pair.
   * @param {Object} report
   * @returns {Array<{expectedIndex: number, observedIndex: number, expectedGeneration: string,
   *   observedGeneration: string}>}
   */
  function labelledPairs(report) {
    const expectedRows = fixtureRows(replay.CATALOGUE_FILENAME);
    const observedRows = fixtureRows(replay.OBSERVED_FILENAME);
    return report.matched.map((pair) => {
      const e = expectedRows[pair.expected.index];
      const o = observedRows[pair.observed.index];
      expect(e['@timestamp']).toBe(pair.expected['@timestamp']);
      expect(o['@timestamp']).toBe(pair.observed['@timestamp']);
      return {
        expectedIndex: pair.expected.index,
        observedIndex: pair.observed.index,
        expectedGeneration: e.bench.fixtureGeneration,
        observedGeneration: o.bench.fixtureGeneration,
      };
    });
  }

  it('pairs expectation 0 with observation 0 and expectation 1 with observation 1', () => {
    expect(buildReport().matched.map((p) => [p.expected.index, p.observed.index])).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it('and every one of those pairs is generation A against generation B', () => {
    const pairs = labelledPairs(buildReport());

    expect(pairs).toEqual([
      { expectedIndex: 0, observedIndex: 0, expectedGeneration: 'A', observedGeneration: 'B' },
      { expectedIndex: 1, observedIndex: 1, expectedGeneration: 'B', observedGeneration: 'A' },
    ]);
    for (const pair of pairs) {
      expect(pair.expectedGeneration).not.toBe(pair.observedGeneration);
    }
  });

  it('carries no generation label of its own — the join was not taught the answer', () => {
    const serialized = JSON.stringify(buildReport());

    expect(serialized).not.toMatch(/fixtureGeneration/);
    expect(serialized).not.toMatch(/fixtureWitness/);
    expect(serialized).not.toMatch(/fixtureStartTimeMs/);
  });
});

describe('derived D1 — one instanceId, two generation witnesses', () => {
  it('models both generations onto one pid and one birth millisecond', () => {
    const [a, b] = fixtureRows(replay.CATALOGUE_FILENAME);

    expect(a.process.pid).toBe(4242);
    expect(b.process.pid).toBe(a.process.pid);
    expect(a.bench.fixtureStartTimeMs).toBe(1717000000000);
    expect(b.bench.fixtureStartTimeMs).toBe(a.bench.fixtureStartTimeMs);
  });

  it('gives them one identical instanceId, in the format process-identity.js builds', () => {
    const expectedRows = fixtureRows(replay.CATALOGUE_FILENAME);
    const observedRows = fixtureRows(replay.OBSERVED_FILENAME);
    // Derived from the fixture's own pid and birth millisecond rather than typed
    // in, so the two can never drift apart inside one file. The format itself is
    // `${pid}:${startTime}` — src/main/process-identity.js:137, unchanged here.
    const modelled = `${expectedRows[0].process.pid}:${expectedRows[0].bench.fixtureStartTimeMs}`;

    expect(modelled).toBe('4242:1717000000000');
    for (const row of expectedRows) expect(row.bench.fixtureInstanceId).toBe(modelled);
    for (const row of observedRows) expect(row.bench.instanceId).toBe(modelled);
    for (const pair of buildReport().matched) expect(pair.observed.instanceId).toBe(modelled);
  });

  it('gives them DIFFERENT witnesses, finer than the millisecond they both floor to', () => {
    const rows = fixtureRows(replay.CATALOGUE_FILENAME);
    const witnesses = rows.map((row) => row.bench.fixtureWitness);

    expect(witnesses[0]).not.toBe(witnesses[1]);
    for (const [i, witness] of witnesses.entries()) {
      expect(witness).toMatch(/^\d+$/);
      expect(rows[i].bench.fixtureWitnessSource).toBe('createTime100ns');
      // The production floor, re-derived: 100 ns ticks → epoch ms. Both witnesses
      // land on the one millisecond the shared instanceId is built from, which is
      // the whole resolution mismatch being modelled.
      const flooredMs = Number(BigInt(witness) / 10000n - FILETIME_EPOCH_OFFSET_MS);
      expect(flooredMs).toBe(rows[i].bench.fixtureStartTimeMs);
    }
    // Distinct, and by less than the millisecond that erases the distinction.
    const apartMs = Number(BigInt(witnesses[1]) - BigInt(witnesses[0])) / 10000;
    expect(apartMs).toBeGreaterThan(0);
    expect(apartMs).toBeLessThan(1);
  });

  it('carries the same witnesses on the observed side, so the pairing is checkable there too', () => {
    const expectedRows = fixtureRows(replay.CATALOGUE_FILENAME);
    const observedRows = fixtureRows(replay.OBSERVED_FILENAME);
    const witnessOf = (rows, generation) =>
      rows.find((row) => row.bench.fixtureGeneration === generation).bench.fixtureWitness;

    for (const generation of ['A', 'B']) {
      expect(witnessOf(observedRows, generation)).toBe(witnessOf(expectedRows, generation));
    }
  });
});

describe('derived D1 — outside the historical-recording immutability contract', () => {
  it('does not live under tests/fixtures/bench/runs/', () => {
    expect(path.resolve(DERIVED).startsWith(path.resolve(RUNS))).toBe(false);
    expect(path.basename(path.dirname(DERIVED))).toBe('derived');
  });

  it('leaves runs/ holding exactly the two recorded run directories', () => {
    // The bytes of those two runs are pinned by committed sha256 digests in
    // tests/main/bench/fixture-immutability.test.js. What is pinned HERE is that
    // the derived case did not join them: a model dropped into runs/ would be
    // covered by a contract that says "recording", and would be one.
    expect(fs.readdirSync(RUNS).sort()).toEqual([...RECORDED_RUN_IDS].sort());
    for (const runId of RECORDED_RUN_IDS) {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(RUNS, runId, replay.MANIFEST_FILENAME), 'utf8'),
      );
      expect(manifest.derived).toBeUndefined();
      expect(manifest.arm).toBe('A');
      expect(manifest.runId).toBe(runId);
    }
  });
});
