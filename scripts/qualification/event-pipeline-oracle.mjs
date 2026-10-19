import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

export const SENSORS = ['file-watch', 'file-handle', 'process', 'network', 'other'];
const TYPES = ['file-access', 'config-access', 'agent-enter', 'network-connection'];

/** Produce bounded synthetic metadata without opening any watched file.
 * @param {number} index Zero-based offered sequence.
 * @param {number} epoch Synthetic wall-clock anchor.
 * @param {number} rate Requested events per second.
 * @returns {object} Input for the production security batcher.
 * @since 0.19.2
 */
export function fixtureEvent(index, epoch, rate) {
  return {
    sensor: SENSORS[index % SENSORS.length],
    type: TYPES[index % TYPES.length],
    timestamp: epoch + Math.floor(index * 1000 / rate),
    details: {
      pid: index + 1,
      agent: 'Synthetic qualification',
      instanceId: `${index + 1}:${epoch}`,
      action: 'fixture',
      path: `/aegis-fixture/.ssh/key-${index % 7}`,
      severity: 'high',
    },
  };
}

/** Independent delivery oracle. Its retained storage is one bit per offered ID.
 * @param {number} expected Exact offered record count.
 * @param {number} epoch Synthetic wall-clock anchor.
 * @param {number} rate Requested events per second.
 * @returns {object} accept/assertComplete/snapshot operations.
 * @since 0.19.2
 */
export function createOracle(expected, epoch, rate) {
  assert.ok(Number.isSafeInteger(expected) && expected > 0 && expected <= 600_000);
  const seen = new Uint8Array(Math.ceil(expected / 8));
  const counters = { delivered: 0, replayed: 0, lossMarkers: 0, declaredLost: 0 };
  const bySensor = Object.fromEntries(SENSORS.map((id) => [id, 0]));
  return {
    accept(records) {
      assert.ok(Array.isArray(records) && records.length <= 16_384, 'bounded-consumer-batch');
      for (const record of records) {
        if (record.type === 'pipeline-loss') {
          counters.lossMarkers++;
          assert.ok(Number.isSafeInteger(record.details.extra.count), 'loss-count-required');
          counters.declaredLost += record.details.extra.count;
          continue;
        }
        const index = record.details.pid - 1;
        assert.ok(Number.isSafeInteger(index) && index >= 0 && index < expected, 'foreign-delivery');
        assert.equal(seen[index >> 3] & (1 << (index & 7)), 0, 'duplicate-delivery');
        assert.equal(index, counters.delivered, 'global-delivery-order');
        assert.equal(record.sensor, SENSORS[index % 5], 'sensor-preserved');
        assert.equal(record.type, TYPES[index % 4], 'type-preserved');
        assert.equal(record.timestamp, epoch + Math.floor(index * 1000 / rate), 'timestamp-preserved');
        assert.equal(record.details.path, `/aegis-fixture/.ssh/key-${index % 7}`, 'path-preserved');
        assert.equal(record.details.instanceId, `${index + 1}:${epoch}`, 'identity-preserved');
        assert.match(record.deliveryId, /^[a-f0-9-]{36}$/, 'delivery-id-present');
        seen[index >> 3] |= 1 << (index & 7);
        counters.delivered++;
        bySensor[record.sensor]++;
        if (record.replayed === true) counters.replayed++;
      }
    },
    assertComplete() {
      assert.equal(counters.lossMarkers, 0, 'normal-storage-must-not-lose');
      assert.equal(counters.declaredLost, 0, 'normal-storage-must-not-declare-loss');
      assert.equal(counters.delivered, expected, 'every-offered-record-delivered');
      assert.ok(counters.replayed > 0, 'spill-replay-required');
    },
    snapshot: () => ({ ...counters, bySensor: { ...bySensor }, bitmapBytes: seen.byteLength }),
  };
}

/** Pace a real-clock workload with bounded catch-up instead of an unbounded burst.
 * @param {object} options Rate/duration and push, tick and fail-fast callbacks.
 * @returns {Promise<object>} Actual rate, timing and scheduler observations.
 * @since 0.19.2
 */
export async function pacedFeed({ rate, durationMs, push, tick = () => {} }) {
  const tickMs = 10;
  const perTick = rate * tickMs / 1000;
  const expected = rate * durationMs / 1000;
  assert.ok(Number.isSafeInteger(perTick) && Number.isSafeInteger(expected));
  const started = performance.now();
  const observations = { offered: 0, batches: 0, lateBatches: 0, maxLatenessMs: 0,
    catchUpBatches: 0, maxBurstEvents: 0, tickMs, maximumAllowedBurstEvents: perTick * 2,
    offeredPerSecond: Array(Math.ceil(durationMs / 1000) + 2).fill(0) };
  while (observations.offered < expected) {
    const elapsed = performance.now() - started;
    assert.ok(elapsed < durationMs + 2000, 'offering-deadline');
    const dueAt = observations.offered / rate * 1000;
    if (elapsed < dueAt) { await sleep(Math.max(1, dueAt - elapsed)); continue; }
    const lateness = elapsed - dueAt;
    observations.maxLatenessMs = Math.max(observations.maxLatenessMs, lateness);
    if (lateness > tickMs) observations.lateBatches++;
    const due = Math.max(perTick, Math.floor(lateness / tickMs + 1) * perTick);
    const count = Math.min(expected - observations.offered, perTick * 2, due);
    if (count > perTick) observations.catchUpBatches++;
    observations.batches++;
    observations.maxBurstEvents = Math.max(observations.maxBurstEvents, count);
    tick(elapsed);
    for (let n = 0; n < count; n++) {
      const second = Math.floor((performance.now() - started) / 1000);
      assert.ok(second < observations.offeredPerSecond.length, 'bounded-timing-histogram');
      observations.offeredPerSecond[second]++;
      push(observations.offered++);
    }
    // Yield after every bounded batch, including catch-up batches.
    await sleep(0);
  }
  const remainder = durationMs - (performance.now() - started);
  if (remainder > 0) await sleep(remainder);
  const elapsedMs = performance.now() - started;
  return { ...observations, elapsedMs, skippedEvents: expected - observations.offered,
    actualOfferedPerSecond: expected * 1000 / elapsedMs };
}
