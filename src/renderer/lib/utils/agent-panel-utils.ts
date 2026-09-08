/**
 * @file agent-panel-utils.ts — Name-group → representative card rows (F-W05)
 * @module renderer/utils/agent-panel-utils
 * @description AgentPanel groups process instances by display name and shows one
 *   card per name. All per-instance metrics on the card (risk, file activity,
 *   network) come from the **highest-risk representative** only. Multi-instance
 *   presence is communicated via `_processCount` / `_instances`, not by silently
 *   summing activity onto the rep's risk.
 * @since 0.10.0
 */

/** Minimal fields required to pick a representative and retain metrics. */
export interface PanelAgentLike {
  readonly name?: string;
  readonly riskScore?: number;
  readonly fileCount?: number;
  readonly networkCount?: number;
  readonly applicationGroup?: import('../../../shared/types/process').ApplicationProcessGroup;
  readonly [key: string]: unknown;
}

/** Grouped card row: representative instance plus multi-process metadata. */
export type GroupedPanelAgent<T extends PanelAgentLike = PanelAgentLike> = T & {
  readonly _processCount: number;
  /** null when any member lacks an observed application tree. */
  readonly _applicationCount: number | null;
  readonly _instances: T[];
};

/**
 * Partition processes by backend-observed application tree. Unobserved rows stay
 * separate; a shared name, directory or PID alone never establishes a tree.
 * @param agents - Processes in one named card
 * @returns Observed application trees and separate unobserved rows
 * @since 0.15.0
 */
export function groupApplicationInstances<T extends PanelAgentLike>(
  agents: ReadonlyArray<T>,
): Array<{ id: string | null; rootPid: number | null; instances: T[] }> {
  const result: Array<{ id: string | null; rootPid: number | null; instances: T[] }> = [];
  const byId = new Map<string, (typeof result)[number]>();
  for (const agent of agents) {
    const meta = agent.applicationGroup;
    if (!meta?.id) {
      result.push({ id: null, rootPid: null, instances: [agent] });
      continue;
    }
    let group = byId.get(meta.id);
    if (!group) {
      group = { id: meta.id, rootPid: meta.rootPid, instances: [] };
      byId.set(meta.id, group);
      result.push(group);
    }
    group.instances.push(agent);
  }
  return result;
}

/**
 * Group process-instance agents by display `name`.
 *
 * Population contract (F-W05):
 * - `riskScore`, `fileCount`, `networkCount`, pid, instanceId → **representative**
 *   (max riskScore in the name group)
 * - `_processCount` / `_instances` → full group (sorted risk desc)
 *
 * Never re-sums file/network activity across instances onto the rep.
 *
 * @param agents - Enriched per-instance agent rows
 * @returns One card row per distinct non-empty name
 * @since 0.10.0
 */
export function groupAgentsForPanel<T extends PanelAgentLike>(
  agents: ReadonlyArray<T>,
): GroupedPanelAgent<T>[] {
  if (!Array.isArray(agents) || agents.length === 0) return [];

  const byName = new Map<string, T[]>();
  for (const a of agents) {
    const name = typeof a?.name === 'string' && a.name.length > 0 ? a.name : '';
    if (!name) continue;
    let arr = byName.get(name);
    if (!arr) {
      arr = [];
      byName.set(name, arr);
    }
    arr.push(a);
  }

  return [...byName.values()].map((instances) => {
    const rep = instances.reduce((best, cur) =>
      (cur.riskScore || 0) > (best.riskScore || 0) ? cur : best,
    );
    const sorted = [...instances].sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0));
    const applications = groupApplicationInstances(sorted);
    // Spread rep so fileCount/networkCount stay the representative's values.
    return {
      ...rep,
      _processCount: instances.length,
      _applicationCount: applications.every((g) => g.id !== null) ? applications.length : null,
      _instances: sorted,
    };
  });
}
