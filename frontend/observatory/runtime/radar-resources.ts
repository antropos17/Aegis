import { record, type Telemetry, type RecordData } from './host';
import { isScopedProcess } from './agent-scope';
import { describeProtectionObservation, type ProtectionActivity } from './protection';
import {
  describeObservation,
  canonicalObservationPath,
} from '../../../src/shared/observation-display.js';

export interface ResourceRelation {
  key: string;
  actor: string;
  instanceId: string | null;
  attribution: string;
  status: string;
  explanation: string;
  actions: string[];
  rows: RecordData[];
}
export interface RadarResource {
  key: string;
  label: string;
  address: string;
  ip: string;
  level: ProtectionActivity['level'];
  reason: string;
  sensitive: boolean;
  time: number;
  rows: RecordData[];
  relations: ResourceRelation[];
}

/** Format an observed endpoint without discarding its port or IPv6 boundary.
 * @param row Connection metadata @returns Address @since 0.14.1
 */
export function networkAddress(row: RecordData): string {
  const host = String(row.domain || '').trim() || String(row.remoteIp || '').trim();
  const port = typeof row.remotePort === 'number' && row.remotePort > 0 ? row.remotePort : null;
  return host ? `${host.includes(':') ? `[${host}]` : host}${port ? `:${port}` : ''}` : '';
}

/** Group all resources independently of radar pagination; retain every process lifetime and attribution boundary.
 * @param state Recorded population and activity @param layer Resource kind @returns Unique resources @since 0.14.1
 */
export function radarResources(state: Telemetry, layer: string): RadarResource[] {
  const network = layer === 'network';
  const grouped = new Map<string, RadarResource>();
  const priority = { review: 0, unverified: 1, observed: 2 };
  const identities = new Map<string, Telemetry['agents']>();
  for (const agent of state.agents) {
    if (agent.instanceId)
      identities.set(agent.instanceId, [...(identities.get(agent.instanceId) ?? []), agent]);
  }
  for (const entry of network ? state.network : state.events) {
    const row = entry as unknown as RecordData;
    const exact = typeof row.instanceId === 'string' ? (identities.get(row.instanceId) ?? []) : [];
    const info = describeObservation(
      row,
      exact.length === 1 ? (exact as unknown as RecordData[]) : [],
    );
    const facts = describeProtectionObservation(row, network);
    const address = network ? networkAddress(row) : String(row.file || '').trim();
    if (!address) continue;
    const ip = String(row.remoteIp || '').trim();
    const key = network
      ? JSON.stringify([
          ip.toLowerCase() || String(row.domain || '').toLowerCase(),
          row.remotePort ?? null,
        ])
      : canonicalObservationPath(address);
    const resource: RadarResource = grouped.get(key) ?? {
      key,
      label: network ? address : info.resource,
      address,
      ip,
      level: facts.level,
      reason: facts.reason,
      sensitive: row.sensitive === true,
      time: facts.time,
      rows: [],
      relations: [],
    };
    if (priority[facts.level] < priority[resource.level]) {
      resource.level = facts.level;
      resource.reason = facts.reason;
    }
    resource.sensitive ||= row.sensitive === true;
    resource.time = Math.max(resource.time, facts.time);
    resource.rows.push(row);
    const status = String(
      record(row.attribution).status ??
        (typeof row.attribution === 'string'
          ? row.attribution
          : info.actor
            ? 'recorded'
            : 'unattributed'),
    );
    const actor = status === 'unattributed' ? '' : info.actor;
    const relationKey = JSON.stringify([
      row.instanceId ?? null,
      actor,
      status,
      record(row.attribution).evidence ?? [],
    ]);
    let relation = resource.relations.find((item) => item.key === relationKey);
    if (!relation) {
      relation = {
        key: relationKey,
        actor,
        instanceId: typeof row.instanceId === 'string' ? row.instanceId : null,
        attribution: info.attribution,
        status,
        explanation: info.explanation,
        actions: [],
        rows: [],
      };
      resource.relations.push(relation);
    }
    relation.rows.push(row);
    if (!relation.actions.includes(facts.action)) relation.actions.push(facts.action);
    grouped.set(key, resource);
  }
  return [...grouped.values()].sort(
    (a, b) =>
      priority[a.level] - priority[b.level] ||
      b.time - a.time ||
      a.address.localeCompare(b.address),
  );
}

/** Resolve navigation against the current lifetime; a PID, path or product name alone is insufficient.
 * @param relation Recorded ownership @param state Current population @returns Exact current agent or null @since 0.14.1
 */
export function resourceProcess(
  relation: ResourceRelation,
  state: Telemetry,
): Telemetry['agents'][number] | null {
  if (
    !state.ready ||
    state.stale ||
    !relation.actor ||
    !relation.instanceId ||
    ['unattributed', 'ambiguous'].includes(relation.status)
  )
    return null;
  const matches = state.agents.filter((agent) => agent.instanceId === relation.instanceId);
  return matches.length === 1 && matches[0].agent === relation.actor && isScopedProcess(matches[0])
    ? matches[0]
    : null;
}
