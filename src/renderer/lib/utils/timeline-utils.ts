/**
 * @file timeline-utils.ts
 * @description Pure constants and helper functions for the Timeline component.
 * @since v0.3.1
 */

// ═══ LAYOUT CONSTANTS ═══

export const SVG_H = 80;
export const LANE_CRIT = 12;
export const LANE_HIGH = 26;
export const LANE_MED = 40;
export const LANE_LOW = 54;
export const TICK_TOP = 60;
export const TICK_H = 6;
export const PX_PER_UNIT = 120;
export const PAD = 20;
export const MIN_TICK_PX = 64;
const CLUSTER_PX = 12;

export const ZOOM_LEVELS: { ms: number }[] = [
  { ms: 3600000 },
  { ms: 1800000 },
  { ms: 600000 },
  { ms: 300000 },
  { ms: 60000 },
  { ms: 30000 },
  { ms: 10000 },
];

const NICE_INTERVALS: number[] = [
  5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 900000, 1800000, 3600000, 7200000,
];

export const HISTORY_BATCH = 25;

// ═══ SEVERITY HELPERS ═══

interface TimelineEvent {
  _type?: string;
  _denied?: boolean;
  sensitive?: boolean;
  action?: string;
  flagged?: boolean;
  agent?: string;
  timestamp?: number;
  file?: string;
  _historical?: boolean;
}

/** Map an event to its severity level. */
export function getSeverity(ev: TimelineEvent): string {
  if (ev._type === 'network') return ev.flagged ? 'high' : 'low';
  if (ev._denied) return 'critical';
  if (ev.sensitive) return 'high';
  if (ev.action === 'deleted') return 'medium';
  return 'low';
}

/** Severity → CSS custom property color. */
export function sevColor(sev: string): string {
  if (sev === 'critical') return 'var(--md-sys-color-error)';
  if (sev === 'high') return 'var(--md-sys-color-secondary)';
  if (sev === 'medium') return 'var(--md-sys-color-primary)';
  return 'var(--md-sys-color-on-surface-variant)';
}

/** Severity → Y-lane position. */
function sevLane(sev: string): number {
  if (sev === 'critical') return LANE_CRIT;
  if (sev === 'high') return LANE_HIGH;
  if (sev === 'medium') return LANE_MED;
  return LANE_LOW;
}

// ═══ TIME FORMATTING ═══

