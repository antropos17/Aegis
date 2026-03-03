/**
 * @file vis-timeline-utils.ts
 * @description Data transformation helpers: AEGIS events → vis-timeline items/groups.
 * @since v0.4.0
 */

import type {
  FileEvent,
  NetworkConnection,
  DeviationWarning,
  DetectedAgent,
} from '../../../shared/types';

/** vis-timeline group for a single agent row */
export interface VisGroup {
  readonly id: string;
  readonly content: string;
  readonly className: string;
}

/** vis-timeline item (event on the timeline) */
export interface VisItem {
  readonly id: string;
  readonly group: string;
  readonly start: Date;
  readonly content: string;
  readonly className: string;
  readonly title: string;
  readonly type: 'box' | 'point';
  readonly _eventType: 'file' | 'network' | 'anomaly' | 'process';
}

/** Unified event shape for timeline processing */
export interface TimelineEvent {
  readonly agent: string;
  readonly timestamp: number;
  readonly eventType: 'file' | 'network' | 'anomaly' | 'process';
  readonly label: string;
  readonly detail: string;
  readonly flagged: boolean;
}

/** CSS class names for event type coloring */
const EVENT_CLASS: Record<string, string> = {
  file: 'vis-item-file',
  network: 'vis-item-network',
  process: 'vis-item-process',
  anomaly: 'vis-item-anomaly',
};

/**
 * Convert FileEvent[] to unified TimelineEvent[]
 * @param events - Raw file events from IPC store
 */
export function fileEventsToTimeline(events: FileEvent[]): TimelineEvent[] {
  return events.map((ev) => ({
    agent: ev.agent,
    timestamp: ev.timestamp,
    eventType: 'file' as const,
    label: ev.action,
    detail: `${ev.action}: ${ev.file}${ev.sensitive ? ' (sensitive)' : ''}`,
    flagged: ev.sensitive,
  }));
}

/**
 * Convert NetworkConnection[] to unified TimelineEvent[]
 * @param conns - Raw network connections from IPC store
 */
export function networkEventsToTimeline(conns: NetworkConnection[]): TimelineEvent[] {
  return conns
    .filter((c) => c.agent)
    .map((c, i) => ({
      agent: c.agent,
      timestamp: Date.now() - i * 1000,
      eventType: 'network' as const,
      label: c.domain || c.remoteIp,
      detail: `${c.domain || c.remoteIp}:${c.remotePort} (${c.state})`,
      flagged: c.flagged,
    }));
}

/**
 * Convert DeviationWarning[] to unified TimelineEvent[]
 * @param warnings - Anomaly warnings from anomaly detector
 */
export function anomalyEventsToTimeline(warnings: DeviationWarning[]): TimelineEvent[] {
  return warnings.map((w) => ({
    agent: w.agent,
    timestamp: Date.now(),
    eventType: 'anomaly' as const,
    label: w.type,
    detail: w.message,
    flagged: true,
  }));
}

/**
 * Build vis-timeline groups from detected agents
 * @param agents - Currently detected agents
 */
export function buildVisGroups(agents: DetectedAgent[]): VisGroup[] {
  const seen = new Set<string>();
  const groups: VisGroup[] = [];
  for (const a of agents) {
    if (seen.has(a.agent)) continue;
    seen.add(a.agent);
    groups.push({
      id: a.agent,
      content: a.agent,
      className: `vis-group-${a.category || 'unknown'}`,
    });
  }
  return groups;
}

/**
 * Build vis-timeline items from unified events
 * @param events - Merged timeline events
 */
export function buildVisItems(events: TimelineEvent[]): VisItem[] {
  return events.map((ev, i) => ({
    id: `${ev.eventType}-${ev.timestamp}-${i}`,
    group: ev.agent,
    start: new Date(ev.timestamp),
    content: ev.label,
    className: `${EVENT_CLASS[ev.eventType]}${ev.flagged ? ' vis-item-flagged' : ''}`,
    title: ev.detail,
    type: 'point' as const,
    _eventType: ev.eventType,
  }));
}

/** Dark theme options for vis-timeline */
export const VIS_TIMELINE_OPTIONS = {
  height: '280px',
  stack: true,
  showCurrentTime: true,
  zoomMin: 1000,
  zoomMax: 1000 * 60 * 60 * 24,
  orientation: { axis: 'bottom' },
  margin: { item: 4 },
  selectable: true,
  multiselect: false,
} as const;
