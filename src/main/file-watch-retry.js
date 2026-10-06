'use strict';

const FAST_RETRY_LIMIT = 3;
const RECOVERY_DELAY_MS = 300_000;

/** Keep fast retries bounded, then permit slow probes until coverage recovers.
 * @param {() => number} [now] Monotonic elapsed time, independent of wall-clock changes.
 * @returns {{pollDelayMs: number, canRetry: () => boolean, beginRetry: () => void,
 * finishSetup: () => void, takeExhaustionNotice: () => object|null, reset: () => void}}
 * Retry policy; callers retain watcher ownership and single-flight teardown.
 * @since v0.19.1-beta
 */
function createFileWatchRetryPolicy(now = () => performance.now()) {
  let attempts = 0;
  let recoveryAt = 0;
  let notified = false;
  return {
    pollDelayMs: 30_000,
    canRetry: () => attempts < FAST_RETRY_LIMIT || now() >= recoveryAt,
    beginRetry() {
      attempts = Math.min(FAST_RETRY_LIMIT, attempts + 1);
    },
    finishSetup() {
      if (attempts === FAST_RETRY_LIMIT) recoveryAt = now() + RECOVERY_DELAY_MS;
    },
    takeExhaustionNotice() {
      if (attempts !== FAST_RETRY_LIMIT || notified) return null;
      notified = true;
      return { attempts, recoveryDelayMs: RECOVERY_DELAY_MS };
    },
    reset() {
      attempts = 0;
      recoveryAt = 0;
      notified = false;
    },
  };
}

module.exports = { createFileWatchRetryPolicy };
