/**
 * @file app-health.js
 * @module main/app-health
 * @description Pure app-level health derivation over the sensor-health leaves.
 *
 * One question: what can AEGIS still observe? The answer is DERIVED on every read
 * from a snapshot of inputs — no stored machine, no latch. Each "transition" is the
 * edge between two derivations on consecutive ticks, so every edge is a change in a
 * named signal rather than a hidden field.
 *
 * NOT a worst-of roll-up. `aggregateSensorHealth` stays the single implementation of
 * worst-of and is called from here, but its result is an INPUT, never the answer: app
 * FAILED states that a capability is lost, and a severity maximum cannot say that.
 *
 * No I/O, no Electron, no timers, no wall clock, and no `mark*` call: a leaf is
 * written only by the code that performed or refused the observation it names, and
 * that boundary is not this module's to cross.
 * @since 0.12.0
 */
'use strict';

const { SENSOR_HEALTH_STATE, AGGREGATE_NONE, aggregateSensorHealth } = require('./sensor-health');

/** @typedef {'BOOTING'|'SENSORS_STARTING'|'HEALTHY'|'DEGRADED'|'FAILED'} AppHealthState */

/**
 * Closed set of app-level states.
 * @type {Readonly<Record<string, string>>}
 */
const APP_HEALTH_STATE = Object.freeze({
  BOOTING: 'BOOTING',
  SENSORS_STARTING: 'SENSORS_STARTING',
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  FAILED: 'FAILED',
});

/**
 * Closed set of reason codes. DECLARATION ORDER IS THE EMITTED ORDER — `reasons` is
 * built by walking this table, so the array never depends on evaluation order. These
 * are reason CODES, not sensor identifiers: a reader that wants sensor names takes
 * them from the aggregate's `failedSensorIds` / `degradedSensorIds`.
 * @type {Readonly<Record<string, string>>}
 */
const APP_HEALTH_REASON = Object.freeze({
  POPULATION_FAILED: 'population-failed',
  POPULATION_DEGRADED: 'population-degraded',
  POPULATION_STARTING: 'population-starting',
  ZERO_COVERAGE: 'zero-coverage',
  SENSOR_FAILED: 'sensor-failed',
  SENSOR_DEGRADED: 'sensor-degraded',
  SENSOR_STARTING: 'sensor-starting',
  IDENTITY_DEGRADED: 'identity-degraded',
  WATCH_ROOTS_UNAVAILABLE: 'watch-roots-unavailable',
  WATCH_PLAN_STARTING: 'watch-plan-starting',
  RESIDUAL_LOSS: 'residual-loss',
});

/**
 * Which state each reason lands in. A PARTITION: every code appears in exactly one
 * tier, which is what makes {@link deriveAppHealth} total — an empty `reasons` is the
 * only way to reach HEALTHY. Ordered failure-first, copied from
 * `watch-root-registry.deriveWatchPlaneState` for the same reason it holds there: a
 * CONFIRMED FAILURE OUTRANKS A NOT-YET. With the starting tier first, a
 * permission-denied enumeration plus one chokidar root stuck at `registered` (terminal
 * — its `ready` may never fire) would report "starting" over a machine AEGIS cannot see.
 * @type {ReadonlyArray<{state: string, reasons: string[]}>}
 */
const TIERS = Object.freeze([
  {
    state: APP_HEALTH_STATE.FAILED,
    reasons: [APP_HEALTH_REASON.POPULATION_FAILED, APP_HEALTH_REASON.ZERO_COVERAGE],
  },
  {
    state: APP_HEALTH_STATE.DEGRADED,
    reasons: [
      APP_HEALTH_REASON.POPULATION_DEGRADED,
      APP_HEALTH_REASON.SENSOR_FAILED,
      APP_HEALTH_REASON.SENSOR_DEGRADED,
      APP_HEALTH_REASON.IDENTITY_DEGRADED,
      APP_HEALTH_REASON.WATCH_ROOTS_UNAVAILABLE,
      APP_HEALTH_REASON.RESIDUAL_LOSS,
    ],
  },
  {
    state: APP_HEALTH_STATE.SENSORS_STARTING,
    reasons: [
      APP_HEALTH_REASON.POPULATION_STARTING,
      APP_HEALTH_REASON.SENSOR_STARTING,
      APP_HEALTH_REASON.WATCH_PLAN_STARTING,
    ],
  },
]);

