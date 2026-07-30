import { describe, it, expect, beforeEach } from 'vitest';
import tracker from '../../src/main/token-tracker.js';

const {
  MODEL_PRICING,
  DEFAULT_PRICING,
  computeCost,
  trackTokens,
  getCost,
  getAllCosts,
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
    it('returns an honest all-zero record for an untracked pid (degraded `:u` space)', () => {
      const rec = getCost(9999);
      expect(rec).toEqual({
        instanceId: '9999:u',
        pid: 9999,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        estimated: false,
        models: [],
      });
    });

    it('returns an honest all-zero record for an untracked instance', () => {
      const rec = getCost({ pid: 9999, startTime: 111 });
      expect(rec.instanceId).toBe('9999:111');
      expect(rec.pid).toBe(9999);
      expect(rec.totalTokens).toBe(0);
      expect(rec.estimated).toBe(false);
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

  describe('per-instance attribution (C-01)', () => {
    it('keeps two pids independent — no cross-wiring', () => {
      trackTokens(100, { model: KNOWN_MODEL, inputTokens: 1000, outputTokens: 100 });
      trackTokens(200, { model: OTHER_MODEL, inputTokens: 5000, outputTokens: 500 });

      const a = getCost(100);
      const b = getCost(200);

      expect(a.pid).toBe(100);
      expect(a.inputTokens).toBe(1000);
      expect(a.models).toEqual([KNOWN_MODEL]);

      expect(b.pid).toBe(200);
      expect(b.inputTokens).toBe(5000);
      expect(b.models).toEqual([OTHER_MODEL]);
    });

    // The reason this module keys by instance at all: Windows recycles PIDs, so
    // a new process must never inherit a dead instance's accumulated record.
    it('keeps a recycled pid clean: 100:111 dead, 100:222 starts from zero', () => {
      trackTokens(
        { pid: 100, startTime: 111 },
        { model: KNOWN_MODEL, inputTokens: 1000, outputTokens: 100, estimated: true },
      );
      const fresh = trackTokens(
        { pid: 100, startTime: 222 },
        { model: KNOWN_MODEL, inputTokens: 7, outputTokens: 3 },
      );

      // The new instance inherits neither counts nor the sticky estimated flag.
      expect(fresh.instanceId).toBe('100:222');
      expect(fresh.totalTokens).toBe(10);
      expect(fresh.estimated).toBe(false);

      // The dead instance's record is retained (session-total honesty), untouched.
      const dead = getCost({ pid: 100, startTime: 111 });
      expect(dead.instanceId).toBe('100:111');
      expect(dead.totalTokens).toBe(1100);
      expect(dead.estimated).toBe(true);

      expect(getAllCosts()).toHaveLength(2);
    });

    it('prefers a stamped instanceId over local derivation (same key as file-watcher handleKey)', () => {
      trackTokens(
        { pid: 100, startTime: 111, instanceId: '100:999' },
        { model: KNOWN_MODEL, inputTokens: 10, outputTokens: 1 },
      );

      expect(getCost({ pid: 100, instanceId: '100:999' }).totalTokens).toBe(11);
      // The derived key was never written — the stamped one won.
      expect(getCost({ pid: 100, startTime: 111 }).totalTokens).toBe(0);
    });

    it('accumulates a bare-number caller into the degraded `<pid>:u` record', () => {
      trackTokens(100, { model: KNOWN_MODEL, inputTokens: 10, outputTokens: 1 });
      const rec = trackTokens(
        { pid: 100 },
        { model: KNOWN_MODEL, inputTokens: 5, outputTokens: 2 },
      );

      // Bare pid and a ref without startTime resolve to the SAME `:u` key —
      // exactly the pre-instanceId behaviour, not a third identity.
      expect(rec.instanceId).toBe('100:u');
      expect(rec.totalTokens).toBe(18);
      expect(getAllCosts()).toHaveLength(1);
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
      expect(getCost(100).estimated).toBe(false);

      trackTokens(100, {
        model: KNOWN_MODEL,
        inputTokens: 100,
        outputTokens: 10,
        estimated: true,
      });
      expect(getCost(100).estimated).toBe(true);
    });

    it('collects distinct models in first-seen order', () => {
      trackTokens(100, { model: KNOWN_MODEL, inputTokens: 10, outputTokens: 1 });
      trackTokens(100, { model: KNOWN_MODEL, inputTokens: 10, outputTokens: 1 });
      trackTokens(100, { model: OTHER_MODEL, inputTokens: 10, outputTokens: 1 });
      expect(getCost(100).models).toEqual([KNOWN_MODEL, OTHER_MODEL]);
    });
  });

  describe('input guards (no fabrication)', () => {
    it('returns null for an invalid pid', () => {
      expect(trackTokens(0, { model: KNOWN_MODEL, inputTokens: 1 })).toBeNull();
      expect(trackTokens(-5, { model: KNOWN_MODEL, inputTokens: 1 })).toBeNull();
      expect(trackTokens(NaN, { model: KNOWN_MODEL, inputTokens: 1 })).toBeNull();
      // Object refs are held to the same pid contract — an instanceId alone
      // cannot smuggle in a record for a process that has no valid pid.
      expect(
        trackTokens({ pid: 0, startTime: 1 }, { model: KNOWN_MODEL, inputTokens: 1 }),
      ).toBeNull();
      expect(trackTokens({ instanceId: '7:1' }, { model: KNOWN_MODEL, inputTokens: 1 })).toBeNull();
      expect(trackTokens(null, { model: KNOWN_MODEL, inputTokens: 1 })).toBeNull();
    });

    it('records nothing when an event carries no usable token counts', () => {
      expect(trackTokens(100, { model: KNOWN_MODEL })).toBeNull();
      expect(getAllCosts()).toEqual([]);
    });
  });

  describe('getAllCosts', () => {
    it('returns one record per tracked instance, each carrying its instanceId', () => {
      trackTokens(
        { pid: 100, startTime: 1 },
        { model: KNOWN_MODEL, inputTokens: 10, outputTokens: 1 },
      );
      trackTokens(
        { pid: 200, startTime: 2 },
        { model: KNOWN_MODEL, inputTokens: 20, outputTokens: 2 },
      );
      const all = getAllCosts();
      expect(all).toHaveLength(2);
      expect(all.map((r) => r.pid).sort((x, y) => x - y)).toEqual([100, 200]);
      expect(all.map((r) => r.instanceId).sort()).toEqual(['100:1', '200:2']);
    });
  });

  // Regression (2026-06-05): the live token-feed records bare model ids verbatim
  // (`claude-opus-4-8`, `claude-sonnet-4-6` — confirmed against real transcripts).
  // Before this pricing fix those ids were absent from MODEL_PRICING, so they hit
  // DEFAULT_PRICING and flipped `estimated:true` — the footer showed `~$`. Dollar
  // amounts are hard-coded (NOT read from MODEL_PRICING) so the assertion locks
  // the actual money: it fails red if a rate drifts or an entry is dropped.
  describe('current model pricing (regression)', () => {
    it('prices claude-opus-4-8 at $5 in / $25 out — measured, not estimated', () => {
      const { costUsd, knownModel } = computeCost('claude-opus-4-8', 1_000_000, 1_000_000);
      expect(costUsd).toBeCloseTo(30.0, 10); // 5 input + 25 output
      expect(knownModel).toBe(true);

      const rec = trackTokens(4242, {
        model: 'claude-opus-4-8',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      });
      expect(rec.costUsd).toBeCloseTo(30.0, 10);
      expect(rec.estimated).toBe(false);
    });

    it('prices claude-sonnet-4-6 at $3 in / $15 out — measured, not estimated', () => {
      const { costUsd, knownModel } = computeCost('claude-sonnet-4-6', 1_000_000, 1_000_000);
      expect(costUsd).toBeCloseTo(18.0, 10); // 3 input + 15 output
      expect(knownModel).toBe(true);

      const rec = trackTokens(4343, {
        model: 'claude-sonnet-4-6',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      });
      expect(rec.estimated).toBe(false);
    });

    it('keeps DEFAULT + sticky-estimated for a genuinely unknown model', () => {
      const { costUsd, knownModel } = computeCost('foo-1', 1_000_000, 0);
      expect(knownModel).toBe(false);
      expect(costUsd).toBeCloseTo(DEFAULT_PRICING.input, 10); // 1M input only → $3

      const rec = trackTokens(4444, {
        model: 'foo-1',
        inputTokens: 1_000_000,
        outputTokens: 0,
      });
      expect(rec.estimated).toBe(true);
    });
  });
});
