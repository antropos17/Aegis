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
 *   WIRING (roadmap §5, block 3). The five taps in `main.js` / `scan-loop.js` call `ingest`, the
 *   process tick calls `sweep`, and `main.js` installs the `onDetection` that writes the
 *   `sequence-detection` audit record; `scan-loop.js` reads {@link scoreFor} when it assembles
 *   the per-instance anomaly scores, which is how a detection reaches the existing alert path
 *   without a channel of its own. The rule file is `rules/sequences/sequences.yaml` (SEQ001).
 *
 *   TRANSITION ORDER on an event with key K under rule R — fixed, and covered case by case in
 *   `tests/main/sequence-engine.test.js`:
 *   1. a state whose `elapsed > timespanMs` is discarded (`expired`) and then treated as ABSENT,
 *      so the same event may still open a fresh sequence on step 0;
 *   2. a state whose `step[stepIndex]` matches ADVANCES; on the last step (`elapsed ≤ timespanMs`,
 *      the boundary is inclusive) it emits and is deleted (`completed`). Advance beats 3 and 4:
 *      one event satisfies exactly one step of one rule, and a completion never re-opens on the
 *      event that completed it;
 *   3. a state at `stepIndex === 1` whose event matches `step[0]` SLIDES — `openedAt`, the actor
 *      and `evidence[0]` are replaced (`slid`), which widens the window at no memory cost. At
 *      `stepIndex ≥ 2` the same event is IGNORED (`retriggerIgnored`);
 *   4. no state and a match on `step[0]` OPENS (`opened`) — unless the key exited inside the
 *      last minute (`lateAfterExit`, below) or a cap has to give first (`evicted`, below).
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
 *   BOUNDED MEMORY (roadmap §3). `MAX_OPEN_PER_RULE` distinct instances per rule and
 *   `MAX_OPEN_TOTAL` open sequences overall, both overridable through `init` for tests. A slot
 *   under a rule is held by a DISTINCT instanceId — one instance holds at most one slot per rule
 *   by construction (rule 3 above slides instead of opening), so a noisy instance cannot starve
 *   the others; the starvation attack is rejected by design and pinned by a test. When an open
 *   finds a cap reached: first a MICRO-SWEEP of the affected rule's map (of every map, for the
 *   total cap), so a state that has already expired leaves as `expired` instead of taking quota
 *   from a live one — the hole this closes is that between logical expiry and the tick's
 *   `sweep()` a dead state still held its slot; if the cap is still reached after that, the state
 *   with the OLDEST `openedAt` — the one nearest its own expiry — is evicted (`evicted`, counted
 *   under the rule it belonged to, which for the total cap need not be the rule opening), with a
 *   warn rate-limited to one a minute per rule. Empty inner maps are deleted. Worst case: an
 *   `OpenSeq` is O(steps ≤ 5) fixed fields with the path truncated to 256 characters, so 1024 of
 *   them sit well under 2 MB.
 *
 *   `agent-exit` (roadmap §2). An exit carrier is first offered as a step like any other event —
 *   it can complete a rule whose last step IS the exit — and only then closes every open state
 *   for that instanceId across all rules (`closedOnExit`) and puts the key into
 *   `recentlyExited: Map<instanceId, expiresAt>` for `EXIT_TTL_MS`. The hole THAT closes:
 *   `doFileScan` / `doHotReadScan` are async, so a late handle-scan result for an already-dead
 *   instanceId can arrive AFTER its exit and would otherwise open an orphan that only the window
 *   would ever close. An open for such a key is skipped and counted (`lateAfterExit`), inclusive
 *   of the TTL boundary; a second exit re-arms the TTL; `sweep()` purges entries past it, and an
 *   open past it purges its own entry. An exit closes STATES, never counters: what the exited
 *   instance had already completed stays completed.
 *
 *   THE DETECTION a completion becomes — `onDetection({ ruleId, title, level, timespan,
 *   instanceId, agent, pid, attribution, steps })`. `timespan` is the rule's window in
 *   milliseconds. `agent` and `pid` are the FIRST step's, in the audit conventions (`''` and
 *   `null` for absent — `audit-logger.js` `log()`), so the consumer in block 3 can hand the
 *   record over unchanged; a slide replaces them along with `evidence[0]`. `attribution` is the
 *   WEAKEST LINK across the steps: every attributed step `confirmed` ⇒ `confirmed`, any
 *   `inferred` ⇒ `inferred`, any `unattributed` ⇒ `unattributed`; `evidence` is the union of the
 *   steps' codes in first-appearance order. A step whose carrier projects no
 *   `aegis.attribution` is NEUTRAL (`attribution: null` on the step) — session records on both
 *   sides (the ownership question does not apply, `events.ts`) and, in production, EVERY
 *   `NetworkConnection`: Event Schema v1 gives that carrier no `attribution` field, so SEQ001's
 *   status is decided by its file step alone. A sequence of neutral steps only reports
 *   `confirmed` with empty evidence: the `instanceId` on a session record is the scanner's own
 *   pid observation, and no closed-list code names it. `steps[i]` is `{ step, at, action?,
 *   path?, attribution }` — `action` and `path` are omitted when the projection carries none
 *   (the ecs-normalizer convention), `attribution` is always present because `null` there is a
 *   statement. No array in the payload is shared with a live state.
 *
 *   THE SCORE a detection leaves behind — {@link scoreFor}. The LAST detection on an instance
 *   is remembered with its level and the clock reading it landed on; for `SCORE_HOLD_MS` after
 *   it the instance scores critical 90 / high 70 / medium 55 / low 30 on the anomaly scale, and
 *   `scan-loop.js` merges that with `Math.max` into the per-instance anomaly score, so the
 *   renderer's existing threshold (50) raises the toast for anything medium and above with no
 *   new channel. `informational` scores 0: a score is a claim of risk and that level makes
 *   none. Last-wins on purpose: a later, lower detection re-arms the hold at ITS level, which
 *   is the literal reading of "held after the last detection" and keeps one entry per instance.
 *   The entry is dropped on the read that finds it past the hold and by `sweep()`, so the map
 *   is bounded by the live instances the taps still see. `reset` keeps the entries — a reload
 *   changes the rules, not what an instance did — and `init` clears them.
 *
 *   ONE CLOCK, INJECTED. `observedAt = now()` at ingest, for both the window and the order: a
 *   `NetworkConnection` carries no timestamp at all (ECS-MAPPING §5) and a file event carries the
 *   `Date.now()` of its emission, so the two carrier scales are never mixed. Order is arrival
 *   order, which is well defined because every tap is synchronous and ingest is atomic. A
 *   negative elapsed (a clock jump) is clamped to 0 — there is no early expiry. The exit TTL and
 *   both warn rate limits read the same clock.
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
 *   STATS are a FIXED set of counters — `opened, completed, expired, evicted, slid,
 *   retriggerIgnored, closedOnExit, lateAfterExit, reloadDiscarded, ingestErrors` — kept per
 *   rule (keyed by exactly the loaded ruleIds) and as global aggregates, plus the global-only
 *   `skippedNullInstanceId` (no rule is consulted for a keyless event), the gauges `openNow` and
 *   `peakOpen` at both levels, and the global `recentlyExited` gauge. A per-rule `ingestErrors`
 *   moves only when that rule's own matcher throws; a projection failure precedes rule dispatch
 *   and lands on the global counter alone. `getStats()` returns a fresh copy at both levels.
 *
 *   LIFECYCLE: in-memory only, for the life of the process. A state is destroyed on completion,
 *   on expiry, on eviction, on its instance's exit, and on `reset` (the hot-reload path,
 *   `reloadDiscarded`); an AEGIS restart drops every open sequence, which is a declared bound and
 *   not a defect.
 * @requires ./logger
 * @requires ../shared/ecs-normalizer
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.3.0
 * @since v0.14.0
 */

