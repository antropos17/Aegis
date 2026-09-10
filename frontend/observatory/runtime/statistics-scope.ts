import type { Telemetry } from './host';

export interface StatisticsScope {
  agent: string;
  instanceId: string;
}

/** Restrict statistics to current stamped identities without reusing global counters.
 * @param state Delivered telemetry @param scope Selected agent and optional process
 * @returns Scoped observations; absent selections remain unavailable @since 0.14.1
 */
export function scopeStatistics(state: Telemetry, scope: StatisticsScope): Telemetry {
  if (!scope.agent) return state;
  const agents = state.agents.filter(
    (agent) =>
      agent.agent === scope.agent && (!scope.instanceId || agent.instanceId === scope.instanceId),
  );
  const ids = new Set(agents.map((agent) => agent.instanceId).filter(Boolean));
  const matches = (row: { instanceId?: unknown }): boolean =>
    typeof row.instanceId === 'string' && ids.has(row.instanceId);
  return {
    ...state,
    agents,
    resources: state.resources.filter(matches),
    tokens: state.tokens.filter(matches),
    events: state.events.filter(
      (event) =>
        matches(event) && !event.selfAccess && event.attribution?.status !== 'unattributed',
    ),
    network: state.network.filter(matches),
    // The bridge exposes global cumulative scan counters only. Retained rows
    // cannot substitute for counters: eviction would manufacture negative rates.
    scanCounters: { files: NaN, sensitive: NaN, evicted: NaN },
    evicted: 0,
    retainedEvicted: 0,
    stale: state.stale || !agents.length,
  };
}
