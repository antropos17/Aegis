import { record, type RecordData } from './host';
import { observationEvidenceLabel } from '../../../src/shared/observation-display.js';

export interface InfoField {
  key: string;
  label: string;
  value?: string;
  children?: InfoField[];
  items?: string[];
}
const labels: Record<string, string> = {
  names: 'Process signatures',
  knownDomains: 'Known domains',
  knownPorts: 'Known ports',
  configPaths: 'Configuration paths',
  parentEditors: 'Parent editors',
  pid: 'Process ID',
  ppid: 'Parent process ID',
  instanceId: 'Process identity',
  instanceIdSource: 'Identity source',
  verdict: 'Endpoint verification',
  verdictReason: 'Verification evidence',
  cpu: 'CPU',
  memMb: 'RAM, MB',
  memMB: 'RAM, MB',
  heapMB: 'Heap, MB',
  costUsd: 'Cost, USD',
  totalTokens: 'Total tokens',
  inputTokens: 'Input tokens',
  outputTokens: 'Output tokens',
  cacheReadTokens: 'Cached input tokens',
  cwd: 'Working directory',
  localIp: 'Local IP',
  localPort: 'Local port',
  remoteIp: 'Remote IP',
  remotePort: 'Remote port',
  populationReliable: 'Reliable process observation',
  identityDegraded: 'Identity degraded',
  schemaVersion: 'Record format',
  rendererRetention: 'Retained observations',
  evicted: 'Older observations removed',
  sensitiveEvicted: 'Sensitive observations removed',
  appHealth: 'Sensor health',
  agentResources: 'Process resource samples',
  aegisProcess: 'AEGIS usage',
  lastScan: 'Last scan',
  timestamp: 'Observed at',
  seq: 'Record number',
};
const states: Record<string, string> = {
  HEALTHY: 'Healthy',
  DEGRADED: 'Degraded',
  UNAVAILABLE: 'Unavailable',
  NONE: 'None',
  SENSORS_STARTING: 'Sensors starting',
  confirmed: 'PID confirmed',
  inferred: 'Indirect match',
  unattributed: 'Actor not recorded',
  ambiguous: 'Ambiguous ownership',
  os: 'Operating system',
};
const missingFields: Record<string, string> = {
  cwd: 'Working directory not recorded',
  pid: 'Process ID not recorded',
  instanceId: 'Process identity not recorded',
  instanceIdSource: 'Identity source not recorded',
  agent: 'Actor not recorded',
  domain: 'Hostname not recorded',
  model: 'Model not recorded',
  verdict: 'Endpoint unverified',
  verdictReason: 'Verification reason not recorded',
};
const endpointStates: Record<string, string> = {
  allowlisted: 'Allowlisted',
  flagged: 'Not allowlisted',
  unknown: 'Endpoint unverified',
};
const privateField =
  /api.?key|secret|password|authorization|access.?token|refresh.?token|private.?key|file.?contents?|command.?line/i;

/** Human labels for stored attributes. @param key Wire field @returns Readable label @since 0.14.1 */
export function fieldLabel(key: string): string {
  return (
    labels[key] ??
    key
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/^./, (c) => c.toUpperCase())
  );
}
/** Format a scalar without serializing objects. @param value Wire value @param key Field @returns Display text @since 0.14.1 */
export function fieldValue(value: unknown, key = ''): string {
  if (value === null || value === undefined || value === '')
    return Object.hasOwn(missingFields, key) ? missingFields[key] : 'Unavailable';
  if (key === 'verdict')
    return Object.hasOwn(endpointStates, String(value))
      ? endpointStates[String(value)]
      : String(value);
  if (key === 'verdictReason') return observationEvidenceLabel(value);
  if (key === 'instanceIdSource' && value === 'unknown') return 'Process start time not observed';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (['timestamp', 'firstSeen', 'lastSeen', 'startedAt', 'observedAt', 'at'].includes(key)) {
    const time = new Date(typeof value === 'number' ? value : String(value));
    if (Number.isFinite(time.getTime())) return time.toLocaleString();
  }
  if (typeof value === 'number')
    return Number.isFinite(value) ? value.toLocaleString() : 'Unavailable';
  if (typeof value === 'string') return states[value] ?? value;
  return 'Unavailable';
}
/** Structure nested diagnostics into named fields, never raw JSON. @param value Wire value @returns Safe field tree @since 0.14.1 */
export function informationFields(value: unknown): InfoField[] {
  const seen = new WeakSet<object>();
  const walk = (input: unknown, depth: number): InfoField[] => {
    if (!input || typeof input !== 'object' || seen.has(input) || depth > 6) return [];
    seen.add(input);
    const list = Array.isArray(input);
    const result = Object.entries(input)
      .filter(([key]) => !privateField.test(key))
      .map(([key, val]) => {
        const label = list ? 'Record ' + (Number(key) + 1) : fieldLabel(key);
        if (Array.isArray(val) && val.every((item) => item === null || typeof item !== 'object')) {
          return { key, label, items: val.map((item) => fieldValue(item, key)) };
        }
        if (val && typeof val === 'object') {
          const children = walk(val, depth + 1);
          return {
            key,
            label,
            ...(children.length ? { children } : { value: 'No further details' }),
          };
        }
        return { key, label, value: fieldValue(val, key) };
      });
    seen.delete(input);
    return result;
  };
  return walk(value, 0);
}
/** Pick available, non-secret attributes for an entity section. @param row Record @param keys Allowed fields @returns Attributes @since 0.14.1 */
export function selectFields(row: RecordData, keys: string[]): RecordData {
  return Object.fromEntries(
    keys.filter((key) => key in row && !privateField.test(key)).map((key) => [key, row[key]]),
  );
}
/** Read attribution as human fields. @param row Observation @returns Recorded evidence @since 0.14.1 */
export function evidenceFields(row: RecordData): RecordData {
  const attribution = record(row.attribution);
  return {
    ...selectFields(row, [
      'source',
      'pid',
      'instanceId',
      'reason',
      'verdict',
      'verdictReason',
      'localIp',
      'localPort',
      'remoteIp',
      'remotePort',
      'severity',
    ]),
    ...(Array.isArray(attribution.evidence)
      ? { evidence: attribution.evidence.map(observationEvidenceLabel) }
      : {}),
    ...(attribution.status ? { attribution: attribution.status } : {}),
  };
}
