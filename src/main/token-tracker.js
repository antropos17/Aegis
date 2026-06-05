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
 *   The only place AEGIS ever holds a real `usage` block is its OWN analysis
 *   call (`ai-analysis.js` → `parsed.usage`). Therefore:
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
 *   Attribution is per-PID (C-01): every count is stamped from the `pid`
 *   argument and stored under that pid only — concurrency or interleaved events
 *   can never cross-wire one agent's usage onto another.
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.1.0
 */
'use strict';

/**
 * Published per-model pricing, in USD per 1,000,000 tokens, split into input
 * (prompt) and output (completion) rates.
 *
 * Claude rates verified 2026-06-05 (see the inline note on the Claude block).
 * GPT/Gemini rates are still approximate authoring-time guesses (their inline
 * `TODO: verify pricing`) and none of these auto-refresh — confirm against the
 * provider's current price sheet before presenting any dollar figure as
 * authoritative.
 * @type {Readonly<Record<string, { input: number, output: number }>>}
 */
const MODEL_PRICING = Object.freeze({
  // Anthropic — Claude (USD / 1M tokens). Verified 2026-06-05 against the
  // bundled Anthropic `claude-api` skill (models.md + SKILL.md, cached
  // 2026-05-26): Opus 4.6/4.7/4.8 = $5/$25, Sonnet 4.6 = $3/$15, Haiku 4.5 =
  // $1/$5. These bare ids match what Claude Code writes to `message.model`
  // (confirmed against live transcripts). Re-confirm on the next model launch.
  'claude-opus-4-8': { input: 5.0, output: 25.0 },
  'claude-opus-4-7': { input: 5.0, output: 25.0 },
  'claude-opus-4-6': { input: 5.0, output: 25.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0 },
  'claude-sonnet-4-5': { input: 3.0, output: 15.0 },
  'claude-opus-4-1': { input: 15.0, output: 75.0 }, // legacy Opus rate (pre price cut)
  // OpenAI — GPT (USD / 1M tokens). TODO: verify pricing.
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  // Google — Gemini (USD / 1M tokens). TODO: verify pricing.
  'gemini-1.5-pro': { input: 1.25, output: 5.0 },
});

/**
 * Fallback price applied to a model id absent from {@link MODEL_PRICING}. Using
 * it forces `estimated:true` on the resulting cost, because the rate itself is a
 * guess for an unknown model.
 *
 * TODO: verify pricing — placeholder mid-range rate, not a real quote.
 * @type {Readonly<{ input: number, output: number }>}
 */
const DEFAULT_PRICING = Object.freeze({ input: 3.0, output: 15.0 });

/**
 * Tokens per 1,000,000 — divisor turning a token count into the per-million
 * units {@link MODEL_PRICING} is quoted in.
 * @type {number}
 */
const TOKENS_PER_PRICED_UNIT = 1_000_000;

/**
 * @typedef {Object} CostRecord
 * @property {number} pid - the process this usage is attributed to (C-01 key).
 * @property {number} inputTokens - accumulated prompt/input tokens.
 * @property {number} outputTokens - accumulated completion/output tokens.
 * @property {number} totalTokens - `inputTokens + outputTokens`.
 * @property {number} costUsd - accumulated cost in USD (raw float; round at the
 *   display layer). Rests on the unverified {@link MODEL_PRICING} table.
 * @property {boolean} estimated - true once ANY contributing event had estimated
 *   counts or used an unknown-model fallback price (sticky — never flips back).
 * @property {string[]} models - distinct model ids that contributed, in first-seen order.
 */

/**
 * @typedef {Object} TokenEvent
 * @property {string} [model] - model id; matched against {@link MODEL_PRICING}.
 * @property {number} [inputTokens] - measured or caller-estimated input tokens.
 * @property {number} [outputTokens] - measured or caller-estimated output tokens.
 * @property {boolean} [estimated] - set true when the counts above are an
 *   estimate the caller computed, not measured usage.
 */

