/**
 * @file tests/main/bench/metrics-mutation.test.js
 * @description The injection proof on the one rule the whole of B2.5 turns on: a
 *   catalogue row the oracle did not confirm is NOT ground truth, and is excluded
 *   from every sensor denominator.
 *
 *   `metrics.test.js` asserts what the module currently answers. That is a
 *   self-report until something proves the assertions can fail: a test whose
 *   expectations happen to hold under both the rule and its absence proves the
 *   command ran, not that it inspected anything (memory-bank/ai-mistakes.md #21,
 *   and #34(d) for the same demand on a contributed test).
 *
 *   So this file BREAKS the rule and requires the numbers to move. It reads
 *   `bench/lib/metrics.js`, asserts its target clause appears exactly once —
 *   a mutant that silently changed nothing would "survive" — replaces
 *   {@link groundTruthRows}'s filter with the identity, writes the result to a
 *   throwaway file with its relative requires rewritten, loads it, and scores the
 *   same derived model through it. The house style is
 *   `scripts/verify-witness-gate.mjs`, which does exactly this to `process-utils.js`.
 *
 *   **Which assertions go red is named, not implied.** The three values checked
 *   below are the ones `metrics.test.js` asserts by hand in
 *   "keeps an unconfirmed row out of the recall denominator, and never calls it a
 *   miss" and "keeps an unconfirmed row the sensor DID see out of the precision
 *   denominator too". Every one of them moves.
 *
 *   The input is `tests/fixtures/bench/derived/M2-unconfirmed-rows`, a hand-written
 *   model. Nothing here is an accuracy figure about the AEGIS sensor.
 */
import fs from 'fs';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import metrics from '../../../bench/lib/metrics.js';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const SOURCE = path.join(REPO, 'bench', 'lib', 'metrics.js');
const MODEL = path.join(REPO, 'tests', 'fixtures', 'bench', 'derived', 'M2-unconfirmed-rows');

/**
 * The one clause that decides whether a catalogue row may be scored against.
 *
 * `find` must match exactly once. A mutant whose target has been refactored away
 * changes nothing and would pass while proving nothing, so a count other than one
 * fails this file by name — fix the mutant, never delete it.
 * @type {{id: string, find: string, replace: string}}
 */
const MUTANT = Object.freeze({
  id: 'ground-truth-is-every-catalogue-row',
  find: '  return rows.filter((row) => row.oracle.verdict === VERDICT.CONFIRMED);',
  replace:
    '  // MUTANT: the oracle-confirmation exclusion removed. Every catalogue row is\n' +
    '  // treated as ground truth, confirmed or not.\n' +
    '  return rows;',
});

/** @type {string} */
let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-bench-metrics-mutant-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/**
 * Read the module, apply one edit, and load the result.
 *
 * The copy leaves `bench/lib/`, so its `require('./x')` specifiers would resolve
 * beside the copy and find nothing. They are rewritten to the REAL modules'
 * absolute paths: the mutation is meant to change one clause of this module, not
 * to swap the two it depends on.
 * @param {{find: string, replace: string}|null} edit - Null loads an unmutated copy.
 * @param {string} name - File name inside the throwaway directory.
 * @returns {Object} The loaded module.
 */
function load(edit, name) {
  // Line endings folded first: .gitattributes puts this tree under `text=auto`,
  // so a checkout can hold CRLF and an LF-only target would never match.
  let code = fs.readFileSync(SOURCE, 'utf8').replace(/\r\n/g, '\n');
  if (edit) {
    const occurrences = code.split(edit.find).length - 1;
    expect(
      occurrences,
      `the mutant target appears ${occurrences} times, not once. bench/lib/metrics.js was ` +
        'refactored — update this mutant instead of deleting it, or it changes nothing and ' +
        '"survives" while proving nothing',
    ).toBe(1);
    code = code.replace(edit.find, edit.replace);
  }
  code = code.replace(/require\('(\.[^']+)'\)/g, (_match, specifier) => {
    const resolved = require.resolve(path.resolve(path.dirname(SOURCE), specifier));
    return `require(${JSON.stringify(resolved)})`;
  });
  const file = path.join(tmp, name);
  fs.writeFileSync(file, code, 'utf8');
  return require(file);
}

/**
 * Score `M2-unconfirmed-rows` through one loaded copy of the module.
 * @param {Object} module - From {@link load}.
 * @returns {Object} The `file/creation` sensor block.
 */
function scoreM2(module) {
  const ndjson = (name) =>
    fs
      .readFileSync(path.join(MODEL, name), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line));
  const json = (name) => JSON.parse(fs.readFileSync(path.join(MODEL, name), 'utf8'));
  const built = module.buildMetrics({
    runId: 'DERIVED-M2-unconfirmed-rows',
    scenario: 'M2-unconfirmed-rows',
    arm: 'A',
    expected: ndjson('expected.ndjson'),
    oracle: ndjson('oracle-sysmon.ndjson'),
    loss: json('oracle-loss.json'),
    observed: ndjson('observed.ndjson'),
    maxLatency: { value: 30000, source: 'test' },
    ticksWhileProcessAlive: 2,
    inputs: [],
  });
  return built.metrics.sensor['file/creation'];
}

describe('bench/lib/metrics — the unconfirmed-row exclusion, injected against', () => {
  it('answers the committed figures when the rule is in place', () => {
    // The shipped module and an unmutated copy of it must agree, or the loader
    // below is measuring the rewrite rather than the mutation.
    const shipped = metrics.groundTruthRows([
      { oracle: { verdict: 'confirmed' } },
      { oracle: { verdict: 'unconfirmed' } },
    ]);
    expect(shipped).toHaveLength(1);

    const control = scoreM2(load(null, 'control.js'));
    expect(control.recall).toBe('1/1');
    expect(control.notDetected).toBe(0);
    expect(control.precisionDenominator).toBe(2);
  });

  it('goes red on every figure the moment the exclusion is removed', () => {
    const mutated = scoreM2(load(MUTANT, `${MUTANT.id}.js`));

    // metrics.test.js asserts recall === '1/1': three rows were catalogued, one is
    // ground truth, and the sensor saw it. Without the exclusion all three become
    // ground truth and the figure is a coverage claim about events nobody
    // established happened.
    expect(mutated.recall).not.toBe('1/1');
    expect(mutated.recall).toBe('2/3');
    expect(mutated.recallValue).not.toBe(1);

    // The failure the rule exists to stop: E2 is unconfirmed AND unobserved, so
    // the mutant charges the sensor with missing an event the bench never
    // established. metrics.test.js asserts notDetected === 0.
    expect(mutated.notDetected).not.toBe(0);
    expect(mutated.notDetected).toBe(1);

    // And the same row's twin on the precision side: E3 is unconfirmed and WAS
    // observed, so the mutant credits the sensor with a true positive against a
    // row that is not ground truth. metrics.test.js asserts a denominator of 2.
    expect(mutated.precisionDenominator).not.toBe(2);
    expect(mutated.precisionDenominator).toBe(3);
    expect(mutated.truePositives).toBe(2);
  });

  it('refuses a mutant whose target is not there, so a no-op cannot pass as a kill', () => {
    expect(() =>
      load({ find: 'return rows.filter((row) => row.thisClauseDoesNotExist);', replace: '' }, 'x.js'),
    ).toThrow(/the mutant target appears 0 times, not once/);
  });
});
