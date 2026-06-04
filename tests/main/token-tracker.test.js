import { describe, it, expect, beforeEach } from 'vitest';
import tracker from '../../src/main/token-tracker.js';

const {
  MODEL_PRICING,
  DEFAULT_PRICING,
  computeCost,
  trackTokens,
  getCostByPid,
  getAllCosts,
  reset,
  _resetForTest,
} = tracker;

const KNOWN_MODEL = 'claude-haiku-4-5-20251001';
const OTHER_MODEL = 'gpt-4o';

describe('token-tracker', () => {
  beforeEach(() => {
    _resetForTest();
  });

  describe('computeCost (cost calculation)', () => {
    it('prices 1M input + 1M output at the model table rate', () => {
      const price = MODEL_PRICING[KNOWN_MODEL];
      const { costUsd, knownModel } = computeCost(KNOWN_MODEL, 1_000_000, 1_000_000);
      // 1M tokens / 1M unit = 1.0 unit each → input + output rate.
      expect(costUsd).toBeCloseTo(price.input + price.output, 10);
      expect(knownModel).toBe(true);
    });

    it('applies a different known model at its own rate', () => {
      const price = MODEL_PRICING[OTHER_MODEL];
      const { costUsd } = computeCost(OTHER_MODEL, 2_000_000, 500_000);
      expect(costUsd).toBeCloseTo(2 * price.input + 0.5 * price.output, 10);
    });

    it('falls back to DEFAULT_PRICING for an unknown model (knownModel=false)', () => {
      const { costUsd, knownModel } = computeCost('made-up-model', 1_000_000, 0);
      expect(knownModel).toBe(false);
      expect(costUsd).toBeCloseTo(DEFAULT_PRICING.input, 10);
    });
  });

  describe('zero-state', () => {
    it('returns an honest all-zero record for an untracked pid', () => {
      const rec = getCostByPid(9999);
      expect(rec).toEqual({
        pid: 9999,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        estimated: false,
        models: [],
      });
    });

    it('reports no tracked records before any event', () => {
      expect(getAllCosts()).toEqual([]);
    });
  });

  describe('estimated flag', () => {
    it('marks real measured counts on a known model as NOT estimated', () => {
      const rec = trackTokens(100, {
        model: KNOWN_MODEL,
        inputTokens: 1000,
        outputTokens: 200,
      });
      expect(rec.estimated).toBe(false);
    });

    it('honors a caller-supplied estimated:true flag', () => {
      const rec = trackTokens(100, {
        model: KNOWN_MODEL,
        inputTokens: 1000,
        outputTokens: 200,
        estimated: true,
      });
      expect(rec.estimated).toBe(true);
    });

    it('forces estimated:true for an unknown model (the price itself is a guess)', () => {
      const rec = trackTokens(100, {
        model: 'unknown-model-xyz',
        inputTokens: 1000,
        outputTokens: 200,
      });
      expect(rec.estimated).toBe(true);
    });
  });

  describe('per-PID attribution (C-01)', () => {
    it('keeps two pids independent — no cross-wiring', () => {
      trackTokens(100, { model: KNOWN_MODEL, inputTokens: 1000, outputTokens: 100 });
      trackTokens(200, { model: OTHER_MODEL, inputTokens: 5000, outputTokens: 500 });

      const a = getCostByPid(100);
      const b = getCostByPid(200);

      expect(a.pid).toBe(100);
      expect(a.inputTokens).toBe(1000);
      expect(a.models).toEqual([KNOWN_MODEL]);

      expect(b.pid).toBe(200);
      expect(b.inputTokens).toBe(5000);
      expect(b.models).toEqual([OTHER_MODEL]);
    });
  });

  describe('accumulation', () => {
    it('sums tokens and cost across events for one pid', () => {
      trackTokens(100, { model: KNOWN_MODEL, inputTokens: 1000, outputTokens: 200 });
      const rec = trackTokens(100, { model: KNOWN_MODEL, inputTokens: 500, outputTokens: 50 });

      expect(rec.inputTokens).toBe(1500);
      expect(rec.outputTokens).toBe(250);
      expect(rec.totalTokens).toBe(1750);

      const expected =
        computeCost(KNOWN_MODEL, 1000, 200).costUsd + computeCost(KNOWN_MODEL, 500, 50).costUsd;
      expect(rec.costUsd).toBeCloseTo(expected, 10);
    });

    it('makes estimated sticky-true once any contributing event is estimated', () => {
      trackTokens(100, { model: KNOWN_MODEL, inputTokens: 1000, outputTokens: 200 });
      expect(getCostByPid(100).estimated).toBe(false);

      trackTokens(100, {
        model: KNOWN_MODEL,
        inputTokens: 100,
        outputTokens: 10,
        estimated: true,
      });
      expect(getCostByPid(100).estimated).toBe(true);
    });

    it('collects distinct models in first-seen order', () => {
      trackTokens(100, { model: KNOWN_MODEL, inputTokens: 10, outputTokens: 1 });
      trackTokens(100, { model: KNOWN_MODEL, inputTokens: 10, outputTokens: 1 });
      trackTokens(100, { model: OTHER_MODEL, inputTokens: 10, outputTokens: 1 });
      expect(getCostByPid(100).models).toEqual([KNOWN_MODEL, OTHER_MODEL]);
    });
  });

  describe('input guards (no fabrication)', () => {
    it('returns null for an invalid pid', () => {
      expect(trackTokens(0, { model: KNOWN_MODEL, inputTokens: 1 })).toBeNull();
      expect(trackTokens(-5, { model: KNOWN_MODEL, inputTokens: 1 })).toBeNull();
      expect(trackTokens(NaN, { model: KNOWN_MODEL, inputTokens: 1 })).toBeNull();
    });

    it('records nothing when an event carries no usable token counts', () => {
      expect(trackTokens(100, { model: KNOWN_MODEL })).toBeNull();
      expect(getAllCosts()).toEqual([]);
    });
  });

  describe('getAllCosts', () => {
    it('returns one record per tracked pid', () => {
      trackTokens(100, { model: KNOWN_MODEL, inputTokens: 10, outputTokens: 1 });
      trackTokens(200, { model: KNOWN_MODEL, inputTokens: 20, outputTokens: 2 });
      const all = getAllCosts();
      expect(all).toHaveLength(2);
      expect(all.map((r) => r.pid).sort((x, y) => x - y)).toEqual([100, 200]);
    });
  });

  describe('reset(pid)', () => {
    it('drops only the targeted pid and reverts it to zero-state', () => {
      trackTokens(100, { model: KNOWN_MODEL, inputTokens: 10, outputTokens: 1 });
      trackTokens(200, { model: KNOWN_MODEL, inputTokens: 20, outputTokens: 2 });

      expect(reset(100)).toBe(true);
      expect(reset(100)).toBe(false); // already gone

      expect(getCostByPid(100).totalTokens).toBe(0);
      expect(getCostByPid(100).inputTokens).toBe(0);
      expect(getCostByPid(200).inputTokens).toBe(20); // survives
      expect(getAllCosts()).toHaveLength(1);
    });
  });
});
