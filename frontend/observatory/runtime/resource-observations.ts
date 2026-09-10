import type { RecordData, Telemetry } from './host';

export interface ResourceCollection {
  collectedAt: number;
  collectionStartedAt: number;
  collectionSequence: number;
}
export interface CollectionRange {
  oldest: number;
  newest: number;
}
/** Read collector provenance; these times describe collection, not OS sampling.
 * @param row Resource row @returns Valid collector metadata or null @since 0.14.1
 */
export function resourceCollection(row: RecordData): ResourceCollection | null {
  const { collectedAt, collectionStartedAt, collectionSequence } = row;
  if (
    typeof collectedAt !== 'number' ||
    !Number.isFinite(collectedAt) ||
    collectedAt <= 0 ||
    typeof collectionStartedAt !== 'number' ||
    !Number.isFinite(collectionStartedAt) ||
    collectionStartedAt <= 0 ||
    typeof collectionSequence !== 'number' ||
    !Number.isSafeInteger(collectionSequence) ||
    collectionSequence <= 0
  )
    return null;
  return { collectedAt, collectionStartedAt, collectionSequence };
}
function identity(row: RecordData): string | null {
  return typeof row.instanceId === 'string' && row.instanceId ? row.instanceId : null;
}
/** Keep newer instance readings when an older asynchronous batch arrives late.
 * @param previous Last accepted rows @param incoming New delivery
 * @returns Rows preserving ambiguous duplicates and newer readings @since 0.14.1
 */
export function mergeResourceDelivery(
  previous: RecordData[],
  incoming: RecordData[],
): RecordData[] {
  const maximum = Math.max(
    0,
    ...incoming.map((row) => resourceCollection(row)?.collectionSequence ?? 0),
  );
  if (!maximum) return incoming;
  const uniquePrevious = new Map<string, RecordData>();
  for (const row of previous) {
    const id = identity(row);
    if (id && previous.filter((item) => identity(item) === id).length === 1)
      uniquePrevious.set(id, row);
  }
  const accepted = incoming.map((row) => {
    const id = identity(row),
      clock = resourceCollection(row);
    const old = id ? uniquePrevious.get(id) : undefined;
    const oldClock = old && resourceCollection(old);
    if (clock && old && oldClock && oldClock.collectionSequence >= clock.collectionSequence)
      return old;
    return row;
  });
  const deliveredIds = new Set(incoming.map(identity));
  for (const [id, row] of uniquePrevious) {
    if (!deliveredIds.has(id) && (resourceCollection(row)?.collectionSequence ?? 0) > maximum)
      accepted.push(row);
  }
  return accepted;
}
/** Select a new resource snapshot without re-stamping cached readings.
 * Latest per-instance readings may span collections; retain that range explicitly.
 * @param state Current telemetry @param before Last seen sequence for each identity
 * @param unattributedBefore Last seen sequence for rows without an attributable identity
 * @returns Snapshot rows, collection range, and bounded sequence state @since 0.14.1
 */
export function observeResourceCollection(
  state: Telemetry,
  before: Record<string, number>,
  unattributedBefore = 0,
): {
  at: number | null;
  rows: RecordData[];
  sequences: Record<string, number>;
  collection?: CollectionRange;
  advanced?: boolean;
  unattributedSequence?: number;
} {
  const rows = state.resources;
  const timed = rows.some(
    (row) => 'collectedAt' in row || 'collectionSequence' in row || 'collectionStartedAt' in row,
  );
  if (!timed) return { at: state.resourcesAt, rows, sequences: before };
  const ids = new Set(state.agents.map((agent) => agent.instanceId).filter(Boolean));
  const sequences: Record<string, number> = Object.create(null);
  for (const id of ids) if (id && Object.hasOwn(before, id)) sequences[id] = before[id];
  const accepted: RecordData[] = [];
  const hasUnattributed = state.agents.some((agent) => !agent.instanceId);
  let unattributedSequence = unattributedBefore;
  const times: number[] = [];
  let changed = false;
  for (const row of rows) {
    const id = identity(row),
      clock = resourceCollection(row);
    if (!clock || clock.collectedAt > (state.resourcesAt ?? 0)) continue;
    if (!id) {
      if (hasUnattributed && clock.collectionSequence >= unattributedBefore) {
        times.push(clock.collectedAt);
        if (clock.collectionSequence > unattributedBefore) changed = true;
        unattributedSequence = Math.max(unattributedSequence, clock.collectionSequence);
      }
      continue;
    }
    if (!ids.has(id)) continue;
    const previous = Object.hasOwn(before, id) ? before[id] : 0;
    if (clock.collectionSequence < previous) continue;
    accepted.push(row);
    times.push(clock.collectedAt);
    if (clock.collectionSequence > previous) changed = true;
    sequences[id] = Math.max(sequences[id] ?? 0, clock.collectionSequence);
  }
  if (!changed) {
    // Malformed metadata is unavailable; valid cache replay adds no point.
    const invalid = rows.some((row) => {
      const id = identity(row),
        clock = resourceCollection(row);
      return (
        (id ? ids.has(id) : hasUnattributed) &&
        (!clock || clock.collectedAt > (state.resourcesAt ?? 0))
      );
    });
    return {
      at: invalid ? state.resourcesAt : null,
      rows: invalid ? [] : accepted,
      sequences,
      unattributedSequence,
    };
  }
  return {
    at: Math.max(...times),
    rows: accepted,
    sequences,
    collection: { oldest: Math.min(...times), newest: Math.max(...times) },
    advanced: true,
    unattributedSequence,
  };
}