const logger = require('./logger');
const { normalizeToEcs } = require('../shared/ecs-normalizer');

/** Logger module tag — every line this file emits carries it. @type {string} */
const LOG_MODULE = 'sequence-engine';

/** At most one warn of a kind per this many ms, on the INJECTED clock. @type {number} */
const WARN_INTERVAL_MS = 60000;

/** Evidence keeps a path only as identification, never as content. @type {number} */
const EVIDENCE_PATH_MAX = 256;

/** Distinct instances one rule may hold open (roadmap §3). @type {number} */
const MAX_OPEN_PER_RULE = 128;

/** Open sequences across every rule (roadmap §3). @type {number} */
const MAX_OPEN_TOTAL = 1024;

/** How long an exited key refuses a late open (roadmap §2). @type {number} */
const EXIT_TTL_MS = 60000;

/** How long the last detection keeps scoring its instance (roadmap §5). @type {number} */
const SCORE_HOLD_MS = 10 * 60 * 1000;

/**
 * Level → the score the alert path merges (roadmap §5). `informational` and any label outside
 * the loader's union are absent here and score 0.
 * @type {ReadonlyMap<string, number>}
 */
const LEVEL_SCORE = new Map([
  ['critical', 90],
  ['high', 70],
  ['medium', 55],
  ['low', 30],
]);

