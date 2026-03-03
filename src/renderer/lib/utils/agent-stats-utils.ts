/**
 * @file agent-stats-utils.ts — Sorting and formatting for AgentStatsPanel
 * @module renderer/utils/agent-stats-utils
 */

import type { EnrichedAgent } from '../../../shared/types/risk';

/** Sortable column identifiers */
export type SortColumn = 'agent' | 'risk' | 'files' | 'network' | 'lastSeen';

/** Sort direction */
export type SortDirection = 'asc' | 'desc';

/** Agent row data for the stats table */
export interface AgentStatsRow {
  readonly name: string;
  readonly pid: number;
  readonly status: 'active' | 'idle';
  readonly riskScore: number;
  readonly fileCount: number;
  readonly networkCount: number;
  readonly lastSeen: number;
  readonly category: string;
  readonly trustGrade: string;
}

/**
 * Map enriched agents to stats rows.
 * @param agents - Enriched agent list from store
 * @param now - Current timestamp for lastSeen calculation
 * @returns Flat stats row array
 */
export function toStatsRows(agents: readonly EnrichedAgent[], now: number): AgentStatsRow[] {
  const byName = new Map<string, EnrichedAgent[]>();
  for (const a of agents) {
    const arr = byName.get(a.name) ?? [];
    arr.push(a);
    byName.set(a.name, arr);
  }

  return [...byName.values()].map((instances) => {
    const rep = instances.reduce((best, cur) =>
      (cur.riskScore || 0) > (best.riskScore || 0) ? cur : best,
    );
    return {
      name: rep.name,
      pid: rep.pid,
      status: 'active' as const,
      riskScore: Math.round(instances.reduce((s, a) => Math.max(s, a.riskScore || 0), 0)),
      fileCount: instances.reduce((s, a) => s + Math.round(a.fileCount || 0), 0),
      networkCount: instances.reduce((s, a) => s + (a.networkCount || 0), 0),
      lastSeen: now,
      category: rep.category,
      trustGrade: rep.trustGrade,
    };
  });
}

/**
 * Sort stats rows by column and direction.
 * @param rows - Agent stats rows
 * @param column - Column to sort by
 * @param direction - Sort direction
 * @returns New sorted array
 */
export function sortRows(
  rows: readonly AgentStatsRow[],
  column: SortColumn,
  direction: SortDirection,
): AgentStatsRow[] {
  const mult = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (column) {
      case 'agent':
        return mult * a.name.localeCompare(b.name);
      case 'risk':
        return mult * (a.riskScore - b.riskScore);
      case 'files':
        return mult * (a.fileCount - b.fileCount);
      case 'network':
        return mult * (a.networkCount - b.networkCount);
      case 'lastSeen':
        return mult * (a.lastSeen - b.lastSeen);
      default:
        return 0;
    }
  });
}

/**
 * Format a relative time string (e.g. "2s ago", "3m ago").
 * @param ms - Milliseconds since last seen
 * @returns Human-readable relative time
 */
export function formatRelativeTime(ms: number): string {
  if (ms < 1000) return 'now';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

/**
 * Get CSS color variable for a risk score (matches AgentCard grade colors).
 * @param score - Risk score 0-100
 * @returns CSS color string using design tokens
 */
export function riskColor(score: number): string {
  if (score <= 15) return 'var(--md-sys-color-tertiary)';
  if (score <= 35) return 'var(--md-sys-color-primary)';
  if (score <= 60) return 'var(--md-sys-color-secondary)';
  return 'var(--md-sys-color-error)';
}
