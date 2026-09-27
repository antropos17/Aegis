import type { DetectedAgent, FileEvent } from '../../../src/shared/types';
import { actionTarget, type Telemetry } from './host';

export interface SensitiveAlert {
  readonly id: string;
  readonly event: FileEvent;
  readonly reviewed: boolean;
  readonly savedReview: boolean;
  readonly live: boolean;
}

export interface JournalAlert {
  readonly eventId: string;
  readonly timestamp: number;
  readonly basename: string;
  readonly action: FileEvent['action'];
  readonly agent: string;
  readonly attribution: 'confirmed' | 'inferred' | 'unattributed';
  readonly reviewed: boolean;
}

export interface SensitiveAlertDelivery {
  readonly items: SensitiveAlert[];
  readonly fresh: SensitiveAlert[];
  readonly evicted: number;
}

export interface SensitiveAlertTracker {
  ingest(events: readonly FileEvent[]): SensitiveAlertDelivery;
  mergeJournal(rows: readonly JournalAlert[]): SensitiveAlert[];
  setReviewed(id: string, reviewed: boolean, saved?: boolean): SensitiveAlert[];
}

function observedAt(item: SensitiveAlert): number {
  return Number.isFinite(item.event.timestamp) ? item.event.timestamp : Number.NEGATIVE_INFINITY;
}

function newestFirst(left: SensitiveAlert, right: SensitiveAlert): number {
  return observedAt(right) - observedAt(left) || right.id.localeCompare(left.id);
}

function summaryEvent(row: JournalAlert): FileEvent {
  return {
    eventId: row.eventId,
    agent: row.agent,
    pid: null,
    instanceId: null,
    parentEditor: null,
    cwd: null,
    file: row.basename,
    sensitive: true,
    selfAccess: false,
    reason: '',
    action: row.action,
    timestamp: row.timestamp,
    category: 'other',
    attribution: { status: row.attribution, evidence: [] },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(['created', 'modified', 'deleted', 'accessed', 'holding']);

/** Narrow the fixed journal wire format before any summary reaches the UI.
 * @param value IPC value @returns Validated summaries @since 0.17.0
 */
export function parseJournalAlerts(value: unknown): JournalAlert[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const rows: JournalAlert[] = [];
  for (const candidate of value.slice(0, 100)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const row = candidate as Record<string, unknown>;
    if (
      typeof row.eventId !== 'string' ||
      !UUID.test(row.eventId) ||
      ids.has(row.eventId) ||
      typeof row.timestamp !== 'number' ||
      !Number.isInteger(row.timestamp) ||
      row.timestamp < 0 ||
      typeof row.basename !== 'string' ||
      !row.basename ||
      row.basename.length > 200 ||
      /[/\\]/.test(row.basename) ||
      typeof row.action !== 'string' ||
      !ACTIONS.has(row.action) ||
      typeof row.agent !== 'string' ||
      row.agent.length > 100 ||
      !['confirmed', 'inferred', 'unattributed'].includes(String(row.attribution)) ||
      typeof row.reviewed !== 'boolean'
    )
      continue;
    ids.add(row.eventId);
    rows.push(row as unknown as JournalAlert);
  }
  return rows;
}

/** Bounded review list merged by per-observation UUID, never by path or time.
 * @param capacity Maximum retained alerts @returns Alert tracker @since 0.17.0
 */
export function createSensitiveAlertTracker(capacity = 100): SensitiveAlertTracker {
  if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('Invalid alert capacity');
  const seen = new WeakSet<FileEvent>();
  const locallyReviewed = new Map<string, boolean>();
  let initialized = false;
  let nextLegacyId = 1;
  let items: SensitiveAlert[] = [];
  let evicted = 0;

  function bound(next: SensitiveAlert[]): void {
    const total = next.length;
    // A seed can arrive after live IPC. Keep current-window observations before
    // filling the remaining slots with persisted summaries.
    const live = next.filter((item) => item.live);
    const summaries = next.filter((item) => !item.live).sort(newestFirst);
    next = live.concat(summaries.slice(0, Math.max(0, capacity - live.length)));
    evicted += Math.max(0, total - capacity);
    items = next.slice(0, capacity).sort(newestFirst);
    pruneReviewOverrides();
  }

  function pruneReviewOverrides(): void {
    const retained = new Set(items.map((item) => item.id));
    for (const id of locallyReviewed.keys()) if (!retained.has(id)) locallyReviewed.delete(id);
  }

  return {
    ingest(events: readonly FileEvent[]): SensitiveAlertDelivery {
      const added: SensitiveAlert[] = [];
      for (const event of events) {
        if (!event || typeof event !== 'object' || seen.has(event)) continue;
        seen.add(event);
        if (event.sensitive !== true) continue;
        const id =
          typeof event.eventId === 'string' && UUID.test(event.eventId)
            ? event.eventId
            : `session-${nextLegacyId++}`;
        const at = items.findIndex((item) => item.id === id);
        if (at !== -1) {
          items = items.map((item, index) =>
            index === at ? { ...item, event, live: true } : item,
          );
          continue;
        }
        added.push({ id, event, reviewed: false, savedReview: false, live: true });
      }
      if (added.length) {
        // New delivery wins the capacity boundary even when its timestamp is late.
        const next = added.sort(newestFirst).concat(items);
        evicted += Math.max(0, next.length - capacity);
        items = next.slice(0, capacity).sort(newestFirst);
        pruneReviewOverrides();
      }
      const fresh = initialized ? added : [];
      initialized = true;
      return { items, fresh, evicted };
    },
    mergeJournal(rows: readonly JournalAlert[]): SensitiveAlert[] {
      const next = [...items];
      for (const row of rows) {
        if (!row || typeof row.eventId !== 'string' || !row.eventId) continue;
        const at = next.findIndex((item) => item.id === row.eventId);
        const reviewed = locallyReviewed.get(row.eventId) ?? row.reviewed === true;
        if (at !== -1) next[at] = { ...next[at], reviewed, savedReview: reviewed };
        else
          next.push({
            id: row.eventId,
            event: summaryEvent(row),
            reviewed,
            savedReview: reviewed,
            live: false,
          });
      }
      bound(next);
      return items;
    },
    setReviewed(id: string, reviewed: boolean, saved = false): SensitiveAlert[] {
      if (items.some((item) => item.id === id)) locallyReviewed.set(id, reviewed);
      items = items.map((item) =>
        item.id === id ? { ...item, reviewed, savedReview: saved && reviewed } : item,
      );
      return items;
    },
  };
}

/** Display only a basename in transient notifications.
 * @param path Observed path @returns File name @since 0.17.0
 */
export function alertBasename(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).at(-1) || path || 'Unknown file';
}

/** Link a confirmed observation only to its uniquely matched, currently controllable process.
 * @param event Sensitive observation @param state Latest live telemetry @returns Current process or null @since 0.17.0
 */
export function alertControlTarget(event: FileEvent, state: Telemetry): DetectedAgent | null {
  if (
    event.attribution?.status !== 'confirmed' ||
    event.selfAccess === true ||
    typeof event.instanceId !== 'string' ||
    !event.agent ||
    !Number.isInteger(event.pid) ||
    (event.pid ?? 0) <= 0
  )
    return null;
  const matches = state.agents.filter(
    (agent) =>
      agent.instanceId === event.instanceId &&
      agent.pid === event.pid &&
      agent.agent === event.agent,
  );
  if (matches.length !== 1) return null;
  try {
    return actionTarget(state, event.instanceId) === matches[0] ? matches[0] : null;
  } catch {
    return null;
  }
}