/** The ECS action a session record's exit side projects. @type {string} */
const EXIT_ACTION = 'agent-exit';

/**
 * Attribution statuses, strongest first. A status outside the closed union — impossible from
 * typed code — ranks below `unattributed`, so an unknown label can never strengthen a sequence.
 * @type {ReadonlyMap<string, number>}
 */
const STATUS_RANK = new Map([
  ['confirmed', 3],
  ['inferred', 2],
  ['unattributed', 1],
]);

/** @type {readonly unknown[]} */
const NO_CATEGORIES = Object.freeze([]);

/** @typedef {import('./sequence-rule-loader').SequenceRule} SequenceRule */
/** @typedef {import('./sequence-rule-loader').SequenceStep} SequenceStep */

/**
 * @typedef {object} StepAttribution
 * @property {string} status - `confirmed` | `inferred` | `unattributed`, as the carrier said.
 * @property {string[]} evidence - the carrier's codes, copied.
 */

/**
 * @typedef {object} SequenceStepEvidence
 * @property {string} step - the base document name the event satisfied.
 * @property {number} at - ingest time on the injected clock.
 * @property {string} [action] - the ECS `event.action`, when the projection carries one.
 * @property {string} [path] - `file.path`, truncated to {@link EVIDENCE_PATH_MAX}.
 * @property {StepAttribution|null} attribution - `null` when the carrier projects none (neutral).
 */

/**
 * @typedef {object} OpenSeq
 * @property {number} stepIndex - the index of the step still WANTED, so an open sequence is at 1.
 * @property {number} openedAt - the window origin; the slide moves it.
 * @property {string} agent - the first step's `aegis.agent.name`, `''` when it had none.
 * @property {number|null} pid - the first step's `process.pid`, `null` when it had none.
 * @property {SequenceStepEvidence[]} evidence - one entry per satisfied step, in order.
 */

/**
 * @typedef {object} SequenceDetection
 * @property {string} ruleId
 * @property {string} title
 * @property {string} level
 * @property {number} timespan - the rule's window, in milliseconds.
 * @property {string} instanceId - the group key, verbatim.
 * @property {string} agent - from the first step; `''` when it carried none.
 * @property {number|null} pid - from the first step; `null` when it carried none.
 * @property {StepAttribution} attribution - the weakest link across the attributed steps.
 * @property {SequenceStepEvidence[]} steps - the emitting state's own array; the state is
 *   deleted in the same call, so nothing shares it afterwards.
 */

/**
 * @typedef {object} RuleCounters
 * @property {number} opened
 * @property {number} completed
 * @property {number} expired
 * @property {number} evicted
 * @property {number} slid
 * @property {number} retriggerIgnored
 * @property {number} closedOnExit
 * @property {number} lateAfterExit
 * @property {number} reloadDiscarded
 * @property {number} ingestErrors
 */

/** @typedef {keyof RuleCounters} CounterName */

/** @typedef {RuleCounters & {peakOpen: number}} RuleLedger */

/** @typedef {RuleCounters & {openNow: number, peakOpen: number}} RuleStats */

/**
 * @typedef {RuleCounters & {
 *   skippedNullInstanceId: number,
 *   openNow: number,
 *   peakOpen: number,
 *   recentlyExited: number,
 *   rules: Record<string, RuleStats>,
 * }} EngineStats
 */

/** @returns {RuleCounters} */
function _zeroCounters() {
  return {
    opened: 0,
    completed: 0,
    expired: 0,
    evicted: 0,
    slid: 0,
    retriggerIgnored: 0,
    closedOnExit: 0,
    lateAfterExit: 0,
    reloadDiscarded: 0,
    ingestErrors: 0,
  };
}

/** @type {SequenceRule[]} */
let _rules = [];

/** @type {((detection: SequenceDetection) => void)|null} */
let _onDetection = null;

/** @type {() => number} */
let _now = Date.now;

