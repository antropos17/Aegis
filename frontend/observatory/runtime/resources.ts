import { measured, type RecordData } from './host';

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
