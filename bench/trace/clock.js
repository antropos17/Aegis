/**
 * @file bench/trace/clock.js
 * @module bench/trace/clock
 * @description A virtual clock, and the switch that puts it in front of the real one.
 *
 *   Replay has to be able to state that the same bytes in produce the same verdicts
 *   out, and the product reads the wall clock in more than twenty places: an event's
 *   `timestamp`, the watcher's 2 s debounce, the scan loop's 30 s dedup window, the
 *   DNS cache TTL, a session's `firstSeen`, and — the one no injection point covers —
 *   `src/main/audit-logger.js` stamping `new Date().toISOString()` on every record it
 *   writes. That module takes an injectable `now` through `init({now})`, but it is
 *   used for DAY ROTATION only; the record's own timestamp is read from the global.
 *   So the global is what has to move.
 *
 *   WHAT THIS IS NOT. It is not a fake timer library and it does not touch
 *   `setTimeout` or `setInterval`. Replay never starts the product's scan intervals —
 *   cadence is supplied by the trace, as `clock.advance` records — so the only live
 *   timer in a replay is the audit logger's 5 s flush, which is stopped by calling
 *   the product's own `shutdown()`. A trace's clock moves only when a record says so.
 *
 *   NOTHING HERE READS OR WRITES ANYTHING. The clock is a value; `install` is the
 *   only function with a side effect, it names its target, and it hands back the
 *   exact undo.
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.12.0
 */

'use strict';

/**
 * The global a preload stamps once the clock is in place.
 *
 * It exists so that "the preload did not run" is DETECTABLE rather than silent. A
 * harness that only checked `Date.now()` against the trace's epoch would be fooled by
 * a real clock that happens to be near it, and a replay that quietly ran on wall time
 * would produce a plausible verdict nobody could reproduce.
 * @type {string}
 */
const MARKER = '__aegisTraceClock';

/** @type {number} The marker's shape version, so a mismatched pair is not read as a match. */
const MARKER_VERSION = 1;

/**
 * The clock this process installed, if any.
 *
 * Module state rather than another global: a preload and the harness `require` this
 * file by the same absolute path, so they share one instance, and one process holds
 * exactly one clock. The global marker answers "is a clock in front of the real one";
 * this answers "which one", and the two are deliberately separate — a caller must not
 * be able to get a handle to a clock that was never installed.
 * @type {Object|null}
 */
let _current = null;

/** A clock misuse. Separate from a trace refusal: this is the harness, not the file. */
class ClockError extends Error {
  /**
   * @param {string} reason - `clock-reversed` | `clock-invalid` | `clock-not-installed`.
   * @param {string} message - What a caller needs in order to act.
   */
  constructor(reason, message) {
    super(message);
    this.name = 'ClockError';
    this.reason = reason;
  }
}

/**
 * Create a virtual clock starting at an instant.
 *
 * Time moves FORWARD ONLY, and only when {@link VirtualClock#advanceTo} is called.
 * Going backwards is refused rather than clamped: a trace whose records are out of
 * order is a trace nobody recorded that way, and silently holding the clock still
 * would let the watcher's debounce and the scan loop's dedup window answer questions
 * about an ordering the recording never had.
 * @param {number} startEpochMs - Milliseconds since the epoch. Must be a non-negative
 *   safe integer: every window the product compares against is integer milliseconds.
 * @returns {Object} The clock.
 * @throws {ClockError} `clock-invalid` when the start is not a usable instant.
 */
function createClock(startEpochMs) {
  if (!Number.isSafeInteger(startEpochMs) || startEpochMs < 0) {
    throw new ClockError(
      'clock-invalid',
      `a clock starts at a non-negative safe integer of milliseconds, not ` +
        `${JSON.stringify(startEpochMs)}`,
    );
  }
  let current = startEpochMs;

  return {
    /** @returns {number} The instant the clock reads now. */
    now() {
      return current;
    },
    /** @returns {number} The instant the clock was created at; never moves. */
    epoch() {
      return startEpochMs;
    },
    /**
     * Move the clock forward to an instant.
     * @param {number} epochMs - The instant to move to. May equal the current one:
     *   two observations can share a millisecond, and refusing that would make the
     *   format unable to record what the machine actually did.
     * @returns {number} The new instant.
     * @throws {ClockError} `clock-invalid` or `clock-reversed`.
     */
    advanceTo(epochMs) {
      if (!Number.isSafeInteger(epochMs) || epochMs < 0) {
        throw new ClockError(
          'clock-invalid',
          `cannot advance to ${JSON.stringify(epochMs)} — an instant is a non-negative safe ` +
            'integer of milliseconds',
        );
      }
      if (epochMs < current) {
        throw new ClockError(
          'clock-reversed',
          `cannot advance to ${epochMs} from ${current} — a virtual clock moves forward only, ` +
            'and a recording whose instants go backwards is not one this harness can replay',
        );
      }
      current = epochMs;
      return current;
    },
  };
}

