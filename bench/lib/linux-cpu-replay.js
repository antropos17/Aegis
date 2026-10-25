'use strict';
const c = require('./linux-cpu-replay-common');
const io = require('./linux-cpu-replay-io');
const packets = require('./linux-cpu-replay-packets');
const { reconcile } = require('./linux-cpu-replay-bindings');
const N = Object.keys(c.FILES);
/** Inspect fixed five-file CPU evidence and replay current arithmetic offline. No capture or supplied code executes.
 * @param {object} options Closed input and fresh out paths.
 * @returns {Promise<object>} Fixed exitCode and safe deterministic report, publication status requiring the module result.
 * @since unreleased
 */
async function replayLinuxCpu(options) {
  let o;
  try {
    o = io.options(options);
  } catch {
    return { exitCode: 2, report: null };
  }
  try {
    io.fresh(o.out);
  } catch {
    return { exitCode: 5, report: null };
  }
  const report = {
    version: 'linux-cpu-replay/1',
    scope: 'offline-linux-self-cpu-bundle',
    state: 'incomplete',
    reason: 'missing-artifacts',
    runId: null,
    inputs: [],
    missing: [],
    recorded: null,
    replay: {
      state: 'not-present',
      comparison: null,
      producerComparison: null,
      producerClockOverride: 'none',
    },
    current: {
      nodeVersion: process.version,
      sourcesBefore: null,
      sourcesAfter: null,
      state: 'unavailable',
      historicalModel: null,
      historicalModelComparison: 'not-available',
    },
    originalFinalPublication: 'unknown',
    finalPublication: 'not-self-attested',
    ...c.FLAGS,
  };
  let b,
    code = 3,
    before,
    currentAvailable = false,
    invalid = false;
  try {
    b = io.bundle(o.input);
    report.inputs = N.map((file) =>
      b[file]
        ? { file, byteLength: b[file].byteLength, sha256: b[file].sha256, closed: true }
        : { file, missing: true },
    );
    report.missing = N.filter((n) => !b[n]);
    const validators = [packets.plan, packets.pending, packets.raw, packets.windows, packets.final];
    N.forEach((n, i) => {
      if (b[n]) validators[i](b[n].value);
    });
    report.recorded = reconcile(b);
    report.runId = report.recorded.runId;
  } catch {
    invalid = true;
    code = 4;
    report.state = 'refused';
    report.reason = 'bundle-refused';
  }
  try {
    before = io.inventory();
    report.current.sourcesBefore = before;
    currentAvailable = true;
  } catch {
    /* Current code identity is separately unavailable. */
  }
  if (!invalid && b) {
    const plan = b[N[0]]?.value,
      w = b[N[3]]?.value,
      f = b[N[4]]?.value;
    const historical = (plan?.sources ?? f?.sources.after)?.files.find(
      (x) => x.file === 'bench/lib/linux-own-cpu-model.js',
    );
    if (historical) {
      report.current.historicalModel = {
        ...historical,
        nodeVersion: (plan?.sources ?? f?.sources.after).nodeVersion,
        basis: plan ? 'recorded-plan-declaration' : 'recorded-final-after-declaration',
      };
      if (before) {
        const actual = before.files.find((x) => x.file === historical.file);
        report.current.historicalModelComparison =
          historical.sha256 === actual.sha256 && historical.byteLength === actual.byteLength
            ? 'match'
            : 'different';
      }
    }
    if (w && currentAvailable) {
      let result, model;
      try {
        model = require('./linux-own-cpu-model');
      } catch {
        currentAvailable = false;
      }
      if (model)
        try {
          result = model.evaluateCpuReference({
            clockTicksPerSecond: w.clockTicksPerSecond,
            windows: w.windows,
          });
        } catch {
          code = 4;
          invalid = true;
          report.state = 'refused';
          report.reason = 'reference-shape-refused';
        }
      if (result) {
        // The producer can latch a clock failure after the final normalized API window.
        // Keep pure arithmetic intact; only the expected recorded projection changes state/reason.
        const raw = b[N[2]]?.value;
        const clockEvidence =
          w.windows.some((row) => row.reason === 'clock-regressed') ||
          w.workload.reason === 'clock-unavailable' ||
          ['clock-regressed', 'clock-unavailable'].includes(raw?.clock.reason) ||
          ['clock-regressed', 'clock-unavailable'].includes(f?.acquisition?.stopReason);
        const clockRefusal =
          !c.equal(result, w.comparison) &&
          w.comparison.state === 'refused' &&
          w.comparison.reason === 'clock-regressed' &&
          clockEvidence;
        const producerComparison = clockRefusal
          ? { ...result, state: 'refused', reason: 'clock-regressed' }
          : result;
        report.replay = {
          state: c.equal(producerComparison, w.comparison) ? 'equal' : 'different',
          comparison: result,
          producerComparison,
          producerClockOverride: clockRefusal ? 'compatible-recorded-clock-regression' : 'none',
        };
        if (report.replay.state === 'different') {
          code = 4;
          invalid = true;
          report.state = 'refused';
          report.reason = 'comparison-mismatch';
        }
      }
    }
    if (!invalid) {
      const full =
        !report.missing.length &&
        f?.state === 'consistent-under-declared-model' &&
        report.replay.state === 'equal';
      code = full ? 0 : 3;
      report.state = full ? 'consistent-for-conditional-replay' : 'incomplete-or-recorded-nonpass';
      report.reason = full
        ? null
        : report.missing.length
          ? 'missing-artifacts'
          : 'recorded-nonpass';
    }
  }
  try {
    const after = io.inventory();
    report.current.sourcesAfter = after;
    report.current.state =
      before && c.equal(before, after) ? 'unchanged' : before ? 'changed' : 'unavailable';
  } catch {
    report.current.state = 'unavailable';
  }
  if (!invalid && (!currentAvailable || report.current.state !== 'unchanged')) {
    code = 7;
    report.state = 'replay-unavailable';
    report.reason = 'current-implementation-unavailable';
  }
  try {
    io.publish(o.out, report);
  } catch (error) {
    return { exitCode: error.message === 'linux-cpu-replay-output-refused' ? 5 : 6, report };
  }
  return { exitCode: code, report };
}
module.exports = { replayLinuxCpu };
