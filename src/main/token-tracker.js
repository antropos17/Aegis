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
 *   All active instances and the 256 most recently updated exited records stay
 *   individually addressable. Older exited records are folded into one explicit
 *   archive row without a PID or instance identity. Summing `getAllCosts()` still
 *   preserves lifetime usage and cost for this application run. Compaction requires
 *   a confirmed population observation; outages and suspend freezes cannot retire
 *   records. This does not change the transcript adapter's separate dedup state.
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
 * @property {string|null} instanceId - the process INSTANCE this usage is keyed by
 *   (C-01 key; see process-identity.js for the three value spaces).
 * @property {number|null} pid - owning process id; null for the archive aggregate.
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
 * @property {boolean} [modelsTruncated] - additional/oversized labels were omitted.
 * @property {boolean} [archived] - aggregate of exited history, never a process.
 * @property {number} [archivedRecords] - number of records folded into the archive.
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
const EXITED_RECORD_LIMIT = 256;
const MODEL_LABEL_LIMIT = 32;
const MODEL_LABEL_LENGTH = 256;
/** @type {CostRecord|null} */
let archive = null;

/** Retain bounded display labels without changing pricing or numeric accounting.
 * @param {CostRecord} record @param {string} model @returns {void} @since 0.18.0-beta
 */
function rememberModel(record, model) {
  if (!model || record.models.includes(model)) return;
  if (model.length > MODEL_LABEL_LENGTH || record.models.length >= MODEL_LABEL_LIMIT) {
    record.modelsTruncated = true;
    return;
  }
  record.models.push(model);
}

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
 * Empty retained counter, not proof of zero lifetime usage after compaction.
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
  rememberModel(record, model);

  // Map order represents the latest usage update, including resumed retained rows.
  records.delete(key);
  records.set(key, record);
  return record;
}

/**
 * Read the accumulated cost record for one process instance. Resolved through
 * the same {@link recordKey} as every write, so read and write can never
 * disagree on identity.
 * @param {number|ProcRef} proc - same shapes as {@link trackTokens}.
 * @returns {CostRecord} the tracked record, or an honest zero-state record when
 *   no individual record is retained (never `null`). Compacted exited usage remains
 *   in the archive returned by getAllCosts, not in this per-instance lookup.
 * @since v0.10.0-alpha
 */
function getCost(proc) {
  const key = recordKey(proc);
  const pid = pidOf(proc);
  if (!key) return zeroRecord(isPositiveNumber(pid) ? pid : 0, '0:u');
  return records.get(key) || zeroRecord(isPositiveNumber(pid) ? pid : 0, key);
}

/**
 * @returns {CostRecord[]} retained per-instance records plus one archive aggregate
 *   when history has been compacted; summing these rows preserves lifetime totals.
 * @since v0.10.0-alpha
 */
function getAllCosts() {
  return [...records.values(), ...(archive ? [archive] : [])];
}

/** Fold older confirmed exited records into a constant-size lifetime aggregate.
 * The caller's liveness predicate must include the session tracker's exit grace.
 * Compaction is frozen unless the whole population and identity pass was observed.
 * Active rows are never capped; retained state scales with the live population,
 * plus at most 256 exited rows and one archive. No transcripts or IDs are evicted.
 * @param {(instanceId:string) => boolean} isLive Authoritative session liveness.
 * @param {boolean} [observed=false] Confirmed, current population/identity evidence.
 * @returns {void} @since 0.18.0-beta
 */
function compactCosts(isLive, observed = false) {
  if (observed !== true || typeof isLive !== 'function') return;
  const exited = [];
  for (const [key, record] of records) if (!isLive(key)) exited.push([key, record]);
  for (const [key, record] of exited.slice(0, Math.max(0, exited.length - EXITED_RECORD_LIMIT))) {
    archive ??= {
      ...zeroRecord(0, ''),
      pid: null,
      instanceId: null,
      archived: true,
      archivedRecords: 0,
    };
    archive.inputTokens += record.inputTokens;
    archive.outputTokens += record.outputTokens;
    archive.totalTokens = archive.inputTokens + archive.outputTokens;
    archive.costUsd += record.costUsd;
    archive.estimated ||= record.estimated;
    if (record.pricingEstimated) archive.pricingEstimated = true;
    if (record.modelsTruncated) archive.modelsTruncated = true;
    for (const model of record.models) rememberModel(archive, model);
    archive.archivedRecords++;
    records.delete(key);
  }
}

/** @internal Clear all module state (for tests). @returns {void} */
function _resetForTest() {
  records.clear();
  archive = null;
}

module.exports = {
  MODEL_PRICING,
  DEFAULT_PRICING,
  computeCost,
  trackTokens,
  getCost,
  getAllCosts,
  compactCosts,
  _resetForTest,
};
