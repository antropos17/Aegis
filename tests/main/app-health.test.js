import { describe, it, expect } from 'vitest';
import {
  APP_HEALTH_STATE,
  APP_HEALTH_REASON,
  PROJECTED_SENSOR_ID,
  PROJECTION_REASON,
  projectEffectiveRecords,
  deriveAppHealth,
} from '../../src/main/app-health.js';
import { SENSOR_HEALTH_STATE, AGGREGATE_NONE } from '../../src/main/sensor-health.js';

/** Fixed literal. Nothing here reads a clock — see "no age-based rule" below. */
const T0 = 1700000000000;

/**
 * @param {string} sensorId
 * @param {string} state
 * @param {object} [over]
 */
function rec(sensorId, state, over = {}) {
  return {
    sensorId,
    state,
    lastAttemptAt: T0,
    lastSuccessAt: state === SENSOR_HEALTH_STATE.HEALTHY ? T0 : null,
    lastError: null,
    consecutiveFailures: 0,
    lossCount: 0,
    detail: null,
    ...over,
  };
}

/** `populationReliable` is kept true-iff-HEALTHY, exactly as the real contract builds it. */
function caps(populationState, over = {}) {
  return {
    populationState,
    populationReliable: populationState === SENSOR_HEALTH_STATE.HEALTHY,
    populationAsOf: populationState === SENSOR_HEALTH_STATE.HEALTHY ? T0 : null,
    identityQuality: 'witnessed',
    ...over,
  };
}

function plan(state, over = {}) {
  return {
    state,
    liveWatcherCount: state === SENSOR_HEALTH_STATE.FAILED ? 0 : 4,
    unavailableGroups: [],
    ...over,
  };
}

function input(over = {}) {
  return {
    bootPhase: true,
    capabilities: caps(SENSOR_HEALTH_STATE.HEALTHY),
    identityDegraded: false,
    records: [
      rec('process', SENSOR_HEALTH_STATE.HEALTHY),
      rec('network', SENSOR_HEALTH_STATE.HEALTHY),
    ],
    watchPlan: plan(SENSOR_HEALTH_STATE.HEALTHY),
    ...over,
  };
}

/** The accepted CIM fallback: snapshot leaf DEGRADED, keys still forming. */
function birthTimeFallback(over = {}) {
  return input({
    capabilities: caps(SENSOR_HEALTH_STATE.HEALTHY, { identityQuality: 'birth-time' }),
    identityDegraded: false,
    records: [
      rec('process', SENSOR_HEALTH_STATE.HEALTHY),
      rec(PROJECTED_SENSOR_ID, SENSOR_HEALTH_STATE.DEGRADED, { detail: 'cim-fallback' }),
      rec('network', SENSOR_HEALTH_STATE.HEALTHY),
    ],
    ...over,
  });
}

