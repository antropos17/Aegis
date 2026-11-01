import type { Telemetry } from './host';
import type { RadarGroup } from './radar';
import { isScopedProcess } from './agent-scope';
import { canonicalObservationPath } from '../../../src/shared/observation-display.js';
import { isObjectRead, objectReadMatchesProcess, objectResourceKey } from './object-read';

export interface RadarConnection {
  key: string;
  from: string;
  to: string;
  files: number;
}

/** Derive visible product pairs from confirmed file observations in the displayed snapshot.
 * @param state Displayed telemetry @param plotted Visible product groups @returns Shared recorded file counts @since 0.19.0
 */
export function radarConnections(state: Telemetry, plotted: RadarGroup[]): RadarConnection[] {
  if (!state.ready) return [];
  const visible = new Set(plotted.slice(0, 4).map((group) => group.key));
  const identities = new Map<string, Telemetry['agents']>();
  for (const agent of state.agents) {
    if (agent.instanceId)
      identities.set(agent.instanceId, [...(identities.get(agent.instanceId) ?? []), agent]);
  }
  const owners = new Map<string, Set<string>>();
  for (const event of state.events) {
    if (event.attribution?.status !== 'confirmed' || !event.instanceId || !event.agent) continue;
    const matches = identities.get(event.instanceId) ?? [];
    if (matches.length !== 1) continue;
    const agent = matches[0];
    if (
      !isScopedProcess(agent) ||
      !objectReadMatchesProcess(event, agent) ||
      agent.pid !== event.pid ||
      agent.agent !== event.agent ||
      !visible.has(agent.agent)
    )
      continue;
    const path = typeof event.file === 'string' ? event.file.trim() : '';
    const key = isObjectRead(event) ? objectResourceKey(event) : canonicalObservationPath(path);
    if (!key) continue;
    const products = owners.get(key) ?? new Set<string>();
    products.add(agent.agent);
    owners.set(key, products);
  }
  const pairs = new Map<string, RadarConnection>();
  for (const products of owners.values()) {
    const sorted = [...products].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const [from, to] = [sorted[i], sorted[j]];
        const key = JSON.stringify([from, to]);
        const pair = pairs.get(key) ?? { key, from, to, files: 0 };
        pair.files++;
        pairs.set(key, pair);
      }
    }
  }
  return [...pairs.values()].sort((a, b) => a.key.localeCompare(b.key));
}
