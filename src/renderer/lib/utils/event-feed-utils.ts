/**
 * @file event-feed-utils.ts — Filtering and formatting for EventFeed
 * @module renderer/utils/event-feed-utils
 */

/** Event type categories for feed display */
export type EventType = 'FILE' | 'NET' | 'PROC' | 'ANOMALY';

/** Single feed entry for display */
export interface FeedEntry {
  readonly id: string;
  readonly time: string;
  readonly type: EventType;
  readonly agent: string;
  readonly detail: string;
  readonly timestamp: number;
}

/** Active filter state */
export interface FeedFilters {
  readonly file: boolean;
  readonly net: boolean;
  readonly proc: boolean;
  readonly anomaly: boolean;
  readonly agent: string;
}

/**
 * Format timestamp to HH:MM:SS.
 * @param ts - Unix timestamp in ms
 * @returns Formatted time string
 */
export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/**
 * Shorten a file path for compact display.
 * @param path - Full file path
 * @returns Shortened path
 */
function shortenPath(path: string): string {
  if (path.length <= 50) return path;
  const parts = path.split('/');
  if (parts.length <= 3) return path;
  return `${parts[0]}/.../` + parts.slice(-2).join('/');
}

/**
 * Convert raw file events to feed entries.
 * @param events - Flat array of file events
 * @returns Feed entries array
 */
export function fileEventsToFeed(events: readonly Record<string, unknown>[]): FeedEntry[] {
  return events.map((ev, i) => ({
    id: `file-${ev.timestamp}-${i}`,
    time: formatTimestamp(ev.timestamp as number),
    type: 'FILE' as const,
    agent: (ev.agent as string) || 'Unknown',
    detail: `${ev.action || 'accessed'} ${shortenPath((ev.file as string) || '')}`,
    timestamp: (ev.timestamp as number) || 0,
  }));
}

/**
 * Convert raw network connections to feed entries.
 * @param connections - Network connection array
 * @returns Feed entries array
 */
export function networkToFeed(connections: readonly Record<string, unknown>[]): FeedEntry[] {
  return connections.map((conn, i) => ({
    id: `net-${conn.timestamp || Date.now()}-${i}`,
    time: formatTimestamp((conn.timestamp as number) || Date.now()),
    type: 'NET' as const,
    agent: (conn.agent as string) || 'Unknown',
    detail: `\u2192 ${conn.domain || conn.remoteIp}:${conn.remotePort}`,
    timestamp: (conn.timestamp as number) || Date.now(),
  }));
}

/**
 * Filter feed entries by type and agent.
 * @param entries - All feed entries
 * @param filters - Active filter state
 * @returns Filtered entries
 */
export function filterFeed(entries: readonly FeedEntry[], filters: FeedFilters): FeedEntry[] {
  return entries.filter((e) => {
    if (e.type === 'FILE' && !filters.file) return false;
    if (e.type === 'NET' && !filters.net) return false;
    if (e.type === 'PROC' && !filters.proc) return false;
    if (e.type === 'ANOMALY' && !filters.anomaly) return false;
    if (filters.agent !== 'all' && e.agent !== filters.agent) return false;
    return true;
  });
}

/**
 * Get CSS class for event type (color coding).
 * @param type - Event type
 * @returns CSS class name
 */
export function typeClass(type: EventType): string {
  switch (type) {
    case 'FILE':
      return 'type-file';
    case 'NET':
      return 'type-net';
    case 'PROC':
      return 'type-proc';
    case 'ANOMALY':
      return 'type-anomaly';
    default:
      return '';
  }
}
