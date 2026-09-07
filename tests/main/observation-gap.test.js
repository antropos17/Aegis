/**
 * Block B5 — the observation-gap machine (src/main/observation-gap.js).
 *
 * Pure: every clock value is passed in, `powerMonitor` is an injected `{on}` and the
 * only side effect is the `onGap` callback `attach` is given. No fake timers are
 * needed here — the scan-loop suite is where the tick side of the contract lives.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import {
  OBSERVATION_GAP_STATE,
  init,
  attach,
  noteSuspend,
  noteResume,
  noteObserved,
  snapshot,
  buildGapAuditDetails,
  _resetForTest,
} from '../../src/main/observation-gap.js';

const T0 = 1_700_000_000_000;

/** The shape a fresh process publishes before any power event. */
const FRESH = Object.freeze({
  state: 'NONE',
  suspendedAt: null,
  resumedAt: null,
  gapMs: null,
  clearedAt: null,
  suspendCount: 0,
  totalGapMs: 0,
});

describe('observation-gap (B5)', () => {
  beforeEach(() => {
    _resetForTest();
  });

  describe('construction', () => {
    it('1. a fresh process is NONE with null gap fields and zero counters', () => {
      expect(snapshot()).toEqual(FRESH);
    });

    it('2. snapshot() is a fresh JSON-safe object on every call', () => {
      const a = snapshot();
      const b = snapshot();
      expect(a).not.toBe(b);
      expect(JSON.parse(JSON.stringify(a))).toEqual(a);
      a.state = 'MUTATED';
      expect(snapshot().state).toBe(OBSERVATION_GAP_STATE.NONE);
    });

    it('the state set is closed and frozen', () => {
      expect(Object.isFrozen(OBSERVATION_GAP_STATE)).toBe(true);
      expect(Object.values(OBSERVATION_GAP_STATE).sort()).toEqual(['NONE', 'RESUMED', 'SUSPENDED']);
    });
  });

  describe('suspend', () => {
    it('3. suspend → SUSPENDED, stamps suspendedAt and counts once', () => {
      const s = noteSuspend(T0);
      expect(s).toEqual({
        ...FRESH,
        state: OBSERVATION_GAP_STATE.SUSPENDED,
        suspendedAt: T0,
        suspendCount: 1,
      });
    });

    it('4. a second suspend with no resume between keeps the FIRST suspendedAt', () => {
      noteSuspend(T0);
      const s = noteSuspend(T0 + 500);
      expect(s.state).toBe(OBSERVATION_GAP_STATE.SUSPENDED);
      expect(s.suspendedAt).toBe(T0);
      expect(s.suspendCount).toBe(2);
    });
  });

  describe('resume', () => {
    it('5. resume after suspend → RESUMED with the gap measured and accumulated', () => {
      noteSuspend(T0);
      const s = noteResume(T0 + 4000);
      expect(s).toEqual({
        state: OBSERVATION_GAP_STATE.RESUMED,
        suspendedAt: T0,
        resumedAt: T0 + 4000,
        gapMs: 4000,
        clearedAt: null,
        suspendCount: 1,
        totalGapMs: 4000,
      });
    });

    it('6. a resume nobody saw the suspend of still ARMS the flag, with an unknown gap', () => {
      const s = noteResume(T0);
      expect(s).toEqual({
        ...FRESH,
        state: OBSERVATION_GAP_STATE.RESUMED,
        resumedAt: T0,
      });
    });

    it('7. two pairs accumulate the totals and the snapshot describes the LAST gap', () => {
      noteSuspend(T0);
      noteResume(T0 + 1000);
      noteObserved(T0 + 2000);
      noteSuspend(T0 + 10_000);
      const s = noteResume(T0 + 13_000);
      expect(s.suspendedAt).toBe(T0 + 10_000);
      expect(s.resumedAt).toBe(T0 + 13_000);
      expect(s.gapMs).toBe(3000);
      expect(s.suspendCount).toBe(2);
      expect(s.totalGapMs).toBe(4000);
      expect(s.clearedAt).toBeNull();
    });

    it('a resume whose clock reads earlier than the suspend clamps the gap to 0', () => {
      noteSuspend(T0);
      const s = noteResume(T0 - 1);
      expect(s.state).toBe(OBSERVATION_GAP_STATE.RESUMED);
      expect(s.gapMs).toBe(0);
      expect(s.totalGapMs).toBe(0);
    });
  });

  describe('observed — the tick that clears the flag', () => {
    it('8. an observation while RESUMED clears to NONE and keeps the last gap readable', () => {
      noteSuspend(T0);
      noteResume(T0 + 4000);
      const s = noteObserved(T0 + 9000);
      expect(s).toEqual({
        state: OBSERVATION_GAP_STATE.NONE,
        suspendedAt: T0,
        resumedAt: T0 + 4000,
        gapMs: 4000,
        clearedAt: T0 + 9000,
        suspendCount: 1,
        totalGapMs: 4000,
      });
    });

    it('9. an observation while SUSPENDED does not clear — the resume has not come', () => {
      noteSuspend(T0);
      const s = noteObserved(T0 + 100);
      expect(s.state).toBe(OBSERVATION_GAP_STATE.SUSPENDED);
      expect(s.clearedAt).toBeNull();
    });

    it('10. an observation while NONE changes nothing', () => {
      expect(noteObserved(T0)).toEqual(FRESH);
    });

    it('11. a suspend after a cleared gap starts a NEW gap from a clean slate', () => {
      noteSuspend(T0);
      noteResume(T0 + 4000);
      noteObserved(T0 + 9000);
      const s = noteSuspend(T0 + 20_000);
      expect(s).toEqual({
        state: OBSERVATION_GAP_STATE.SUSPENDED,
        suspendedAt: T0 + 20_000,
        resumedAt: null,
        gapMs: null,
        clearedAt: null,
        suspendCount: 2,
        totalGapMs: 4000,
      });
    });
  });

  describe('attach — the injected powerMonitor', () => {
    it('12. subscribes exactly suspend and resume, reading the injected clock', () => {
      const pm = new EventEmitter();
      let clock = T0;
      init({ now: () => clock });
      attach(pm);
      expect(pm.eventNames().sort()).toEqual(['resume', 'suspend']);
      pm.emit('suspend');
      clock = T0 + 2500;
      pm.emit('resume');
      const s = snapshot();
      expect(s.state).toBe(OBSERVATION_GAP_STATE.RESUMED);
      expect(s.suspendedAt).toBe(T0);
      expect(s.resumedAt).toBe(T0 + 2500);
      expect(s.gapMs).toBe(2500);
    });

    it('13. onGap fires once per resume with the RESUMED snapshot, never on suspend', () => {
      const pm = new EventEmitter();
      const onGap = vi.fn();
      init({ now: () => T0 });
      attach(pm, { onGap });
      pm.emit('suspend');
      expect(onGap).not.toHaveBeenCalled();
      pm.emit('resume');
      expect(onGap).toHaveBeenCalledTimes(1);
      expect(onGap.mock.calls[0][0]).toEqual(snapshot());
      expect(onGap.mock.calls[0][0].state).toBe(OBSERVATION_GAP_STATE.RESUMED);
    });

    it('14. attaching twice is refused — one subscription per process life', () => {
      const pm = new EventEmitter();
      attach(pm);
      expect(() => attach(pm)).toThrow(/already attached/);
      expect(pm.listenerCount('suspend')).toBe(1);
    });

    it('15. a powerMonitor without on() is refused', () => {
      expect(() => attach({})).toThrow(/powerMonitor/);
      expect(() => attach(null)).toThrow(/powerMonitor/);
    });
  });

  describe('input validation', () => {
    it('16. every note rejects a clock value that is not a finite non-negative number', () => {
      for (const bad of [NaN, Infinity, -1, '1', null, undefined]) {
        expect(() => noteSuspend(bad)).toThrow(/now/);
        expect(() => noteResume(bad)).toThrow(/now/);
        expect(() => noteObserved(bad)).toThrow(/now/);
      }
    });
  });

  describe('buildGapAuditDetails — the observation-gap audit record', () => {
    it('18. renders a resumed snapshot with ISO timestamps and the operator context', () => {
      noteSuspend(T0);
      const s = noteResume(T0 + 4000);
      expect(buildGapAuditDetails(s, { monitoringPaused: false, activeSessions: 2 })).toEqual({
        cause: 'os-suspend',
        suspendedAt: new Date(T0).toISOString(),
        resumedAt: new Date(T0 + 4000).toISOString(),
        gapMs: 4000,
        suspendCount: 1,
        monitoringPaused: false,
        activeSessions: 2,
      });
    });

    it('19. a resume without a seen suspend renders null, never a guessed time', () => {
      const s = noteResume(T0);
      const d = buildGapAuditDetails(s, { monitoringPaused: true, activeSessions: 0 });
      expect(d.suspendedAt).toBeNull();
      expect(d.gapMs).toBeNull();
      expect(d.monitoringPaused).toBe(true);
    });

    it('20. rejects an operator context it cannot vouch for', () => {
      const s = noteResume(T0);
      expect(() => buildGapAuditDetails(s, { monitoringPaused: 'no', activeSessions: 0 })).toThrow(
        /monitoringPaused/,
      );
      expect(() =>
        buildGapAuditDetails(s, { monitoringPaused: false, activeSessions: -1 }),
      ).toThrow(/activeSessions/);
    });
  });
});