/**
 * Put a clock in front of the real one, on a target global object.
 *
 * Three globals move, and each is read by the product:
 *   - `Date.now()` — the watcher's debounce, the scan loop's dedup key, session
 *     bookkeeping, the DNS cache TTL.
 *   - `new Date()` with no arguments — `audit-logger.js`'s record timestamp and its
 *     day-rotation string, and `baselines.js`'s local-hour bucket. `new Date(x)` with
 *     an argument is untouched: it names an instant the caller already has.
 *   - `performance.now()` — only ever used for durations the product logs, but it is
 *     replaced so that no path can reach a real clock at all. It reads as
 *     milliseconds since this clock's own epoch.
 *
 * `Date` is replaced by a PROXY over the real constructor rather than by a subclass,
 * so `Date.parse`, `Date.UTC`, `instanceof`, `Date.prototype` and calling `Date()`
 * without `new` all keep working. A subclass would quietly change identity for code
 * that never asked for a virtual clock.
 * @param {Object} clock - A clock from {@link createClock}.
 * @param {Object} [target] - The global to patch. Defaults to `globalThis`.
 * @returns {() => void} The exact undo. Calling it twice is a no-op.
 */
function install(clock, target = globalThis) {
  _current = clock;
  const RealDate = target.Date;
  const realPerformanceNow = target.performance ? target.performance.now : null;

  const VirtualDate = new Proxy(RealDate, {
    construct(ctor, args, newTarget) {
      const effective = args.length === 0 ? [clock.now()] : args;
      return Reflect.construct(ctor, effective, newTarget);
    },
    // `Date(...)` without `new` returns a STRING and ignores its arguments — that is
    // the language's rule, not ours, and the virtual clock only changes which instant
    // the string describes.
    apply() {
      return new RealDate(clock.now()).toString();
    },
    get(ctor, prop, receiver) {
      if (prop === 'now') return () => clock.now();
      return Reflect.get(ctor, prop, receiver);
    },
  });

  target.Date = VirtualDate;
  if (realPerformanceNow) {
    target.performance.now = () => clock.now() - clock.epoch();
  }
  target[MARKER] = Object.freeze({
    version: MARKER_VERSION,
    epochMs: clock.epoch(),
    installedAt: 'preload',
  });

  let undone = false;
  return function uninstall() {
    if (undone) return;
    undone = true;
    target.Date = RealDate;
    if (realPerformanceNow) target.performance.now = realPerformanceNow;
    delete target[MARKER];
    _current = null;
  };
}

/**
 * Whether a virtual clock is in front of the real one on this global.
 *
 * A caller that needs the clock must ask this BEFORE it does anything else. The
 * failure this exists for is a preload that did not run — `--require` misspelled, an
 * env var unset, a wrapper that dropped the flag — which otherwise looks exactly like
 * a preload that worked, right up until the verdict file cannot be reproduced.
 * @param {Object} [target] - The global to inspect. Defaults to `globalThis`.
 * @returns {boolean}
 */
function isInstalled(target = globalThis) {
  const marker = target[MARKER];
  return !!marker && marker.version === MARKER_VERSION;
}

/**
 * The instant a preloaded clock was seeded at, or refuse.
 * @param {Object} [target] - The global to inspect. Defaults to `globalThis`.
 * @returns {number} The seeded epoch.
 * @throws {ClockError} `clock-not-installed` when no clock is in front of the real one.
 */
function installedEpochMs(target = globalThis) {
  if (!isInstalled(target)) {
    throw new ClockError(
      'clock-not-installed',
      'no virtual clock is installed on this process — run the entrypoint with ' +
        '`node --require bench/trace/preload.js`. A replay on the wall clock produces a ' +
        'verdict nobody can reproduce, and it looks exactly like one that can',
    );
  }
  return target[MARKER].epochMs;
}

/**
 * The clock this process installed.
 *
 * The handle a harness advances from `clock.advance` records. It is reachable only
 * after {@link install} has run, so a caller cannot advance a clock nothing is
 * reading.
 * @returns {Object} The installed clock.
 * @throws {ClockError} `clock-not-installed` when none is.
 */
function currentClock() {
  if (!_current) {
    throw new ClockError(
      'clock-not-installed',
      'no virtual clock has been installed in this process, so there is none to advance',
    );
  }
  return _current;
}

module.exports = {
  ClockError,
  MARKER,
  MARKER_VERSION,
  createClock,
  currentClock,
  install,
  installedEpochMs,
  isInstalled,
};