/** The one sensor the effective projection may touch. A table, not a mechanism. */
const PROJECTED_SENSOR_ID = 'proc-snapshot';

/** Why that record is projected, published so the rewrite is auditable. */
const PROJECTION_REASON = 'identity-birth-time-fallback';

/**
 * @typedef {Object} AppHealthInput
 * @property {boolean} bootPhase - true once the deferred modules are loaded. While
 *   false nothing exists to read: `scanner`/`watcher` are undefined in main.js.
 * @property {{populationState: string, populationReliable: boolean,
 *   populationAsOf: number|null, identityQuality: string}} capabilities -
 *   `process-scanner.getProcessCapabilities()`, verbatim.
 * @property {boolean} identityDegraded - `process-scanner.isIdentityDegraded()`,
 *   verbatim. Never re-derived from `identityQuality`.
 * @property {ReadonlyArray<import('./sensor-health').SensorHealth>} records - RAW leaves.
 * @property {{state: string, liveWatcherCount: number, unavailableGroups: Array<object>}}
 *   watchPlan - `file-watcher.getWatchPlan()`.
 */

/**
 * @typedef {Object} AppHealth
 * @property {AppHealthState} state
 * @property {string[]} reasons - every satisfied condition, in APP_HEALTH_REASON order
 * @property {import('./sensor-health').SensorHealthAggregate|null} raw - worst-of over
 *   the untouched records, for diagnostics. Null while BOOTING.
 * @property {import('./sensor-health').SensorHealthAggregate|null} effective - worst-of
 *   over the projected set, which is what the state rests on. Null while BOOTING.
 * @property {Array<{sensorId: string, from: string, to: string, reason: string}>} projections
 */

/**
 * Project the raw leaves onto the set allowed to affect app health.
 *
 * ONE row, hardcoded: an accepted CIM fallback on `proc-snapshot`. That leaf marks the
 * fallback DEGRADED, which is true about the SOURCE — the primary provider is gone and
 * a spare answers — and false about the application: the identity keys still form in
 * the same space with the same values, nothing splits, and `isIdentityDegraded()`
 * deliberately returns false. Feeding the raw worst-of straight in would hold the whole
 * app DEGRADED for as long as an accepted operating mode lasts, and a warning that is
 * always on is not a warning.
 *
 * REWRITTEN IN A COPY, never dropped. Dropping would change `participatingCount` and
 * open {@link AGGREGATE_NONE} where it must not be reachable; rewriting leaves
 * participation exactly as it was. The caller's records are not mutated.
 *
 * `lossCount === 0` is required on top of the identity conditions: `markHealthy`
 * refuses to erase residual loss, and a projection undoing that would be a second,
 * weaker source of truth for the same rule. Vacuous today — nothing in `src/` calls
 * `addLoss` — and written down anyway.
 *
 * WHAT IT RESTS ON: `identityQuality === 'birth-time'` is true exactly when
 * `getIdentityQuality()` saw the snapshot leaf DEGRADED on a platform publishing a
 * birth time. "DEGRADED implies cim-fallback" is therefore a property of THAT function,
 * so this deliberately does not also test `detail === 'cim-fallback'`: a second
 * condition would diverge silently the day the string is renamed, and would guard
 * against a defect belonging next door. If `proc-snapshot` gains a second cause of
 * DEGRADED, `getIdentityQuality()` is what must change — it would already be claiming
 * "the keys still form" about a cause it knows nothing about.
 * @param {ReadonlyArray<import('./sensor-health').SensorHealth>} records
 * @param {{identityQuality: string}} capabilities
 * @param {boolean} identityDegraded
 * @returns {{records: import('./sensor-health').SensorHealth[],
 *   projections: Array<{sensorId: string, from: string, to: string, reason: string}>}}
 * @since 0.12.0
 */