/** @type {number} */
let _maxOpenPerRule = MAX_OPEN_PER_RULE;

/** @type {number} */
let _maxOpenTotal = MAX_OPEN_TOTAL;

/** @type {Map<string, Map<string, OpenSeq>>} */
const _open = new Map();

/** Keys that exited, each with the clock reading its refusal lasts to. @type {Map<string, number>} */
const _recentlyExited = new Map();

/** The LAST detection per key: its level and the clock reading it landed on. @type {Map<string, {level: string, at: number}>} */
const _lastDetection = new Map();

/** @type {RuleCounters & {skippedNullInstanceId: number}} */
let _global = { ..._zeroCounters(), skippedNullInstanceId: 0 };

/** One ledger per loaded ruleId, in load order. @type {Map<string, RuleLedger>} */
let _ledgers = new Map();

/** The live total, kept in step with every insert and delete. @type {number} */
let _openCount = 0;

/** @type {number} */
let _peakOpen = 0;

/** The clock reading of the last ingest-error warn. @type {number} */
let _lastIngestWarnAt = Number.NEGATIVE_INFINITY;

/** The clock reading of the last eviction warn, per rule. @type {Map<string, number>} */
const _lastEvictWarnAt = new Map();

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function _isMap(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * @param {unknown} v
 * @returns {v is string}
 */
function _isString(v) {
  return typeof v === 'string';
}

/**
 * A cap option is honoured only as a positive integer; anything else is the module default.
 * @param {unknown} v
 * @param {number} fallback
 * @returns {number}
 */
function _positiveInt(v, fallback) {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : fallback;
}

/**
 * The ledger of a loaded rule. Every caller reaches this through a rule taken from `_rules`,
 * and `init` builds one ledger per entry of that array, so the lookup cannot miss.
 * @param {string} ruleId
 * @returns {RuleLedger}
 */
function _ledger(ruleId) {
  return /** @type {RuleLedger} */ (_ledgers.get(ruleId));
}

/**
 * Moves one counter on the rule's ledger and on the global aggregate together, so the two can
 * never disagree about a transition.
 * @param {string} ruleId
 * @param {CounterName} name
 * @returns {void}
 */
function _count(ruleId, name) {
  _ledger(ruleId)[name]++;
  _global[name]++;
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
 * Whether the projection is the exit side of a session record — the one event that closes
 * states after it has been offered as a step.
 * @param {Record<string, unknown>} doc
 * @param {readonly unknown[]} categories
 * @returns {boolean}
 */
function _isExit(doc, categories) {
  const event = doc.event;
  return categories.includes('process') && _isMap(event) && event.action === EXIT_ACTION;
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
 * The carrier's attribution as the projection carries it, or `null` when it carries none. The
 * evidence array is copied here even though the normalizer already copied it once: the payload
 * owns what it hands out, and that ownership should not depend on a neighbour's convention.
 * @param {Record<string, unknown>} doc
 * @returns {StepAttribution|null}
 */
function _stepAttribution(doc) {
  const aegis = doc.aegis;
  if (!_isMap(aegis) || !_isMap(aegis.attribution)) return null;
  const src = aegis.attribution;
  if (!_isString(src.status)) return null;
  const evidence = Array.isArray(src.evidence) ? src.evidence.filter(_isString) : [];
  return { status: src.status, evidence };
}

/**
 * One evidence entry. Absence is written as absence — a field the projection does not carry is
 * OMITTED rather than emitted as `null`, the convention `ecs-normalizer.js` states. `attribution`
 * is the exception: `null` there is the neutral-step statement, so the key is always present.
 * @param {SequenceStep} step
 * @param {Record<string, unknown>} doc
 * @param {number} observedAt
 * @returns {SequenceStepEvidence}
 */
function _evidence(step, doc, observedAt) {
  /** @type {SequenceStepEvidence} */
  const out = { step: step.name, at: observedAt, attribution: null };
  const event = doc.event;
  if (_isMap(event) && _isString(event.action) && event.action !== '') {
    out.action = event.action;
  }
  const file = doc.file;
  if (_isMap(file) && _isString(file.path) && file.path !== '') {
    out.path = file.path.slice(0, EVIDENCE_PATH_MAX);
  }
  out.attribution = _stepAttribution(doc);
  return out;
}

/**
 * The actor of a step-0 event, in the audit conventions: `''` for no agent, `null` for no pid.
 * `process.pid` is only ever a positive integer in a projection (the normalizer omits 0 and
 * `null`), so a number here is a pid the OS handed out.
 * @param {Record<string, unknown>} doc
 * @returns {{agent: string, pid: number|null}}
 */
function _actorOf(doc) {
  const aegis = doc.aegis;
  const agentBranch = _isMap(aegis) && _isMap(aegis.agent) ? aegis.agent : null;
  const agent = agentBranch !== null && _isString(agentBranch.name) ? agentBranch.name : '';
  const proc = doc.process;
  const pid = _isMap(proc) && typeof proc.pid === 'number' ? proc.pid : null;
  return { agent, pid };
}

/**
 * The weakest link across the attributed steps, and the union of their codes in
 * first-appearance order. Neutral steps contribute nothing, which is what leaves an
 * all-neutral sequence at `confirmed` with no evidence — the header states why.
 * @param {SequenceStepEvidence[]} steps
 * @returns {StepAttribution}
 */
function _foldAttribution(steps) {
  let status = 'confirmed';
  let rank = Number.POSITIVE_INFINITY;
  /** @type {string[]} */
  const evidence = [];
  for (const step of steps) {
    if (step.attribution === null) continue;
    const r = STATUS_RANK.get(step.attribution.status) ?? 0;
    if (r < rank) {
      rank = r;
      status = step.attribution.status;
    }
    for (const code of step.attribution.evidence) {
      if (!evidence.includes(code)) evidence.push(code);
    }
  }
  return { status, evidence };
}

/**
 * Drops one state, keeps the live total in step, and keeps the outer map free of empty inner
 * maps. The inner map is passed in rather than looked up: every caller already holds it, and a
 * lookup here would need an `undefined` branch that no event could ever reach.
 * @param {Map<string, OpenSeq>} states
 * @param {string} ruleId
 * @param {string} key
 * @returns {void}
 */
function _drop(states, ruleId, key) {
  states.delete(key);
  _openCount--;
  if (states.size === 0) _open.delete(ruleId);
}

/**
 * Discards every expired state under one rule (`expired`). Shared by the tick's `sweep()` and
 * the caps' micro-sweep, so the two can never disagree about what expiry means.
 * @param {SequenceRule} rule
 * @param {number} at
 * @returns {void}
 */
function _sweepRule(rule, at) {
  const states = _open.get(rule.id);
  if (states === undefined) return;
  for (const [key, state] of states) {
    if (_elapsed(state, at) > rule.timespanMs) {
      _drop(states, rule.id, key);
      _count(rule.id, 'expired');
    }
  }
}

/**
 * One warn per {@link WARN_INTERVAL_MS} per rule on the injected clock; the counter is exact.
 * @param {string} ruleId - the rule whose state was evicted.
 * @param {'per-rule'|'total'} cap
 * @param {number} limit
 * @param {number} observedAt
 * @returns {void}
 */
function _warnEvicted(ruleId, cap, limit, observedAt) {
  const last = _lastEvictWarnAt.get(ruleId);
  if (last !== undefined && observedAt - last < WARN_INTERVAL_MS) return;
  _lastEvictWarnAt.set(ruleId, observedAt);
  logger.warn(
    LOG_MODULE,
    `${cap} cap of ${limit} open sequences reached: evicted the oldest under ${ruleId}`,
    { reason: 'cap-evicted', rule: ruleId, cap, limit, evicted: _ledger(ruleId).evicted },
  );
}

/**
 * Evicts the state with the oldest `openedAt` in one map — the one nearest its own expiry.
 * @param {string} ruleId
 * @param {Map<string, OpenSeq>} states - non-empty: the caller found it at the cap.
 * @param {'per-rule'|'total'} cap
 * @param {number} limit
 * @param {number} observedAt
 * @returns {void}
 */
function _evictOldestIn(ruleId, states, cap, limit, observedAt) {
  let oldestKey = '';
  let oldestAt = Number.POSITIVE_INFINITY;
  for (const [key, state] of states) {
    if (state.openedAt < oldestAt) {
      oldestAt = state.openedAt;
      oldestKey = key;
    }
  }
  _drop(states, ruleId, oldestKey);
  _count(ruleId, 'evicted');
  _warnEvicted(ruleId, cap, limit, observedAt);
}

/**
 * Makes room for one open under `rule`: micro-sweep first, eviction only if that was not enough,
 * on the rule's own map and then on the whole engine. Each cap gives at most one state, because
 * the caller inserts exactly one.
 * @param {SequenceRule} rule
 * @param {number} observedAt
 * @returns {void}
 */
function _makeRoom(rule, observedAt) {
  let states = _open.get(rule.id);
  if (states !== undefined && states.size >= _maxOpenPerRule) {
    _sweepRule(rule, observedAt);
    // Re-read: the sweep deletes the inner map when it empties it.
    states = _open.get(rule.id);
    if (states !== undefined && states.size >= _maxOpenPerRule) {
      _evictOldestIn(rule.id, states, 'per-rule', _maxOpenPerRule, observedAt);
    }
  }
  if (_openCount < _maxOpenTotal) return;
  for (const r of _rules) _sweepRule(r, observedAt);
  if (_openCount < _maxOpenTotal) return;
  // Still at the cap, so at least one state exists; find the oldest across every rule.
  let victimRule = '';
  /** @type {Map<string, OpenSeq>|null} */
  let victimStates = null;
  let oldestAt = Number.POSITIVE_INFINITY;
  for (const [ruleId, bucket] of _open) {
    for (const state of bucket.values()) {
      if (state.openedAt < oldestAt) {
        oldestAt = state.openedAt;
        victimRule = ruleId;
        victimStates = bucket;
      }
    }
  }
  if (victimStates !== null) {
    _evictOldestIn(victimRule, victimStates, 'total', _maxOpenTotal, observedAt);
  }
}

/**
 * Transition 4. The exit gate comes first: a key inside its exit TTL opens nothing and is
 * counted, and one past it purges its own entry. Then the caps, then the insert.
 * @param {SequenceRule} rule
 * @param {string} key
 * @param {Record<string, unknown>} doc
 * @param {number} observedAt
 * @returns {void}
 */
function _openState(rule, key, doc, observedAt) {
  const refusesUntil = _recentlyExited.get(key);
  if (refusesUntil !== undefined) {
    if (observedAt <= refusesUntil) {
      _count(rule.id, 'lateAfterExit');
      return;
    }
    _recentlyExited.delete(key);
  }
  _makeRoom(rule, observedAt);
  // The inner map is re-read rather than reused from any earlier lookup: expiry, the sweep and
  // eviction all delete it when they empty it, and writing into a detached Map would lose the
  // state silently.
  let states = _open.get(rule.id);
  if (states === undefined) {
    states = new Map();
    _open.set(rule.id, states);
  }
  const { agent, pid } = _actorOf(doc);
  states.set(key, {
    stepIndex: 1,
    openedAt: observedAt,
    agent,
    pid,
    evidence: [_evidence(rule.steps[0], doc, observedAt)],
  });
  _openCount++;
  if (_openCount > _peakOpen) _peakOpen = _openCount;
  const ledger = _ledger(rule.id);
  if (states.size > ledger.peakOpen) ledger.peakOpen = states.size;
  _count(rule.id, 'opened');
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
      _count(rule.id, 'expired');
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
          _count(rule.id, 'completed');
          _emit(rule, key, state, observedAt);
        } else {
          state.stepIndex++;
        }
        return;
      }
      // 3 — a repeat of step 0: slide at stepIndex 1, ignored above it.
      if (_matches(rule.steps[0], doc, categories)) {
        if (state.stepIndex === 1) {
          const { agent, pid } = _actorOf(doc);
          state.openedAt = observedAt;
          state.agent = agent;
          state.pid = pid;
          state.evidence[0] = _evidence(rule.steps[0], doc, observedAt);
          _count(rule.id, 'slid');
        } else {
          _count(rule.id, 'retriggerIgnored');
        }
      }
      return;
    }
  }

  // 4 — open.
  if (_matches(rule.steps[0], doc, categories)) _openState(rule, key, doc, observedAt);
}

