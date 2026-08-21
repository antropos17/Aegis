/**
 * @file sensor-health.js
 * @module main/sensor-health
 * @description Pure sensor-health domain model (Block B1).
 *
 * Distinguishes "observed zero activity" (HEALTHY empty) from "could not
 * reliably observe" (DEGRADED / FAILED). No sensor I/O, no Electron, no timers.
 *
 * Lost observations are irrecoverable: `lossCount` is cumulative for the
 * lifetime of a health record and is NOT cleared by a later HEALTHY-class
 * success. A new record via {@link createSensorHealth} starts a fresh lifetime.
 *
 * @since 0.11.0
 */
'use strict';

/** @typedef {'STARTING'|'HEALTHY'|'DEGRADED'|'FAILED'|'DISABLED'|'UNSUPPORTED'} SensorHealthState */

/**
 * Closed set of health states.
 * @type {Readonly<{STARTING: string, HEALTHY: string, DEGRADED: string, FAILED: string, DISABLED: string, UNSUPPORTED: string}>}
 */
const SENSOR_HEALTH_STATE = Object.freeze({
  STARTING: 'STARTING',
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  FAILED: 'FAILED',
  DISABLED: 'DISABLED',
  UNSUPPORTED: 'UNSUPPORTED',
});

/**
 * Aggregate summary when no sensor participates in worst-of (all DISABLED /
 * UNSUPPORTED, or empty list). Not HEALTHY — zero participation is not "clean".
 * @type {string}
 */
const AGGREGATE_NONE = 'NONE';

/** Severity for expected-active states (higher = worse). */
const SEVERITY = Object.freeze({
  [SENSOR_HEALTH_STATE.FAILED]: 4,
  [SENSOR_HEALTH_STATE.DEGRADED]: 3,
  [SENSOR_HEALTH_STATE.STARTING]: 2,
  [SENSOR_HEALTH_STATE.HEALTHY]: 1,
});

/**
 * @typedef {Object} SensorHealth
 * @property {string} sensorId
 * @property {SensorHealthState} state
 * @property {number|null} lastAttemptAt - ms epoch when latest result was applied
 * @property {number|null} lastSuccessAt - ms epoch of last fully successful observation
 *   (also updated when success is forced into DEGRADED solely by residual lossCount)
 * @property {string|null} lastError - latest health-affecting failure/degrade reason
 * @property {number} consecutiveFailures - full failures only; not DEGRADED partials
 * @property {number} lossCount - irrecoverable loss in this health-record lifetime
 * @property {string|null} detail - optional short note (capability, pause reason, …)
 */

/**
 * @param {string} sensorId
 * @returns {string}
 */
function assertSensorId(sensorId) {
  if (typeof sensorId !== 'string' || sensorId.length === 0) {
    throw new Error('sensor-health: sensorId must be a non-empty string');
  }
  return sensorId;
}

/**
 * @param {number} now
 * @returns {number}
 */
function assertNow(now) {
  if (typeof now !== 'number' || !Number.isFinite(now) || now < 0) {
    throw new Error('sensor-health: now must be a finite non-negative number');
  }
  return now;
}

/**
 * Render a rejected value for a thrown message. The `typeof` prefix is what keeps the
 * string `'0'` distinguishable from the number `0`; plain interpolation renders both
 * as `0` and would name the wrong defect.
 * @param {unknown} v
 * @returns {string}
 */
function describeValue(v) {
  return typeof v === 'string' ? `string ${JSON.stringify(v)}` : `${typeof v} ${String(v)}`;
}

/**
 * Structural gate for every record entering this module.
 *
 * `lossCount` is asserted HERE and not left to the consumer. `app-health`'s projection
 * gate reads `rec.lossCount !== 0` and its `residual-loss` reason reads `lossCount > 0`
 * — for `undefined` the first is true and the second is false, so a foreign record
 * blocks the projection AND reports no loss: a conservative wrong answer that nothing
 * says out loud (audit finding D-3). The gate is right once its input is a record; a
 * value that is not one is this boundary's business.
 * @param {unknown} rec
 * @returns {SensorHealth}
 */
function assertRecord(rec) {
  if (rec === null || typeof rec !== 'object') {
    throw new Error('sensor-health: record must be a plain object');
  }
  const r = /** @type {SensorHealth} */ (rec);
  assertSensorId(r.sensorId);
  if (!Object.values(SENSOR_HEALTH_STATE).includes(r.state)) {
    throw new Error(`sensor-health: invalid state "${r.state}"`);
  }
  // `Number.isInteger` is false for a missing field, a non-number, NaN and Infinity
  // alike, so only the sign needs a second clause.
  if (!Number.isInteger(r.lossCount) || r.lossCount < 0) {
    throw new Error(
      `sensor-health: lossCount must be a non-negative integer (sensor "${r.sensorId}", got ${describeValue(r.lossCount)})`,
    );
  }
  return r;
}

