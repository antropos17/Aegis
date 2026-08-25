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

/** Stamped fixtures — reconcile no longer re-derives identity from bare pid. */
const CURSOR = { pid: 100, agent: 'Cursor', process: 'cursor', instanceId: '100:u' };

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

  describe('reconcile — identity degradation (the SPLIT direction)', () => {
    /** The same live process, keyed before and during a birth-time outage. */
    const CLAUDE_OS = {
      pid: 100,
      agent: 'Claude Code',
      process: 'claude',
      instanceId: '100:1717000000000',
    };
    const CLAUDE_U = { pid: 100, agent: 'Claude Code', process: 'claude', instanceId: '100:u' };

    it('a degraded scan neither ends the old session nor starts one under the new key', () => {
      // The process never left. The snapshot provider did, so its key changed —
      // which reconcile would otherwise read as "one agent exited, another arrived".
      const entered = [];
      const exited = [];
      const tick = (agents, opts) => {
        const res = tracker.reconcile(agents, { grace: 2, ...opts });
        entered.push(...res.entered);
        exited.push(...res.exited);
      };

      tick([CLAUDE_OS], { now: 0 });
      expect(entered).toHaveLength(1);

      // Three degraded ticks — one more than grace, so an aged-out session would
      // have been reported by the third.
      tick([CLAUDE_U], { now: 10000, identityDegraded: true });
      tick([CLAUDE_U], { now: 20000, identityDegraded: true });
      tick([CLAUDE_U], { now: 30000, identityDegraded: true });

      // Recovery: the key is the one it always was, and the session it belongs to
      // was still there to match it.
      tick([CLAUDE_OS], { now: 40000 });

      expect(entered).toHaveLength(1);
      expect(entered[0].instanceId).toBe('100:1717000000000');
      expect(exited).toHaveLength(0);
      expect(tracker.activeCount()).toBe(1);
    });

    it('a degraded scan is not counted as a miss', () => {
      tracker.reconcile([CLAUDE_OS], { now: 0, grace: 2 });
      tracker.reconcile([], { now: 10000, identityDegraded: true, grace: 2 });
      tracker.reconcile([], { now: 20000, identityDegraded: true, grace: 2 });
      const res = tracker.reconcile([], { now: 30000, identityDegraded: true, grace: 2 });
      expect(res.exited).toHaveLength(0);
      expect(tracker.activeCount()).toBe(1);
    });

    it('B5. a scan that straddled an OS sleep is frozen exactly like the other two', () => {
      // Evidence gathered before the suspend, reconciled after the resume (B5 straddle):
      // the `now` the tracker would stamp is on the far side of the sleep, so the
      // tick may neither start, end nor age a session.
      tracker.reconcile([CURSOR], { now: 1_000_000, grace: 2 });
      const straddled = tracker.reconcile([], { now: 1_010_000, grace: 2, gapStraddled: true });
      expect(straddled).toEqual({ entered: [], exited: [] });
      const again = tracker.reconcile([], { now: 1_020_000, grace: 2, gapStraddled: true });
      expect(again).toEqual({ entered: [], exited: [] });
      expect(tracker.activeCount()).toBe(1);
      // A new agent on a straddled tick is not entered either — no fabricated firstSeen.
      const fresh = tracker.reconcile([{ ...CURSOR, pid: 7, instanceId: '7:u' }], {
        now: 1_030_000,
        grace: 2,
        gapStraddled: true,
      });
      expect(fresh.entered).toHaveLength(0);
      expect(tracker.activeCount()).toBe(1);
    });

    it('B5. a straddled tick is not counted as a miss', () => {
      tracker.reconcile([CURSOR], { now: 1_000_000, grace: 2 });
      tracker.reconcile([], { now: 1_010_000, grace: 2, gapStraddled: true });
      // One reliable miss after the straddle: still within grace, no exit yet.
      const res = tracker.reconcile([], { now: 1_020_000, grace: 2 });
      expect(res.exited).toHaveLength(0);
      expect(tracker.activeCount()).toBe(1);
    });

    it('the flag is opt-in: an absent identityDegraded reconciles exactly as before', () => {
      // linux/darwin never set it — `<pid>:u` is their steady state, not an
      // outage, and every enter/exit must still be reported there.
      const { allEntered, allExited } = runScans(
        [{ agents: [CURSOR] }, { agents: [] }, { agents: [] }],
        0,
        2,
      );
      expect(allEntered).toHaveLength(1);
      expect(allExited).toHaveLength(1);
      expect(tracker.activeCount()).toBe(0);
    });
  });

  describe('reconcile — PID reuse', () => {
    it('a recycled PID belonging to a different agent starts a new session', () => {
      // pid 100 is Cursor, then after Cursor exits the OS reuses 100 for Copilot.
      // Stamps differ (space 3 :u + process name in sessionKey).
      const { allEntered } = runScans(
        [
          {
            agents: [{ pid: 100, agent: 'Cursor', process: 'cursor', instanceId: '100:u' }],
          },
          {
            agents: [{ pid: 100, agent: 'Copilot', process: 'copilot', instanceId: '100:u' }],
          },
        ],
        0,
        2,
      );
      const names = allEntered.map((e) => e.agent).sort();
      expect(names).toEqual(['Copilot', 'Cursor']);
      expect(allEntered).toHaveLength(2);
    });

    // The case the name-only key could NOT see: the OS hands pid 200 to a SECOND
    // run of the same executable. Before instanceId this collapsed into one
    // never-ending session — no exit for the dead process, no enter for the new
    // one, and firstSeen frozen at the dead process's first sighting.
    // Shape follows the existing reuse guard test in
    // tests/main/token-adapters/claude-code.test.js:264-278 (divergent startTime).
    describe('same process name, different OS birth time', () => {
      const STARTED = 1_717_000_000_000;
      const live = (startTime) => ({
        pid: 200,
        agent: 'Claude Code',
        process: 'claude',
        startTime,
        instanceId: `200:${startTime}`,
      });

      it('ends the dead session and starts a new one', () => {
        const first = tracker.reconcile([live(STARTED)], { now: 0, grace: 2 });
        expect(first.entered).toHaveLength(1);

        // The recycled pid appears (+10h birth time). The dead session is not in
        // this scan, so it ages out over the grace window.
        tracker.reconcile([live(STARTED + 36_000_000)], { now: 10000, grace: 2 });
        const res = tracker.reconcile([live(STARTED + 36_000_000)], { now: 20000, grace: 2 });

        expect(res.exited).toHaveLength(1);
        expect(res.exited[0].pid).toBe(200);
        expect(res.exited[0].instanceId).toBe(`200:${STARTED}`);
        expect(tracker.activeCount()).toBe(1);
      });

      it('gives the new instance its own firstSeen, not the dead process one', () => {
        const first = tracker.reconcile([live(STARTED)], { now: 5000, grace: 2 });
        const second = tracker.reconcile([live(STARTED + 36_000_000)], { now: 15000, grace: 2 });

        expect(first.entered[0].firstSeen).toBe(5000);
        expect(second.entered).toHaveLength(1);
        expect(second.entered[0].firstSeen).toBe(15000);
        expect(second.entered[0].instanceId).toBe(`200:${STARTED + 36_000_000}`);
      });

      it('does not fabricate a session for agents without a stamped instanceId', () => {
        // Second identity resolution is forbidden: unstamped agents are skipped.
        const bare = (startTime) => ({
          pid: 200,
          agent: 'Claude Code',
          process: 'claude',
          startTime,
        });
        const first = tracker.reconcile([bare(STARTED)], { now: 0, grace: 2 });
        const second = tracker.reconcile([bare(STARTED + 36_000_000)], { now: 10000, grace: 2 });
        expect(first.entered).toHaveLength(0);
        expect(second.entered).toHaveLength(0);
        expect(tracker.activeCount()).toBe(0);
      });

      it('a same-birth-time re-sighting is still ONE session (no flicker split)', () => {
        const { allEntered, allExited } = runScans(
          [{ agents: [live(STARTED)] }, { agents: [] }, { agents: [live(STARTED)] }],
          0,
          2,
        );
        expect(allEntered).toHaveLength(1);
        expect(allExited).toHaveLength(0);
        expect(tracker.activeCount()).toBe(1);
      });
    });
  });

  describe('reconcile — multiple concurrent agents', () => {
    it('tracks distinct sessions independently', () => {
      const res = tracker.reconcile(
        [
          { pid: 100, agent: 'Cursor', process: 'cursor', instanceId: '100:u' },
          { pid: 200, agent: 'Claude Code', process: 'claude', instanceId: '200:u' },
        ],
        { now: 0, grace: 2 },
      );
      expect(res.entered).toHaveLength(2);
      expect(tracker.activeCount()).toBe(2);
    });

    it('one agent exiting does not affect the other', () => {
      tracker.reconcile(
        [
          { pid: 100, agent: 'Cursor', process: 'cursor', instanceId: '100:u' },
          { pid: 200, agent: 'Claude Code', process: 'claude', instanceId: '200:u' },
        ],
        { now: 0, grace: 2 },
      );
      // Cursor gone, Claude stays.
      tracker.reconcile(
        [{ pid: 200, agent: 'Claude Code', process: 'claude', instanceId: '200:u' }],
        {
          now: 10000,
          grace: 2,
        },
      );
      const res = tracker.reconcile(
        [{ pid: 200, agent: 'Claude Code', process: 'claude', instanceId: '200:u' }],
        {
          now: 20000,
          grace: 2,
        },
      );
      expect(res.exited).toHaveLength(1);
      expect(res.exited[0].agent).toBe('Cursor');
      expect(tracker.activeCount()).toBe(1);
    });
  });

  describe('sessionKey', () => {
    it('is identical for the same stamped instance + process regardless of casing', () => {
      expect(tracker.sessionKey({ pid: 100, process: 'cursor', instanceId: '100:u' })).toBe(
        tracker.sessionKey({ pid: 100, process: 'Cursor', instanceId: '100:u' }),
      );
    });

    it('differs when the process name differs for the same stamped instance', () => {
      expect(tracker.sessionKey({ pid: 100, process: 'cursor', instanceId: '100:u' })).not.toBe(
        tracker.sessionKey({ pid: 100, process: 'copilot', instanceId: '100:u' }),
      );
    });

    it('returns null when instanceId is missing (no second derivation)', () => {
      expect(tracker.sessionKey({ pid: 100, process: 'cursor' })).toBeNull();
    });
  });
});