/**
 * Records the detection for {@link scoreFor} and hands it to the consumer. The score is
 * recorded FIRST and regardless of a consumer: the alert path reads it off this module, not off
 * the audit record. The callback is NOT wrapped: a consumer that throws is a consumer defect,
 * and swallowing it here would hide a lost detection.
 * @param {SequenceRule} rule
 * @param {string} key
 * @param {OpenSeq} state
 * @param {number} observedAt - the clock reading of the completing event.
 * @returns {void}
 */
function _emit(rule, key, state, observedAt) {
  _lastDetection.set(key, { level: rule.level, at: observedAt });
  if (_onDetection === null) return;
  _onDetection({
    ruleId: rule.id,
    title: rule.title,
    level: rule.level,
    timespan: rule.timespanMs,
    instanceId: key,
    agent: state.agent,
    pid: state.pid,
    attribution: _foldAttribution(state.evidence),
    steps: state.evidence,
  });
}

/**
 * Closes every open state of an exited key (`closedOnExit`) and marks the key for
 * {@link EXIT_TTL_MS}. Runs AFTER the exit was offered as a step, so a rule the exit completed
 * has already deleted its own state and is not counted here.
 * @param {string} key
 * @param {number} observedAt
 * @returns {void}
 */
function _closeOnExit(key, observedAt) {
  for (const rule of _rules) {
    const states = _open.get(rule.id);
    if (states === undefined || !states.has(key)) continue;
    _drop(states, rule.id, key);
    _count(rule.id, 'closedOnExit');
  }
  _recentlyExited.set(key, observedAt + EXIT_TTL_MS);
}