function projectEffectiveRecords(records, capabilities, identityDegraded) {
  if (!Array.isArray(records)) throw new Error('app-health: records must be an array');
  const accepted =
    capabilities != null && capabilities.identityQuality === 'birth-time' && !identityDegraded;
  /** @type {Array<{sensorId: string, from: string, to: string, reason: string}>} */
  const projections = [];
  const projected = records.map((rec) => {
    if (
      !accepted ||
      rec.sensorId !== PROJECTED_SENSOR_ID ||
      rec.state !== SENSOR_HEALTH_STATE.DEGRADED ||
      rec.lossCount !== 0
    ) {
      return rec;
    }
    projections.push({
      sensorId: rec.sensorId,
      from: rec.state,
      to: SENSOR_HEALTH_STATE.HEALTHY,
      reason: PROJECTION_REASON,
    });
    return { ...rec, state: SENSOR_HEALTH_STATE.HEALTHY };
  });
  return { records: projected, projections };
}

/**
 * Every satisfied condition, walked in {@link APP_HEALTH_REASON} declaration order.
 *
 * Deliberately NOT "the reason the winning rule fired": reporting only the winner needs
 * logic deciding what a reader may not know about, which is a mechanism for hiding
 * degradation. Two consequences are intended:
 *
 * - `population-failed` and `sensor-failed` co-occur. The `process` leaf participates
 *   in the aggregate, so its failure is true from both angles — the population
 *   capability is gone AND a participating sensor is FAILED. Suppressing the second
 *   would hide a fact the reader can check in `effective`.
 * - `sensor-starting` comes from the aggregate STATE while `sensor-failed` /
 *   `sensor-degraded` come from the id ARRAYS. `aggregateSensorHealth` publishes
 *   `failedSensorIds` and `degradedSensorIds` but no `startingSensorIds`, and deriving
 *   a third array here would put a second view of the same set beside the existing one.
 *
 * `watch-roots-unavailable` covers plane DEGRADED as well as FAILED. Those coincide
 * with a non-empty `unavailableGroups` by construction of `deriveWatchPlaneState`; all
 * three are named so the derivation stays total over the input TYPE, not merely over
 * the states the registry can actually produce.
 * @param {AppHealthInput} input
 * @param {import('./sensor-health').SensorHealthAggregate} effective
 * @param {ReadonlyArray<import('./sensor-health').SensorHealth>} effectiveRecords
 * @returns {string[]}
 */
function collectReasons(input, effective, effectiveRecords) {
  const { capabilities: caps, identityDegraded, watchPlan } = input;
  const S = SENSOR_HEALTH_STATE;
  const R = APP_HEALTH_REASON;
  const held = {
    [R.POPULATION_FAILED]: caps.populationState === S.FAILED,
    [R.POPULATION_DEGRADED]: caps.populationState === S.DEGRADED,
    [R.POPULATION_STARTING]: caps.populationState === S.STARTING,
    [R.ZERO_COVERAGE]: effective.state === AGGREGATE_NONE,
    [R.SENSOR_FAILED]: effective.failedSensorIds.length > 0,
    [R.SENSOR_DEGRADED]: effective.degradedSensorIds.length > 0,
    [R.SENSOR_STARTING]: effective.state === S.STARTING,
    [R.IDENTITY_DEGRADED]: identityDegraded === true,
    [R.WATCH_ROOTS_UNAVAILABLE]:
      watchPlan.unavailableGroups.length > 0 ||
      watchPlan.state === S.DEGRADED ||
      watchPlan.state === S.FAILED,
    [R.WATCH_PLAN_STARTING]: watchPlan.state === S.STARTING,
    [R.RESIDUAL_LOSS]: effectiveRecords.some((r) => r.lossCount > 0),
  };
  return Object.values(R).filter((code) => held[code]);
}

/**
 * @param {AppHealthInput} input
 * @returns {AppHealthInput}
 */
function assertInput(input) {
  if (input === null || typeof input !== 'object') {
    throw new Error('app-health: input must be a plain object');
  }
  if (typeof input.bootPhase !== 'boolean') {
    throw new Error('app-health: bootPhase must be a boolean');
  }
  if (input.bootPhase === false) return input;
  if (input.capabilities == null || typeof input.capabilities.populationState !== 'string') {
    throw new Error('app-health: capabilities.populationState must be a string');
  }
  if (typeof input.identityDegraded !== 'boolean') {
    throw new Error('app-health: identityDegraded must be a boolean');
  }
  if (input.watchPlan == null || typeof input.watchPlan.state !== 'string') {
    throw new Error('app-health: watchPlan.state must be a string');
  }
  if (!Array.isArray(input.watchPlan.unavailableGroups)) {
    throw new Error('app-health: watchPlan.unavailableGroups must be an array');
  }
  return input;
}

