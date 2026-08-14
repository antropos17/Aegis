/**
 * @file bench/lib/report.js
 * @module bench/lib/report
 * @description The two report-shaping steps that are the same whether a report
 *   comes from a live run or from a recorded one: the join bound derived from the
 *   scan interval that run used, and the summary the report is said out loud with.
 *
 *   It exists so that `bench/run.js` and `bench/replay.js` share one definition of
 *   the bound instead of two that can drift, and so that replay can have it
 *   **without loading the live-run graph**. Requiring `run.js` for these two
 *   functions would pull the actor, the sensor, the catalogue writer and ajv into
 *   a process that must only ever read four files out of one directory — inert at
 *   load time, but a replay whose module graph can reach the sensor is one nobody
 *   can prove did not.
 *
 *   The only import here is `./join`, which reads and writes nothing. Nothing in
 *   this module touches the filesystem, the clock, the environment or `src/`.
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.11.0
 */
'use strict';

const join = require('./join');

/**
 * How many scan intervals a sensor is given to report something before the join
 * stops calling it that expectation's observation.
 *
 * Three, and not fewer, because AEGIS reports a process end only after
 * `session-tracker.js`'s grace of two consecutive scans that missed the process:
 * the floor for `process/end` is already two intervals plus the scan that
 * concludes it. It is not generous — a `process/end` that lands past the bound
 * produces a miss that is a property of the window, which is why every miss in
 * the report names its nearest candidate and the distance to it.
 * @type {number}
 */
const MAX_LATENCY_INTERVALS = 3;

/**
 * The join bound, from the interval — {@link MAX_LATENCY_INTERVALS} of them.
 * @param {{value: number|null, source: string, unavailable?: string}} scanInterval
 * @returns {{value: number|null, source: string, unavailable?: string}} Milliseconds.
 */
function maxLatencyFrom(scanInterval) {
  if (scanInterval.value === null) {
    return {
      value: null,
      source: scanInterval.source,
      unavailable:
        `the scan interval this run used could not be established — ${scanInterval.unavailable}. ` +
        'A join window is derived from the run or it is absent; it is never defaulted, because ' +
        'every recall figure in the report is a statement about that window',
    };
  }
  return {
    value: scanInterval.value * MAX_LATENCY_INTERVALS * 1000,
    source: `${scanInterval.value} s × ${MAX_LATENCY_INTERVALS} scan intervals — ${scanInterval.source}`,
  };
}

/**
 * Say the report out loud: one line per category, and the two facts that decide
 * whether its numbers may be read as coverage at all.
 * @param {Object} report - From `join.buildReport()`.
 * @returns {void}
 */
function reportJoin(report) {
  const bound = report.join.maxLatencyMs;
  console.log(
    `\njoin    [expected, expected + ${bound === null ? 'ABSENT' : `${bound} ms`}] — ` +
      report.join.maxLatencySource,
  );
  for (const category of join.CATEGORIES) {
    const block = report.categories[category];
    const latency =
      block.latencyMs.p50 === null ? 'no latency point' : `p50 ${block.latencyMs.p50} ms`;
    console.log(`report  ${category.padEnd(14)} ${block.recall.padEnd(34)} ${latency}`);
  }
  if (report.processObservable === false) {
    console.log(
      'report  processObservable false — no scan tick fell inside the process lifetime, so the ' +
        'process categories name a structural gap, not a coverage result',
    );
  }
  console.log(
    report.unmatchedObserved.length === 0
      ? 'report  every observed event cancelled an expectation'
      : `report  ${report.unmatchedObserved.length} observed event(s) cancelled no expectation — ` +
          'listed in the report, where they are signal rather than debris',
  );
  if (report.join.unavailable) console.error(`\nbench: ${report.join.unavailable}`);
}

module.exports = {
  MAX_LATENCY_INTERVALS,
  maxLatencyFrom,
  reportJoin,
};
