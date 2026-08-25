// @ts-check
'use strict';

/**
 * @file sequence-engine.js
 * @module main/sequence-engine
 * @description The `temporal_ordered` state machine over the rules `sequence-rule-loader.js`
 *   compiles. State is `Map<ruleId, Map<instanceId, OpenSeq>>` — EXACTLY one open sequence per
 *   (rule, instanceId), so one instance's progress through one rule is one object and a noisy
 *   instance cannot crowd the others out of a rule.
 *
 *   NOTHING CONSUMES THIS YET. No tap calls `ingest`, no tick calls `sweep` and no rule file
 *   exists — the machine is written and pinned before anything is wired to it, on the
 *   ecs-normalizer precedent (PR #294, landed before its first caller).
 *
 *   WHAT IS HERE, AND WHAT IS DELIBERATELY NOT. Ingest, advance, slide, expiry, sweep and
 *   completion, with the clock as the test seam. The bounded-memory caps and eviction
 *   (roadmap §3), the `agent-exit` cleanup with `recentlyExited`, the per-rule counter tables and
 *   the audit record a detection becomes are the NEXT prompts (§7 block 2 prompt 2, block 3) —
 *   `getStats()` publishes exactly the global counters this file produces, and an unbounded map
 *   is what an engine with no caller is allowed to be.
 *
 *   TRANSITION ORDER on an event with key K under rule R — fixed, and covered case by case in
 *   `tests/main/sequence-engine.test.js`:
 *   1. a state whose `elapsed > timespanMs` is discarded (`expired`) and then treated as ABSENT,
 *      so the same event may still open a fresh sequence on step 0;
 *   2. a state whose `step[stepIndex]` matches ADVANCES; on the last step (`elapsed ≤ timespanMs`,
 *      the boundary is inclusive) it emits and is deleted (`completed`). Advance beats 3 and 4:
 *      one event satisfies exactly one step of one rule, and a completion never re-opens on the
 *      event that completed it;
 *   3. a state at `stepIndex === 1` whose event matches `step[0]` SLIDES — `openedAt` and
 *      `evidence[0]` are replaced (`slid`), which widens the window at no memory cost. At
 *      `stepIndex ≥ 2` the same event is IGNORED (`retriggerIgnored`);
 *   4. no state and a match on `step[0]` OPENS (`opened`).
 *
 *   THE RESIDUAL THE SLIDE DOES NOT COVER, written as the guarantee rather than the impression
 *   (ai-mistakes #27). Because the slide is confined to `stepIndex === 1`, a repeat of step 0
 *   arriving after the SECOND step has landed cannot widen the window: `A₁ B₁ A₂ B₂ C` under
 *   `[A, B, C]` fires nothing once A₁'s window closes before C, even though `A₂ B₂ C` fit inside
 *   one window. `A₁ A₂ B C` — the shape roadmap §2 names in passing — is NOT that case and does
 *   fire: A₂ arrives at `stepIndex 1` and slides, and A₁'s expiry stops mattering the moment it
 *   does. Both are pinned by tests. An event that matches no step of a rule leaves that rule
 *   untouched and is counted nowhere; the invariant is that no dropped STATE is silent.
 *
 *   ONE CLOCK, INJECTED. `observedAt = now()` at ingest, for both the window and the order: a
 *   `NetworkConnection` carries no timestamp at all (ECS-MAPPING §5) and a file event carries the
 *   `Date.now()` of its emission, so the two carrier scales are never mixed. Order is arrival
 *   order, which is well defined because every tap is synchronous and ingest is atomic. A
 *   negative elapsed (a clock jump) is clamped to 0 — there is no early expiry.
 *
 *   RESOLUTION, so a rule author knows what a window can measure: scan cadences of 10 s / 30 s
 *   plus chokidar's 2 s per-path debounce mean a meaningful `timespan` starts at about 60 s. A
 *   shorter window can invert the file → network order and fail to fire; the loader's 1 s floor
 *   is a grammar bound, not a promise that 1 s observes anything.
 *
 *   THE KEY IS `carrier.instanceId` VERBATIM, never parsed — parsing it here would be a second
 *   identity resolution (ai-mistakes #19). All three value spaces are accepted as opaque strings:
 *   `pid:startTime`, `0:<name>` for a synthetic, and `<pid>:u`. `<pid>:u` — the linux/darwin
 *   steady state — is not pid-reuse-safe over long windows, and the loader's 24 h `timespan`
 *   ceiling is what bounds that damage. The `attachModels` pid-0 synthetics carry
 *   `instanceId: null` even with confirmed attribution (`src/shared/types/events.ts:74–76`) and
 *   fall under the null policy: counted as `skippedNullInstanceId`, never opening or advancing.
 *
 *   LIFECYCLE: in-memory only, for the life of the process. A state is destroyed on completion,
 *   on expiry, and on `reset` (the hot-reload path, `reloadDiscarded`); an AEGIS restart drops
 *   every open sequence, which is a declared bound and not a defect.
 * @requires ./logger
 * @requires ../shared/ecs-normalizer
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.1.0
 * @since v0.14.0
 */

