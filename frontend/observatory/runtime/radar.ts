import { instances, measured, type Telemetry, type RecordData } from './host';
import { activityBins } from './activity';
import { canonicalObservationPath } from '../../../src/shared/observation-display.js';
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
/** Open a product overview without implying a process action target. @param group Product group @returns Detail request @since 0.14.1 */
export function groupRecord(group: RadarGroup): RecordData {
  return { agentGroupKey: group.key, name: group.name };
}
interface GroupEvidence {
  files: number;
  network: number;
  latest: number | null;
  tokens: number | null;
  cost: number | null;
  estimated: boolean;
}
/** Roll up exact-identity observations and complete token measurements. @param group Product group @param state Telemetry @returns Group evidence @since 0.14.1 */
export function groupEvidence(group: RadarGroup, state: Telemetry): GroupEvidence {
  const ids = new Set(group.members.map((a) => a.instanceId).filter(Boolean));
  const events = state.events.filter((e) => e.instanceId && ids.has(e.instanceId));
  const tokens = group.members.map((a) =>
    a.instanceId ? state.tokens.find((t) => t.instanceId === a.instanceId) : undefined,
  );
  const tokenSum = (key: string): number | null =>
    tokens.length && tokens.every((t) => measured(t?.[key]) !== null)
      ? tokens.reduce((total, t) => total + Number(t?.[key]), 0)
      : null;
  return {
    files: new Set(
      events
        .filter((e) => !e.selfAccess && e.attribution?.status !== 'unattributed')
        .map((e) => canonicalObservationPath(e.file))
        .filter(Boolean),
    ).size,
    network: state.network.filter((n) => n.instanceId && ids.has(n.instanceId)).length,
    latest: events.reduce<number | null>((latest, e) => Math.max(latest ?? 0, e.timestamp), null),
    tokens: tokenSum('totalTokens'),
    cost: tokenSum('costUsd'),
    estimated: tokens.some((t) => t?.estimated === true),
  };
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
