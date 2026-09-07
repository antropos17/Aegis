/**
 * @file observation-gap.js
 * @module main/observation-gap
 * @description The OS suspend / resume observation gap (Block B5).
 *
 * One question: is there a stretch of wall-clock AEGIS was not observing through, and
 * has a real observation been made since? The answer travels beside `appHealth` on the
 * stats payload as `stats.observationGap` — a SIBLING, exactly like `monitoringPaused`.
 * It is not a sensor-health leaf: a leaf names one sensor's observation and joins the
 * worst-of, and no sensor is broken by a sleep. It is not an app-health reason either:
 * that module derives from a snapshot with no stored machine, and a gap is a stored
 * event with a start and an end.
 *
 * Machine: NONE → (suspend) SUSPENDED → (resume) RESUMED → (observed) NONE.
 * RESUMED means the machine woke and no tick has yet RECONCILED — scan-loop clears it
 * from the first process tick whose session reconcile was not frozen, and nothing else
 * clears it. A tick that ran while the flag was armed but observed nothing (a
 * permission-denied enumeration, a degraded identity, a tick that straddled the sleep)
 * leaves it armed: a sleep gap is never credited as a healthy empty observation.
 *
 * No Electron, no timers, no clock of its own: `powerMonitor` is injected as `{on}`
 * through {@link attach}, the clock through {@link init}, and every `note*` takes its
 * `now` explicitly. The only side effect is the `onGap` callback `attach` is given.
 *
 * `suspendCount` is read by TWO consumers on purpose, and both are named here so the
 * next reader does not re-pick by convenience (ai-mistakes #29): the stats payload reads
 * it as a lifetime counter, and scan-loop reads it as the STRADDLE WITNESS — a snapshot
 * taken before the provider `await` is compared with one taken after, and a count that
 * moved means the tick's evidence was gathered on the far side of a sleep.
 * @since 0.15.0
 */
'use strict';

/** @typedef {'NONE'|'SUSPENDED'|'RESUMED'} ObservationGapState */

/**
 * Closed set of gap states.
 * @type {Readonly<{NONE: string, SUSPENDED: string, RESUMED: string}>}
 */
const OBSERVATION_GAP_STATE = Object.freeze({
  NONE: 'NONE',
  SUSPENDED: 'SUSPENDED',
  RESUMED: 'RESUMED',
});

/** The cause every record this module describes carries. */
const GAP_CAUSE = 'os-suspend';

/**
 * @typedef {Object} ObservationGap
 * @property {ObservationGapState} state
 * @property {number|null} suspendedAt - ms epoch of the `suspend` event of the current or
 *   last gap; null when the resume arrived without a seen suspend
 * @property {number|null} resumedAt - ms epoch of the matching `resume` event
 * @property {number|null} gapMs - `resumedAt - suspendedAt`, clamped at 0; null while
 *   suspended or when the suspend was never seen
 * @property {number|null} clearedAt - ms epoch of the observation that cleared RESUMED
 * @property {number} suspendCount - `suspend` events this process life (the straddle witness)
 * @property {number} totalGapMs - every measured gap summed, this process life
 */

/** @returns {ObservationGap} */
function fresh() {
  return {
    state: OBSERVATION_GAP_STATE.NONE,
    suspendedAt: null,
    resumedAt: null,
    gapMs: null,
    clearedAt: null,
    suspendCount: 0,
    totalGapMs: 0,
  };
}

/** @type {ObservationGap} */
let _gap = fresh();
/** @type {() => number} */
let _now = () => Date.now();
let _attached = false;

/**
 * @param {unknown} now
 * @returns {number}
 */
function assertNow(now) {
  if (typeof now !== 'number' || !Number.isFinite(now) || now < 0) {
    throw new Error('observation-gap: now must be a finite non-negative number');
  }
  return now;
}

/**
 * Plain copy of the current gap. A fresh object per call — never the module's own
 * record handed to a renderer or a test.
 * @returns {ObservationGap}
 * @since 0.15.0
 */
function snapshot() {
  return { ..._gap };
}

/**
 * The system is suspending. From NONE or RESUMED this opens a new gap; from SUSPENDED
 * (a second suspend with no resume between) the first `suspendedAt` is kept, because
 * the machine has been unobserved since THAT moment, and only the count moves.
 * @param {number} now - ms epoch
 * @returns {ObservationGap}
 * @since 0.15.0
 */
function noteSuspend(now) {
  const t = assertNow(now);
  if (_gap.state !== OBSERVATION_GAP_STATE.SUSPENDED) {
    _gap = {
      ..._gap,
      state: OBSERVATION_GAP_STATE.SUSPENDED,
      suspendedAt: t,
      resumedAt: null,
      gapMs: null,
      clearedAt: null,
    };
  }
  _gap = { ..._gap, suspendCount: _gap.suspendCount + 1 };
  return snapshot();
}

/**
 * The system resumed. Arms the flag whether or not the suspend was seen: a resume
 * nobody saw the start of is still a gap, of unknown length — `gapMs` stays null rather
 * than guessing. A wall clock that reads earlier on resume than on suspend (a time
 * sync on wake) measures as 0, never negative.
 * @param {number} now - ms epoch
 * @returns {ObservationGap}
 * @since 0.15.0
 */
