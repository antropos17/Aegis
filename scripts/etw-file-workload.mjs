import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const phases = [];
for (let repeat = 1; repeat <= 3; repeat++) {
  phases.push(
    Object.freeze({ repeat, kind: 'paced', operations: 2000, rate: 1000, batch: 25 }),
    Object.freeze({ repeat, kind: 'burst', operations: 20000, rate: null, batch: 250 }),
  );
}
export const LOAD_PROFILE = Object.freeze({
  id: 'repeated-read-4k-v1',
  handlePolicy: 'one-open-per-phase',
  bytesPerRead: 4096,
  settleMs: 2000,
  timeoutMs: 90000,
  phases: Object.freeze(phases),
});

/** Execute a finite read phase using one handle to the caller's disposable fixture.
 * Pacing never catches up missed batches. No cache flush or direct I/O is requested.
 * @param {string} file - Existing fixture containing exactly 4096 bytes of value 7.
 * @param {Object} phase - Bounded operation count and pacing parameters.
 * @returns {Promise<Object>} Completed logical reads and measured wall-clock duration.
 * @since v0.14.2
 */
export async function runReadPhase(file, phase) {
  const { operations, rate, batch } = phase;
  if (
    !Number.isSafeInteger(operations) ||
    operations < 1 ||
    operations > 20000 ||
    !Number.isSafeInteger(batch) ||
    batch < 1 ||
    batch > 250 ||
    (rate !== null && (!Number.isSafeInteger(rate) || rate < 1 || rate > 1000))
  )
    throw new Error('workload-invalid-phase');
  const buffer = Buffer.alloc(LOAD_PROFILE.bytesPerRead);
  const expected = Buffer.alloc(LOAD_PROFILE.bytesPerRead, 7);
  const started = performance.now();
  let completed = 0;
  let maxBatchLatenessMs = 0;
  let nextBatchAt = started;
  const fd = fs.openSync(file, 'r');
  try {
    while (completed < operations) {
      if (rate !== null) {
        // Timers may wake early; do not start the next batch before its deadline.
        while (performance.now() < nextBatchAt) await delay(nextBatchAt - performance.now());
      }
      const batchStarted = performance.now();
      if (rate !== null)
        maxBatchLatenessMs = Math.max(maxBatchLatenessMs, batchStarted - nextBatchAt);
      const count = Math.min(batch, operations - completed);
      for (let index = 0; index < count; index++) {
        const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
        if (bytes !== buffer.length || !buffer.equals(expected))
          throw new Error('workload-fixture-mismatch');
        completed++;
      }
      if (rate !== null) nextBatchAt = batchStarted + (count * 1000) / rate;
    }
    if (rate !== null) {
      while (performance.now() < nextBatchAt) await delay(nextBatchAt - performance.now());
    }
  } finally {
    fs.closeSync(fd);
  }
  const durationMs = performance.now() - started;
  return {
    ...phase,
    completed,
    bytesRead: completed * buffer.length,
    durationMs,
    achievedOperationsPerSecond: (completed * 1000) / durationMs,
    maxBatchLatenessMs: rate === null ? null : maxBatchLatenessMs,
  };
}
