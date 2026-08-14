/**
 * @file watch-root-registry.js
 * @module main/watch-root-registry
 * @description The chokidar watch-root registry (design §1).
 *
 *   `fs-chokidar` is ONE health record over SEVERAL FSWatcher objects. Reading it off
 *   whichever object spoke last made a single `ready` claim the whole mechanism healthy
 *   and a single `error` condemn it. The registry separates INTENT (the plan, fixed
 *   before the first registration) from OUTCOME (what each root did), and W is derived
 *   from the whole plan.
 *
 *   Pure state and pure derivation: no I/O, no chokidar, no fs, no timers. It stores the
 *   watcher objects it is GIVEN and never creates, closes or inspects one — `watcher
 *   !== null` is the only fact about them W is allowed to rest on. It reads
 *   sensor-health's state enum to NAME the derived W and writes no health record: the
 *   `fs-chokidar` record and every `sensorHealth.mark*` call stay in file-watcher.js,
 *   which owns them — hence {@link markRootReady} and {@link markRootErrored} return
 *   whether the plan moved instead of writing the record themselves.
 * @requires ./sensor-health
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.12.0
 */
'use strict';
const sensorHealth = require('./sensor-health');

/**
 * The four watch-root groups `setupFileWatchers` registers. Two are preflighted,
 * two are unconditional — which is why the plan can never be empty (§1.2).
 * @type {Readonly<Record<string, string>>}
 * @since 0.12.0
 */
const WATCH_GROUP = Object.freeze({
  CREDENTIAL_DIRS: 'credential-dirs',
  AGENT_CONFIG_DIRS: 'agent-config-dirs',
  PROJECT_DIR: 'project-dir',
  ENV_FILES: 'env-files',
});

/**
 * Lifecycle states of one watch root (§1.3).
 *
 * `not-applicable` is the ONLY exclusion from the plan, and it rests on a completed
 * probe — never on a throw. `registration-failed`, `not-attempted` and `errored` are
 * all terminal: nothing in this module recreates a watcher object (gap P).
 * @type {Readonly<Record<string, string>>}
 * @since 0.12.0
 */
const WATCH_ROOT_STATE = Object.freeze({
  NOT_APPLICABLE: 'not-applicable',
  PLANNED: 'planned',
  NOT_ATTEMPTED: 'not-attempted',
  REGISTRATION_FAILED: 'registration-failed',
  REGISTERED: 'registered',
  READY: 'ready',
  ERRORED: 'errored',
});

/** States that name a planned root as unavailable — a CONFIRMED loss of coverage. */
const UNAVAILABLE_ROOT_STATES = new Set([
  WATCH_ROOT_STATE.ERRORED,
  WATCH_ROOT_STATE.REGISTRATION_FAILED,
  WATCH_ROOT_STATE.NOT_ATTEMPTED,
]);

/**
 * @typedef {Object} WatchRoot
 * @property {string} id - one of {@link WATCH_GROUP}
 * @property {string} state - one of {@link WATCH_ROOT_STATE}
 * @property {object|null} watcher - the LIVE FSWatcher object, or null if none exists
 * @property {string|null} lastError
 * @property {number} deliveredCount - callbacks this root has delivered
 * @property {number|null} lastEventAt
 */

/**
 * The plan: planned roots in registration order. Empty until `setupFileWatchers`
 * builds it, and immutable in membership for the record lifetime.
 * @type {Map<string, WatchRoot>}
 */
let _watchPlan = new Map();

/** Groups a completed preflight proved absent — excluded from the plan (§1.2). */
let _absentGroups = [];

/**
 * Drop the plan. Called by file-watcher whenever the `fs-chokidar` record's lifetime
 * ends: the plan is what writes that record, so a plan outliving it would recompute W
 * from roots the new record never saw registered. It is also the ONLY thing that clears
 * a previous run's plan — this module stays in `require.cache` across a test's
 * file-watcher reload, where the plan used to die with the module.
 * @returns {void}
 */
function resetWatchPlan() {
  _watchPlan = new Map();
  _absentGroups = [];
}

