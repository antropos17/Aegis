'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');

/** Aggregate numeric timings only; never retain arguments, results or exceptions.
 * @param {() => number} now - Monotonic milliseconds.
 * @param {number} [warmupMs] - Startup window.
 * @param {number} [sampleLimit] - Maximum retained durations per stage and phase.
 * @returns {Object} Timing wrappers, recorder, snapshot and current stage.
 * @since 0.15.0
 */
function createMetrics(now, warmupMs = 90000, sampleLimit = 4096) {
  const start = now();
  const entries = new Map();
  const context = new AsyncLocalStorage();
  function record(label, started, failed = false) {
    const phase = started - start < warmupMs ? 'startup' : 'steady';
    const key = `${phase}:${label}`;
    let row = entries.get(key);
    if (!row) {
      row = { phase, label, calls: 0, failures: 0, totalMs: 0, maxMs: 0, samples: [] };
      entries.set(key, row);
    }
    const duration = Math.max(0, now() - started);
    row.calls++;
    row.failures += Number(failed);
    row.totalMs += duration;
    row.maxMs = Math.max(row.maxMs, duration);
    if (row.samples.length < sampleLimit) row.samples.push(duration);
  }
  function wrap(label, fn) {
    return function (...args) {
      const started = now();
      try {
        const result = context.run(label, () => fn.apply(this, args));
        if (result && typeof result.then === 'function') {
          result.then(
            () => record(label, started),
            () => record(label, started, true),
          );
        } else record(label, started);
        return result;
      } catch (error) {
        record(label, started, true);
        throw error;
      }
    };
  }
  function snapshot() {
    return [...entries.values()].map(({ samples, ...row }) => {
      const sorted = [...samples].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return {
        ...row,
        medianMs: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
        p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
        sampled: sorted.length,
        truncated: row.calls > sorted.length,
      };
    });
  }
  return { wrap, record, snapshot, current: () => context.getStore() || 'startup-or-unwrapped' };
}

module.exports = { createMetrics };
