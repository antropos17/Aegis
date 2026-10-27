import { record, type Telemetry } from './host';

const BUCKETS = ['file-watch', 'file-handle', 'process', 'network', 'other'] as const;
export const DELIVERY_FRESHNESS_MS = 90_000;

type Counters = { accepted: number; delivered: number; buffered: number; lost: number };
export type SecurityDelivery =
  | { available: false }
  | ({
      available: true;
      pendingLoss: number;
      unknownLoss: boolean;
      markerDurable: boolean;
      replayPending: boolean;
      spillBlocked: boolean;
      spillRecords: number;
      spillBytes: number;
    } & Counters);

function count(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0)
  );
}

/** Read only the fixed delivery-lane counters from a current stats receipt.
 * @param telemetry Current telemetry snapshot
 * @param now Current wall-clock time
 * @returns Bounded display model or unavailable
 * @since 0.21.0-beta
 */
export function securityDelivery(telemetry: Telemetry, now: number): SecurityDelivery {
  const at = telemetry.statsAt;
  if (
    !telemetry.ready ||
    telemetry.stale ||
    telemetry.error ||
    typeof at !== 'number' ||
    !Number.isFinite(at) ||
    at <= 0 ||
    !Number.isFinite(now) ||
    now < at ||
    now - at >= DELIVERY_FRESHNESS_MS
  )
    return { available: false };

  const delivery = record(record(telemetry.stats.ipc).securityEvents);
  const sensors = record(delivery.sensors);
  const spill = record(delivery.spill);
  if (
    Object.keys(sensors).length !== BUCKETS.length ||
    BUCKETS.some((bucket) => !Object.hasOwn(sensors, bucket))
  )
    return { available: false };
  if (
    !count(delivery.pendingLoss) ||
    typeof delivery.unknownLoss !== 'boolean' ||
    typeof delivery.markerDurable !== 'boolean' ||
    typeof delivery.replayPending !== 'boolean' ||
    !count(spill.records) ||
    !count(spill.bytes) ||
    typeof spill.blocked !== 'boolean'
  )
    return { available: false };

  const totals: Counters = { accepted: 0, delivered: 0, buffered: 0, lost: 0 };
  for (const bucket of BUCKETS) {
    const source = record(sensors[bucket]);
    for (const key of ['accepted', 'delivered', 'buffered', 'lost'] as const) {
      const value = source[key];
      if (!count(value) || !Number.isSafeInteger(totals[key] + value)) return { available: false };
      totals[key] += value;
    }
  }
  return {
    available: true,
    ...totals,
    pendingLoss: delivery.pendingLoss,
    unknownLoss: delivery.unknownLoss,
    markerDurable: delivery.markerDurable,
    replayPending: delivery.replayPending,
    spillBlocked: spill.blocked,
    spillRecords: spill.records,
    spillBytes: spill.bytes,
  };
}
