/**
 * @file token-tracker.js
 * @module main/token-tracker
 * @description Per-agent (per-PID) token + cost accounting. A pure, isolated
 *   accounting module with no I/O and no Electron dependency — callers feed it
 *   usage events and read back accumulated token counts and a USD cost estimate.
 *
 *   HONESTY MODEL (this drives the whole design). AEGIS cannot observe a
 *   monitored agent's real token usage: those counts live inside that agent's
 *   own TLS session to the model API and never appear on any wire AEGIS sees.
 *   Measured counts can also come from allowlisted numeric usage in matching
 *   local Claude Code transcripts. Coverage depends on readable supported files.
 *
 *   - A caller that HAS real measured counts passes them as-is → `estimated:false`.
 *   - A caller that only has a proxy computes counts itself and passes them with
 *     `estimated:true`. This module never fabricates counts and never invents a
 *     char→token conversion (chars are inside the same unobservable TLS session
 *     as tokens, so a char proxy would imply a data source we do not have).
 *
 *   The `estimated` flag reports whether the TOKEN COUNTS are measured vs
 *   guessed — the thing AEGIS actually observes. It does NOT certify the dollar
 *   figure: even where `MODEL_PRICING` rates are verified, an unknown model id
 *   still falls back to `DEFAULT_PRICING` and flips `estimated` true.
 *
 *   Attribution is per-INSTANCE (C-01): every count is keyed by the process
 *   INSTANCE (`instanceId` = pid bound to its OS birth time, see
 *   process-identity.js), with the pid stored alongside for display — so
 *   concurrency or interleaved events can never cross-wire one agent's usage
 *   onto another, and a recycled pid can never inherit a dead instance's
 *   accumulated tokens, cost, or sticky `estimated` flag.
 *
 *   Records for exited instances are RETAINED deliberately: the footer sums
 *   `getAllCosts()` into a session-total spend, and that figure must be
 *   monotonic — an agent exiting must not roll back money already spent. That
 *   is why this module has no prune analogous to the file-watcher's
 *   `pruneKnownHandles` (dedup must not leak; accounting must not forget).
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.1.0
 */
'use strict';

const { buildInstanceId } = require('./process-identity');

const { MODEL_PRICING, DEFAULT_PRICING, computeCost } = require('./token-pricing');

/**
 * @typedef {Object} ProcRef
 * @property {number} pid - OS process id; must be a finite number > 0.
 * @property {number|null} [startTime] - OS process-creation time (epoch ms), used
 *   to derive the instance key when no `instanceId` is stamped.
 * @property {string} [instanceId] - instance key stamped upstream
 *   (procUtil.enrichWithParentChains); preferred over local derivation.
 */

/**
 * @typedef {Object} CostRecord
 * @property {string} instanceId - the process INSTANCE this usage is keyed by
 *   (C-01 key; see process-identity.js for the three value spaces).
 * @property {number} pid - the owning process id, stored alongside for display.
 * @property {number} inputTokens - accumulated prompt/input tokens.
 * @property {number} outputTokens - accumulated completion/output tokens.
 * @property {number} totalTokens - `inputTokens + outputTokens`.
 * @property {number} costUsd - accumulated cost in USD (raw float; round at the
 *   display layer). Uses the local {@link MODEL_PRICING} table; rates can become
 *   out of date and are not a provider billing statement.
 * @property {boolean} estimated - true once ANY contributing event had estimated
 *   counts or used an unknown-model fallback price (sticky — never flips back).
 * @property {boolean} [pricingEstimated] - sticky cache-pricing assumption flag;
 *   an unknown write duration does not change measured token counts.
 * @property {string[]} models - distinct model ids that contributed, in first-seen order.
 */

/**
 * @typedef {Object} TokenEvent
 * @property {string} [model] - model id; matched against {@link MODEL_PRICING}.
 * @property {number} [inputTokens] - measured or caller-estimated input tokens.
 * @property {number} [outputTokens] - measured or caller-estimated output tokens.
 * @property {{uncached:number, read:number, write5m:number, write1h:number, writeUnknown:number}} [inputBreakdown] - numeric input categories.
 * @property {boolean} [estimated] - set true when the counts above are an
 *   estimate the caller computed, not measured usage.
 */

/** @type {Map<string, CostRecord>} Accumulated cost records keyed by instanceId. */
const records = new Map();

/**
 * True when `v` is a finite number greater than zero (valid pid).
 * @param {*} v
 * @returns {boolean}
 */
function isPositiveNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * True when `v` is a finite number ≥ 0 (valid token count).
 * @param {*} v
 * @returns {boolean}
 */
function isNonNegativeNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/**
 * Extract the owning pid from a proc ref (bare number or {@link ProcRef}).
 * @param {number|ProcRef} proc
 * @returns {*} the pid candidate, validated by the caller.
 */
function pidOf(proc) {
  if (typeof proc === 'number') return proc;
  return proc && typeof proc === 'object' ? proc.pid : null;
}