const logger = require('./logger');
const { normalizeToEcs } = require('../shared/ecs-normalizer');

/** Logger module tag — every line this file emits carries it. @type {string} */
const LOG_MODULE = 'sequence-engine';

/** At most one ingest-error warn per this many ms, on the INJECTED clock. @type {number} */
const WARN_INTERVAL_MS = 60000;

/** Evidence keeps a path only as identification, never as content. @type {number} */
const EVIDENCE_PATH_MAX = 256;

/** @type {readonly unknown[]} */
const NO_CATEGORIES = Object.freeze([]);

/** @typedef {import('./sequence-rule-loader').SequenceRule} SequenceRule */
/** @typedef {import('./sequence-rule-loader').SequenceStep} SequenceStep */

/**
 * @typedef {object} SequenceEvidence
 * @property {string} step - the base document name the event satisfied.
 * @property {string} category - that step's `logsource.category`.
 * @property {number} observedAt - ingest time on the injected clock.
 * @property {string} [action] - the ECS `event.action`, when the projection carries one.
 * @property {string} [path] - `file.path`, truncated to {@link EVIDENCE_PATH_MAX}.
 */

/**
 * @typedef {object} OpenSeq
 * @property {number} stepIndex - the index of the step still WANTED, so an open sequence is at 1.
 * @property {number} openedAt - the window origin; the slide moves it.
 * @property {SequenceEvidence[]} evidence - one entry per satisfied step, in order.
 */

/**
 * @typedef {object} SequenceDetection
 * @property {string} ruleId
 * @property {string} title
 * @property {string} level
 * @property {string} instanceId - the group key, verbatim.
 * @property {number} openedAt
 * @property {number} completedAt
 * @property {number} elapsedMs - `completedAt − openedAt`, clamped at 0.
 * @property {SequenceEvidence[]} evidence - the emitting state's own array; the state is deleted
 *   in the same call, so nothing shares it afterwards.
 */

/**
 * @typedef {object} SequenceCounters
 * @property {number} opened
 * @property {number} completed
 * @property {number} expired
 * @property {number} slid
 * @property {number} retriggerIgnored
 * @property {number} reloadDiscarded
 * @property {number} ingestErrors
 * @property {number} skippedNullInstanceId
 */

/** @returns {SequenceCounters} */
function _zeroCounters() {
  return {
    opened: 0,
    completed: 0,
    expired: 0,
    slid: 0,
    retriggerIgnored: 0,
    reloadDiscarded: 0,
    ingestErrors: 0,
    skippedNullInstanceId: 0,
  };
}

/** @type {SequenceRule[]} */
let _rules = [];

/** @type {((detection: SequenceDetection) => void)|null} */
let _onDetection = null;

/** @type {() => number} */
let _now = Date.now;

/** @type {Map<string, Map<string, OpenSeq>>} */
const _open = new Map();

/** @type {SequenceCounters} */
let _counters = _zeroCounters();