describe('app-health', () => {
  describe('transitions', () => {
    it('1. BOOTING while the deferred modules are unloaded — and it reads nothing else', () => {
      const out = deriveAppHealth({ bootPhase: false });
      expect(out.state).toBe(APP_HEALTH_STATE.BOOTING);
      expect(out.reasons).toEqual([]);
      expect(out.raw).toBeNull();
      expect(out.effective).toBeNull();
    });

    it('1→2. bootPhase flips with every leaf still STARTING → SENSORS_STARTING', () => {
      const out = deriveAppHealth(
        input({
          capabilities: caps(SENSOR_HEALTH_STATE.STARTING),
          records: [
            rec('process', SENSOR_HEALTH_STATE.STARTING),
            rec('network', SENSOR_HEALTH_STATE.STARTING),
          ],
          watchPlan: plan(SENSOR_HEALTH_STATE.STARTING),
        }),
      );
      expect(out.state).toBe(APP_HEALTH_STATE.SENSORS_STARTING);
    });

    it('2. SENSORS_STARTING → HEALTHY once every leaf and the plan have observed', () => {
      expect(deriveAppHealth(input()).state).toBe(APP_HEALTH_STATE.HEALTHY);
    });

    it('3. SENSORS_STARTING → DEGRADED: a degraded leaf is not swallowed by startup', () => {
      const out = deriveAppHealth(
        input({
          capabilities: caps(SENSOR_HEALTH_STATE.STARTING),
          records: [
            rec('process', SENSOR_HEALTH_STATE.STARTING),
            rec('network', SENSOR_HEALTH_STATE.DEGRADED),
          ],
          watchPlan: plan(SENSOR_HEALTH_STATE.STARTING),
        }),
      );
      expect(out.state).toBe(APP_HEALTH_STATE.DEGRADED);
    });

    it('4. HEALTHY → FAILED when the population enumeration fails', () => {
      const out = deriveAppHealth(
        input({
          capabilities: caps(SENSOR_HEALTH_STATE.FAILED),
          records: [
            rec('process', SENSOR_HEALTH_STATE.FAILED),
            rec('network', SENSOR_HEALTH_STATE.HEALTHY),
          ],
        }),
      );
      expect(out.state).toBe(APP_HEALTH_STATE.FAILED);
    });

    it('5. FAILED → DEGRADED: recovery does not require every leaf to be clean', () => {
      const out = deriveAppHealth(
        input({
          capabilities: caps(SENSOR_HEALTH_STATE.HEALTHY),
          records: [
            rec('process', SENSOR_HEALTH_STATE.HEALTHY),
            rec('network', SENSOR_HEALTH_STATE.FAILED),
          ],
        }),
      );
      expect(out.state).toBe(APP_HEALTH_STATE.DEGRADED);
    });

    it('6. HEALTHY → DEGRADED on identity degradation', () => {
      const out = deriveAppHealth(
        input({
          identityDegraded: true,
          capabilities: caps(SENSOR_HEALTH_STATE.HEALTHY, { identityQuality: 'unknown' }),
        }),
      );
      expect(out.state).toBe(APP_HEALTH_STATE.DEGRADED);
      expect(out.reasons).toContain(APP_HEALTH_REASON.IDENTITY_DEGRADED);
    });

    it('7. HEALTHY → DEGRADED on an unavailable watch root', () => {
      const out = deriveAppHealth(
        input({
          watchPlan: plan(SENSOR_HEALTH_STATE.DEGRADED, {
            unavailableGroups: [{ id: 'env-files', state: 'errored', reason: 'EPERM' }],
            liveWatcherCount: 3,
          }),
        }),
      );
      expect(out.state).toBe(APP_HEALTH_STATE.DEGRADED);
    });

    it('8. residual loss never reads as HEALTHY (no addLoss caller in src/ today)', () => {
      const out = deriveAppHealth(
        input({
          records: [
            rec('process', SENSOR_HEALTH_STATE.HEALTHY),
            rec('network', SENSOR_HEALTH_STATE.HEALTHY, { lossCount: 3 }),
          ],
        }),
      );
      expect(out.state).toBe(APP_HEALTH_STATE.DEGRADED);
      expect(out.reasons).toContain(APP_HEALTH_REASON.RESIDUAL_LOSS);
    });

    it('9. zero coverage → FAILED (defensive invariant, no live route)', () => {
      const out = deriveAppHealth(input({ records: [] }));
      expect(out.effective.state).toBe(AGGREGATE_NONE);
      expect(out.state).toBe(APP_HEALTH_STATE.FAILED);
      expect(out.reasons).toContain(APP_HEALTH_REASON.ZERO_COVERAGE);
    });
  });

  // populationReliable is `true` iff populationState === 'HEALTHY', so the boolean
  // collapses STARTING, DEGRADED and FAILED into one `false`. A, B and C differ in
  // exactly what it collapses — together they are the proof that the derivation reads
  // the state and not the flag.
  describe('population lifecycle — populationState, never populationReliable', () => {
    it('A. normal startup is SENSORS_STARTING, never FAILED', () => {
      const out = deriveAppHealth(
        input({
          capabilities: caps(SENSOR_HEALTH_STATE.STARTING),
          records: [
            rec('process', SENSOR_HEALTH_STATE.STARTING),
            rec('network', SENSOR_HEALTH_STATE.STARTING),
          ],
          watchPlan: plan(SENSOR_HEALTH_STATE.STARTING),
        }),
      );
      expect(out.state).toBe(APP_HEALTH_STATE.SENSORS_STARTING);
      expect(out.state).not.toBe(APP_HEALTH_STATE.FAILED);
    });

    it('B. a real population failure is FAILED even while another leaf is STARTING', () => {
      const out = deriveAppHealth(
        input({
          capabilities: caps(SENSOR_HEALTH_STATE.FAILED),
          records: [
            rec('process', SENSOR_HEALTH_STATE.FAILED),
            rec('network', SENSOR_HEALTH_STATE.STARTING),
          ],
        }),
      );
      expect(out.state).toBe(APP_HEALTH_STATE.FAILED);
    });

    it('C. a partial population state is DEGRADED, not FAILED', () => {
      const out = deriveAppHealth(
        input({
          capabilities: caps(SENSOR_HEALTH_STATE.DEGRADED),
          records: [
            rec('process', SENSOR_HEALTH_STATE.DEGRADED),
            rec('network', SENSOR_HEALTH_STATE.HEALTHY),
          ],
        }),
      );
      expect(out.state).toBe(APP_HEALTH_STATE.DEGRADED);
    });

    it('all three carry populationReliable false — the flag cannot tell them apart', () => {
      for (const state of [
        SENSOR_HEALTH_STATE.STARTING,
        SENSOR_HEALTH_STATE.DEGRADED,
        SENSOR_HEALTH_STATE.FAILED,
      ]) {
        expect(caps(state).populationReliable).toBe(false);
      }
    });
  });

  describe('accepted CIM fallback — the effective projection', () => {
    it('D. birth-time fallback with everything else healthy is app HEALTHY', () => {
      expect(deriveAppHealth(birthTimeFallback()).state).toBe(APP_HEALTH_STATE.HEALTHY);
    });

    it('E. the fallback does not mask a leaf that is still starting', () => {
      const out = deriveAppHealth(
        birthTimeFallback({
          records: [
            rec('process', SENSOR_HEALTH_STATE.HEALTHY),
            rec(PROJECTED_SENSOR_ID, SENSOR_HEALTH_STATE.DEGRADED, { detail: 'cim-fallback' }),
            rec('network', SENSOR_HEALTH_STATE.STARTING),
          ],
        }),
      );
      expect(out.state).toBe(APP_HEALTH_STATE.SENSORS_STARTING);
    });

    it('F. the fallback does not mask a real failure', () => {
      const out = deriveAppHealth(
        birthTimeFallback({
          records: [
            rec('process', SENSOR_HEALTH_STATE.HEALTHY),
            rec(PROJECTED_SENSOR_ID, SENSOR_HEALTH_STATE.DEGRADED, { detail: 'cim-fallback' }),
            rec('network', SENSOR_HEALTH_STATE.FAILED),
          ],
        }),
      );
      expect(out.state).toBe(APP_HEALTH_STATE.DEGRADED);
    });

    it('G. the projection is narrow: not while identity is degraded', () => {
      const out = deriveAppHealth(
        birthTimeFallback({
          identityDegraded: true,
          capabilities: caps(SENSOR_HEALTH_STATE.HEALTHY, { identityQuality: 'unknown' }),
        }),
      );
      expect(out.projections).toEqual([]);
      expect(out.state).toBe(APP_HEALTH_STATE.DEGRADED);
    });

    it('G. the projection is narrow: never lifts a FAILED snapshot leaf', () => {
      const out = deriveAppHealth(
        birthTimeFallback({
          records: [
            rec('process', SENSOR_HEALTH_STATE.HEALTHY),
            rec(PROJECTED_SENSOR_ID, SENSOR_HEALTH_STATE.FAILED),
          ],
        }),
      );
      expect(out.projections).toEqual([]);
      expect(out.state).toBe(APP_HEALTH_STATE.DEGRADED);
    });

    it('G. the projection is narrow: never erases residual loss', () => {
      const out = deriveAppHealth(
        birthTimeFallback({
          records: [
            rec('process', SENSOR_HEALTH_STATE.HEALTHY),
            rec(PROJECTED_SENSOR_ID, SENSOR_HEALTH_STATE.DEGRADED, {
              detail: 'cim-fallback',
              lossCount: 1,
            }),
          ],
        }),
      );
      expect(out.projections).toEqual([]);
      expect(out.state).toBe(APP_HEALTH_STATE.DEGRADED);
      expect(out.reasons).toContain(APP_HEALTH_REASON.RESIDUAL_LOSS);
    });

    it('G. the projection is narrow: no other sensor id is ever lifted', () => {
      const out = deriveAppHealth(
        birthTimeFallback({
          records: [
            rec('process', SENSOR_HEALTH_STATE.HEALTHY),
            rec('fs-rm', SENSOR_HEALTH_STATE.DEGRADED),
          ],
        }),
      );
      expect(out.projections).toEqual([]);
      expect(out.state).toBe(APP_HEALTH_STATE.DEGRADED);
    });

    it('H. the raw record stays DEGRADED and the rewrite is published', () => {
      const out = deriveAppHealth(birthTimeFallback());
      expect(out.raw.state).toBe(SENSOR_HEALTH_STATE.DEGRADED);
      expect(out.raw.degradedSensorIds).toEqual([PROJECTED_SENSOR_ID]);
      expect(out.effective.state).toBe(SENSOR_HEALTH_STATE.HEALTHY);
      expect(out.effective.degradedSensorIds).toEqual([]);
      expect(out.projections).toEqual([
        {
          sensorId: PROJECTED_SENSOR_ID,
          from: SENSOR_HEALTH_STATE.DEGRADED,
          to: SENSOR_HEALTH_STATE.HEALTHY,
          reason: PROJECTION_REASON,
        },
      ]);
    });

    it('H. participation is unchanged — the record is rewritten, not dropped', () => {
      const out = deriveAppHealth(birthTimeFallback());
      expect(out.effective.participatingCount).toBe(out.raw.participatingCount);
      expect(out.effective.totalCount).toBe(out.raw.totalCount);
    });

    it('projectEffectiveRecords does not mutate the caller’s records', () => {
      const records = [
        rec(PROJECTED_SENSOR_ID, SENSOR_HEALTH_STATE.DEGRADED, { detail: 'cim-fallback' }),
      ];
      const out = projectEffectiveRecords(records, { identityQuality: 'birth-time' }, false);
      expect(records[0].state).toBe(SENSOR_HEALTH_STATE.DEGRADED);
      expect(out.records[0].state).toBe(SENSOR_HEALTH_STATE.HEALTHY);
      expect(out.records[0]).not.toBe(records[0]);
    });
  });

  // These red if rules 2/3 are moved below rule 4 — a confirmed failure outranks a
  // not-yet, exactly as deriveWatchPlaneState orders its own rules.
  describe('rule order — failure outranks not-yet', () => {
    it('I. a closed population gate is not masked by a starting plan', () => {
      const out = deriveAppHealth(
        input({
          capabilities: caps(SENSOR_HEALTH_STATE.FAILED),
          records: [
            rec('process', SENSOR_HEALTH_STATE.FAILED),
            rec('network', SENSOR_HEALTH_STATE.STARTING),
          ],
          watchPlan: plan(SENSOR_HEALTH_STATE.STARTING),
        }),
      );
      expect(out.state).toBe(APP_HEALTH_STATE.FAILED);
    });

    it('J. a degraded leaf is not masked by a starting plan', () => {
      const out = deriveAppHealth(
        input({
          capabilities: caps(SENSOR_HEALTH_STATE.STARTING),
          records: [
            rec('process', SENSOR_HEALTH_STATE.STARTING),
            rec('network', SENSOR_HEALTH_STATE.DEGRADED),
          ],
          watchPlan: plan(SENSOR_HEALTH_STATE.STARTING),
        }),
      );
      expect(out.state).toBe(APP_HEALTH_STATE.DEGRADED);
    });

    it('K. a mixed startup does not fall through the rules', () => {
      // ~9 s of every launch: the process tick lands at 3 s, the network one at 12 s.
      const out = deriveAppHealth(
        input({
          records: [
            rec('process', SENSOR_HEALTH_STATE.HEALTHY),
            rec('network', SENSOR_HEALTH_STATE.STARTING),
            rec('fs-handle', SENSOR_HEALTH_STATE.STARTING),
          ],
        }),
      );
      expect(out.effective.state).toBe(SENSOR_HEALTH_STATE.STARTING);
      expect(out.state).toBe(APP_HEALTH_STATE.SENSORS_STARTING);
    });
  });

  // A single leaf in FAILED reaches DEGRADED, never FAILED. Replacing the derivation
  // with `return effective.state` reds every case here.
  describe('FAILED is a capability statement, not worst-of', () => {
    for (const sensorId of ['network', 'fs-rm', PROJECTED_SENSOR_ID, 'fs-chokidar']) {
      it(`a lone ${sensorId} FAILED is app DEGRADED`, () => {
        const out = deriveAppHealth(
          input({
            records: [
              rec('process', SENSOR_HEALTH_STATE.HEALTHY),
              rec(sensorId, SENSOR_HEALTH_STATE.FAILED),
            ],
          }),
        );
        expect(out.effective.state).toBe(SENSOR_HEALTH_STATE.FAILED);
        expect(out.state).toBe(APP_HEALTH_STATE.DEGRADED);
      });
    }

    it('only a lost population capability reaches FAILED', () => {
      const out = deriveAppHealth(
        input({
          capabilities: caps(SENSOR_HEALTH_STATE.FAILED),
          records: [rec('process', SENSOR_HEALTH_STATE.FAILED)],
        }),
      );
      expect(out.state).toBe(APP_HEALTH_STATE.FAILED);
    });
  });

  describe('reasons — the complete set of satisfied conditions', () => {
    it('R1. normal startup', () => {
      const out = deriveAppHealth(
        input({
          capabilities: caps(SENSOR_HEALTH_STATE.STARTING),
          records: [
            rec('process', SENSOR_HEALTH_STATE.STARTING),
            rec('network', SENSOR_HEALTH_STATE.STARTING),
          ],
          watchPlan: plan(SENSOR_HEALTH_STATE.STARTING),
        }),
      );
      expect(out.reasons).toEqual([
        APP_HEALTH_REASON.POPULATION_STARTING,
        APP_HEALTH_REASON.SENSOR_STARTING,
        APP_HEALTH_REASON.WATCH_PLAN_STARTING,
      ]);
    });

    it('R2. population failure keeps sensor-failed too — the process leaf is both', () => {
      const out = deriveAppHealth(
        input({
          capabilities: caps(SENSOR_HEALTH_STATE.FAILED),
          records: [
            rec('process', SENSOR_HEALTH_STATE.FAILED),
            rec('network', SENSOR_HEALTH_STATE.STARTING),
          ],
        }),
      );
      expect(out.reasons).toEqual([
        APP_HEALTH_REASON.POPULATION_FAILED,
        APP_HEALTH_REASON.SENSOR_FAILED,
      ]);
      expect(out.effective.failedSensorIds).toEqual(['process']);
    });

    it('R3. an accepted fallback leaves nothing to report', () => {
      expect(deriveAppHealth(birthTimeFallback()).reasons).toEqual([]);
    });

    it('R4. the fallback plus a failed network reports only the failure', () => {
      const out = deriveAppHealth(
        birthTimeFallback({
          records: [
            rec('process', SENSOR_HEALTH_STATE.HEALTHY),
            rec(PROJECTED_SENSOR_ID, SENSOR_HEALTH_STATE.DEGRADED, { detail: 'cim-fallback' }),
            rec('network', SENSOR_HEALTH_STATE.FAILED),
          ],
        }),
      );
      expect(out.reasons).toEqual([APP_HEALTH_REASON.SENSOR_FAILED]);
    });

    it('R5. several causes at once, in declaration order', () => {
      const out = deriveAppHealth(
        input({
          capabilities: caps(SENSOR_HEALTH_STATE.DEGRADED, { identityQuality: 'unknown' }),
          identityDegraded: true,
          records: [rec('process', SENSOR_HEALTH_STATE.DEGRADED)],
          watchPlan: plan(SENSOR_HEALTH_STATE.DEGRADED, {
            unavailableGroups: [{ id: 'agent-config', state: 'errored', reason: 'ENOENT' }],
            liveWatcherCount: 2,
          }),
        }),
      );
      expect(out.reasons).toEqual([
        APP_HEALTH_REASON.POPULATION_DEGRADED,
        APP_HEALTH_REASON.SENSOR_DEGRADED,
        APP_HEALTH_REASON.IDENTITY_DEGRADED,
        APP_HEALTH_REASON.WATCH_ROOTS_UNAVAILABLE,
      ]);
    });
  });

  describe('orthogonality — monitoringPaused is not an input', () => {
    it('N1. an injected monitoringPaused changes nothing, in either position', () => {
      const base = deriveAppHealth(input());
      expect(deriveAppHealth(input({ monitoringPaused: true }))).toEqual(base);
      expect(deriveAppHealth(input({ monitoringPaused: false }))).toEqual(base);
    });

    it('N1. it cannot rescue a degraded reading either', () => {
      const degraded = input({
        records: [
          rec('process', SENSOR_HEALTH_STATE.HEALTHY),
          rec('network', SENSOR_HEALTH_STATE.DEGRADED),
        ],
      });
      expect(deriveAppHealth({ ...degraded, monitoringPaused: true }).state).toBe(
        APP_HEALTH_STATE.DEGRADED,
      );
    });

    it('N3. no age-based rule: a stale lastSuccessAt derives the same state', () => {
      const fresh = deriveAppHealth(input());
      const stale = deriveAppHealth(
        input({
          capabilities: caps(SENSOR_HEALTH_STATE.HEALTHY, { populationAsOf: 1 }),
          records: [
            rec('process', SENSOR_HEALTH_STATE.HEALTHY, { lastSuccessAt: 1, lastAttemptAt: 1 }),
            rec('network', SENSOR_HEALTH_STATE.HEALTHY, { lastSuccessAt: 1, lastAttemptAt: 1 }),
          ],
        }),
      );
      expect(stale.state).toBe(fresh.state);
      expect(stale.reasons).toEqual(fresh.reasons);
    });
  });

  describe('totality and closed range', () => {
    /**
     * The three axes are fed as INDEPENDENT inputs on purpose, and some combinations
     * are unconstructable from real records: `populationState` IS the `process`
     * record's state and that record participates in the aggregate, so
     * populationState FAILED alongside an effective aggregate of HEALTHY never occurs
     * in life — and neither does watchPlan FAILED beside a healthy aggregate, which is
     * why the watch-plan states are named in rule 3 at all.
     *
     * Totality is proven over the INPUT TYPE, not over reachable states: the
     * impossible rows are exactly what catches a fall-through. Deleting them as
     * "unrealistic" destroys the test.
     *
     * It proves termination in a valid state and a closed reason range. It does NOT
     * prove precedence — that is what A/B/C, D/E/F and the mutation runs are for.
     */
    const POPULATION = [
      SENSOR_HEALTH_STATE.STARTING,
      SENSOR_HEALTH_STATE.HEALTHY,
      SENSOR_HEALTH_STATE.DEGRADED,
      SENSOR_HEALTH_STATE.FAILED,
    ];
    const AGGREGATES = [
      [SENSOR_HEALTH_STATE.HEALTHY, [rec('x', SENSOR_HEALTH_STATE.HEALTHY)]],
      [SENSOR_HEALTH_STATE.STARTING, [rec('x', SENSOR_HEALTH_STATE.STARTING)]],
      [SENSOR_HEALTH_STATE.DEGRADED, [rec('x', SENSOR_HEALTH_STATE.DEGRADED)]],
      [SENSOR_HEALTH_STATE.FAILED, [rec('x', SENSOR_HEALTH_STATE.FAILED)]],
      [AGGREGATE_NONE, []],
    ];
    const PLANS = [
      SENSOR_HEALTH_STATE.STARTING,
      SENSOR_HEALTH_STATE.HEALTHY,
      SENSOR_HEALTH_STATE.DEGRADED,
      SENSOR_HEALTH_STATE.FAILED,
    ];

    it('20. every combination terminates in exactly one valid state', () => {
      const states = Object.values(APP_HEALTH_STATE);
      let combinations = 0;
      for (const populationState of POPULATION) {
        for (const [aggregateState, records] of AGGREGATES) {
          for (const planState of PLANS) {
            const out = deriveAppHealth(
              input({ capabilities: caps(populationState), records, watchPlan: plan(planState) }),
            );
            combinations += 1;
            expect(out.effective.state, `aggregate axis for ${aggregateState}`).toBe(
              aggregateState,
            );
            expect(states, `${populationState} / ${aggregateState} / ${planState}`).toContain(
              out.state,
            );
          }
        }
      }
      expect(combinations).toBe(80);
    });

    it('R6. reasons stay inside the closed set, with no duplicates', () => {
      const codes = Object.values(APP_HEALTH_REASON);
      for (const populationState of POPULATION) {
        for (const [, records] of AGGREGATES) {
          for (const planState of PLANS) {
            const out = deriveAppHealth(
              input({ capabilities: caps(populationState), records, watchPlan: plan(planState) }),
            );
            for (const reason of out.reasons) expect(codes).toContain(reason);
            expect(new Set(out.reasons).size).toBe(out.reasons.length);
          }
        }
      }
    });

    it('the state set itself is closed and frozen', () => {
      expect(Object.isFrozen(APP_HEALTH_STATE)).toBe(true);
      expect(Object.isFrozen(APP_HEALTH_REASON)).toBe(true);
      expect(Object.values(APP_HEALTH_STATE)).toHaveLength(5);
      expect(Object.values(APP_HEALTH_REASON)).toHaveLength(11);
    });
  });

  describe('input validation', () => {
    it('rejects a missing bootPhase rather than guessing one', () => {
      expect(() => deriveAppHealth({})).toThrow(/bootPhase/);
    });

    it('rejects a booted input with no capability contract', () => {
      expect(() => deriveAppHealth({ bootPhase: true })).toThrow(/populationState/);
    });

    it('rejects a non-boolean identityDegraded — it must be read, never inferred', () => {
      expect(() =>
        deriveAppHealth(input({ identityDegraded: /** @type {never} */ ('unknown') })),
      ).toThrow(/identityDegraded/);
    });
  });
});