/**
 * Accounting key for `records`: the process INSTANCE, never the bare pid — a
 * recycled pid must never inherit a dead instance's accumulated record. Shared
 * by every write AND read path, so a key mismatch between them is impossible by
 * construction (same invariant as file-watcher's `handleKey`).
 *
 * Prefers the `instanceId` stamped upstream by procUtil.enrichWithParentChains.
 * Does NOT re-derive from `{pid, startTime}` — that is a second identity resolution
 * and can disagree with the scan-batch stamp (ai-mistakes.md #19).
 *
 * Bare-number callers (token-cost-collector miss path) degrade explicitly to the
 * `"<pid>:u"` space — documented honest degradation, not a full OS instance claim.
 * @param {number|ProcRef} proc
 * @returns {string|null}
 */
function recordKey(proc) {
  if (typeof proc === 'number') {
    return Number.isInteger(proc) && proc > 0 ? buildInstanceId({ pid: proc }) : null;
  }
  if (!proc || typeof proc !== 'object') return null;
  if (typeof proc.instanceId === 'string' && proc.instanceId) return proc.instanceId;
  // Unstamped object: space-3 degradation by pid only — never invent birth-time identity.
  if (Number.isInteger(proc.pid) && proc.pid > 0) return buildInstanceId({ pid: proc.pid });
  return null;
}

/**
 * Honest zero-state record for an instance with no tracked usage.
 * `estimated:false` because an exact zero is a fact, not a guess.
 * @param {number} pid
 * @param {string} instanceId
 * @returns {CostRecord}
 */
function zeroRecord(pid, instanceId) {
  return {
    instanceId,
    pid,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    estimated: false,
    models: [],
  };
}

/**
 * Attribute one usage event to a process instance and accumulate its tokens +
 * cost (C-01).
 *
 * @param {number|ProcRef} proc - owning process: a full ref keys by instance; a
 *   bare pid degrades to the `"<pid>:u"` space. The pid itself must be a finite
 *   number > 0 either way.
 * @param {TokenEvent} event - usage to record.
 * @returns {CostRecord|null} the updated record, or `null` when the pid is
 *   invalid or `event` carries no usable token counts (nothing is fabricated).
 * @since v0.10.0-alpha
 */
function trackTokens(proc, event) {
  const pid = pidOf(proc);
  if (!isPositiveNumber(pid)) return null;
  if (!event || typeof event !== 'object') return null;

  const key = recordKey(proc);
  if (!key) return null;
  const hasInput = isNonNegativeNumber(event.inputTokens);
  const hasOutput = isNonNegativeNumber(event.outputTokens);
  // No usable counts → record nothing. You cannot estimate from nothing, and
  // fabricating a number here is exactly the dishonesty this module forbids.
  if (!hasInput && !hasOutput) return records.get(key) || null;

  const inTok = hasInput ? event.inputTokens : 0;
  const outTok = hasOutput ? event.outputTokens : 0;
  const model = typeof event.model === 'string' ? event.model : '';
  const { costUsd, knownModel, cachePricingEstimated } = computeCost(
    model,
    inTok,
    outTok,
    event.inputBreakdown,
  );

  // estimated is sticky-true: caller-flagged estimate OR an unknown-model price.
  const eventEstimated = event.estimated === true || !knownModel;

  const record = records.get(key) || zeroRecord(pid, key);
  record.inputTokens += inTok;
  record.outputTokens += outTok;
  record.totalTokens = record.inputTokens + record.outputTokens;
  record.costUsd += costUsd;
  if (cachePricingEstimated) record.pricingEstimated = true;
  record.estimated = record.estimated || eventEstimated;
  if (model && !record.models.includes(model)) record.models.push(model);

  records.set(key, record);
  return record;
}

/**
 * Read the accumulated cost record for one process instance. Resolved through
 * the same {@link recordKey} as every write, so read and write can never
 * disagree on identity.
 * @param {number|ProcRef} proc - same shapes as {@link trackTokens}.
 * @returns {CostRecord} the tracked record, or an honest zero-state record when
 *   the instance has no usage (never `null`).
 * @since v0.10.0-alpha
 */
function getCost(proc) {
  const key = recordKey(proc);
  const pid = pidOf(proc);
  if (!key) return zeroRecord(isPositiveNumber(pid) ? pid : 0, '0:u');
  return records.get(key) || zeroRecord(isPositiveNumber(pid) ? pid : 0, key);
}

/**
 * @returns {CostRecord[]} every tracked per-instance record (excludes untracked
 *   instances; records of exited instances are retained — see the file header).
 * @since v0.10.0-alpha
 */
function getAllCosts() {
  return Array.from(records.values());
}

/** @internal Clear all module state (for tests). @returns {void} */
function _resetForTest() {
  records.clear();
}

module.exports = {
  MODEL_PRICING,
  DEFAULT_PRICING,
  computeCost,
  trackTokens,
  getCost,
  getAllCosts,
  _resetForTest,
};
