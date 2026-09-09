import { measured, type RecordData, type Telemetry } from './host';
import type { RadarGroup } from './radar';
import { measuredStatisticsTotal, type StatisticsMeasurement } from './statistics-metrics';

/** Convert two cumulative microsecond samples to a CPU percentage.
 * @param previous Previous sample @param next Latest sample @param elapsedMs Elapsed wall time
 * @returns CPU percentage or unavailable @since 0.14.1
 */
export function cpuPercent(
  previous: RecordData,
  next: RecordData,
  elapsedMs: number,
): number | null {
  const counters = [previous.cpuUser, previous.cpuSystem, next.cpuUser, next.cpuSystem].map(
    measured,
  );
  if (elapsedMs <= 0 || !Number.isFinite(elapsedMs) || counters.some((n) => n === null))
    return null;
  const [u0, s0, u1, s1] = counters as number[];
  if (u1 < u0 || s1 < s0) return null;
  return ((u1 - u0 + s1 - s0) / (elapsedMs * 1000)) * 100;
}

/** Sum measured group members with explicit coverage and current stamped identities.
 * @param group Product group @param state Current telemetry @param key Resource field
 * @returns Measured subtotal and coverage; missing members never imply zero @since 0.14.1
 */
export function measuredGroupResource(
  group: RadarGroup,
  state: Telemetry,
  key: 'cpu' | 'memMb',
): StatisticsMeasurement {
  const currentIds = new Set(state.agents.map((agent) => agent.instanceId).filter(Boolean));
  return measuredStatisticsTotal(
    {
      ...state,
      agents: group.members.map((member) => ({
        ...member,
        instanceId: member.instanceId ?? undefined,
      })),
    },
    state.resources.filter((row) => !!row.instanceId && currentIds.has(String(row.instanceId))),
    key,
  );
}
