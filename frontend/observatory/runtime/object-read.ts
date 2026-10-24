import { record, type RecordData } from './host';

export const OBJECT_READ_EXPLANATION =
  'Object identity verified; name is a binding label. Access path unknown.';

/** Identify object-bound records before interpreting any legacy path fields.
 * @param value Observation or restored alert summary @returns Whether path semantics are absent @since 0.20.1
 */
export function isObjectRead(value: unknown): boolean {
  return record(value).observationKind === 'bound-object-read';
}

/** Require the full issuing birth before joining object history to a current process.
 * @param value Historical observation @param process Candidate process
 * @returns Whether the object belongs to this exact lifetime; legacy records are unchanged @since 0.20.1
 */
export function objectReadMatchesProcess(value: unknown, process: unknown): boolean {
  if (!isObjectRead(value)) return true;
  const row = record(value);
  const current = record(process);
  return (
    typeof row.createTime100ns === 'string' &&
    /^[1-9]\d*$/.test(row.createTime100ns) &&
    current.instanceIdSource === 'os' &&
    current.createTime100ns === row.createTime100ns &&
    current.instanceId === row.instanceId &&
    current.pid === row.pid &&
    current.agent === row.agent
  );
}

/** Read a display label without turning it into an observed access path.
 * @param value Observation or restored alert summary @returns Binding label or legacy path @since 0.20.1
 */
export function observationLabel(value: unknown): string {
  const row = record(value);
  const label = isObjectRead(row) ? (record(row.object).label ?? row.bindingLabel) : row.file;
  return typeof label === 'string' ? label : '';
}

/** Select an observed path for native actions; object binding labels never qualify.
 * @param row Selected observation @returns Recorded path, or empty when unavailable @since 0.20.1
 */
export function pathActionTarget(row: RecordData): string {
  if (isObjectRead(row) || row.type === 'network-connection') return '';
  const path = row.file || row.cwd || row.path;
  return typeof path === 'string' ? path : '';
}

/** Keep object identity separate from path identity in resource counts and radar links.
 * @param value Observation @returns Opaque identity key, or empty for path records @since 0.20.1
 */
export function objectResourceKey(value: unknown): string {
  if (!isObjectRead(value)) return '';
  const object = record(record(value).object);
  return typeof object.objectKey === 'string' && object.objectKey
    ? JSON.stringify(['object', object.objectKey, object.scopeGeneration, object.policyGeneration])
    : '';
}
