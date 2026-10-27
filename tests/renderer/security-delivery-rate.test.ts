import { describe, expect, it } from 'vitest';
import { emptyTelemetry } from '../../frontend/observatory/runtime/host';
import { advanceDeliveryRate } from '../../frontend/observatory/runtime/security-delivery-rate';
import { DELIVERY_FRESHNESS_MS } from '../../frontend/observatory/runtime/security-delivery';

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const buckets = ['file-watch', 'file-handle', 'process', 'network', 'other'];
function sample(sampleMs: number, count: number, receivedAt: number, generation = ID) {
  return {
    ...emptyTelemetry(),
    ready: true,
    stale: false,
    statsAt: receivedAt,
    stats: {
      ipc: {
        securityEvents: {
          sampleGeneration: generation,
          sampleMonotonicMs: sampleMs,
          sensors: Object.fromEntries(
            buckets.map((key) => [key, { accepted: count, delivered: 0, buffered: 0, lost: 0 }]),
          ),
          pendingLoss: 0,
          unknownLoss: false,
          markerDurable: true,
          replayPending: false,
          spill: { records: 0, bytes: 0, blocked: false },
        },
      },
    },
  };
}

describe('security audit-lane admission rates', () => {
  it('requires two samples and calculates each bucket only over their monotonic interval', () => {
    const first = advanceDeliveryRate(null, sample(1000, 5, 10_000), 10_000);
    expect(first?.rates).toBeNull();
    const second = sample(3000, 7, 12_000);
    second.stats.ipc.securityEvents.sensors.network.accepted = 9;
    const result = advanceDeliveryRate(first, second, 12_000);
    expect(result?.intervalMs).toBe(2000);
    expect(result?.rates).toEqual({
      'file-watch': 1,
      'file-handle': 1,
      process: 1,
      network: 2,
      other: 1,
    });
  });
  it('does not extend receipt freshness for a duplicate or invent a rate from one sample', () => {
    const first = advanceDeliveryRate(null, sample(1000, 5, 10_000), 10_000);
    const duplicate = advanceDeliveryRate(first, sample(1000, 5, 20_000), 20_000);
    expect(duplicate).toEqual(first);
    expect(duplicate?.rates).toBeNull();
    const expired = advanceDeliveryRate(duplicate, sample(1000, 5, 100_000), 100_000);
    expect(expired?.rates).toBeNull();
  });
  it('expires a previously computed rate despite repeated cached receipts', () => {
    const first = advanceDeliveryRate(null, sample(1000, 5, 10_000), 10_000);
    const second = advanceDeliveryRate(first, sample(3000, 7, 12_000), 12_000);
    expect(second?.rates?.network).toBe(1);
    const repeated = advanceDeliveryRate(second, sample(3000, 7, 50_000), 50_000);
    expect(repeated?.rates?.network).toBe(1);
    const expired = advanceDeliveryRate(repeated, sample(3000, 7, 102_000), 102_000);
    expect(expired?.rates).toBeNull();
  });
  it('represents a zero difference only for a valid observed interval', () => {
    const first = advanceDeliveryRate(null, sample(1000, 5, 10_000), 10_000);
    const second = advanceDeliveryRate(first, sample(3000, 5, 12_000), 12_000);
    expect(second?.rates?.network).toBe(0);
    const stale = sample(4000, 5, 13_000);
    stale.stale = true;
    expect(advanceDeliveryRate(second, stale, 13_000)).toBeNull();
    expect(advanceDeliveryRate(null, sample(5000, 5, 14_000), 14_000)?.rates).toBeNull();
  });
  it.each(['stale', 'missing', 'invalid-id', 'invalid-clock', 'changed-same-time'])(
    'invalidates on %s',
    (kind) => {
      const first = advanceDeliveryRate(null, sample(1000, 5, 10_000), 10_000);
      const next = sample(1000, 5, 11_000);
      if (kind === 'stale') next.stale = true;
      if (kind === 'missing') next.stats.ipc.securityEvents.sampleGeneration = '';
      if (kind === 'invalid-id') next.stats.ipc.securityEvents.sampleGeneration = 'not-a-uuid';
      if (kind === 'invalid-clock') next.stats.ipc.securityEvents.sampleMonotonicMs = NaN;
      if (kind === 'changed-same-time') next.stats.ipc.securityEvents.sensors.other.accepted++;
      expect(advanceDeliveryRate(first, next, 11_000)).toBeNull();
    },
  );
  it.each([
    'new-generation',
    'clock-regression',
    'counter-regression',
    'long-gap',
    'receipt-regression',
  ])('starts a new baseline without a rate on %s', (kind) => {
    const first = advanceDeliveryRate(null, sample(1000, 5, 10_000), 10_000);
    const next = sample(2000, 6, 11_000);
    if (kind === 'new-generation') next.stats.ipc.securityEvents.sampleGeneration = OTHER_ID;
    if (kind === 'clock-regression') next.stats.ipc.securityEvents.sampleMonotonicMs = 999;
    if (kind === 'counter-regression') next.stats.ipc.securityEvents.sensors.process.accepted = 4;
    if (kind === 'long-gap')
      next.stats.ipc.securityEvents.sampleMonotonicMs += DELIVERY_FRESHNESS_MS;
    if (kind === 'receipt-regression') next.statsAt = 10_000;
    expect(advanceDeliveryRate(first, next, 11_000)?.rates).toBeNull();
  });
  it('does not accept unsafe counters or a huge unrepresentable rate', () => {
    const first = advanceDeliveryRate(null, sample(1000, 0, 10_000), 10_000);
    const next = sample(1001, 0, 11_000);
    next.stats.ipc.securityEvents.sensors.network.accepted = Number.MAX_SAFE_INTEGER;
    expect(advanceDeliveryRate(first, next, 11_000)?.rates).toBeNull();
    next.stats.ipc.securityEvents.sensors.network.accepted = Number.MAX_SAFE_INTEGER + 1;
    expect(advanceDeliveryRate(first, next, 11_000)).toBeNull();
  });
});