/**
 * @param {string|null|undefined} msg
 * @returns {string|null}
 */
function normalizeError(msg) {
  if (msg == null || msg === '') return null;
  if (typeof msg !== 'string') {
    throw new Error('sensor-health: lastError must be a string or null');
  }
  return msg;
}

/**
 * Create a new expected-active sensor health record (fresh lifetime, loss=0).
 * @param {string} sensorId
 * @param {{ detail?: string|null }} [opts]
 * @returns {SensorHealth}
 * @since 0.11.0
 */
function createSensorHealth(sensorId, opts = {}) {
  assertSensorId(sensorId);
  return {
    sensorId,
    state: SENSOR_HEALTH_STATE.STARTING,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null,
    consecutiveFailures: 0,
    lossCount: 0,
    detail: opts.detail != null ? String(opts.detail) : null,
  };
}

/**
 * Create an unsupported sensor record (does not participate in global worst-of).
 * @param {string} sensorId
 * @param {{ detail?: string|null, now?: number }} [opts]
 * @returns {SensorHealth}
 * @since 0.11.0
 */
function createUnsupported(sensorId, opts = {}) {
  assertSensorId(sensorId);
  const now = opts.now != null ? assertNow(opts.now) : null;
  return {
    sensorId,
    state: SENSOR_HEALTH_STATE.UNSUPPORTED,
    lastAttemptAt: now,
    lastSuccessAt: null,
    lastError: null,
    consecutiveFailures: 0,
    lossCount: 0,
    detail: opts.detail != null ? String(opts.detail) : null,
  };
}

/**
 * Clone plain fields (immutable API).
 * @param {SensorHealth} rec
 * @param {Partial<SensorHealth>} patch
 * @returns {SensorHealth}
 */
function withPatch(rec, patch) {
  return {
    sensorId: rec.sensorId,
    state: patch.state !== undefined ? patch.state : rec.state,
    lastAttemptAt: patch.lastAttemptAt !== undefined ? patch.lastAttemptAt : rec.lastAttemptAt,
    lastSuccessAt: patch.lastSuccessAt !== undefined ? patch.lastSuccessAt : rec.lastSuccessAt,
    lastError: patch.lastError !== undefined ? patch.lastError : rec.lastError,
    consecutiveFailures:
      patch.consecutiveFailures !== undefined ? patch.consecutiveFailures : rec.consecutiveFailures,
    lossCount: patch.lossCount !== undefined ? patch.lossCount : rec.lossCount,
    detail: patch.detail !== undefined ? patch.detail : rec.detail,
  };
}

/**
 * Record a fully successful observation.
 *
 * If residual `lossCount > 0`, state becomes DEGRADED (not HEALTHY) — loss is
 * not erased by success. lastSuccessAt still advances (valid observation).
 *
 * @param {SensorHealth} rec
 * @param {number} now - ms epoch when this result is processed
 * @param {{ detail?: string|null }} [opts]
 * @returns {SensorHealth}
 * @since 0.11.0
 */
function markHealthy(rec, now, opts = {}) {
  const r = assertRecord(rec);
  const t = assertNow(now);
  if (r.state === SENSOR_HEALTH_STATE.UNSUPPORTED) {
    throw new Error('sensor-health: cannot mark HEALTHY from UNSUPPORTED; create a new record');
  }
  if (r.state === SENSOR_HEALTH_STATE.DISABLED) {
    throw new Error('sensor-health: cannot mark HEALTHY from DISABLED; call reenable first');
  }
  const residualLoss = r.lossCount > 0;
  return withPatch(r, {
    state: residualLoss ? SENSOR_HEALTH_STATE.DEGRADED : SENSOR_HEALTH_STATE.HEALTHY,
    lastAttemptAt: t,
    lastSuccessAt: t,
    lastError: null,
    consecutiveFailures: 0,
    detail:
      opts.detail !== undefined
        ? opts.detail == null
          ? null
          : String(opts.detail)
        : residualLoss
          ? r.detail || 'residual-loss'
          : null,
  });
}

/**
 * Record a partial/incomplete but still operating observation (or known
 * capability gap while expected to run). Does not increment consecutiveFailures.
 *
 * @param {SensorHealth} rec
 * @param {number} now
 * @param {{ error?: string|null, detail?: string|null }} [opts]
 * @returns {SensorHealth}
 * @since 0.11.0
 */
