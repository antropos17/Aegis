import { instances, record, records, type RecordData, type Telemetry } from './host';
import { radarGroups } from './radar';
import { describeObservation } from '../../../src/shared/observation-display.js';
export interface DetailTab {
  id: string;
  label: string;
  icon?: string;
  count?: number;
}
export type DetailKind = 'group' | 'process' | 'records' | 'catalog' | 'resource' | 'information';

/** Resolve the record's presentation without supplying actor identity. @param row Record @returns Kind @since 0.14.1 */
export function detailKind(row: RecordData): DetailKind {
  return row.agentGroupKey
    ? 'group'
    : row.process
      ? 'process'
      : Array.isArray(row.observations)
        ? 'records'
        : row.displayName
          ? 'catalog'
          : row.file || row.path || row.remoteIp || row.domain
            ? 'resource'
            : 'information';
}
/** Exact stamped processes belonging to a displayed group. @param row Group @param state Telemetry @returns Members @since 0.14.1 */
export function detailMembers(row: RecordData, state: Telemetry): ReturnType<typeof instances> {
  return row.agentGroupKey
    ? (radarGroups(instances(state)).find((g) => g.key === row.agentGroupKey)?.members ?? [])
    : [];
}
/** Recorded activity for this entity only; directory context does not create ownership. @param row Entity @param state Telemetry @returns Records @since 0.14.1 */
export function detailActivity(row: RecordData, state: Telemetry): RecordData[] {
  if (Array.isArray(row.observations)) return records(row.observations);
  const ids = new Set(
    row.agentGroupKey
      ? detailMembers(row, state)
          .map((a) => a.instanceId)
          .filter(Boolean)
      : typeof row.instanceId === 'string' && row.process
        ? [row.instanceId]
        : [],
  );
  return [...state.events, ...state.network].filter(
    (entry) =>
      !!entry.instanceId &&
      ids.has(entry.instanceId) &&
      record(record(entry).attribution).status !== 'unattributed',
  ) as unknown as RecordData[];
}
/** Sections available for this entity. @param row Record @param state Telemetry @returns Tabs @since 0.14.1 */
export function detailTabs(row: RecordData, state: Telemetry): DetailTab[] {
  const overview = { id: 'overview', label: 'Overview', icon: 'report' };
  const attributes = { id: 'attributes', label: 'Attributes', icon: 'clipboard' };
  const risk = { id: 'risk', label: 'Risk explanation', icon: 'shield' };
  switch (detailKind(row)) {
    case 'group':
      return [
        overview,
        risk,
        {
          id: 'processes',
          label: 'Processes',
          icon: 'cpu',
          count: detailMembers(row, state).length,
        },
        {
          id: 'activity',
          label: 'Activity',
          icon: 'activity',
          count: detailActivity(row, state).length,
        },
      ];
    case 'process':
      return [
        overview,
        risk,
        {
          id: 'activity',
          label: 'Activity',
          icon: 'activity',
          count: detailActivity(row, state).length,
        },
        attributes,
        { id: 'controls', label: 'Controls', icon: 'settings' },
      ];
    case 'records':
      return [
        overview,
        {
          id: 'records',
          label: 'Records',
          icon: 'history',
          count: records(row.observations).length,
        },
      ];
    case 'catalog':
      return [overview, { id: 'signatures', label: 'Recognition', icon: 'search' }];
    case 'resource':
      return [overview, attributes, { id: 'related', label: 'Related', icon: 'network' }];
    default:
      return [overview, attributes];
  }
}
/** Useful entity title, not the caller's generic metadata label. @param row Record @param fallback Requested title @returns Heading @since 0.14.1 */
export function detailTitle(row: RecordData, fallback: string): string {
  const kind = detailKind(row);
  if (kind === 'resource') return describeObservation(row).resource;
  return String(
    row.name ||
      row.displayName ||
      row.agentGroupKey ||
      (kind === 'process' ? row.agent : '') ||
      row.observationGroup ||
      row.signature ||
      fallback,
  );
}
/** Entity caption kept separate from its name. @param row Record @returns Caption @since 0.14.1 */
export function detailCaption(row: RecordData): string {
  return {
    group: 'Agent overview',
    process: 'Agent instance',
    records: 'Grouped observations',
    catalog: 'Agent catalog',
    resource: describeObservation(row).kind + ' observation',
    information: 'Details',
  }[detailKind(row)];
}