/**
 * One warn per {@link WARN_INTERVAL_MS} on the injected clock. The counter is exact; the log is
 * not, because a broken carrier arrives once per event and would otherwise fill the log with one
 * line per scan tick.
 * @param {unknown} err
 * @param {number} observedAt
 * @param {string|null} ruleId - the rule whose matcher threw, or null for a projection failure.
 * @returns {void}
 */
function _warnIngestError(err, observedAt, ruleId) {
  if (observedAt - _lastIngestWarnAt < WARN_INTERVAL_MS) return;
  _lastIngestWarnAt = observedAt;
  // `String(err)` rather than a `instanceof Error` ternary: the refusals this catches are always
  // Errors, so the other arm would be a branch nothing can reach, and the `TypeError: ` prefix it
  // keeps is the half of the line an operator reads first.
  logger.warn(LOG_MODULE, `ingest refused an event: ${String(err)}`, {
    reason: 'ingest-error',
    rule: ruleId,
    ingestErrors: _global.ingestErrors,
  });
}

/**
 * Installs the ruleset and the seams. A re-init is a FRESH engine: state, exit marks, gauges and
 * counters all go to zero, which is why the hot-reload path is {@link reset} and not this
 * function — a reload that zeroed `reloadDiscarded` would erase the count of what it had just
 * discarded.
 * @param {object} options
 * @param {SequenceRule[]} [options.rules] - as `sequence-rule-loader` compiled them.
 * @param {(detection: SequenceDetection) => void} [options.onDetection]
 * @param {() => number} [options.now] - epoch ms; `Date.now` when omitted.
 * @param {number} [options.maxOpenPerRule] - {@link MAX_OPEN_PER_RULE} unless a positive integer.
 * @param {number} [options.maxOpenTotal] - {@link MAX_OPEN_TOTAL} unless a positive integer.
 * @returns {void}
 * @since v0.14.0
 */
