import { record, type Telemetry } from './host';
import { DELIVERY_FRESHNESS_MS, securityDelivery } from './security-delivery';

export const RATE_BUCKETS = ['file-watch', 'file-handle', 'process', 'network', 'other'] as const;
type Bucket = (typeof RATE_BUCKETS)[number];
type Values = Record<Bucket, number>;
const MAX_RETIRED_GENERATIONS = 32;
export type DeliveryRateState = {
  generation: string;
  sampleMs: number;
  receivedAt: number;
  accepted: Values;
  rates: Values | null;
  intervalMs: number | null;
  invalidated: boolean;
  retiredGenerations: string[];
  exhausted: boolean;
};

function invalidate(previous: DeliveryRateState | null): DeliveryRateState | null {
  return previous ? { ...previous, rates: null, intervalMs: null, invalidated: true } : null;
}

function validCount(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0)
  );
}

/** Advance only across two valid, bounded, same-generation producer samples.
 * @param previous Previously accepted sample and result
 * @param telemetry Current renderer receipt
 * @param now Current wall-clock time, used only to expire the receipt
 * @returns New state or null when the receipt cannot be used
 * @since 0.21.0-beta
 */
export function advanceDeliveryRate(
  previous: DeliveryRateState | null,
  telemetry: Telemetry,
  now: number,
): DeliveryRateState | null {
  if (previous?.exhausted) return invalidate(previous);
  if (!securityDelivery(telemetry, now).available || telemetry.statsAt === null)
    return invalidate(previous);
  const delivery = record(record(telemetry.stats.ipc).securityEvents);
  const generation = delivery.sampleGeneration;
  const sampleMs = delivery.sampleMonotonicMs;
  if (
    typeof generation !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(generation) ||
    !validCount(sampleMs)
  )
    return invalidate(previous);
  const sensors = record(delivery.sensors);
  const accepted = {} as Values;
  for (const bucket of RATE_BUCKETS) {
    const value = record(sensors[bucket]).accepted;
    if (!validCount(value)) return invalidate(previous);
    accepted[bucket] = value;
  }
  const sample = {
    generation,
    sampleMs,
    receivedAt: telemetry.statsAt,
    accepted,
    rates: null,
    intervalMs: null,
    invalidated: false,
    retiredGenerations: previous?.retiredGenerations ?? [],
    exhausted: false,
  };
  if (!previous) return sample;
  if (previous.generation !== generation) {
    if (previous.retiredGenerations.includes(generation)) return invalidate(previous);
    if (previous.retiredGenerations.length >= MAX_RETIRED_GENERATIONS)
      return invalidate({ ...previous, exhausted: true });
    return { ...sample, retiredGenerations: [...previous.retiredGenerations, previous.generation] };
  }
  if (sampleMs < previous.sampleMs || telemetry.statsAt < previous.receivedAt)
    return invalidate(previous);
  if (sampleMs === previous.sampleMs) {
    if (RATE_BUCKETS.some((bucket) => accepted[bucket] !== previous.accepted[bucket])) {
      const highWater = { ...previous.accepted };
      for (const bucket of RATE_BUCKETS)
        highWater[bucket] = Math.max(highWater[bucket], accepted[bucket]);
      return invalidate({ ...previous, accepted: highWater });
    }
    if (now < previous.receivedAt || now - previous.receivedAt >= DELIVERY_FRESHNESS_MS)
      return invalidate(previous);
    return previous;
  }
  const elapsed = sampleMs - previous.sampleMs;
  if (RATE_BUCKETS.some((bucket) => accepted[bucket] < previous.accepted[bucket])) {
    const highWater = { ...previous.accepted };
    for (const bucket of RATE_BUCKETS)
      highWater[bucket] = Math.max(highWater[bucket], accepted[bucket]);
    return invalidate({ ...previous, sampleMs, accepted: highWater });
  }
  if (telemetry.statsAt === previous.receivedAt)
    return invalidate({ ...previous, sampleMs, accepted });
  if (
    previous.invalidated ||
    now < previous.receivedAt ||
    now - previous.receivedAt >= DELIVERY_FRESHNESS_MS ||
    elapsed > DELIVERY_FRESHNESS_MS
  )
    return sample;
  const rates = {} as Values;
  for (const bucket of RATE_BUCKETS) {
    const rate = (accepted[bucket] - previous.accepted[bucket]) / (elapsed / 1000);
    if (!Number.isFinite(rate) || rate > Number.MAX_SAFE_INTEGER) return sample;
    rates[bucket] = rate;
  }
  return { ...sample, rates, intervalMs: elapsed };
}