/** @type {Map<number, CostRecord>} Accumulated cost records keyed by pid. */
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
 * Compute the USD cost of a single (model, tokens) pair. Pure — no module state.
 *
 * @param {string} model - model id; unknown ids fall back to {@link DEFAULT_PRICING}.
 * @param {number} inputTokens - input/prompt tokens (coerced to 0 if not finite ≥0).
 * @param {number} outputTokens - output/completion tokens (coerced to 0 if not finite ≥0).
 * @returns {{ costUsd: number, knownModel: boolean }} `knownModel:false` means the
 *   price came from the fallback table and the dollar figure is itself a guess.
 * @since v0.10.0-alpha
 */
function computeCost(model, inputTokens, outputTokens) {
  const inTok = isNonNegativeNumber(inputTokens) ? inputTokens : 0;
  const outTok = isNonNegativeNumber(outputTokens) ? outputTokens : 0;
  const knownModel = typeof model === 'string' && model in MODEL_PRICING;
  const price = knownModel ? MODEL_PRICING[model] : DEFAULT_PRICING;
  const costUsd =
    (inTok / TOKENS_PER_PRICED_UNIT) * price.input +
    (outTok / TOKENS_PER_PRICED_UNIT) * price.output;
  return { costUsd, knownModel };
}

/**
 * Honest zero-state record for a pid with no tracked usage. `estimated:false`
 * because an exact zero is a fact, not a guess.
 * @param {number} pid
 * @returns {CostRecord}
 */
function zeroRecord(pid) {
  return {
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
 * Attribute one usage event to a pid and accumulate its tokens + cost (C-01).
 *
 * @param {number} pid - owning process id; must be a finite number > 0.
 * @param {TokenEvent} event - usage to record.
 * @returns {CostRecord|null} the updated record, or `null` when `pid` is invalid
 *   or `event` carries no usable token counts (nothing is fabricated).
 * @since v0.10.0-alpha
 */
function trackTokens(pid, event) {
  if (!isPositiveNumber(pid)) return null;
  if (!event || typeof event !== 'object') return null;

  const hasInput = isNonNegativeNumber(event.inputTokens);
  const hasOutput = isNonNegativeNumber(event.outputTokens);
  // No usable counts → record nothing. You cannot estimate from nothing, and
  // fabricating a number here is exactly the dishonesty this module forbids.
  if (!hasInput && !hasOutput) return records.get(pid) || null;

  const inTok = hasInput ? event.inputTokens : 0;
  const outTok = hasOutput ? event.outputTokens : 0;
  const model = typeof event.model === 'string' ? event.model : '';
  const { costUsd, knownModel } = computeCost(model, inTok, outTok);

  // estimated is sticky-true: caller-flagged estimate OR an unknown-model price.
  const eventEstimated = event.estimated === true || !knownModel;

  const record = records.get(pid) || zeroRecord(pid);
  record.inputTokens += inTok;
  record.outputTokens += outTok;
  record.totalTokens = record.inputTokens + record.outputTokens;
  record.costUsd += costUsd;
  record.estimated = record.estimated || eventEstimated;
  if (model && !record.models.includes(model)) record.models.push(model);

  records.set(pid, record);
  return record;
}

/**
 * Read the accumulated cost record for a pid.
 * @param {number} pid
 * @returns {CostRecord} the tracked record, or an honest zero-state record when
 *   the pid has no usage (never `null`).
 * @since v0.10.0-alpha
 */
function getCostByPid(pid) {
  return records.get(pid) || zeroRecord(pid);
}

/**
 * @returns {CostRecord[]} every tracked per-pid record (excludes untracked pids).
 * @since v0.10.0-alpha
 */
function getAllCosts() {
  return Array.from(records.values());
}

/**
 * Drop the record for one pid (e.g. when an agent process exits).
 * @param {number} pid
 * @returns {boolean} true if a record existed and was removed.
 * @since v0.10.0-alpha
 */
function reset(pid) {
  return records.delete(pid);
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
  getCostByPid,
  getAllCosts,
  reset,
  _resetForTest,
};