/** The clock reading of the last ingest-error warn. @type {number} */
let _lastIngestWarnAt = Number.NEGATIVE_INFINITY;

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function _isMap(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The window a state has already consumed. A clock that ran backwards yields a negative
 * difference, which is clamped to 0 in ONE place so neither expiry nor the completion boundary
 * has to restate it.
 * @param {OpenSeq} state
 * @param {number} observedAt
 * @returns {number}
 */
function _elapsed(state, observedAt) {
  const delta = observedAt - state.openedAt;
  return delta > 0 ? delta : 0;
}

/**
 * The ECS categorization of one projection. `event.category` is what the step's own
 * `logsource.category` is compared against, and containment is the comparison rather than
 * equality: a `config-access` record projects `['configuration', 'file']` and IS a file event.
 * Two projections carry no category the dictionary knows — an `anomaly-alert` (`intrusion_detection`)
 * and an audit `type` outside the closed union (no `category` key at all) — and both therefore
 * match no step of any rule. That is the intended reading, not an omission to repair.
 * @param {Record<string, unknown>} doc
 * @returns {readonly unknown[]}
 */
function _categoriesOf(doc) {
  const event = doc.event;
  return _isMap(event) && Array.isArray(event.category) ? event.category : NO_CATEGORIES;
}

/**
 * @param {SequenceStep} step
 * @param {Record<string, unknown>} doc
 * @param {readonly unknown[]} categories
 * @returns {boolean}
 */
function _matches(step, doc, categories) {
  return categories.includes(step.category) && step.matcher(doc);
}

/**
 * One evidence entry. Absence is written as absence — a field the projection does not carry is
 * OMITTED rather than emitted as `null`, the convention `ecs-normalizer.js` states.
 * @param {SequenceStep} step
 * @param {Record<string, unknown>} doc
 * @param {number} observedAt
 * @returns {SequenceEvidence}
 */
function _evidence(step, doc, observedAt) {
  /** @type {SequenceEvidence} */
  const out = { step: step.name, category: step.category, observedAt };
  const event = doc.event;
  if (_isMap(event) && typeof event.action === 'string' && event.action !== '') {
    out.action = event.action;
  }
  const file = doc.file;
  if (_isMap(file) && typeof file.path === 'string' && file.path !== '') {
    out.path = file.path.slice(0, EVIDENCE_PATH_MAX);
  }
  return out;
}

/**
 * Drops one state and keeps the outer map free of empty inner maps. The inner map is passed in
 * rather than looked up: every caller already holds it, and a lookup here would need an
 * `undefined` branch that no event could ever reach.
 * @param {Map<string, OpenSeq>} states
 * @param {string} ruleId
 * @param {string} key
 * @returns {void}
 */
function _drop(states, ruleId, key) {
  states.delete(key);
  if (states.size === 0) _open.delete(ruleId);
}

/**
 * One rule's transition for one event. Returns after the FIRST transition it takes: the
 * priority written in the file header is this function's control flow, in order.
 * @param {SequenceRule} rule
 * @param {string} key
 * @param {Record<string, unknown>} doc
 * @param {readonly unknown[]} categories
 * @param {number} observedAt
 * @returns {void}
 */
function _applyRule(rule, key, doc, categories, observedAt) {
  const states = _open.get(rule.id);
  if (states !== undefined) {
    let state = states.get(key);

    // 1 — an expired state leaves as `expired` and the event goes on as if there were none.
    if (state !== undefined && _elapsed(state, observedAt) > rule.timespanMs) {
      _drop(states, rule.id, key);
      _counters.expired++;
      state = undefined;
    }

    if (state !== undefined) {
      const wanted = rule.steps[state.stepIndex];
      // 2 — advance, and complete on the last step. The boundary is inclusive by construction:
      // anything past `timespanMs` was already discarded above.
      if (_matches(wanted, doc, categories)) {
        state.evidence.push(_evidence(wanted, doc, observedAt));
        if (state.stepIndex === rule.steps.length - 1) {
          _drop(states, rule.id, key);
          _counters.completed++;
          _emit(rule, key, state, observedAt);
        } else {
          state.stepIndex++;
        }
        return;
      }
      // 3 — a repeat of step 0: slide at stepIndex 1, ignored above it.
      if (_matches(rule.steps[0], doc, categories)) {
        if (state.stepIndex === 1) {
          state.openedAt = observedAt;
          state.evidence[0] = _evidence(rule.steps[0], doc, observedAt);
          _counters.slid++;
        } else {
          _counters.retriggerIgnored++;
        }
      }
      return;
    }
  }

  // 4 — open. The inner map is re-read rather than reused from above: the expiry branch may
  // have deleted it, and writing into that detached Map would lose the state silently.
  if (!_matches(rule.steps[0], doc, categories)) return;
  let bucket = _open.get(rule.id);
  if (bucket === undefined) {
    bucket = new Map();
    _open.set(rule.id, bucket);
  }
  bucket.set(key, {
    stepIndex: 1,
    openedAt: observedAt,
    evidence: [_evidence(rule.steps[0], doc, observedAt)],
  });
  _counters.opened++;
}

/**
 * Hands a completed sequence to the consumer. The callback is NOT wrapped: a consumer that
 * throws is a consumer defect, and swallowing it here would hide a lost detection.
 * @param {SequenceRule} rule
 * @param {string} key
 * @param {OpenSeq} state
 * @param {number} completedAt
 * @returns {void}
 */
function _emit(rule, key, state, completedAt) {
  if (_onDetection === null) return;
  _onDetection({
    ruleId: rule.id,
    title: rule.title,
    level: rule.level,
    instanceId: key,
    openedAt: state.openedAt,
    completedAt,
    elapsedMs: _elapsed(state, completedAt),
    evidence: state.evidence,
  });
}

/**
 * One warn per {@link WARN_INTERVAL_MS} on the injected clock. The counter is exact; the log is
 * not, because a broken carrier arrives once per event and would otherwise fill the log with one
 * line per scan tick.
 * @param {unknown} err
 * @param {number} observedAt
 * @returns {void}
 */
function _warnIngestError(err, observedAt) {
  if (observedAt - _lastIngestWarnAt < WARN_INTERVAL_MS) return;
  _lastIngestWarnAt = observedAt;
  // `String(err)` rather than a `instanceof Error` ternary: the refusals this catches are always
  // Errors, so the other arm would be a branch nothing can reach, and the `TypeError: ` prefix it
  // keeps is the half of the line an operator reads first.
  logger.warn(LOG_MODULE, `ingest refused an event: ${String(err)}`, {
    reason: 'ingest-error',
    ingestErrors: _counters.ingestErrors,
  });
}

/**
 * Installs the ruleset and the seams. A re-init is a FRESH engine: state and counters both go to
 * zero, which is why the hot-reload path is {@link reset} and not this function — a reload that
 * zeroed `reloadDiscarded` would erase the count of what it had just discarded.
 * @param {object} options
 * @param {SequenceRule[]} [options.rules] - as `sequence-rule-loader` compiled them.
 * @param {(detection: SequenceDetection) => void} [options.onDetection]
 * @param {() => number} [options.now] - epoch ms; `Date.now` when omitted.
 * @returns {void}
 * @since v0.14.0
 */
function init(options) {
  const opts = _isMap(options) ? options : {};
  _rules = Array.isArray(opts.rules) ? opts.rules.slice() : [];
  _onDetection = typeof opts.onDetection === 'function' ? opts.onDetection : null;
  _now = typeof opts.now === 'function' ? opts.now : Date.now;
  _open.clear();
  _counters = _zeroCounters();
  _lastIngestWarnAt = Number.NEGATIVE_INFINITY;
}

/**
 * Offers one live carrier to every loaded rule. Never throws: an unrecognised shape is counted
 * and dropped, because the taps run inside the scan cycle and an exception there would cost the
 * whole tick.
 * @param {unknown} carrier - a `FileEvent`, a `NetworkConnection`, a session record or an audit
 *   record — the four shapes `normalizeToEcs` accepts.
 * @returns {void}
 * @since v0.14.0
 */
function ingest(carrier) {
  // With no rules there is nothing an event could open, and the projection is the expensive
  // part: the engine costs a length check per event until a ruleset is loaded.
  if (_rules.length === 0) return;
  const observedAt = _now();
  if (!_isMap(carrier)) {
    // The same refusal `normalizeToEcs` makes, taken one step earlier so the `instanceId` read
    // below is safe on any argument.
    _counters.ingestErrors++;
    _warnIngestError(
      new TypeError(`expected an event object, received ${typeof carrier}`),
      observedAt,
    );
    return;
  }
  const key = carrier.instanceId;
  if (typeof key !== 'string' || key === '') {
    _counters.skippedNullInstanceId++;
    return;
  }
  /** @type {Record<string, unknown>} */
  let doc;
  try {
    doc = normalizeToEcs(carrier);
  } catch (err) {
    _counters.ingestErrors++;
    _warnIngestError(err, observedAt);
    return;
  }
  const categories = _categoriesOf(doc);
  for (const rule of _rules) _applyRule(rule, key, doc, categories, observedAt);
}

/**
 * Discards every state whose window has closed, so memory does not wait for the next event of
 * the same key. Called once per tick by the scan loop (block 3).
 * @returns {void}
 * @since v0.14.0
 */
function sweep() {
  const at = _now();
  for (const rule of _rules) {
    const states = _open.get(rule.id);
    if (states === undefined) continue;
    for (const [key, state] of states) {
      if (_elapsed(state, at) > rule.timespanMs) {
        states.delete(key);
        _counters.expired++;
      }
    }
    if (states.size === 0) _open.delete(rule.id);
  }
}

/**
 * Drops every open sequence — the hot-reload path, where the rules the states were opened
 * against no longer exist. Counters survive: they describe the process, not the ruleset.
 * @param {string} reason - what asked for it, for the log line.
 * @returns {void}
 * @since v0.14.0
 */
function reset(reason) {
  let discarded = 0;
  for (const states of _open.values()) discarded += states.size;
  _open.clear();
  _counters.reloadDiscarded += discarded;
  if (discarded > 0) {
    logger.info(LOG_MODULE, `discarded ${discarded} open sequence(s)`, { reason, discarded });
  }
}

/**
 * A snapshot of the global counters plus the live `openNow` gauge. A fresh object every call:
 * a caller holding a reference must not be able to move a counter.
 * @returns {SequenceCounters & {openNow: number}}
 * @since v0.14.0
 */
function getStats() {
  let openNow = 0;
  for (const states of _open.values()) openNow += states.size;
  return { ..._counters, openNow };
}

module.exports = {
  init,
  ingest,
  sweep,
  reset,
  getStats,
};
