/**
 * @file grouped-feed-utils.ts
 * @description Pure helper functions for the GroupedFeed component.
 * Re-exports shared severity helpers from timeline-utils.
 * @since v0.3.1
 */

export { getSeverity, sevColor, formatTime } from './timeline-utils';
import { getSeverity } from './timeline-utils';
import { shortenPath as _shortenPath } from './path-utils';

// ═══ TYPES ═══

export interface FeedEvent {
  agent: string;
  timestamp: number;
  file: string;
  action?: string;
  sensitive?: boolean;
  reason?: string;
  flagged?: boolean;
  repeatCount?: number;
  _type: 'file' | 'network';
  _denied?: boolean;
  _domain?: string;
  _ip?: string;
}

export interface NetworkConnection {
  agent?: string;
  timestamp?: number;
  domain?: string;
  remoteIp?: string;
  remotePort?: number;
  state?: string;
  flagged?: boolean;
}

export interface EnrichedAgent {
  name: string;
  riskScore?: number;
  trustGrade?: string;
}

export interface FeedGroup {
  name: string;
  count: number;
  lastActivity: number;
  severity: string;
  riskScore: number;
  trustGrade: string;
  fileEvents: FeedEvent[];
  configEvents: FeedEvent[];
  networkEvents: FeedEvent[];
}

// ═══ DISPLAY HELPERS ═══

/** Shorten a file path to last 2 segments if over 40 chars. */
export function shortenPath(p: string | undefined): string {
  return _shortenPath(p, 40, 2);
}

/** Classify event sub-type for grouping. */
export function getSubType(ev: FeedEvent): 'network' | 'config' | 'file' {
  if (ev._type === 'network') return 'network';
  if (ev.reason?.startsWith('AI agent config')) return 'config';
  return 'file';
}

/** Find the highest severity among a list of events. */
export function maxSev(evs: FeedEvent[]): string {
  const ord: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  let best = 'low';
  for (const ev of evs) {
    const s = getSeverity(ev);
    if ((ord[s] || 0) > (ord[best] || 0)) best = s;
  }
  return best;
}

// ═══ DATA TRANSFORMS ═══

/** Merge file events and network connections into a unified sorted list. */
export function buildUnifiedEvents(
  fileEventArrays: FeedEvent[][],
  networkConnections: NetworkConnection[],
): FeedEvent[] {
  const fileEvs: FeedEvent[] = fileEventArrays
    .flat()
    .map((ev) => ({ ...ev, _type: 'file' as const }));
  const netEvs: FeedEvent[] = networkConnections.map((c) => ({
    agent: c.agent || 'Unknown',
    timestamp: c.timestamp || Date.now(),
    file: `${c.domain || c.remoteIp || '?'}:${c.remotePort || '?'}`,
    action: c.state || 'established',
    sensitive: !!c.flagged,
    reason: c.flagged ? 'Unknown domain' : '',
    flagged: !!c.flagged,
    _type: 'network' as const,
    _domain: c.domain || '',
    _ip: c.remoteIp || '',
  }));
  return [...fileEvs, ...netEvs].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

/** Filter unified events by agent, severity, and type. */
export function filterEvents(
  events: FeedEvent[],
  agentFilter: string,
  severityFilter: string,
  typeFilter: string,
  limit = 200,
): FeedEvent[] {
  let r = events;
  if (agentFilter !== 'all') r = r.filter((ev) => ev.agent === agentFilter);
  if (severityFilter !== 'all') r = r.filter((ev) => getSeverity(ev) === severityFilter);
  if (typeFilter !== 'all') r = r.filter((ev) => ev._type === typeFilter);
  return r.slice(0, limit);
}

/** Group filtered events by agent name. */
export function groupByAgent(events: FeedEvent[], agents: EnrichedAgent[]): FeedGroup[] {
  const map = new Map<string, FeedEvent[]>();
  for (const ev of events) {
    if (!map.has(ev.agent)) map.set(ev.agent, []);
    map.get(ev.agent)!.push(ev);
  }
  return [...map.entries()]
    .map(([name, evs]) => {
      const a = agents.find((x) => x.name === name);
      return {
        name,
        count: evs.length,
        lastActivity: evs[0]?.timestamp || 0,
        severity: maxSev(evs),
        riskScore: Math.round(a?.riskScore || 0),
        trustGrade: a?.trustGrade || '?',
        fileEvents: evs.filter((e) => getSubType(e) === 'file'),
        configEvents: evs.filter((e) => getSubType(e) === 'config'),
        networkEvents: evs.filter((e) => getSubType(e) === 'network'),
      };
    })
    .sort((a, b) => b.lastActivity - a.lastActivity);
}
