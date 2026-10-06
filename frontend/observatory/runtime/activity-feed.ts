import {
  describeObservation,
  groupObservations,
  observationTime,
} from '../../../src/shared/observation-display.js';
import type { RecordData } from './host';
import { motionAllowed } from './motion';

export type FeedGroup = ReturnType<typeof groupObservations>[number];
export type RecordKey = (_row: RecordData) => string;
interface KeyedRecord {
  row: RecordData;
  key: string;
}
export interface FeedSnapshot {
  groups: FeedGroup[];
  agents: RecordData[];
  signature: string;
  total: number;
}

function canonicalEvidence(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) =>
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.keys(entry)
            .sort()
            .map((key) => [key, (entry as Record<string, unknown>)[key]]),
        )
      : entry,
  );
}

function evidence(row: RecordData): string {
  return canonicalEvidence([
    row.eventId,
    row.id,
    row.instanceId,
    row.pid,
    row.agent,
    row.file,
    row.path,
    row.timestamp,
    row.action,
    row.type,
    row.source,
    row.reason,
    row.detail,
    row.severity,
    row.sensitive,
    row.selfAccess,
    row.localIp,
    row.localPort,
    row.remoteIp,
    row.ip,
    row.remotePort,
    row.domain,
    row.state,
    row.verdict,
    row.verdictReason,
    row.attribution,
    row.extra,
    row.details,
  ]);
}

/** Keep UUIDs, equivalent network snapshots and legacy object identities separate.
 * @returns Component-local record key function @since 0.19.2
 */
export function createRecordKey(): RecordKey {
  const legacy = new WeakMap<RecordData, string>();
  let next = 0;
  return (row) => {
    if (typeof row.eventId === 'string' && row.eventId) return 'event:' + row.eventId;
    if (typeof row.id === 'string' && row.id) return 'record:' + row.id;
    // This identifies a delivered snapshot record, never a connection lifetime.
    if (row.remoteIp || row.ip || row.domain || row.type === 'network-connection')
      return 'network:' + evidence(row);
    let key = legacy.get(row);
    if (!key) {
      key = 'legacy:' + ++next;
      legacy.set(row, key);
    }
    return key;
  };
}

/** Assign unique keys without positional reuse after filtering or eviction.
 * @param rows Original observations @param key Component-local identity function
 * @returns Keyed original records @since 0.19.2
 */
export function keyedRecords(rows: RecordData[], key: RecordKey): KeyedRecord[] {
  const occurrences = new Map<string, number>();
  return rows.map((row) => {
    const base = key(row);
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    return { row, key: base + ':' + occurrence };
  });
}

/** Group retained records using original identities for individual observations.
 * @param rows Original observations @param grouping Display grouping
 * @param agents Captured actor context @param key Component-local record identities
 * @returns Immutable group snapshot and change signature @since 0.19.2
 */
export function feedSnapshot(
  rows: RecordData[],
  grouping: 'resource' | 'agent' | 'none',
  agents: RecordData[],
  key: RecordKey,
): FeedSnapshot {
  const groups =
    grouping === 'none'
      ? keyedRecords(rows, key)
          .map((entry) => ({
            key: entry.key,
            label: describeObservation(entry.row, agents).resource,
            rows: [entry.row],
            latest: entry.row,
            first: observationTime(entry.row.timestamp),
            last: observationTime(entry.row.timestamp),
          }))
          .sort(
            (a, b) =>
              b.last - a.last || a.label.localeCompare(b.label) || a.key.localeCompare(b.key),
          )
      : groupObservations(rows, grouping, agents);
  // Canonical comparison must not reorder captured groups or original evidence.
  const signature = groups
    .map((group) => [group.key, group.rows.map(canonicalEvidence).sort()] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));
  return {
    groups,
    agents,
    signature: JSON.stringify(signature),
    total: rows.length,
  };
}

type ScrollOptions = {
  active: boolean;
  more: boolean;
  following?: boolean;
  load: () => void;
  hold: () => void;
};
type FeedScrollAction = { update: (_next: ScrollOptions) => void; destroy: () => void };

