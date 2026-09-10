import type { Telemetry, RecordData } from './host';
import type { RadarGroup } from './radar';
import {
  describeObservation,
  canonicalObservationPath,
} from '../../../src/shared/observation-display.js';

export interface RadarResource {
  key: string;
  row: RecordData;
  rows: RecordData[];
  resourceKey: string;
  group: string | null;
  name: string;
  label: string;
  address: string;
  detail: string;
  count: number;
  attribution: string;
}

/** Format an observed endpoint, falling back to its IP when DNS is empty.
 * @param row Connection metadata @returns Address with an optional port @since 0.14.1
 */
export function networkAddress(row: RecordData): string {
  const host = String(row.domain || '').trim() || String(row.remoteIp || '').trim();
  const port = typeof row.remotePort === 'number' && row.remotePort > 0 ? row.remotePort : null;
  return host ? `${host.includes(':') ? `[${host}]` : host}${port ? `:${port}` : ''}` : '';
}

/** Collect unique resources, keeping exact process attribution and the newest file evidence.
 * @param state Observed telemetry @param layer Resource layer @param plotted Visible agent groups
 * @param chosen Selected group @returns Resources available on this radar page @since 0.14.1
 */
export function radarResources(
  state: Telemetry,
  layer: string,
  plotted: RadarGroup[],
  chosen?: RadarGroup,
): RadarResource[] {
  const owners = new Map(
    plotted.flatMap((g) =>
      g.members.filter((a) => a.instanceId).map((a) => [a.instanceId, g] as const),
    ),
  );
  const allIds = new Set(state.agents.map((a) => a.instanceId).filter(Boolean));
  const resources = new Map<string, RadarResource>();
  const source = layer === 'files' ? state.events : state.network;
  for (const entry of source) {
    const row = entry as unknown as RecordData;
    const info = describeObservation(row);
    const evidence = row.attribution as { status?: string } | undefined;
    if (row.selfAccess === true) continue;
    const owner = evidence?.status === 'unattributed' ? undefined : owners.get(entry.instanceId);
    if (chosen && owner?.key !== chosen.key) continue;
    // Other radar pages have their own resources. Historical/unknown owners stay unlinked.
    if (!chosen && !owner && entry.instanceId && allIds.has(entry.instanceId)) continue;
    const file = String(row.file || '').trim();
    const ip = String(row.remoteIp || '').trim();
    const domain = String(row.domain || '').trim();
    const port = typeof row.remotePort === 'number' && row.remotePort > 0 ? row.remotePort : null;
    const address = layer === 'files' ? file : networkAddress(row);
    if (!address) continue;
    const status = owner
      ? evidence?.status === 'inferred'
        ? 'Indirect attribution'
        : evidence?.status === 'confirmed'
          ? 'Confirmed'
          : 'Recorded owner'
      : info.context || info.skill
        ? 'Resource context · actor not recorded'
        : 'No current agent link';
    // Ports and distinct IPs remain distinct even when reverse DNS returns the same name.
    const identity =
      layer === 'files' ? canonicalObservationPath(file) : `${ip || domain}:${port ?? ''}`;
    const key = JSON.stringify([owner?.key ?? entry.instanceId ?? null, identity]);
    const existing = resources.get(key);
    if (existing) {
      existing.count++;
      existing.rows.push(row);
      if (existing.attribution !== status) existing.attribution = 'Mixed attribution';
      if (Number(row.timestamp || 0) > Number(existing.row.timestamp || 0)) existing.row = row;
      continue;
    }
    resources.set(key, {
      key,
      row,
      rows: [row],
      resourceKey: identity,
      group: owner?.key ?? null,
      name: owner?.name ?? info.label,
      label:
        layer === 'files' ? (info.skill ? 'Skill · ' + info.skill.name : info.resource) : address,
      address,
      detail:
        layer === 'files'
          ? file
          : [domain && ip !== domain ? ip : '', row.state].filter(Boolean).join(' · '),
      count: 1,
      attribution: status,
    });
  }
  return [...resources.values()].sort((a, b) =>
    layer === 'files'
      ? Number(b.row.timestamp || 0) - Number(a.row.timestamp || 0) || a.key.localeCompare(b.key)
      : a.name.localeCompare(b.name) ||
        a.address.localeCompare(b.address) ||
        a.key.localeCompare(b.key),
  );
}