function markDegraded(rec, now, opts = {}) {
  const r = assertRecord(rec);
  const t = assertNow(now);
  if (r.state === SENSOR_HEALTH_STATE.UNSUPPORTED) {
    throw new Error('sensor-health: cannot mark DEGRADED from UNSUPPORTED');
  }
  if (r.state === SENSOR_HEALTH_STATE.DISABLED) {
    throw new Error('sensor-health: cannot mark DEGRADED from DISABLED; call reenable first');
  }
  return withPatch(r, {
    state: SENSOR_HEALTH_STATE.DEGRADED,
    lastAttemptAt: t,
    lastError: opts.error !== undefined ? normalizeError(opts.error) : r.lastError,
    detail:
      opts.detail !== undefined ? (opts.detail == null ? null : String(opts.detail)) : r.detail,
  });
}

/**
 * Record a fully failed observation attempt.
 * @param {SensorHealth} rec
 * @param {number} now
 * @param {{ error?: string|null, detail?: string|null }} [opts]
 * @returns {SensorHealth}
 * @since 0.11.0
 */
function markFailed(rec, now, opts = {}) {
  const r = assertRecord(rec);
  const t = assertNow(now);
  if (r.state === SENSOR_HEALTH_STATE.UNSUPPORTED) {
    throw new Error('sensor-health: cannot mark FAILED from UNSUPPORTED');
  }
  if (r.state === SENSOR_HEALTH_STATE.DISABLED) {
    throw new Error('sensor-health: cannot mark FAILED from DISABLED; call reenable first');
  }
  return withPatch(r, {
    state: SENSOR_HEALTH_STATE.FAILED,
    lastAttemptAt: t,
    lastError: opts.error !== undefined ? normalizeError(opts.error) : r.lastError || 'failed',
    consecutiveFailures: r.consecutiveFailures + 1,
    detail:
      opts.detail !== undefined ? (opts.detail == null ? null : String(opts.detail)) : r.detail,
  });
}

/**
 * Operator/config intentionally stopped this sensor. Does not count as failure.
 * Excluded from global worst-of aggregation.
 *
 * @param {SensorHealth} rec
 * @param {number} now
 * @param {{ detail?: string|null }} [opts]
 * @returns {SensorHealth}
 * @since 0.11.0
 */
function markDisabled(rec, now, opts = {}) {
  const r = assertRecord(rec);
  const t = assertNow(now);
  return withPatch(r, {
    state: SENSOR_HEALTH_STATE.DISABLED,
    lastAttemptAt: t,
    lastError: null,
    consecutiveFailures: 0,
    detail:
      opts.detail !== undefined ? (opts.detail == null ? null : String(opts.detail)) : r.detail,
  });
}

/**
 * Platform/capability permanently unavailable by design for this record.
 * @param {SensorHealth} rec
 * @param {number} now
 * @param {{ detail?: string|null }} [opts]
 * @returns {SensorHealth}
 * @since 0.11.0
 */
function markUnsupported(rec, now, opts = {}) {
  const r = assertRecord(rec);
  const t = assertNow(now);
  return withPatch(r, {
    state: SENSOR_HEALTH_STATE.UNSUPPORTED,
    lastAttemptAt: t,
    lastError: null,
    consecutiveFailures: 0,
    detail:
      opts.detail !== undefined ? (opts.detail == null ? null : String(opts.detail)) : r.detail,
  });
}

/**
 * Leave DISABLED and require a new success before HEALTHY (→ STARTING).
 * Preserves lossCount (same health-record lifetime).
 *
 * @param {SensorHealth} rec
 * @param {number} now
 * @param {{ detail?: string|null }} [opts]
 * @returns {SensorHealth}
 * @since 0.11.0
 */
function reenable(rec, now, opts = {}) {
  const r = assertRecord(rec);
  const t = assertNow(now);
  if (r.state !== SENSOR_HEALTH_STATE.DISABLED) {
    throw new Error('sensor-health: reenable requires DISABLED state');
  }
  return withPatch(r, {
    state: SENSOR_HEALTH_STATE.STARTING,
    lastAttemptAt: t,
    lastError: null,
    consecutiveFailures: 0,
    detail: opts.detail !== undefined ? (opts.detail == null ? null : String(opts.detail)) : null,
  });
}

