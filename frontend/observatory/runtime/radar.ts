import { instances, measured, type Telemetry } from './host';
import { activityBins } from './activity';
export type ObservedInstance = ReturnType<typeof instances>[number];
export interface RadarGroup {
  key: string;
  name: string;
  members: ObservedInstance[];
  risk: number;
}
/** Group observed processes without inventing an instance identity. @param agents Observed instances @returns Stable product groups @since 0.14.1 */
export function radarGroups(agents: ObservedInstance[]): RadarGroup[] {
  const groups = new Map<string, RadarGroup>();
  for (const a of agents) {
    const key = a.agent || a.name;
    const group = groups.get(key) ?? { key, name: a.name, members: [], risk: 0 };
    group.members.push(a);
    group.risk = Math.max(group.risk, a.riskScore);
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((g) => ({
      ...g,
      members: g.members.sort((a, b) => b.riskScore - a.riskScore || a.pid - b.pid),
    }));
}
/** Sum measurements only if every grouped instance is measured. @param group Group @param state Telemetry @param key Resource field @returns Measurement or unknown @since 0.14.1 */
export function groupResource(group: RadarGroup, state: Telemetry, key: string): number | null {
  const values = group.members.map((a) =>
    a.instanceId
      ? measured(state.resources.find((r) => r.instanceId === a.instanceId)?.[key])
      : null,
  );
  return state.stale || values.some((v) => v === null)
    ? null
    : values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
}
/** Read group activity on one shared timeline. @param group Group @param state Telemetry @param end Interval end @returns Bins @since 0.14.1 */
export function groupActivity(group: RadarGroup, state: Telemetry, end: number) {
  const ids = new Set(group.members.map((a) => a.instanceId).filter(Boolean));
  return activityBins(
    state.events.filter((e) => e.instanceId && ids.has(e.instanceId)),
    end,
    300000,
    10,
  );
}
/** Format an optional measured value. @param n Measurement @param suffix Unit @returns Display label @since 0.14.1 */
export function displayMeasure(n: number | null, suffix = ''): string {
  return n === null ? '—' : n.toFixed(1) + suffix;
}
/** Shared risk vocabulary. @param score Risk score @returns Band @since 0.14.1 */
export function riskBand(score: number): string {
  return score >= 66 ? 'high' : score >= 35 ? 'medium' : 'low';
}
