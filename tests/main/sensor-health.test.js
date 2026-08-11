/**
 * Block B1 — pure sensor-health domain model.
 */
import { describe, it, expect } from 'vitest';
import {
  SENSOR_HEALTH_STATE,
  AGGREGATE_NONE,
  createSensorHealth,
  createUnsupported,
  markHealthy,
  markDegraded,
  markFailed,
  markDisabled,
  markUnsupported,
  reenable,
  addLoss,
  aggregateSensorHealth,
  toPlain,
} from '../../src/main/sensor-health.js';

const T0 = 1_700_000_000_000;

describe('sensor-health (B1)', () => {
  describe('construction', () => {
    it('createSensorHealth → STARTING with zero counters', () => {
      const h = createSensorHealth('process');
      expect(h).toEqual({
        sensorId: 'process',
        state: SENSOR_HEALTH_STATE.STARTING,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastError: null,
        consecutiveFailures: 0,
        lossCount: 0,
        detail: null,
      });
    });

    it('rejects empty sensorId', () => {
      expect(() => createSensorHealth('')).toThrow(/sensorId/);
      expect(() => createSensorHealth(null)).toThrow(/sensorId/);
    });

    it('createUnsupported does not start as FAILED', () => {
      const h = createUnsupported('fs-rm', { detail: 'non-win32', now: T0 });
      expect(h.state).toBe(SENSOR_HEALTH_STATE.UNSUPPORTED);
      expect(h.consecutiveFailures).toBe(0);
      expect(h.lastAttemptAt).toBe(T0);
    });
  });

  describe('success', () => {
    it('STARTING → HEALTHY advances lastSuccessAt and clears error', () => {
      let h = createSensorHealth('process');
      h = markHealthy(h, T0 + 1000);
      expect(h.state).toBe(SENSOR_HEALTH_STATE.HEALTHY);
      expect(h.lastAttemptAt).toBe(T0 + 1000);
      expect(h.lastSuccessAt).toBe(T0 + 1000);
      expect(h.consecutiveFailures).toBe(0);
      expect(h.lastError).toBeNull();
    });

    it('repeated HEALTHY advances timestamps and keeps failures at 0', () => {
      let h = markHealthy(createSensorHealth('net'), T0);
      h = markHealthy(h, T0 + 5000);
      expect(h.state).toBe(SENSOR_HEALTH_STATE.HEALTHY);
      expect(h.lastSuccessAt).toBe(T0 + 5000);
      expect(h.consecutiveFailures).toBe(0);
    });
  });

  describe('failure', () => {
    it('HEALTHY → FAILED increments consecutiveFailures; lastSuccessAt frozen', () => {
      let h = markHealthy(createSensorHealth('process'), T0);
      h = markFailed(h, T0 + 1000, { error: 'EPERM' });
      expect(h.state).toBe(SENSOR_HEALTH_STATE.FAILED);
      expect(h.consecutiveFailures).toBe(1);
      expect(h.lastError).toBe('EPERM');
      expect(h.lastSuccessAt).toBe(T0);
      expect(h.lastAttemptAt).toBe(T0 + 1000);
    });

    it('repeated FAILED increments consecutiveFailures monotonically', () => {
      let h = markHealthy(createSensorHealth('process'), T0);
      h = markFailed(h, T0 + 1, { error: 'a' });
      h = markFailed(h, T0 + 2, { error: 'b' });
      h = markFailed(h, T0 + 3, { error: 'c' });
      expect(h.consecutiveFailures).toBe(3);
      expect(h.lastError).toBe('c');
    });

    it('FAILED → HEALTHY resets consecutiveFailures and clears lastError', () => {
      let h = markFailed(markHealthy(createSensorHealth('process'), T0), T0 + 1, {
        error: 'boom',
      });
      h = markHealthy(h, T0 + 2);
      expect(h.state).toBe(SENSOR_HEALTH_STATE.HEALTHY);
      expect(h.consecutiveFailures).toBe(0);
      expect(h.lastError).toBeNull();
      expect(h.lastSuccessAt).toBe(T0 + 2);
    });
  });

  describe('degraded', () => {
    it('HEALTHY → DEGRADED does not increment consecutiveFailures', () => {
      let h = markHealthy(createSensorHealth('fs-handle'), T0);
      h = markDegraded(h, T0 + 1, { error: 'partial', detail: 'some-pids-failed' });
      expect(h.state).toBe(SENSOR_HEALTH_STATE.DEGRADED);
      expect(h.consecutiveFailures).toBe(0);
      expect(h.lastError).toBe('partial');
    });

    it('DEGRADED → HEALTHY recovers when no residual loss', () => {
      let h = markDegraded(markHealthy(createSensorHealth('fs'), T0), T0 + 1, {
        error: 'wobbly',
      });
      h = markHealthy(h, T0 + 2);
      expect(h.state).toBe(SENSOR_HEALTH_STATE.HEALTHY);
      expect(h.lastError).toBeNull();
    });
  });

  describe('disable / reenable', () => {
    it('any active → DISABLED clears consecutiveFailures and lastError', () => {
      let h = markFailed(markHealthy(createSensorHealth('process'), T0), T0 + 1, {
        error: 'x',
      });
      h = markDisabled(h, T0 + 2, { detail: 'operator-pause' });
      expect(h.state).toBe(SENSOR_HEALTH_STATE.DISABLED);
      expect(h.consecutiveFailures).toBe(0);
      expect(h.lastError).toBeNull();
      expect(h.detail).toBe('operator-pause');
    });

    it('DISABLED → reenable → STARTING (not HEALTHY)', () => {
      let h = markDisabled(createSensorHealth('process'), T0);
      h = reenable(h, T0 + 1);
      expect(h.state).toBe(SENSOR_HEALTH_STATE.STARTING);
    });

    it('cannot markHealthy from DISABLED without reenable', () => {
      const h = markDisabled(createSensorHealth('process'), T0);
      expect(() => markHealthy(h, T0 + 1)).toThrow(/DISABLED/);
    });
  });

  describe('unsupported', () => {
    it('markUnsupported from active', () => {
      let h = createSensorHealth('fs-rm');
      h = markUnsupported(h, T0, { detail: 'darwin' });
      expect(h.state).toBe(SENSOR_HEALTH_STATE.UNSUPPORTED);
    });

    it('cannot markHealthy from UNSUPPORTED', () => {
      const h = createUnsupported('fs-rm');
      expect(() => markHealthy(h, T0)).toThrow(/UNSUPPORTED/);
    });
  });

  describe('loss', () => {
    it('HEALTHY + addLoss(1) → DEGRADED with lossCount 1', () => {
      let h = markHealthy(createSensorHealth('etw-future'), T0);
      h = addLoss(h, 1, T0 + 1);
      expect(h.state).toBe(SENSOR_HEALTH_STATE.DEGRADED);
      expect(h.lossCount).toBe(1);
    });

    it('accumulates loss; never negative; rejects invalid amounts', () => {
      let h = markHealthy(createSensorHealth('net'), T0);
      h = addLoss(h, 2, T0 + 1);
      h = addLoss(h, 3, T0 + 2);
      expect(h.lossCount).toBe(5);
      expect(() => addLoss(h, 0, T0 + 3)).toThrow(/positive/);
      expect(() => addLoss(h, -1, T0 + 3)).toThrow(/positive/);
      expect(() => addLoss(h, 1.5, T0 + 3)).toThrow(/positive/);
      expect(() => addLoss(h, NaN, T0 + 3)).toThrow(/positive/);
    });

    it('later success does not erase residual loss → stays DEGRADED not HEALTHY', () => {
      let h = markHealthy(createSensorHealth('net'), T0);
      h = addLoss(h, 1, T0 + 1);
      h = markHealthy(h, T0 + 2);
      expect(h.state).toBe(SENSOR_HEALTH_STATE.DEGRADED);
      expect(h.lossCount).toBe(1);
      expect(h.consecutiveFailures).toBe(0);
      expect(h.lastSuccessAt).toBe(T0 + 2);
      expect(h.lastError).toBeNull();
    });

    it('fresh createSensorHealth starts a new lifetime with loss 0', () => {
      let h = addLoss(markHealthy(createSensorHealth('net'), T0), 9, T0 + 1);
      expect(h.lossCount).toBe(9);
      h = createSensorHealth('net');
      expect(h.lossCount).toBe(0);
      expect(h.state).toBe(SENSOR_HEALTH_STATE.STARTING);
    });

    it('FAILED + addLoss keeps FAILED but accumulates loss', () => {
      let h = markFailed(createSensorHealth('process'), T0, { error: 'down' });
      h = addLoss(h, 2, T0 + 1);
      expect(h.state).toBe(SENSOR_HEALTH_STATE.FAILED);
      expect(h.lossCount).toBe(2);
    });
  });

  describe('serialization', () => {
    it('record is plain JSON-serializable data', () => {
      let h = markFailed(markHealthy(createSensorHealth('process'), T0), T0 + 1, {
        error: 'EPERM',
        detail: 'access denied',
      });
      h = addLoss(h, 1, T0 + 2);
      const plain = toPlain(h);
      expect(plain).toEqual(h);
      expect(JSON.parse(JSON.stringify(plain))).toEqual(plain);
      for (const v of Object.values(plain)) {
        expect(v === null || ['string', 'number'].includes(typeof v)).toBe(true);
      }
    });
  });

  describe('invalid input', () => {
    it('rejects bad now', () => {
      const h = createSensorHealth('x');
      expect(() => markHealthy(h, -1)).toThrow(/now/);
      expect(() => markHealthy(h, NaN)).toThrow(/now/);
      expect(() => markHealthy(h, Infinity)).toThrow(/now/);
    });

    it('rejects non-record', () => {
      expect(() => markHealthy(null, T0)).toThrow(/record/);
    });
  });

  describe('aggregateSensorHealth', () => {
    it('excludes DISABLED and UNSUPPORTED from worst-of', () => {
      const rows = [
        markHealthy(createSensorHealth('a'), T0),
        markDisabled(createSensorHealth('b'), T0),
        createUnsupported('c'),
      ];
      const agg = aggregateSensorHealth(rows);
      expect(agg.state).toBe(SENSOR_HEALTH_STATE.HEALTHY);
      expect(agg.participatingCount).toBe(1);
    });

    it('FAILED beats DEGRADED beats STARTING beats HEALTHY', () => {
      expect(
        aggregateSensorHealth([
          markHealthy(createSensorHealth('a'), T0),
          markDegraded(createSensorHealth('b'), T0),
        ]).state,
      ).toBe(SENSOR_HEALTH_STATE.DEGRADED);
      expect(
        aggregateSensorHealth([
          markDegraded(createSensorHealth('b'), T0),
          markFailed(createSensorHealth('c'), T0, { error: 'x' }),
        ]).state,
      ).toBe(SENSOR_HEALTH_STATE.FAILED);
      expect(
        aggregateSensorHealth([
          markHealthy(createSensorHealth('a'), T0),
          createSensorHealth('start'),
        ]).state,
      ).toBe(SENSOR_HEALTH_STATE.STARTING);
    });

    it('all disabled / unsupported → NONE not HEALTHY', () => {
      const agg = aggregateSensorHealth([
        markDisabled(createSensorHealth('a'), T0),
        createUnsupported('b'),
      ]);
      expect(agg.state).toBe(AGGREGATE_NONE);
      expect(agg.participatingCount).toBe(0);
    });

    it('empty list → NONE', () => {
      expect(aggregateSensorHealth([]).state).toBe(AGGREGATE_NONE);
    });

    it('one healthy + one failed → FAILED', () => {
      const agg = aggregateSensorHealth([
        markHealthy(createSensorHealth('ok'), T0),
        markFailed(createSensorHealth('bad'), T0, { error: 'e' }),
      ]);
      expect(agg.state).toBe(SENSOR_HEALTH_STATE.FAILED);
      expect(agg.failedSensorIds).toEqual(['bad']);
    });
  });
});