function init(options) {
  const opts = _isMap(options) ? options : {};
  _rules = Array.isArray(opts.rules) ? opts.rules.slice() : [];
  _onDetection = typeof opts.onDetection === 'function' ? opts.onDetection : null;
  _now = typeof opts.now === 'function' ? opts.now : Date.now;
  _maxOpenPerRule = _positiveInt(opts.maxOpenPerRule, MAX_OPEN_PER_RULE);
  _maxOpenTotal = _positiveInt(opts.maxOpenTotal, MAX_OPEN_TOTAL);
  _open.clear();
  _recentlyExited.clear();
  _lastDetection.clear();
  _openCount = 0;
  _peakOpen = 0;
  _global = { ..._zeroCounters(), skippedNullInstanceId: 0 };
  _ledgers = new Map();
  for (const rule of _rules) {
    if (!_ledgers.has(rule.id)) _ledgers.set(rule.id, { ..._zeroCounters(), peakOpen: 0 });
  }
  _lastIngestWarnAt = Number.NEGATIVE_INFINITY;
  _lastEvictWarnAt.clear();
}

/**
 * Offers one live carrier to every loaded rule. Never throws: an unrecognised shape is counted
 * and dropped, and so is a rule whose matcher throws — the other rules still see the event —
 * because the taps run inside the scan cycle and an exception there would cost the whole tick.
 * An exit carrier is offered as a step first and closes the key's states after.
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
    _global.ingestErrors++;
    _warnIngestError(
      new TypeError(`expected an event object, received ${typeof carrier}`),
      observedAt,
      null,
    );
    return;
  }
  const key = carrier.instanceId;
  if (!_isString(key) || key === '') {
    _global.skippedNullInstanceId++;
    return;
  }
  /** @type {Record<string, unknown>} */
  let doc;
  try {
    doc = normalizeToEcs(carrier);
  } catch (err) {
    _global.ingestErrors++;
    _warnIngestError(err, observedAt, null);
    return;
  }
  const categories = _categoriesOf(doc);
  for (const rule of _rules) {
    try {
      _applyRule(rule, key, doc, categories, observedAt);
    } catch (err) {
      // A matcher is consulted before any state is touched on every branch, so a throw leaves
      // this rule's state exactly as it was.
      _count(rule.id, 'ingestErrors');
      _warnIngestError(err, observedAt, rule.id);
    }
  }
  if (_isExit(doc, categories)) _closeOnExit(key, observedAt);
}

