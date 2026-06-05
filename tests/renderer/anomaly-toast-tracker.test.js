import { describe, it, expect } from 'vitest';
import { createAnomalyToastTracker } from '../../src/renderer/lib/utils/anomaly-toast-tracker';

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
});
