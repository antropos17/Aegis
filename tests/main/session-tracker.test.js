import { describe, it, expect, beforeEach } from 'vitest';
import tracker from '../../src/main/session-tracker.js';

/**
 * Helper: run a sequence of scans and collect every entered/exited event across
 * the whole run, so tests can assert on totals (e.g. "exactly one session").
 * @param {Array<{agents: Array, reliable?: boolean}>} scans
 * @param {number} startNow
 * @param {number} [grace]
 */
function runScans(scans, startNow, grace) {
  const allEntered = [];
  const allExited = [];
  let now = startNow;
  for (const scan of scans) {
    const res = tracker.reconcile(scan.agents, {
      reliable: scan.reliable !== false,
      now,
      grace,
    });
    allEntered.push(...res.entered);
    allExited.push(...res.exited);
    now += 10000; // simulate a 10s poll interval
  }
  return { allEntered, allExited };
}

const CURSOR = { pid: 100, agent: 'Cursor', process: 'cursor' };

describe('session-tracker', () => {
  beforeEach(() => {
    tracker._resetForTest();
  });

  describe('reconcile — single-tick (the polling-gap case)', () => {
    it('agent seen exactly once then gone → exactly one session + one enter + one exit', () => {
      // Seen in ONE scan, then absent for the full grace window.
      const { allEntered, allExited } = runScans(
        [
          { agents: [CURSOR] }, // sighting
          { agents: [] }, // gone (miss 1)
          { agents: [] }, // gone (miss 2 → exit)
        ],
        1_000_000,
        2,
      );
      expect(allEntered).toHaveLength(1);
      expect(allEntered[0].agent).toBe('Cursor');
      expect(allEntered[0].pid).toBe(100);
      expect(allExited).toHaveLength(1);
      expect(allExited[0].pid).toBe(100);
      expect(tracker.activeCount()).toBe(0);
    });

    it('records the enter on the FIRST sighting, before any miss', () => {
      const res = tracker.reconcile([CURSOR], { now: 1_000_000, grace: 2 });
      expect(res.entered).toHaveLength(1);
      expect(res.exited).toHaveLength(0);
      // session-start carries an AEGIS-observed start-time field
      expect(res.entered[0].firstSeen).toBe(1_000_000);
    });

    it('does not exit before the grace window elapses', () => {
      tracker.reconcile([CURSOR], { now: 0, grace: 2 });
      const afterOneMiss = tracker.reconcile([], { now: 10000, grace: 2 });
      expect(afterOneMiss.exited).toHaveLength(0);
      expect(tracker.activeCount()).toBe(1);
    });
  });

  describe('reconcile — flicker must NOT spawn a duplicate session', () => {
    it('same pid+process reappears within grace → no second enter', () => {
      const { allEntered, allExited } = runScans(
        [
          { agents: [CURSOR] }, // sighting
          { agents: [] }, // one-tick gap (miss 1, < grace)
          { agents: [CURSOR] }, // reappears — same session
        ],
        0,
        2,
      );
      expect(allEntered).toHaveLength(1); // NOT two
      expect(allExited).toHaveLength(0);
      expect(tracker.activeCount()).toBe(1);
    });

    it('a permission-denied (unreliable) scan does not end or re-create a session', () => {
      const { allEntered, allExited } = runScans(
        [
          { agents: [CURSOR] }, // sighting
          { agents: [], reliable: false }, // EPERM → empty list, ignored
          { agents: [], reliable: false }, // EPERM again, still ignored
          { agents: [CURSOR] }, // still the same session
        ],
        0,
        2,
      );
      expect(allEntered).toHaveLength(1);
      expect(allExited).toHaveLength(0);
      expect(tracker.activeCount()).toBe(1);
    });

    it('unreliable scans are not counted as misses', () => {
      tracker.reconcile([CURSOR], { now: 0, grace: 2 });
      // Two unreliable scans would exceed grace IF counted — they must not be.
      tracker.reconcile([], { now: 10000, reliable: false, grace: 2 });
      tracker.reconcile([], { now: 20000, reliable: false, grace: 2 });
      const res = tracker.reconcile([], { now: 30000, reliable: false, grace: 2 });
      expect(res.exited).toHaveLength(0);
      expect(tracker.activeCount()).toBe(1);
    });
  });

  describe('reconcile — PID reuse', () => {
    it('a recycled PID belonging to a different agent starts a new session', () => {
      // pid 100 is Cursor, then after Cursor exits the OS reuses 100 for Copilot.
      const { allEntered } = runScans(
        [
          { agents: [{ pid: 100, agent: 'Cursor', process: 'cursor' }] },
          { agents: [{ pid: 100, agent: 'Copilot', process: 'copilot' }] },
        ],
        0,
        2,
      );
      const names = allEntered.map((e) => e.agent).sort();
      expect(names).toEqual(['Copilot', 'Cursor']);
      expect(allEntered).toHaveLength(2);
    });
  });

  describe('reconcile — multiple concurrent agents', () => {
    it('tracks distinct sessions independently', () => {
      const res = tracker.reconcile(
        [
          { pid: 100, agent: 'Cursor', process: 'cursor' },
          { pid: 200, agent: 'Claude Code', process: 'claude' },
        ],
        { now: 0, grace: 2 },
      );
      expect(res.entered).toHaveLength(2);
      expect(tracker.activeCount()).toBe(2);
    });

    it('one agent exiting does not affect the other', () => {
      tracker.reconcile(
        [
          { pid: 100, agent: 'Cursor', process: 'cursor' },
          { pid: 200, agent: 'Claude Code', process: 'claude' },
        ],
        { now: 0, grace: 2 },
      );
      // Cursor gone, Claude stays.
      tracker.reconcile([{ pid: 200, agent: 'Claude Code', process: 'claude' }], {
        now: 10000,
        grace: 2,
      });
      const res = tracker.reconcile([{ pid: 200, agent: 'Claude Code', process: 'claude' }], {
        now: 20000,
        grace: 2,
      });
      expect(res.exited).toHaveLength(1);
      expect(res.exited[0].agent).toBe('Cursor');
      expect(tracker.activeCount()).toBe(1);
    });
  });

  describe('sessionKey', () => {
    it('is identical for the same pid + process regardless of sighting time', () => {
      expect(tracker.sessionKey({ pid: 100, process: 'cursor' })).toBe(
        tracker.sessionKey({ pid: 100, process: 'Cursor' }),
      );
    });

    it('differs when the process name differs for the same pid', () => {
      expect(tracker.sessionKey({ pid: 100, process: 'cursor' })).not.toBe(
        tracker.sessionKey({ pid: 100, process: 'copilot' }),
      );
    });
  });
});