/** Format timestamp as HH:MM:SS. */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** Format timestamp for tick labels. Sub-minute includes seconds. */
export function formatTick(ts: number, subMinute: boolean): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (!subMinute) return `${hh}:${mm}`;
  return `${hh}:${mm}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** Event types eligible for timeline display from audit log. */
export const AUDIT_EVENT_TYPES = [
  'file-access',
  'config-access',
  'network-connection',
  'permission-deny',
];

/** Pick the best tick interval for the current zoom/width. */
export function pickTickInterval(totalWidth: number, displayRange: number): number {
  const pxPerMs = (totalWidth - PAD * 2) / displayRange;
  for (const interval of NICE_INTERVALS) {
    if (interval * pxPerMs >= MIN_TICK_PX) return interval;
  }
  return NICE_INTERVALS[NICE_INTERVALS.length - 1];
}

// ═══ AUDIT ENTRY CONVERSION ═══

interface AuditEntry {
  timestamp: string;
  type: string;
  agent?: string;
  severity?: string;
  action?: string;
  path?: string;
}

/** Convert an audit log entry to a timeline event object. */
export function auditToTimelineEvent(entry: AuditEntry): TimelineEvent {
  const ts = new Date(entry.timestamp).getTime();
  if (entry.type === 'network-connection') {
    return {
      agent: entry.agent,
      timestamp: ts,
      _type: 'network' as const,
      flagged: entry.severity === 'high',
      _historical: true,
    };
  }
  return {
    agent: entry.agent,
    timestamp: ts,
    action: entry.action,
    file: entry.path,
    sensitive: entry.severity === 'sensitive',
    _denied: entry.type === 'permission-deny',
    _type: 'file' as const,
    _historical: true,
  };
}

/** Compute summary counters from events. */
export function buildSummary(events: TimelineEvent[]): {
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
} {
  let critical = 0;
  let high = 0;
  let medium = 0;
  let low = 0;
  for (const ev of events) {
    const sev = getSeverity(ev);
    if (sev === 'critical') critical++;
    else if (sev === 'high') high++;
    else if (sev === 'medium') medium++;
    else low++;
  }
  return { critical, high, medium, low, total: events.length };
}

// ═══ DATA TRANSFORMS ═══

export interface RawDot {
  x: number;
  y: number;
  sev: string;
  color: string;
  agent: string;
  pid: string | null;
  time: string;
  idx: number;
}

export interface ClusterDot {
  x: number;
  y: number;
  color: string;
  count: number;
  agent: string;
  agentKey: string | null;
  pid: string | null;
  time: string;
  idx: number;
  sev: string;
}

export interface Link {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}

export interface Tick {
  x: number;
  label: string;
}

/** Cluster nearby dots on the same lane. */
export function buildClusters(
  events: (TimelineEvent & { timestamp?: number; agent?: string; pid?: string })[],
  tsToX: (ts: number) => number,
): ClusterDot[] {
  if (events.length === 0) return [];
  const raw: RawDot[] = events.map((ev, idx) => {
    const sev = getSeverity(ev);
    return {
      x: tsToX(ev.timestamp || 0),
      y: sevLane(sev),
      sev,
      color: sevColor(sev),
      agent: ev.agent || 'Unknown',
      pid: ev.pid || null,
      time: formatTime(ev.timestamp || 0),
      idx,
    };
  });

  const result: ClusterDot[] = [];
  let i = 0;
  while (i < raw.length) {
    const base = raw[i];
    const group = [base];
    let j = i + 1;
    while (j < raw.length && raw[j].y === base.y && Math.abs(raw[j].x - base.x) < CLUSTER_PX) {
      group.push(raw[j]);
      j++;
    }
    const avgX = group.reduce((s, d) => s + d.x, 0) / group.length;
    const best = group.reduce((a, b) => {
      const ord: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };
      return (ord[b.sev] || 0) > (ord[a.sev] || 0) ? b : a;
    }, group[0]);
    const agents = [...new Set(group.map((d) => d.agent))];
    result.push({
      x: avgX,
      y: base.y,
      color: best.color,
      count: group.length,
      agent: group.length === 1 ? base.agent : `${group.length} events`,
      agentKey: agents.length === 1 ? agents[0] : null,
      pid: group.length === 1 ? base.pid : null,
      time: group.length === 1 ? base.time : `${group[0].time} — ${group[group.length - 1].time}`,
      idx: base.idx,
      sev: best.sev,
    });
    i = j;
  }
  return result;
}

/** Connection lines between sequential dots of the same agent. */
export function buildLinks(clusters: ClusterDot[]): Link[] {
  const result: Link[] = [];
  const lastByAgent: Record<string, { x: number; y: number; color: string }> = {};
  for (const dot of clusters) {
    if (!dot.agentKey) continue;
    const prev = lastByAgent[dot.agentKey];
    if (prev && Math.abs(dot.x - prev.x) > 3) {
      result.push({ x1: prev.x, y1: prev.y, x2: dot.x, y2: dot.y, color: dot.color });
    }
    lastByAgent[dot.agentKey] = { x: dot.x, y: dot.y, color: dot.color };
  }
  return result;
}

/** Compute tick positions and labels for the timeline axis. */
export function buildTicks(
  displayMinT: number,
  displayRange: number,
  tickInterval: number,
  tsToX: (ts: number) => number,
): Tick[] {
  const subMinute = tickInterval < 60000;
  const result: Tick[] = [];
  const tickEnd = displayMinT + displayRange;
  const firstTick = Math.ceil(displayMinT / tickInterval) * tickInterval;
  let isFirst = true;
  for (let t = firstTick; t <= tickEnd; t += tickInterval) {
    if (isFirst) {
      isFirst = false;
      continue;
    }
    result.push({ x: tsToX(t), label: formatTick(t, subMinute) });
  }
  return result;
}
