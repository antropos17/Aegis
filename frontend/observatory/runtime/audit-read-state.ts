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
const UUID = /^audit:[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
// A non-enumerable symbol remains accessible through Svelte state proxies without
// exposing the locator to metadata rendering or serialized audit rows.
const AUDIT_LOOKUP = Symbol('audit-lookup');
const AUDIT_REVOKED_LOOKUP = Symbol('audit-revoked-lookup');
const lookupOf = (row: RecordData): string | undefined => Reflect.get(row, AUDIT_LOOKUP);
const rememberLookup = (row: RecordData, id: string): void => {
  Object.defineProperty(row, AUDIT_LOOKUP, { value: id, enumerable: false });
};

export interface AuditCustodyRevision { epoch: string; revision: number }
const EPOCH = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function custodyRevision(value: unknown): AuditCustodyRevision | null {
  if (!isRecord(value) || typeof value.epoch !== 'string' || !EPOCH.test(value.epoch) ||
      !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) return null;
  return { epoch: value.epoch, revision: value.revision as number };
}

function auditLookup(row: RecordData, current: AuditCustodyRevision | null): RecordData {
  const copy = { ...row };
  // Only the current main-process custody projection supplies this locator.
  delete copy.eventId;
  if (
    ['file-access', 'config-access'].includes(String(copy.type)) &&
    typeof copy.auditLookupId === 'string' && UUID.test(copy.auditLookupId) &&
    current !== null && custodyRevision(copy.auditCustodyRevision)?.epoch === current.epoch &&
    custodyRevision(copy.auditCustodyRevision)?.revision === current.revision
  ) {
    rememberLookup(copy, copy.auditLookupId);
    copy.eventId = copy.auditLookupId;
  }
  if (
    ['file-access', 'config-access'].includes(String(copy.type)) &&
    typeof copy.auditRevokedLookupId === 'string' && UUID.test(copy.auditRevokedLookupId)
  ) Object.defineProperty(copy, AUDIT_REVOKED_LOOKUP, { value: copy.auditRevokedLookupId, enumerable: false });
  delete copy.auditLookupId;
  delete copy.auditRevokedLookupId;
  delete copy.auditCustodyRevision;
  return copy;
}

function withoutAmbiguousLookups(rows: RecordData[]): RecordData[] {
  const counts = new Map<string, number>();
  const revoked = new Set<string>();
  for (const row of rows) {
    const id = lookupOf(row);
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    const invalidated = Reflect.get(row, AUDIT_REVOKED_LOOKUP);
    if (typeof invalidated === 'string') revoked.add(invalidated);
  }
  return rows.map((row) => {
    const id = lookupOf(row);
    if (!id || ((counts.get(id) ?? 0) < 2 && !revoked.has(id))) return row;
    // The already-open Details view retains this row; revoke its locator too.
    delete row.eventId;
    return row;
  });
}

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
export function admitAuditPage(value: unknown, current: AuditCustodyRevision | null = null): RecordData[] {
  const rows = Array.isArray(value) ? Array.from(value) : null;
  if (!rows || !rows.every(isRecord)) throw new Error('Invalid audit page');
  return rows.map((row) => {
    const safe = auditLookup(row, current);
    return row.type === 'network-connection'
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
          ...safe,
        }
      : safe;
  });
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
  // An open Details panel may still hold an old row after a refresh. The same
  // physical row appearing again is not, by itself, a duplicate.
  if (request.reset) {
    const revoked = new Set(incoming.map((row) => Reflect.get(row, AUDIT_REVOKED_LOOKUP)));
    for (const row of previous.rows) if (revoked.has(lookupOf(row))) delete row.eventId;
  }
  const checkedRows = withoutAmbiguousLookups(request.reset ? incoming : [...incoming, ...previous.rows]);
  return {
    loaded: true,
    rows: checkedRows,
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
  const history = value.historyReadState;
  if (['ready', 'building', 'unavailable', 'uninitialized'].includes(String(history)))
    result.historyReadState = history;
  if (storage === 'ready' || storage === 'unavailable' || storage === 'uninitialized')
    result.storageReadState = storage;
  if (storage !== 'uninitialized') {
    for (const key of ['bufferDepth', 'droppedEntries']) {
      const number = measurement(value[key]);
      if (number !== undefined) result[key] = number;
    }
    if (history === 'ready' || !Object.hasOwn(value, 'historyReadState')) {
      for (const key of ['totalEntries', 'persistedEntries']) {
        const number = measurement(value[key]);
        if (number !== undefined) result[key] = number;
      }
      for (const key of ['firstEntry', 'lastEntry'])
        if (typeof value[key] === 'string' || value[key] === null) result[key] = value[key];
    }
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
