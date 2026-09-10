import type { FileEvent } from '../../../src/shared/types';

export interface ActivityBin {
  start: number;
  end: number;
  events: FileEvent[];
}
/** Bin retained observations with half-open intervals and no fabricated counts.
 * @param events Retained observations @param end Exclusive visible boundary @param periodMs Period @param count Bin count (1–1000)
 * @returns Exact members and bounds; empty for invalid ranges @since 0.14.1
 */
export function activityBins(
  events: FileEvent[],
  end: number,
  periodMs: number,
  count = 24,
): ActivityBin[] {
  if (
    !Number.isFinite(end) ||
    !Number.isFinite(periodMs) ||
    periodMs <= 0 ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 1000
  )
    return [];
  const start = end - periodMs;
  if (!Number.isFinite(start) || start >= end) return [];
  const step = periodMs / count;
  const bins = Array.from({ length: count }, (_, index) => ({
    start: start + index * step,
    end: index === count - 1 ? end : start + (index + 1) * step,
    events: [] as FileEvent[],
  }));
  for (const event of events) {
    const at = event.timestamp;
    if (!Number.isFinite(at) || at < start || at >= end) continue;
    // Search the actual boundaries: division may round an exact edge into the preceding bin.
    let low = 0,
      high = count;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (bins[middle].end <= at) low = middle + 1;
      else high = middle;
    }
    if (low < count && at >= bins[low].start) bins[low].events.push(event);
  }
  return bins;
}

// Intl formatters allocate native state; reuse the two formats across chart ticks.
const clockFormats = new Map<boolean, Intl.DateTimeFormat>();
let clockFormatsAt: number | null = null;

/** Format the complete local clock without slicing locale-specific output.
 * @param at Timestamp @param seconds Include seconds for interval evidence
 * @returns Localized clock label or unavailable marker @since 0.14.1
 */
export function activityTimeLabel(at: number, seconds = false): string {
  if (!Number.isFinite(at) || !Number.isFinite(new Date(at).getTime())) return '—';
  // Periodically pick up default locale/time-zone changes, including after clock rollback.
  const now = Date.now();
  if (clockFormatsAt === null || now < clockFormatsAt || now - clockFormatsAt >= 60000) {
    clockFormats.clear();
    clockFormatsAt = now;
  }
  let formatter = clockFormats.get(seconds);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      ...(seconds ? { second: '2-digit' as const } : {}),
    });
    clockFormats.set(seconds, formatter);
  }
  return formatter.format(at);
}
