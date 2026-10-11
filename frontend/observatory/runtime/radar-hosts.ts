import type { Telemetry } from './host';
import type { RadarGroup } from './radar';
import { isScopedProcess } from './agent-scope';

export interface RadarHostCluster {
  key: string;
  pid: number;
  label: string;
  products: string[];
}

/** Derive inert ancestry cues from exact host lifetimes in the displayed page.
 * @param state Displayed snapshot, including retained snapshots
 * @param plotted Already sliced product groups
 * @returns Cross-product observed host clusters @since 0.19.2
 */
export function radarHostClusters(state: Telemetry, plotted: RadarGroup[]): RadarHostCluster[] {
  if (!state.ready) return [];
  const clusters = new Map<string, RadarHostCluster>();
  for (const group of plotted.slice(0, 4)) {
    let candidate: RadarHostCluster | null = null;
    let valid = group.members.length > 0;
    for (const member of group.members) {
      const matches = state.agents.filter((row) => row.instanceId === member.instanceId);
      const raw = matches.length === 1 ? matches[0] : undefined;
      const host = raw?.observedHostEditor;
      if (
        !isScopedProcess(member) ||
        raw?.instanceIdSource !== 'os' ||
        member.instanceId?.startsWith('demo:') ||
        raw?.discoveryObservation?.stale ||
        raw?.pid !== member.pid ||
        raw?.agent !== group.key ||
        state.agents.filter((row) => row.pid === member.pid).length !== 1 ||
        !host ||
        host.source !== 'fresh-process-table' ||
        !Number.isSafeInteger(host.pid) ||
        host.pid <= 0 ||
        !Number.isFinite(host.startTime) ||
        host.startTime <= 0 ||
        !['sequence', 'createTime100ns', 'linuxStartTicks'].includes(
          host.generationWitnessSource,
        ) ||
        typeof host.generationWitness !== 'string' ||
        !host.generationWitness.trim() ||
        typeof host.label !== 'string' ||
        !host.label.trim()
      ) {
        valid = false;
        break;
      }
      const key = JSON.stringify([
        host.source,
        host.pid,
        host.startTime,
        host.generationWitnessSource,
        host.generationWitness,
      ]);
      if (candidate && (candidate.key !== key || candidate.label !== host.label)) {
        valid = false;
        break;
      }
      candidate = { key, pid: host.pid, label: host.label, products: [] };
    }
    if (!valid || !candidate) continue;
    const existing = clusters.get(candidate.key);
    if (existing && existing.label !== candidate.label) {
      // Conflicting presentation metadata makes this lifetime ambiguous.
      existing.label = '';
    }
    const cluster = existing ?? candidate;
    cluster.products.push(group.key);
    clusters.set(candidate.key, cluster);
  }
  return [...clusters.values()].filter(
    (cluster) => cluster.label && new Set(cluster.products).size >= 2,
  );
}
