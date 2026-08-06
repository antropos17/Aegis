/**
 * @file timeline-utils.ts
 * @description Pure constants and helper functions for the Timeline component.
 * @since v0.3.1
 */

import type { NormalizedAttribution } from '../../../shared/types/events';

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
  /**
   * Event Schema v1 fields, carried through untouched. Absent on a pre-v1 record, and
   * absence is meaningful: it is what marks the record as v0, so it is never defaulted.
   * @since v0.12.0
   */
  schemaVersion?: number;
  instanceId?: string | null;
  /**
   * `null` means the ownership question does not APPLY to this event — categorically
   * different from `{status: 'unattributed'}`, which means it applies and the owner is
   * unknown. Typed as {@link NormalizedAttribution} because the read path mixes real v1
   * attributions with normalized v0 ones whose `evidence` was never recorded.
   */
  attribution?: NormalizedAttribution | null;
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

/**
 * One record as it arrives from `get-audit-entries-before`.
 *
 * The v1 fields below are optional on purpose: `audit-logger.getEntriesBefore()` runs every
 * line through `normalizeAuditEntry`, but a pre-v1 record comes back WITHOUT
 * `schemaVersion` — that absence is how a v0 record is identified, so it must never be
 * defaulted to a number here. Names mirror `AuditRecordV1` in src/shared/types/events.ts.
 */
interface AuditEntry {
  timestamp: string;
  type: string;
  agent?: string;
  severity?: string;
  action?: string;
  path?: string;
  /** @since v0.12.0 */
  schemaVersion?: number;
  /** @since v0.12.0 */
  instanceId?: string | null;
  /** @since v0.12.0 */
  attribution?: NormalizedAttribution | null;
}

/**
 * Convert an audit log entry to a timeline event object.
 *
 * The three Event Schema v1 fields ride through unchanged — no default, no back-fill. A
 * pre-v1 entry therefore produces exactly the object it produced before v1 existed, with
 * all three keys `undefined`, and every downstream reader treats that as "nothing to show".
 */
export function auditToTimelineEvent(entry: AuditEntry): TimelineEvent {
  const ts = new Date(entry.timestamp).getTime();
  if (entry.type === 'network-connection') {
    return {
      agent: entry.agent,
      timestamp: ts,
      _type: 'network' as const,
      flagged: entry.severity === 'high',
      _historical: true,
      schemaVersion: entry.schemaVersion,
      instanceId: entry.instanceId,
      attribution: entry.attribution,
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
    schemaVersion: entry.schemaVersion,
    instanceId: entry.instanceId,
    attribution: entry.attribution,
  };
}

/**
 * Display text for an event whose owner could not be resolved. Mirrors
 * `UNKNOWN_SOURCE_LABEL` in src/main/attribution.js — the main process keeps the honest
 * blank in machine output and leaves the substitution to display surfaces like this one.
 * @since v0.12.0
 */
export const UNKNOWN_SOURCE_LABEL = 'Unknown source';

/**
 * Render an attribution for the tooltip.
 *
 * Deliberately carries NO number: the status is a hard three-way distinction, not a score,
 * and putting a count of evidence codes next to it would invite reading it as confidence.
 *
 * - no attribution (pre-v1, or an event the ownership question does not apply to) → `''`,
 *   which the caller drops entirely rather than rendering an empty row.
 * - `unattributed` → the literal {@link UNKNOWN_SOURCE_LABEL}. The owner is unknown, so no
 *   name is shown in its place (C-01).
 * - `confirmed` / `inferred` → the status plus the evidence codes that produced it.
 * - evidence `null` — a normalized v0 record, where the codes were never written down —
 *   yields the bare status. Not `[]`: it is not a claim that no evidence existed.
 * @since v0.12.0
 */
export function formatAttribution(attribution?: NormalizedAttribution | null): string {
  if (!attribution) return '';
  const status = attribution.status;
  if (status === 'unattributed') return UNKNOWN_SOURCE_LABEL;
  // The union is closed and the write path enforces it (`deriveStatus` throws on an unknown
  // code), so anything else came off disk malformed. Show nothing rather than putting a
  // string of unknown provenance in front of the user.
  if (status !== 'confirmed' && status !== 'inferred') return '';
  const evidence = attribution.evidence;
  if (!Array.isArray(evidence)) return status;
  const codes = evidence.filter((code) => typeof code === 'string');
  if (codes.length === 0) return status;
  return `${status} via ${codes.join(', ')}`;
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
  /** @since v0.12.0 */
  schemaVersion?: number;
  /** @since v0.12.0 */
  instanceId?: string | null;
  /** @since v0.12.0 */
  attribution?: NormalizedAttribution | null;
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
  /**
   * Identity of the single event behind this dot. A dot that clusters more than one event
   * carries `undefined`, exactly as `pid` already does — identity is per-event and picking
   * one would present one event's process as the group's.
   * @since v0.12.0
   */
  schemaVersion?: number;
  /** @since v0.12.0 */
  instanceId?: string | null;
  /**
   * Attribution for this dot. Unlike identity, this survives clustering when every event
   * in the group agrees: see {@link clusterAttribution}.
   * @since v0.12.0
   */
  attribution?: NormalizedAttribution | null;
}

/**
 * Attribution for a clustered dot.
 *
 * A single event keeps its own attribution whole. For a group, the status survives only if
 * every member agrees — then it is a fact about all of them, not one member's status shown
 * as the group's. The evidence does NOT survive: the codes are per-event and differ even
 * between two events with the same status, so the result carries `evidence: null`, which
 * {@link formatAttribution} renders as the bare status.
 *
 * This matters most for `unattributed`. Dropping it on clustering would let an unresolved
 * owner disappear behind an "N events" label the moment another event landed nearby — the
 * exact silence C-01 exists to prevent.
 * @since v0.12.0
 */
export function clusterAttribution(group: RawDot[]): NormalizedAttribution | null | undefined {
  const first = group[0]?.attribution;
  if (group.length === 1) return first;
  if (!first) return undefined;
  for (const dot of group) {
    if (!dot.attribution || dot.attribution.status !== first.status) return undefined;
  }
  return { status: first.status, evidence: null };
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
      schemaVersion: ev.schemaVersion,
      instanceId: ev.instanceId,
      attribution: ev.attribution,
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
      schemaVersion: group.length === 1 ? base.schemaVersion : undefined,
      instanceId: group.length === 1 ? base.instanceId : undefined,
      attribution: clusterAttribution(group),
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