/**
 * Discards every state whose window has closed, every exit mark past its TTL and every score
 * past its hold, so memory does not wait for the next event — or the next score read — of the
 * same key. Called once per tick by the scan loop (block 3).
 * @returns {void}
 * @since v0.14.0
 */
function sweep() {
  const at = _now();
  for (const rule of _rules) _sweepRule(rule, at);
  for (const [key, refusesUntil] of _recentlyExited) {
    if (at > refusesUntil) _recentlyExited.delete(key);
  }
  for (const [key, last] of _lastDetection) {
    if (at - last.at > SCORE_HOLD_MS) _lastDetection.delete(key);
  }
}

/**
 * Drops every open sequence — the hot-reload path, where the rules the states were opened
 * against no longer exist. Counters survive: they describe the process, not the ruleset. Exit
 * marks survive too: they describe instances, which a reload does not change.
 * @param {string} reason - what asked for it, for the log line.
 * @returns {void}
 * @since v0.14.0
 */
function reset(reason) {
  let discarded = 0;
  for (const [ruleId, states] of _open) {
    _ledger(ruleId).reloadDiscarded += states.size;
    discarded += states.size;
  }
  _open.clear();
  _openCount = 0;
  _global.reloadDiscarded += discarded;
  if (discarded > 0) {
    logger.info(LOG_MODULE, `discarded ${discarded} open sequence(s)`, { reason, discarded });
  }
}

/**
 * The score the last detection on `instanceId` still earns on the anomaly scale — critical 90,
 * high 70, medium 55, low 30 — for {@link SCORE_HOLD_MS} after it landed, inclusive of the
 * boundary; 0 for any other level, for a key with no detection, for one past its hold (the
 * entry is dropped on that read) and for a key that is not a string. Reads the injected clock.
 * The alert path (`scan-loop.js`) merges this with `Math.max` into the per-instance anomaly
 * score. Never throws and moves no counter.
 * @param {unknown} instanceId - `carrier.instanceId` verbatim, as the taps carry it.
 * @returns {number}
 * @since v0.14.0
 */
function scoreFor(instanceId) {
  if (!_isString(instanceId)) return 0;
  const last = _lastDetection.get(instanceId);
  if (last === undefined) return 0;
  if (_now() - last.at > SCORE_HOLD_MS) {
    _lastDetection.delete(instanceId);
    return 0;
  }
  const score = LEVEL_SCORE.get(last.level);
  return score === undefined ? 0 : score;
}

/**
 * A snapshot: the global counters and gauges plus one `rules[ruleId]` block per loaded rule. A
 * fresh object at both levels every call, so a caller holding a reference cannot move a counter.
 * @returns {EngineStats}
 * @since v0.14.0
 */
function getStats() {
  /** @type {Record<string, RuleStats>} */
  const rules = {};
  for (const [ruleId, ledger] of _ledgers) {
    const states = _open.get(ruleId);
    rules[ruleId] = { ...ledger, openNow: states === undefined ? 0 : states.size };
  }
  return {
    ..._global,
    openNow: _openCount,
    peakOpen: _peakOpen,
    recentlyExited: _recentlyExited.size,
    rules,
  };
}

module.exports = {
  init,
  ingest,
  sweep,
  reset,
  scoreFor,
  getStats,
};
