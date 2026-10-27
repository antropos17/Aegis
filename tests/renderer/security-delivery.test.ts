import { describe, expect, it } from 'vitest';
import { emptyTelemetry } from '../../frontend/observatory/runtime/host';
import {
  DELIVERY_FRESHNESS_MS,
  securityDelivery,
} from '../../frontend/observatory/runtime/security-delivery';

const now = 1_000_000;
const buckets = ['file-watch', 'file-handle', 'process', 'network', 'other'];
function fixture() {
  const sensors = Object.fromEntries(
    buckets.map((key, i) => [
      key,
      {
        accepted: i + 1,
        delivered: i + 2,
        buffered: i,
        lost: i === 1 ? 3 : 0,
      },
    ]),
  );
  return {
    ...emptyTelemetry(),
    ready: true,
    stale: false,
    statsAt: now,
    stats: {
      ipc: {
        securityEvents: {
          sensors,
          pendingLoss: 2,
          unknownLoss: false,
          markerDurable: true,
          replayPending: false,
          spill: { records: 7, bytes: 1234, blocked: false },
        },
      },
    },
  };
}

describe('security event delivery report', () => {
  it('sums only the five fixed buckets without imposing a relationship between replay and acceptance', () => {
    expect(securityDelivery(fixture(), now)).toEqual({
      available: true,
      accepted: 15,
      delivered: 20,
      buffered: 10,
      lost: 3,
      pendingLoss: 2,
      unknownLoss: false,
      markerDurable: true,
      replayPending: false,
      spillRecords: 7,
      spillBytes: 1234,
      spillBlocked: false,
    });
  });
  it.each(['not-ready', 'stale', 'error', 'missing-time', 'old', 'future'])(
    'does not present retained data when %s',
    (state) => {
      const value = fixture();
      if (state === 'not-ready') value.ready = false;
      if (state === 'stale') value.stale = true;
      if (state === 'error') value.error = 'PRIVATE';
      if (state === 'missing-time') value.statsAt = null;
      if (state === 'old') value.statsAt = now - DELIVERY_FRESHNESS_MS;
      if (state === 'future') value.statsAt = now + 1;
      expect(securityDelivery(value, now)).toEqual({ available: false });
    },
  );
  it('does not invent zero for missing, malformed, negative, unsafe, or overflowed counters', () => {
    const value = fixture();
    const event = value.stats.ipc.securityEvents;
    delete (event.sensors['other'] as Partial<(typeof event.sensors)['other']>).lost;
    expect(securityDelivery(value, now)).toEqual({ available: false });
    event.sensors.other.lost = -1;
    expect(securityDelivery(value, now)).toEqual({ available: false });
    event.sensors.other.lost = Number.MAX_SAFE_INTEGER + 1;
    expect(securityDelivery(value, now)).toEqual({ available: false });
    event.sensors.other.lost = Number.MAX_SAFE_INTEGER;
    expect(securityDelivery(value, now)).toEqual({ available: false });
    event.sensors.other.lost = 0;
    event.spill.blocked = 'true' as unknown as boolean;
    expect(securityDelivery(value, now)).toEqual({ available: false });
  });
  it('rejects extra or missing buckets instead of presenting a partial total', () => {
    const value = fixture();
    value.stats.ipc.securityEvents.sensors.extra = {
      accepted: 2,
      delivered: 0,
      buffered: 0,
      lost: 0,
    };
    expect(securityDelivery(value, now)).toEqual({ available: false });
    delete value.stats.ipc.securityEvents.sensors.extra;
    delete value.stats.ipc.securityEvents.sensors.other;
    expect(securityDelivery(value, now)).toEqual({ available: false });
  });

  it('keeps unknown loss distinct from a zero known pending count', () => {
    const value = fixture();
    value.stats.ipc.securityEvents.unknownLoss = true;
    value.stats.ipc.securityEvents.pendingLoss = 0;
    expect(securityDelivery(value, now)).toMatchObject({
      available: true,
      unknownLoss: true,
      pendingLoss: 0,
    });
  });
});