function noteResume(now) {
  const t = assertNow(now);
  const suspendedAt = _gap.state === OBSERVATION_GAP_STATE.SUSPENDED ? _gap.suspendedAt : null;
  const gapMs = suspendedAt === null ? null : Math.max(0, t - suspendedAt);
  _gap = {
    ..._gap,
    state: OBSERVATION_GAP_STATE.RESUMED,
    suspendedAt,
    resumedAt: t,
    gapMs,
    clearedAt: null,
    totalGapMs: _gap.totalGapMs + (gapMs === null ? 0 : gapMs),
  };
  return snapshot();
}

/**
 * A real observation happened. Clears RESUMED → NONE and stamps `clearedAt`; the last
 * gap's fields stay readable so a stats reader can still see what was just crossed.
 * While SUSPENDED nothing clears — the resume has not come, and a tick that ran in
 * that window (Modern Standby lets some work through) is not the end of the gap.
 * @param {number} now - ms epoch
 * @returns {ObservationGap}
 * @since 0.15.0
 */
function noteObserved(now) {
  const t = assertNow(now);
  if (_gap.state === OBSERVATION_GAP_STATE.RESUMED) {
    _gap = { ..._gap, state: OBSERVATION_GAP_STATE.NONE, clearedAt: t };
  }
  return snapshot();
}

/**
 * Inject the clock. Defaults to a lazy `Date.now()` read, so a fake-timer install
 * that replaces the global `Date` after this module loaded is still honoured.
 * @param {{ now?: () => number }} [opts]
 * @returns {void}
 * @since 0.15.0
 */
function init(opts = {}) {
  _now = typeof opts.now === 'function' ? opts.now : () => Date.now();
}

/**
 * Subscribe to an injected `powerMonitor`. Electron's is usable only after `app.ready`,
 * which is the caller's business — this takes any `{on(event, listener)}`. Exactly two
 * events: `suspend` and `resume`. `onGap` is called once per resume with the RESUMED
 * snapshot, and is where main.js writes the `observation-gap` audit record.
 * @param {{ on: (event: string, listener: () => void) => unknown }} powerMonitor
 * @param {{ onGap?: (gap: ObservationGap) => void }} [opts]
 * @returns {void}
 * @since 0.15.0
 */
function attach(powerMonitor, opts = {}) {
  if (
    powerMonitor === null ||
    typeof powerMonitor !== 'object' ||
    typeof powerMonitor.on !== 'function'
  ) {
    throw new Error('observation-gap: powerMonitor must expose on(event, listener)');
  }
  if (_attached) {
    throw new Error('observation-gap: already attached — one subscription per process life');
  }
  const onGap = typeof opts.onGap === 'function' ? opts.onGap : null;
  powerMonitor.on('suspend', () => {
    noteSuspend(_now());
  });
  powerMonitor.on('resume', () => {
    const gap = noteResume(_now());
    if (onGap) onGap(gap);
  });
  _attached = true;
}

/**
 * The `details` of an `observation-gap` audit record, from a resumed snapshot plus
 * the operator context only main.js can vouch for. ISO strings, to sit beside the
 * record's own `timestamp`; null where the suspend was never seen.
 * @param {ObservationGap} gap
 * @param {{ monitoringPaused: boolean, activeSessions: number }} ctx
 * @returns {{cause: string, suspendedAt: string|null, resumedAt: string|null,
 *   gapMs: number|null, suspendCount: number, monitoringPaused: boolean, activeSessions: number}}
 * @since 0.15.0
 */
function buildGapAuditDetails(gap, ctx) {
  if (gap === null || typeof gap !== 'object') {
    throw new Error('observation-gap: gap must be a snapshot object');
  }
  if (ctx === null || typeof ctx !== 'object' || typeof ctx.monitoringPaused !== 'boolean') {
    throw new Error('observation-gap: ctx.monitoringPaused must be a boolean');
  }
  if (!Number.isInteger(ctx.activeSessions) || ctx.activeSessions < 0) {
    throw new Error('observation-gap: ctx.activeSessions must be a non-negative integer');
  }
  return {
    cause: GAP_CAUSE,
    suspendedAt: gap.suspendedAt == null ? null : new Date(gap.suspendedAt).toISOString(),
    resumedAt: gap.resumedAt == null ? null : new Date(gap.resumedAt).toISOString(),
    gapMs: gap.gapMs == null ? null : gap.gapMs,
    suspendCount: gap.suspendCount,
    monitoringPaused: ctx.monitoringPaused,
    activeSessions: ctx.activeSessions,
  };
}

/** @internal Reset module state (for tests). @returns {void} */
function _resetForTest() {
  _gap = fresh();
  _now = () => Date.now();
  _attached = false;
}

module.exports = {
  OBSERVATION_GAP_STATE,
  init,
  attach,
  noteSuspend,
  noteResume,
  noteObserved,
  snapshot,
  buildGapAuditDetails,
  _resetForTest,
};