/**
 * Accumulate irrecoverable observation loss for this health-record lifetime.
 * Forces non-HEALTHY: HEALTHY → DEGRADED; other active states keep/become DEGRADED
 * unless already FAILED (FAILED stays FAILED but loss still accumulates).
 *
 * @param {SensorHealth} rec
 * @param {number} amount - positive finite integer count of lost observations/units
 * @param {number} now
 * @param {{ detail?: string|null }} [opts]
 * @returns {SensorHealth}
 * @since 0.11.0
 */
function addLoss(rec, amount, now, opts = {}) {
  const r = assertRecord(rec);
  const t = assertNow(now);
  if (
    typeof amount !== 'number' ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !Number.isInteger(amount)
  ) {
    throw new Error('sensor-health: loss amount must be a positive finite integer');
  }
  if (r.state === SENSOR_HEALTH_STATE.UNSUPPORTED || r.state === SENSOR_HEALTH_STATE.DISABLED) {
    throw new Error('sensor-health: cannot addLoss while DISABLED or UNSUPPORTED');
  }
  const lossCount = r.lossCount + amount;
  let state = r.state;
  if (state === SENSOR_HEALTH_STATE.HEALTHY || state === SENSOR_HEALTH_STATE.STARTING) {
    state = SENSOR_HEALTH_STATE.DEGRADED;
  }
  // FAILED stays FAILED; DEGRADED stays DEGRADED
  return withPatch(r, {
    state,
    lossCount,
    lastAttemptAt: t,
    lastError: r.lastError || 'observation-loss',
    detail:
      opts.detail !== undefined ? (opts.detail == null ? null : String(opts.detail)) : r.detail,
  });
}

/**
 * Whether a sensor participates in global worst-of aggregation.
 * @param {SensorHealth} rec
 * @returns {boolean}
 */
function participatesInGlobal(rec) {
  const s = rec.state;
  return (
    s === SENSOR_HEALTH_STATE.STARTING ||
    s === SENSOR_HEALTH_STATE.HEALTHY ||
    s === SENSOR_HEALTH_STATE.DEGRADED ||
    s === SENSOR_HEALTH_STATE.FAILED
  );
}

/**
 * @typedef {Object} SensorHealthAggregate
 * @property {string} state - worst participating state, or {@link AGGREGATE_NONE}
 * @property {number} participatingCount
 * @property {number} totalCount
 * @property {string[]} failedSensorIds
 * @property {string[]} degradedSensorIds
 */

/**
 * Worst-of among expected-active sensors.
 * DISABLED and UNSUPPORTED are excluded (do not create fake degradation).
 * Empty participation → state {@link AGGREGATE_NONE} (never HEALTHY).
 *
 * Severity: FAILED > DEGRADED > STARTING > HEALTHY
 *
 * @param {ReadonlyArray<SensorHealth>} records
 * @returns {SensorHealthAggregate}
 * @since 0.11.0
 */
function aggregateSensorHealth(records) {
  if (!Array.isArray(records)) {
    throw new Error('sensor-health: records must be an array');
  }
  const totalCount = records.length;
  /** @type {SensorHealth[]} */
  const active = [];
  for (const rec of records) {
    const r = assertRecord(rec);
    if (participatesInGlobal(r)) active.push(r);
  }
  if (active.length === 0) {
    return {
      state: AGGREGATE_NONE,
      participatingCount: 0,
      totalCount,
      failedSensorIds: [],
      degradedSensorIds: [],
    };
  }
  let worst = active[0];
  let worstSev = SEVERITY[worst.state] || 0;
  for (let i = 1; i < active.length; i++) {
    const sev = SEVERITY[active[i].state] || 0;
    if (sev > worstSev) {
      worst = active[i];
      worstSev = sev;
    }
  }
  return {
    state: worst.state,
    participatingCount: active.length,
    totalCount,
    failedSensorIds: active
      .filter((r) => r.state === SENSOR_HEALTH_STATE.FAILED)
      .map((r) => r.sensorId),
    degradedSensorIds: active
      .filter((r) => r.state === SENSOR_HEALTH_STATE.DEGRADED)
      .map((r) => r.sensorId),
  };
}

/**
 * JSON-safe plain clone (round-trip check helper).
 * @param {SensorHealth} rec
 * @returns {SensorHealth}
 */
function toPlain(rec) {
  const r = assertRecord(rec);
  return JSON.parse(JSON.stringify(r));
}

module.exports = {
  SENSOR_HEALTH_STATE,
  AGGREGATE_NONE,
  createSensorHealth,
  createUnsupported,
  markHealthy,
  markDegraded,
  markFailed,
  markDisabled,
  markUnsupported,
  reenable,
  addLoss,
  aggregateSensorHealth,
  participatesInGlobal,
  toPlain,
};