/**
 * Derive the app-level health from one snapshot of honest signals.
 *
 * THE `populationReliable` CONTRACT, AND WHY THIS READS `populationState` INSTEAD.
 * `populationReliable` is `true` **iff** `populationState === 'HEALTHY'` — literally,
 * in `process-scanner.getProcessCapabilities()`:
 * `populationReliable: _processHealth.state === SENSOR_HEALTH_STATE.HEALTHY`.
 * The boolean therefore collapses `STARTING`, `DEGRADED` and `FAILED` into one
 * `false`, and a rule of the form `!populationReliable -> FAILED` declares a NORMAL
 * pre-first-observation startup a total observation failure: the process leaf sits at
 * `STARTING` until the first tick, which `population-scope-gate.test.js` already pins
 * ("a never-scanned leaf is STARTING, not reliable, and has no asOf").
 * `populationReliable` stays what it is — the capability GATE agent-scoped consumers
 * read before they observe — and it is not expressive enough to classify an
 * application lifecycle. This derivation reads `populationState`.
 *
 * STATE IS DERIVED FROM `reasons`, not computed beside it. The conditions live once,
 * in {@link collectReasons}; {@link TIERS} maps them onto states. A reason and a state
 * that disagree are therefore not expressible.
 *
 * WHAT FAILED MEANS. Core observation capability is unavailable — about capability,
 * never a maximum over severities. The only LIVE route is `populationState ===
 * 'FAILED'`: that one fact closes the population gate, and with it `doNetworkScan`,
 * `doFileScan` and `doHotReadScan` all refuse and `handleWatcherEvent` stops inferring
 * owners, so the claim "we can see which agents are running" is false. `zero-coverage`
 * is a defensive invariant that closes totality and is NOT reachable today: every leaf
 * but `fs-rm` is created participating on every platform, nothing calls `markDisabled`,
 * and the projection rewrites rather than drops. A single leaf in FAILED — `network`,
 * `fs-rm`, `proc-snapshot`, `fs-chokidar` — reaches DEGRADED, never FAILED.
 *
 * ORTHOGONALITY. `monitoringPaused` is absent from {@link AppHealthInput} on purpose:
 * operator control is a separate dimension and travels beside this value, never inside
 * it. There is also no age-based rule anywhere here — nothing compares `lastSuccessAt`
 * to a clock. Pause stops the intervals, so leaves simply stop being attempted and
 * their last success ages without bound; any "no success in N ms -> DEGRADED" rule
 * would manufacture degradation out of an operator's intent.
 * @param {AppHealthInput} input
 * @returns {AppHealth}
 * @since 0.12.0
 */
function deriveAppHealth(input) {
  const inp = assertInput(input);
  if (inp.bootPhase === false) {
    // Nothing has been observed yet, so there is no condition to report.
    return {
      state: APP_HEALTH_STATE.BOOTING,
      reasons: [],
      raw: null,
      effective: null,
      projections: [],
    };
  }
  const records = Array.isArray(inp.records) ? inp.records : [];
  const raw = aggregateSensorHealth(records);
  const { records: effectiveRecords, projections } = projectEffectiveRecords(
    records,
    inp.capabilities,
    inp.identityDegraded,
  );
  const effective = aggregateSensorHealth(effectiveRecords);
  const reasons = collectReasons(inp, effective, effectiveRecords);
  const tier = TIERS.find((t) => reasons.some((r) => t.reasons.includes(r)));
  // No tier matched means `reasons` is empty, and TIERS partitions every code — so
  // this IS a healthy application, not a fall-through.
  return {
    state: tier ? tier.state : APP_HEALTH_STATE.HEALTHY,
    reasons,
    raw,
    effective,
    projections,
  };
}

module.exports = {
  APP_HEALTH_STATE,
  APP_HEALTH_REASON,
  TIERS,
  PROJECTED_SENSOR_ID,
  PROJECTION_REASON,
  projectEffectiveRecords,
  deriveAppHealth,
};