/**
 * Fix the plan. Called once per health-record lifetime, AFTER both preflights and
 * BEFORE the first `chokidar.watch` — a registration failure can then never shrink it.
 * @param {Array<{id: string, applicable: boolean}>} groups - in registration order
 * @returns {void}
 */
function buildWatchPlan(groups) {
  resetWatchPlan();
  for (const g of groups) {
    if (!g.applicable) {
      _absentGroups.push(g.id);
      continue;
    }
    _watchPlan.set(g.id, {
      id: g.id,
      state: WATCH_ROOT_STATE.PLANNED,
      watcher: null,
      lastError: null,
      deliveredCount: 0,
      lastEventAt: null,
    });
  }
}

/**
 * Whether this group is IN the plan. A group a completed preflight proved absent is not,
 * and must not be registered at all — every `mark*` below no-ops for it, so skipping the
 * `chokidar.watch` call is the caller's job.
 * @param {string} id
 * @returns {boolean}
 */
function hasPlannedRoot(id) {
  return _watchPlan.has(id);
}

/**
 * @param {string} id
 * @param {object} watcher - the object `chokidar.watch` returned
 * @returns {void}
 */
function markRootRegistered(id, watcher) {
  const root = _watchPlan.get(id);
  if (!root) return;
  root.state = WATCH_ROOT_STATE.REGISTERED;
  root.watcher = watcher;
}

/**
 * `chokidar.watch` threw for this group — no watcher object exists for it.
 * @param {string} id
 * @param {string} message - the failure text, already normalized by the caller
 * @returns {void}
 */
function markRootRegistrationFailed(id, message) {
  const root = _watchPlan.get(id);
  if (!root) return;
  root.state = WATCH_ROOT_STATE.REGISTRATION_FAILED;
  root.watcher = null;
  root.lastError = message;
}

/**
 * Setup aborted before these groups were reached — their state is read off plan
 * position, not off anything they did.
 * @returns {void}
 */
function markUnreachedRootsNotAttempted() {
  for (const root of _watchPlan.values()) {
    if (root.state === WATCH_ROOT_STATE.PLANNED) {
      root.state = WATCH_ROOT_STATE.NOT_ATTEMPTED;
    }
  }
}

/**
 * `ready` fired for this root's watcher object.
 * @param {string} id
 * @returns {boolean} true when the root moved to `ready` — the caller must then
 *   re-derive W. False means nothing changed and W must NOT be rewritten.
 */
function markRootReady(id) {
  const root = _watchPlan.get(id);
  if (!root) return false;
  // §1.4 — `errored` is TERMINAL for this watcher object's lifetime. Whether chokidar
  // closes itself on a fatal error or hangs silent is unresolved (roadmap U3), so
  // nothing the same object says afterwards can be read as recovery. Only a NEW object
  // clears it, and no code creates one today (gap P). Without this guard a root that
  // errored during its initial walk and then emitted `ready` would count as clean
  // coverage, and W would reach HEALTHY over a root nobody can vouch for.
  if (root.state === WATCH_ROOT_STATE.ERRORED) return false;
  root.state = WATCH_ROOT_STATE.READY;
  return true;
}

/**
 * An `error` event arrived for this root. The watcher OBJECT is kept: chokidar may
 * still be partially operating, and W FAILED is a statement about object existence,
 * never a count of errors (§1.5).
 * @param {string} id
 * @param {string} message - the error text, already normalized by the caller
 * @returns {boolean} true when the root was in the plan — the caller must then
 *   re-derive W. False means the event named no planned root and W is unchanged.
 */
function markRootErrored(id, message) {
  const root = _watchPlan.get(id);
  if (!root) return false;
  root.state = WATCH_ROOT_STATE.ERRORED;
  root.lastError = message;
  return true;
}

/**
 * Record that this root delivered one callback. Reality only, and deliberately no
 * state: a delivered `add`/`change`/`unlink` proves ONE callback arrived, never that
 * a watcher recovered — §1.4 retracts that claim outright. So it does not clear
 * `errored`, and it does not promote a `registered` root that never said `ready`.
 * @param {string} id
 * @returns {void}
 */
