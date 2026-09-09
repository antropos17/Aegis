import type { FileEvent } from '../../../src/shared/types';

export interface ActivityBin {
  start: number;
  end: number;
  events: FileEvent[];
}
/** Bin retained observations with half-open intervals and no fabricated counts.
 * @param events Retained observations @param end End of visible period @param periodMs Period @param count Bin count
 * @returns Exact members and bounds @since 0.14.1
 */
export function activityBins(
  events: FileEvent[],
  end: number,
  periodMs: number,
  count = 24,
): ActivityBin[] {
  const start = end - periodMs;
  const step = periodMs / count;
  const bins = Array.from({ length: count }, (_, index) => ({
    start: start + index * step,
    end: start + (index + 1) * step,
    events: [] as FileEvent[],
  }));
  for (const event of events) {
    if (!Number.isFinite(event.timestamp) || event.timestamp < start || event.timestamp >= end)
      continue;
    const index = Math.min(count - 1, Math.floor((event.timestamp - start) / step));
    bins[index].events.push(event);
  }
  return bins;
}
