import { record, type RecordData } from './host';
import { selectFields } from './detail-fields';

export type AuditReadState = 'idle' | 'loading' | 'ready' | 'failed';
export interface AuditRequest {
  reset: boolean;
  before: string;
  boundaryOffset: number;
  requestedType: string;
}
export interface AuditPage {
  loaded: boolean;
  rows: RecordData[];
  cursor: string;
  boundaryOffset: number;
  exhausted: boolean;
  appliedType: string;
}
const isRecord = (value: unknown): value is RecordData =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const measurement = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/** Create an unobserved history snapshot. @param before Initial cursor @returns Snapshot @since 0.17.0 */
export function emptyAuditPage(before: string): AuditPage {
  return {
    loaded: false,
    rows: [],
    cursor: before,
    boundaryOffset: 0,
    exhausted: false,
    appliedType: '',
  };
}

/** Admit a history array without inventing absent historical fields. @param value Wire reply @returns Rows @since 0.17.0 */
export function admitAuditPage(value: unknown): RecordData[] {
  if (!Array.isArray(value) || !value.every(isRecord)) throw new Error('Invalid audit page');
  return value.map((row) =>
    row.type === 'network-connection'
      ? {
          ...selectFields(record(row.extra ?? row.details), [
            'localIp',
            'localPort',
            'remoteIp',
            'remotePort',
            'domain',
            'state',
            'verdict',
            'verdictReason',
          ]),
          ...row,
        }
      : row,
  );
}

/** Atomically advance a successfully read page. @param previous Accepted snapshot @param incoming Admitted rows @param request Captured request @returns New snapshot @since 0.17.0 */
export function advanceAuditPage(
  previous: AuditPage,
  incoming: RecordData[],
  request: AuditRequest,
): AuditPage {
  const times = incoming
    .map((row) =>
      typeof row.timestamp === 'string' || typeof row.timestamp === 'number'
        ? String(row.timestamp)
        : '',
    )
    .filter(Boolean)
    .sort();
  const oldest = times[0];
  if (incoming.length >= 100 && !oldest) throw new Error('Audit page has no continuation cursor');
  const boundaryCount = oldest
    ? incoming.filter((row) => String(row.timestamp ?? '') === oldest).length
    : 0;
  return {
    loaded: true,
    rows: request.reset ? incoming : [...incoming, ...previous.rows],
    cursor: oldest ?? (request.reset ? request.before : previous.cursor),
    boundaryOffset: oldest
      ? boundaryCount + (!request.reset && oldest === request.before ? request.boundaryOffset : 0)
      : request.reset
        ? 0
        : previous.boundaryOffset,
    exhausted: incoming.length < 100,
    appliedType: request.requestedType,
  };
}

/** Admit independent counters and qualify both storage sizes. @param value Wire reply @returns Available observations only @since 0.17.0 */
export function admitAuditStats(value: unknown): RecordData {
  if (
    !isRecord(value) ||
    value.success === false ||
    value.denied === true ||
    Object.hasOwn(value, 'error')
  )
    throw new Error('Invalid audit statistics');
  const result: RecordData = {};
  const storage = value.storageReadState;
  if (storage === 'ready' || storage === 'unavailable' || storage === 'uninitialized')
    result.storageReadState = storage;
  if (storage !== 'uninitialized') {
    for (const key of ['totalEntries', 'persistedEntries', 'bufferDepth', 'droppedEntries']) {
      const number = measurement(value[key]);
      if (number !== undefined) result[key] = number;
    }
    for (const key of ['firstEntry', 'lastEntry'])
      if (typeof value[key] === 'string' || value[key] === null) result[key] = value[key];
  }
  if (storage === 'ready')
    for (const key of ['totalSize', 'currentSize']) {
      const number = measurement(value[key]);
      if (number !== undefined) result[key] = number;
    }
  if (isRecord(value.index)) {
    const index: RecordData = {};
    if (
      ['ready', 'building', 'unavailable', 'failed', 'closed'].includes(String(value.index.state))
    )
      index.state = value.index.state;
    for (const key of ['files', 'rows', 'malformedLines']) {
      const number = measurement(value.index[key]);
      if (number !== undefined) index[key] = number;
    }
    if (value.index.lastError === null) index.lastError = null;
    else if (typeof value.index.lastError === 'string')
      index.lastError = 'Audit index details unavailable.';
    result.index = index;
  }
  return result;
}