function noteRootDelivery(id) {
  const root = _watchPlan.get(id);
  if (!root) return;
  root.deliveredCount += 1;
  root.lastEventAt = Date.now();
}

/**
 * W over the plan — ordered and total (§1.6). Rule 1 before 2 because a root can be
 * both `errored` and the only live one; rule 2 before 3 because a confirmed failure
 * outranks a not-yet.
 * @returns {string} a {@link sensorHealth.SENSOR_HEALTH_STATE} value
 * @throws {Error} when called with no plan — §1.2 asserts the plan is never empty.
 */
function deriveWatchPlaneState() {
  const roots = [..._watchPlan.values()];
  if (roots.length === 0) {
    throw new Error('file-watcher: watch plan is empty');
  }
  // 1. Zero live watcher objects — PROVEN zero coverage: there is nothing to observe
  //    with. This is the only source of FAILED. N `errored` roots are N unknowns, not
  //    a proven death (§1.5), so error events never reach this line.
  if (!roots.some((r) => r.watcher !== null)) {
    return sensorHealth.SENSOR_HEALTH_STATE.FAILED;
  }
  // 2. Any planned root confirmed unavailable.
  if (roots.some((r) => UNAVAILABLE_ROOT_STATES.has(r.state))) {
    return sensorHealth.SENSOR_HEALTH_STATE.DEGRADED;
  }
  // 3. Some root has not proven readiness. A root stuck at `registered` whose `ready`
  //    never fires holds W here forever — honest under U3, and out of HEALTHY.
  if (
    roots.some(
      (r) => r.state === WATCH_ROOT_STATE.PLANNED || r.state === WATCH_ROOT_STATE.REGISTERED,
    )
  ) {
    return sensorHealth.SENSOR_HEALTH_STATE.STARTING;
  }
  return sensorHealth.SENSOR_HEALTH_STATE.HEALTHY;
}

/**
 * `<id>:<reason>` for every unavailable root, in PLAN order so the string does not
 * depend on which event happened to land first.
 * @returns {string}
 */
function unavailableRootSummary() {
  const parts = [];
  for (const root of _watchPlan.values()) {
    if (UNAVAILABLE_ROOT_STATES.has(root.state)) {
      parts.push(`${root.id}:${root.lastError || root.state}`);
    }
  }
  return parts.join('; ').slice(0, 200);
}

/**
 * Plain serializable view of the plan — callers must not mutate. The live FSWatcher
 * objects are deliberately not exposed; `hasLiveWatcher` is the only fact about them
 * W is allowed to rest on.
 * @returns {{state: string, groups: Array<object>, absentGroups: string[], liveWatcherCount: number, unavailableGroups: Array<{id: string, state: string, reason: string}>}}
 * @since 0.12.0
 */
function getWatchPlan() {
  const groups = [..._watchPlan.values()].map((r) => ({
    id: r.id,
    state: r.state,
    hasLiveWatcher: r.watcher !== null,
    lastError: r.lastError,
    deliveredCount: r.deliveredCount,
    lastEventAt: r.lastEventAt,
  }));
  return {
    // Before setup has run there is no plan, and deriving from an empty one is the
    // case §1.2 asserts away rather than branches on — so report the record's own
    // starting state instead of throwing out of a getter.
    state:
      groups.length === 0 ? sensorHealth.SENSOR_HEALTH_STATE.STARTING : deriveWatchPlaneState(),
    groups,
    absentGroups: [..._absentGroups],
    liveWatcherCount: groups.filter((g) => g.hasLiveWatcher).length,
    unavailableGroups: groups
      .filter((g) => UNAVAILABLE_ROOT_STATES.has(g.state))
      .map((g) => ({ id: g.id, state: g.state, reason: g.lastError || g.state })),
  };
}

module.exports = {
  WATCH_GROUP,
  WATCH_ROOT_STATE,
  resetWatchPlan,
  buildWatchPlan,
  hasPlannedRoot,
  markRootRegistered,
  markRootRegistrationFailed,
  markUnreachedRootsNotAttempted,
  markRootReady,
  markRootErrored,
  noteRootDelivery,
  deriveWatchPlaneState,
  unavailableRootSummary,
  getWatchPlan,
};