/** Observe native feed scrolling; no timers, frames or work while hidden/paused.
 * @param node Feed surface @param initial Current visibility and loading callbacks
 * @returns Svelte action cleanup/update @since 0.19.2
 */
export function feedScroll(node: HTMLElement, initial: ScrollOptions): FeedScrollAction {
  let options = initial;
  const root = node.closest<HTMLElement>('#main, [data-feed-scroll]');
  const sentinel = node.querySelector<HTMLElement>('[data-feed-older]');
  let inputPending = false;
  let pointerScrolling = false;
  const active = (): boolean => options.active && document.visibilityState !== 'hidden';
  const hold = (): void => {
    if (!active() || !root) return;
    const feedBounds = node.getBoundingClientRect();
    const rootBounds = root.getBoundingClientRect();
    if (feedBounds.bottom > rootBounds.top && feedBounds.top < rootBounds.bottom) options.hold();
  };
  const input = (): void => {
    if (!active()) return;
    inputPending = true;
    hold();
  };
  const keyboard = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement;
    if (
      !['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key) ||
      target.closest('input, textarea, select, [contenteditable], [role="tab"]') ||
      (event.key === ' ' && target.closest('button, a'))
    )
      return;
    input();
  };
  const pointer = (event: PointerEvent): void => {
    if (event.target !== root || !active()) return;
    pointerScrolling = true;
    input();
  };
  const release = (): void => {
    pointerScrolling = false;
    inputPending = false;
  };
  const scroll = (): void => {
    if (inputPending || pointerScrolling) hold();
    inputPending = false;
  };
  const observer =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver(
          (entries): void => {
            if (active() && options.more && entries.some((entry) => entry.isIntersecting))
              options.load();
          },
          { root, rootMargin: '0px 0px 160px 0px' },
        );
  const sync = (): void => {
    observer?.disconnect();
    if (options.following) release();
    if (!active()) {
      release();
      node.querySelectorAll('.feed-arrival').forEach((row) => row.classList.remove('feed-arrival'));
    }
    if (active() && options.more && sentinel) observer?.observe(sentinel);
  };
  root?.addEventListener('scroll', scroll, { passive: true });
  root?.addEventListener('wheel', input, { passive: true });
  root?.addEventListener('touchmove', input, { passive: true });
  root?.addEventListener('keydown', keyboard);
  root?.addEventListener('pointerdown', pointer);
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', release);
  document.addEventListener('visibilitychange', sync);
  sync();
  return {
    update(next: ScrollOptions): void {
      options = next;
      sync();
    },
    destroy(): void {
      observer?.disconnect();
      root?.removeEventListener('scroll', scroll);
      root?.removeEventListener('wheel', input);
      root?.removeEventListener('touchmove', input);
      root?.removeEventListener('keydown', keyboard);
      root?.removeEventListener('pointerdown', pointer);
      document.removeEventListener('pointerup', release);
      document.removeEventListener('pointercancel', release);
      document.removeEventListener('visibilitychange', sync);
    },
  };
}

/** Fade a newly mounted record once while following visible, fresh activity.
 * @param node New record row @param enabled Whether the feed follows live activity
 * @returns Update and disposal callbacks @since 0.19.2
 */
export function feedArrival(
  node: HTMLElement,
  enabled: boolean,
): {
  update: (_next: boolean) => void;
  destroy: () => void;
} {
  const stop = (): void => node.classList.remove('feed-arrival');
  node.addEventListener('animationend', stop);
  node.addEventListener('animationcancel', stop);
  const bounds = node.getBoundingClientRect();
  const viewport = node.closest<HTMLElement>('#main, [data-feed-scroll]')?.getBoundingClientRect();
  if (
    enabled &&
    motionAllowed() &&
    bounds.bottom > (viewport?.top ?? 0) &&
    bounds.top < (viewport?.bottom ?? innerHeight)
  )
    node.classList.add('feed-arrival');
  return {
    update(next: boolean): void {
      if (!next) stop();
    },
    destroy(): void {
      stop();
      node.removeEventListener('animationend', stop);
      node.removeEventListener('animationcancel', stop);
    },
  };
}
