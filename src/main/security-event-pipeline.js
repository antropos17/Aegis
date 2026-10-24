'use strict';
const { randomUUID } = require('crypto');
const { createSpillStore } = require('./security-event-spill');
const { SENSORS, projectRecord } = require('./security-event-record');
const healthModel = require('./sensor-health');
const CODES = new Set([
  'invalid-record',
  'record-oversize',
  'spill-quota',
  'spill-write-failed',
  'spill-corrupt',
  'spill-delete-failed',
  'spill-storage-unavailable',
  'loss-ledger-corrupt',
  'replay-pending',
]);

/** Bounded audit-delivery lane used by production security ingress.
 * Live detection has already consumed the observation; replay never calls it again.
 * @param {Object} options Fixed budgets and synchronous durable audit acknowledgement.
 * @returns {Object} push/flush/destroy/stats batcher.
 * @since 0.19.2
 */
function createSecurityBatcher(options) {
  const capacity = options.capacity ?? 512;
  const byteCapacity = options.byteCapacity ?? 1024 * 1024;
  const now = options.now ?? Date.now;
  if (
    !Number.isSafeInteger(capacity) ||
    capacity < 1 ||
    capacity > 2048 ||
    !Number.isSafeInteger(byteCapacity) ||
    byteCapacity < 1024 ||
    byteCapacity > 1024 * 1024 ||
    typeof options.consume !== 'function'
  )
    throw new Error('invalid-pipeline-options');
  const sensors = Object.fromEntries(
    SENSORS.map((id) => [
      id,
      {
        capacity,
        byteCapacity,
        buffered: 0,
        bufferedBytes: 0,
        highWater: 0,
        highWaterBytes: 0,
        accepted: 0,
        delivered: 0,
        lost: 0,
      },
    ]),
  );
  let health = healthModel.markHealthy(healthModel.createSensorHealth('event-delivery'), now());
  let queue = [];
  let closed = false;
  let flushing = false;
  let startup = true;
  let unknownLoss = false;
  let markerDurable = true;
  const losses = new Map();
  let inflight = [];
  let inflightAcknowledged = false;
  let corruptionCheckpoint = null;
  let store = null;
  function saveLedger() {
    markerDurable = store.saveLoss({
      pending: [...losses.values()],
      inflight,
      corruptionCheckpoint,
    });
    return markerDurable;
  }
  function loss(sensor, code, count, first, last) {
    if (!SENSORS.includes(sensor)) sensor = 'other';
    if (!CODES.has(code)) code = 'invalid-record';
    const key = sensor + ':' + code;
    let item = losses.get(key);
    if (!item) {
      item = {
        deliveryId: randomUUID(),
        sensor,
        code,
        count: 0,
        first,
        last,
        unknown: count === null,
      };
      losses.set(key, item);
    }
    item.count += count ?? 0;
    item.unknown ||= count === null;
    item.first = Math.min(item.first, first);
    item.last = Math.max(item.last, last);
    sensors[sensor].lost += count ?? 0;
    unknownLoss ||= count === null;
    health = healthModel.markDegraded(health, now(), { error: code });
    health.lossCount += count ?? 0;
    markerDurable = false;
  }
  store = createSpillStore({
    ...options,
    onFault: (code, metadata, segment) => {
      if (!segment || segment !== corruptionCheckpoint) {
        if (metadata)
          for (const row of metadata) {
            if (row.count) loss(row.sensor, code, row.count, row.first, row.last);
          }
        else loss('other', code, code === 'spill-delete-failed' ? 0 : null, now(), now());
      }
      if (segment) corruptionCheckpoint = segment;
      return store ? saveLedger() : false;
    },
  });
  const ledger = store.loadLoss();
  const limit = SENSORS.length * CODES.size;
  function validLoss(item) {
    return (
      item &&
      SENSORS.includes(item.sensor) &&
      CODES.has(item.code) &&
      Number.isSafeInteger(item.count) &&
      item.count >= 0 &&
      Number.isSafeInteger(item.first) &&
      item.first >= 0 &&
      Number.isSafeInteger(item.last) &&
      item.last >= item.first &&
      item.last <= 8640000000000000 &&
      typeof item.unknown === 'boolean' &&
      /^[a-f0-9-]{36}$/.test(item.deliveryId)
    );
  }
  if (
    ledger &&
    (!Array.isArray(ledger.pending) ||
      !Array.isArray(ledger.inflight) ||
      ledger.pending.length > limit ||
      ledger.inflight.length > limit ||
      [...ledger.pending, ...ledger.inflight].some((item) => !validLoss(item)))
  ) {
    loss('other', 'loss-ledger-corrupt', null, now(), now());
  } else if (ledger) {
    if (
      typeof ledger.corruptionCheckpoint === 'string' &&
      /^\d{16}-[a-f0-9-]{36}\.(spill|tmp)$/.test(ledger.corruptionCheckpoint)
    )
      corruptionCheckpoint = ledger.corruptionCheckpoint;
    inflight = ledger.inflight.map((item) => ({
      deliveryId: item.deliveryId,
      sensor: item.sensor,
      code: item.code,
      count: item.count,
      first: item.first,
      last: item.last,
      unknown: item.unknown,
    }));
  }
  for (const item of ledger && Array.isArray(ledger.pending)
    ? ledger.pending.slice(0, limit)
    : []) {
    if (!validLoss(item)) {
      loss('other', 'loss-ledger-corrupt', null, now(), now());
      break;
    }
    loss(item.sensor, item.code, item.count, item.first, item.last);
    const restored = losses.get(item.sensor + ':' + item.code);
    restored.unknown ||= item.unknown;
    unknownLoss ||= item.unknown;
    if (/^[a-f0-9-]{36}$/.test(item.deliveryId)) restored.deliveryId = item.deliveryId;
  }
  for (const item of inflight) {
    sensors[item.sensor].lost += item.count;
    health.lossCount += item.count;
    unknownLoss ||= item.unknown;
    health = healthModel.markDegraded(health, now(), { error: item.code });
  }
  function consume(records) {
    try {
      if (options.consume(records) !== true) {
        health = healthModel.markDegraded(health, now(), {
          error: 'audit-persistence-unavailable',
        });
        return false;
      }
      for (const record of records) sensors[record.sensor].delivered++;
      return true;
    } catch {
      health = healthModel.markDegraded(health, now(), { error: 'audit-persistence-unavailable' });
      return false;
    }
  }
  function publishLoss() {
    if (!losses.size && !inflight.length) return true;
    if (!inflight.length) {
      inflight = [...losses.values()].map((item) => ({ ...item }));
      losses.clear();
      inflightAcknowledged = false;
    }
    try {
      if (!inflightAcknowledged) {
        saveLedger();
        const records = inflight.map((item) => ({
          deliveryId: item.deliveryId,
          sensor: item.sensor,
          type: 'pipeline-loss',
          timestamp: item.last,
          replayed: startup,
          details: {
            agent: '',
            pid: null,
            instanceId: null,
            action: item.code,
            path: '',
            severity: 'high',
            attribution: null,
            extra: {
              code: item.code,
              sensor: item.sensor,
              count: item.count,
              firstTimestamp: item.first,
              lastTimestamp: item.last,
              unknownCount: item.unknown,
            },
          },
        }));
        if (options.consume(records) !== true) return false;
        inflightAcknowledged = true;
      }
      // A live acknowledgement retries bookkeeping only; restart may replay its stable ID.
      const acknowledged = inflight;
      inflight = [];
      if (!saveLedger()) {
        inflight = acknowledged;
        return false;
      }
      inflightAcknowledged = false;
      return losses.size === 0;
    } catch {
      return false;
    }
  }
  function clearQueue() {
    queue = [];
    for (const stats of Object.values(sensors)) {
      stats.buffered = 0;
      stats.bufferedBytes = 0;
    }
  }
  function spillQueue() {
    if (!queue.length) return null;
    const code = store.append(queue.map((entry) => entry.record));
    if (!code) clearQueue();
    return code;
  }
  function flush() {
    if (flushing) return;
    flushing = true;
    try {
      if (!publishLoss() || !store.replay(consume)) return;
      startup = false;
      if (queue.length && consume(queue.map((entry) => entry.record))) clearQueue();
      if (health.lossCount === 0 && !unknownLoss && !losses.size && !queue.length)
        health = healthModel.markHealthy(health, now());
    } finally {
      flushing = false;
    }
  }
  flush(); // Startup replay is synchronous and precedes admission.
  const timer = setInterval(flush, options.intervalMs ?? 150);
  timer.unref?.();
  return {
    push(input) {
      if (closed) return false;
      const sensor = SENSORS.includes(input?.sensor) ? input.sensor : 'other';
      const timestamp =
        Number.isSafeInteger(input?.timestamp) &&
        input.timestamp >= 0 &&
        input.timestamp <= 8640000000000000
          ? input.timestamp
          : now();
      if (startup) {
        loss(sensor, 'replay-pending', 1, timestamp, timestamp);
        saveLedger();
        return false;
      }
      let record;
      try {
        record = projectRecord(input);
      } catch (error) {
        loss(
          sensor,
          CODES.has(error.message) ? error.message : 'invalid-record',
          1,
          timestamp,
          timestamp,
        );
        saveLedger();
        return false;
      }
      const size = Buffer.byteLength(JSON.stringify(record));
      const stats = sensors[sensor];
      if (size > byteCapacity) {
        loss(sensor, 'record-oversize', 1, timestamp, timestamp);
        saveLedger();
        return false;
      }
      if (stats.buffered >= capacity || stats.bufferedBytes + size > byteCapacity) {
        const code = spillQueue();
        if (code) {
          // Existing RAM keeps custody. Full storage rejects this new observation.
          loss(sensor, code, 1, timestamp, timestamp);
          saveLedger();
          return false;
        }
      }
      queue.push({ record, size });
      stats.accepted++;
      stats.buffered++;
      stats.bufferedBytes += size;
      stats.highWater = Math.max(stats.highWater, stats.buffered);
      stats.highWaterBytes = Math.max(stats.highWaterBytes, stats.bufferedBytes);
      return true;
    },
    flush,
    destroy() {
      if (closed) return;
      clearInterval(timer);
      flush();
      const code = spillQueue();
      if (code) {
        // Graceful shutdown can no longer own volatile records; disclose them.
        for (const { record } of queue)
          loss(record.sensor, code, 1, record.timestamp, record.timestamp);
        saveLedger();
        clearQueue();
      }
      publishLoss();
      closed = true;
    },
    getStats: () => ({
      sensors: structuredClone(sensors),
      spill: store.stats(),
      pendingLoss: [...losses.values(), ...inflight].reduce((sum, item) => sum + item.count, 0),
      unknownLoss,
      markerDurable,
      health: { ...health },
      replayPending: startup,
    }),
  };
}
module.exports = { createSecurityBatcher };
