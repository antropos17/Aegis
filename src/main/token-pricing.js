'use strict';

/**
 * Published per-model pricing, in USD per 1,000,000 tokens, split into input
 * (prompt) and output (completion) rates.
 *
 * Claude rates rechecked 2026-10-01 against the provider pricing page below.
 * GPT/Gemini rates are still approximate authoring-time guesses (their inline
 * `TODO: verify pricing`) and none of these auto-refresh — confirm against the
 * provider's current price sheet before presenting any dollar figure as
 * authoritative.
 * @type {Readonly<Record<string, { input: number, output: number }>>}
 */
const MODEL_PRICING = Object.freeze({
  // Anthropic — Claude (USD / 1M tokens). Rechecked 2026-10-01:
  // https://platform.claude.com/docs/en/about-claude/pricing
  // Existing model IDs are retained; unknown/new IDs use the estimated fallback.
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

/** Price measured input categories using the existing local model table.
 * Claude 4.x/Haiku cache rates checked 2026-10-01 against
 * https://platform.claude.com/docs/en/about-claude/pricing . Unknown models retain
 * fallback pricing; newer models can have different cache-read multipliers.
 * @param {string} model Model ID.
 * @param {number} inputTokens Total input, including cache categories.
 * @param {number} outputTokens Output count.
 * @param {{uncached:number, read:number, write5m:number, write1h:number, writeUnknown:number}} [breakdown] Input categories.
 * @returns {{costUsd:number, knownModel:boolean, cachePricingEstimated?:boolean}} Local estimate.
 * @since 0.18.0
 */
function computeCost(model, inputTokens, outputTokens, breakdown) {
  const valid = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const input = valid(inputTokens) ? inputTokens : 0;
  const output = valid(outputTokens) ? outputTokens : 0;
  const knownModel = typeof model === 'string' && Object.hasOwn(MODEL_PRICING, model);
  const price = knownModel ? MODEL_PRICING[model] : DEFAULT_PRICING;
  let pricedInput = input / TOKENS_PER_PRICED_UNIT;
  let cachePricingEstimated = false;
  if (breakdown) {
    const keys = ['uncached', 'read', 'write5m', 'write1h', 'writeUnknown'];
    const validBreakdown =
      typeof breakdown === 'object' &&
      !Array.isArray(breakdown) &&
      keys.every((key) => Object.hasOwn(breakdown, key) && valid(breakdown[key])) &&
      keys.reduce((total, key) => total + breakdown[key], 0) === input;
    if (validBreakdown && knownModel && model.startsWith('claude-')) {
      pricedInput =
        breakdown.uncached / TOKENS_PER_PRICED_UNIT +
        (breakdown.read / TOKENS_PER_PRICED_UNIT) * 0.1 +
        (breakdown.write5m / TOKENS_PER_PRICED_UNIT) * 1.25 +
        (breakdown.write1h / TOKENS_PER_PRICED_UNIT) * 2 +
        (breakdown.writeUnknown / TOKENS_PER_PRICED_UNIT) * 1.25;
      cachePricingEstimated = breakdown.writeUnknown > 0;
    } else cachePricingEstimated = true;
  }
  return {
    costUsd: pricedInput * price.input + (output / TOKENS_PER_PRICED_UNIT) * price.output,
    knownModel,
    ...(breakdown ? { cachePricingEstimated } : {}),
  };
}

module.exports = { MODEL_PRICING, DEFAULT_PRICING, computeCost };
