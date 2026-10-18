/** @file Bounded ETW observation retention and synchronous wall-time measurements. */
'use strict';
const KEYS = ['decodeChunk', 'acceptFrame', 'retainBatch', 'snapshot'];

/** Own one session's diagnostic ring and nested timing counters.
 * @param {Function} clock - Monotonic nanosecond clock, separate from lifecycle deadlines.
 * @returns {Object} Retention, copied snapshots and synchronous measurement methods.
 * @since v0.14.2
 */
function createDiagnostics(clock = process.hrtime.bigint) {
  let ring = [],
    bytes = 0,
    dropped = 0;
  const times = Object.fromEntries(
    KEYS.map((key) => [
      key,
      {
        calls: 0n,
        totalTicks: 0n,
        maxTicks: 0n,
        failed: 0n,
      },
    ]),
  );
  function measure(key, callback) {
    if (!Object.hasOwn(times, key)) throw new Error('etw-file:invalid-timing-key');
    const start = clock();
    let success = false;
    try {
      const value = callback();
      success = true;
      return value;
    } finally {
      const elapsed = clock() - start;
      // A regressing injected monotonic clock invalidates even a failed measurement.
      // eslint-disable-next-line no-unsafe-finally
      if (elapsed < 0n) throw new Error('etw-file:timing-clock-regressed');
      const metric = times[key];
      metric.calls++;
      metric.totalTicks += elapsed;
      if (elapsed > metric.maxTicks) metric.maxTicks = elapsed;
      if (!success) metric.failed++;
    }
  }
  function performance() {
    return {
      frequency: '1000000000',
      asOfQpc: clock().toString(),
      ...Object.fromEntries(
        KEYS.map((key) => [
          key,
          Object.fromEntries(
            Object.entries(times[key]).map(([field, value]) => [field, value.toString()]),
          ),
        ]),
      ),
    };
  }
  return {
    measure,
    performance,
    clear() {
      ring = [];
      bytes = 0;
    },
    retain(records) {
      measure('retainBatch', () => {
        for (const record of records) {
          const copy = structuredClone(record);
          const cost =
            1024 + Buffer.byteLength(JSON.stringify(copy)) + (copy.path?.length || 0) * 2;
          while (ring.length && (ring.length >= 256 || bytes + cost > 1024 * 1024)) {
            bytes -= ring.shift().bytes;
            dropped++;
          }
          ring.push({ record: copy, bytes: cost });
          bytes += cost;
        }
      });
    },
    get dropped() {
      return dropped;
    },
    snapshot() {
      return {
        records: ring.map((v) => structuredClone(v.record)),
        ringBytes: bytes,
        ringDropped: dropped,
        mainPerformance: performance(),
      };
    },
  };
}
/** Retain terminal accounting without treating recovered cleanup as a successful capture.
 * @param {Object} state Session reducer state.
 * @param {Object} options capture, diagnostics, stopReason, code and endedAt.
 * @returns {Object} Bounded ended-session summary. @since v0.19.2
 */
function createSummary(state, { capture, diagnostics, stopReason, code, endedAt }) {
  const recoveryVerified =
    state.phase === 'recovered' && code === 4 && state.recovery?.absent === true;
  return {
    launchId: state.launchId,
    sessionId: state.sessionId,
    endedAt,
    phase: state.phase,
    reasons: [...state.reasons],
    maxima: { ...state.maxima },
    capture,
    finalCounters: structuredClone(state.recovery?.counters ?? state.latest?.counters ?? null),
    finalTotals: state.recovery ? null : structuredClone(state.latest?.totals ?? null),
    ringDropped: diagnostics.dropped,
    collectorPerformance: structuredClone(state.latest?.performance ?? null),
    mainPerformance: diagnostics.performance(),
    stopReason,
    exitCode: code,
    stopVerified: state.phase === 'stopped' && code === 0,
    recoveryVerified,
    observationGap: state.recovery?.observationGap === true,
    collectorExit: state.recovery?.collectorExit ?? null,
  };
}
module.exports = { createDiagnostics, createSummary };
