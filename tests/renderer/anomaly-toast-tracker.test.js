import { describe, it, expect } from 'vitest';
import {
  createAnomalyToastTracker,
  ANOMALY_TOAST_THRESHOLD,
  isAnomalyAlert,
} from '../../src/renderer/lib/utils/anomaly-toast-tracker';

describe('createAnomalyToastTracker', () => {
  describe('seed-then-diff (C-12 regression)', () => {
    it('seeds on the first non-empty object and reports nothing (no toast storm)', () => {
      const tracker = createAnomalyToastTracker();
      // Under the C-12 bug, both starting anomalies would be reported as "new"
      // and toasted. The seed call MUST return [].
      expect(tracker.ingest({ agentA: 80, agentB: 90 })).toEqual([]);
    });

    it('does NOT consume the seed on the mount-time empty {} — the real C-12 path', () => {
      // The `anomalies` store is writable({}) and emits {} at mount, BEFORE the
      // first scan batch. If {} consumed the seed, the first populated batch
      // would arrive already-initialized and toast every starting anomaly.
      const tracker = createAnomalyToastTracker();
      expect(tracker.ingest({})).toEqual([]); // mount default — must not seed
      expect(tracker.ingest({ agentA: 80, agentB: 90 })).toEqual([]); // first real batch = seed
      // Only genuinely-new anomalies after the seed are reported.
      expect(tracker.ingest({ agentA: 80, agentB: 90, agentC: 70 })).toEqual(['agentC']);
    });

    it('reports only the genuinely-new key on a later batch, not the repeat', () => {
      const tracker = createAnomalyToastTracker();
      tracker.ingest({ agentA: 80, agentB: 90 }); // seed
      // agentA is a repeat (already seeded), agentC is new.
      expect(tracker.ingest({ agentA: 80, agentC: 70 })).toEqual(['agentC']);
    });

    it('does not re-report a key that was already over threshold', () => {
      const tracker = createAnomalyToastTracker();
      tracker.ingest({ agentA: 80 }); // seed
      expect(tracker.ingest({ agentA: 80 })).toEqual([]);
    });
  });

  describe('threshold gate', () => {
    it('excludes scores below the default threshold (50)', () => {
      const tracker = createAnomalyToastTracker();
      tracker.ingest({ seed: 99 }); // non-empty seed
      const fresh = tracker.ingest({ agentD: 40 });
      expect(fresh).not.toContain('agentD');
      expect(fresh).toEqual([]);
    });

    it('includes a score exactly at the threshold (inclusive)', () => {
      const tracker = createAnomalyToastTracker();
      tracker.ingest({ seed: 99 }); // non-empty seed
      expect(tracker.ingest({ agentE: 50 })).toEqual(['agentE']);
    });

    it('honors a custom threshold', () => {
      const tracker = createAnomalyToastTracker(70);
      tracker.ingest({ seed: 99 }); // non-empty seed
      const fresh = tracker.ingest({ agentF: 60, agentG: 75 });
      expect(fresh).toEqual(['agentG']);
    });
  });

  describe('empty / malformed emissions preserve state', () => {
    it('returns [] for undefined without throwing or wiping state', () => {
      const tracker = createAnomalyToastTracker();
      tracker.ingest({ agentA: 80 }); // seed
      expect(tracker.ingest(undefined)).toEqual([]);
      // agentA is still known — not re-reported on the next batch.
      expect(tracker.ingest({ agentA: 80 })).toEqual([]);
    });

    it('returns [] for null without throwing', () => {
      const tracker = createAnomalyToastTracker();
      expect(tracker.ingest(null)).toEqual([]);
    });

    it('returns [] for an empty object', () => {
      const tracker = createAnomalyToastTracker();
      expect(tracker.ingest({})).toEqual([]);
    });

    it('a transient empty/null between two populated batches does not re-report', () => {
      const tracker = createAnomalyToastTracker();
      tracker.ingest({ agentA: 80 }); // seed
      tracker.ingest({}); // transient empty — must not wipe prevKeys
      tracker.ingest(null); // transient null — must not wipe prevKeys
      expect(tracker.ingest({ agentA: 80, agentB: 90 })).toEqual(['agentB']);
    });

    it('ignores non-numeric score values', () => {
      const tracker = createAnomalyToastTracker();
      tracker.ingest({ seed: 99 }); // non-empty seed
      expect(tracker.ingest({ agentH: '90', agentI: null, agentJ: 80 })).toEqual(['agentJ']);
    });
  });

  // The gate is exported so the card can alert on exactly what toasts (AgentCard.svelte).
  // A second literal anywhere else would let the two drift apart — the case pinned by
  // AgentCard.test.ts at 49/50.
  describe('the exported gate', () => {
    it('ANOMALY_TOAST_THRESHOLD is 50, and it is the default the tracker gates on', () => {
      expect(ANOMALY_TOAST_THRESHOLD).toBe(50);
      const byDefault = createAnomalyToastTracker();
      const explicit = createAnomalyToastTracker(ANOMALY_TOAST_THRESHOLD);
      byDefault.ingest({ seed: 99 });
      explicit.ingest({ seed: 99 });
      const batch = { under: 49, at: 50, over: 51 };
      expect(byDefault.ingest(batch)).toEqual(explicit.ingest(batch));
      expect(explicit.ingest({ under2: 49, at2: 50 })).toEqual(['at2']);
    });

    it('isAnomalyAlert is true at the threshold and above, false below and for non-numbers', () => {
      expect(isAnomalyAlert(50)).toBe(true);
      expect(isAnomalyAlert(100)).toBe(true);
      expect(isAnomalyAlert(49)).toBe(false);
      expect(isAnomalyAlert(0)).toBe(false);
      expect(isAnomalyAlert('90')).toBe(false);
      expect(isAnomalyAlert(null)).toBe(false);
      expect(isAnomalyAlert(undefined)).toBe(false);
      expect(isAnomalyAlert(Number.NaN)).toBe(false);
    });

    it('the tracker reports a key exactly when isAnomalyAlert accepts its score', () => {
      for (const score of [0, 49, 50, 51, 100, '70', null]) {
        const tracker = createAnomalyToastTracker();
        tracker.ingest({ seed: 99 });
        const fresh = tracker.ingest({ probe: score });
        expect(fresh, `score ${String(score)}`).toEqual(isAnomalyAlert(score) ? ['probe'] : []);
      }
    });
  });
});
