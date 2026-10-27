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
    expect(advanceDeliveryRate(second, stale, 13_000)?.rates).toBeNull();
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
      expect(advanceDeliveryRate(first, next, 11_000)?.rates).toBeNull();
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
    expect(advanceDeliveryRate(first, next, 11_000)?.rates).toBeNull();
  });
  it('does not reconstruct an old rate from alternating replayed samples after expiry or outage', () => {
    const s1 = advanceDeliveryRate(null, sample(1000, 5, 10_000), 10_000);
    const s2 = advanceDeliveryRate(s1, sample(2000, 6, 11_000), 11_000);
    expect(s2?.rates?.network).toBe(1);
    let state = advanceDeliveryRate(s2, sample(1000, 5, 101_000), 101_000);
    expect(state?.rates).toBeNull();
    state = advanceDeliveryRate(state, sample(2000, 6, 102_000), 102_000);
    expect(state?.rates).toBeNull();
    state = advanceDeliveryRate(state, sample(1000, 5, 103_000), 103_000);
    expect(state?.rates).toBeNull();
    state = advanceDeliveryRate(state, sample(3000, 7, 104_000), 104_000);
    expect(state?.rates).toBeNull();
    state = advanceDeliveryRate(state, sample(4000, 8, 105_000), 105_000);
    expect(state?.rates?.network).toBe(1);
  });
  it('invalidates a computed rate when the receipt timestamp regresses, even for an identical producer sample', () => {
    const first = advanceDeliveryRate(null, sample(1000, 5, 10_000), 10_000);
    const second = advanceDeliveryRate(first, sample(2000, 6, 11_000), 11_000);
    expect(second?.rates?.network).toBe(1);
    expect(advanceDeliveryRate(second, sample(2000, 6, 10_500), 11_000)?.rates).toBeNull();
  });
  it('retains bucket high-water counts across a regression and requires a new baseline', () => {
    const first = advanceDeliveryRate(null, sample(1000, 5, 10_000), 10_000);
    const second = advanceDeliveryRate(first, sample(2000, 6, 11_000), 11_000);
    let state = advanceDeliveryRate(second, sample(3000, 3, 12_000), 12_000);
    expect(state?.rates).toBeNull();
    state = advanceDeliveryRate(state, sample(4000, 4, 13_000), 13_000);
    expect(state?.rates).toBeNull();
    state = advanceDeliveryRate(state, sample(5000, 6, 14_000), 14_000);
    expect(state?.rates).toBeNull();
    state = advanceDeliveryRate(state, sample(6000, 7, 15_000), 15_000);
    expect(state?.rates?.network).toBe(1);
  });
  it('does not revive retired generations from replayed sample pairs', () => {
    let state = advanceDeliveryRate(null, sample(1000, 5, 10_000), 10_000);
    state = advanceDeliveryRate(state, sample(2000, 6, 11_000), 11_000);
    expect(state?.rates?.network).toBe(1);
    state = advanceDeliveryRate(state, sample(1000, 1, 12_000, OTHER_ID), 12_000);
    state = advanceDeliveryRate(state, sample(2000, 2, 13_000, OTHER_ID), 13_000);
    expect(state?.rates?.network).toBe(1);
    state = advanceDeliveryRate(state, sample(1000, 5, 14_000), 14_000);
    expect(state?.rates).toBeNull();
    state = advanceDeliveryRate(state, sample(2000, 6, 15_000), 15_000);
    expect(state?.rates).toBeNull();
  });
  it('fails closed when the bounded generation history is exhausted', () => {
    let state = advanceDeliveryRate(null, sample(1, 1, 10_000), 10_000);
    for (let i = 0; i < 32; i++) {
      const id = `33333333-3333-4333-8333-${i.toString(16).padStart(12, '0')}`;
      state = advanceDeliveryRate(state, sample(1, 1, 10_001 + i, id), 10_001 + i);
    }
    expect(state?.retiredGenerations).toHaveLength(32);
    const next = sample(1, 1, 20_000, '44444444-4444-4444-8444-444444444444');
    expect(advanceDeliveryRate(state, next, 20_000)?.rates).toBeNull();
    expect(advanceDeliveryRate(state, next, 20_000)?.generation).toBe(state?.generation);
  });
});
