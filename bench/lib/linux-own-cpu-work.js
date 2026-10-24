'use strict';
const WORK = Object.freeze({
  version: 'lcg32-fixed/1',
  multiplier: 1664525,
  increment: 1013904223,
  seed: 1,
  iterations: 67108864,
  chunk: 65536,
  budgetNs: '2000000000',
});
/** Run one fixed inert burst with cooperative chunk checks, never a CPU API oracle. @param {Function} now Checked monotonic clock. @param {AbortSignal} [signal] Cancellation. @returns {object} Actual partial/full count and checksum. @since unreleased */
function runFixedWork(now, signal) {
  const result = {
    state: 'partial',
    reason: null,
    completedIterations: 0,
    checksum: WORK.seed,
    beforeNs: null,
    afterNs: null,
  };
  try {
    const start = now();
    result.beforeNs = start.toString();
    while (result.completedIterations < WORK.iterations) {
      if (signal?.aborted) {
        result.reason = 'cancelled';
        break;
      }
      if (now() - start >= BigInt(WORK.budgetNs)) {
        result.reason = 'work-budget';
        break;
      }
      for (let i = 0; i < WORK.chunk; i++)
        result.checksum = (Math.imul(WORK.multiplier, result.checksum) + WORK.increment) >>> 0;
      result.completedIterations += WORK.chunk;
    }
    result.afterNs = now().toString();
    if (result.completedIterations === WORK.iterations) {
      result.state = 'completed';
      result.reason = null;
    }
  } catch {
    result.reason = 'clock-unavailable';
  }
  return result;
}
module.exports = { WORK, runFixedWork };
