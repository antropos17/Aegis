import type { FileEvent } from '../../../src/shared/types';

export interface SensitiveAlert {
  readonly id: number;
  readonly event: FileEvent;
  readonly reviewed: boolean;
}

export interface SensitiveAlertDelivery {
  readonly items: SensitiveAlert[];
  readonly fresh: SensitiveAlert[];
  readonly evicted: number;
}

export interface SensitiveAlertTracker {
  ingest(events: readonly FileEvent[]): SensitiveAlertDelivery;
  setReviewed(id: number, reviewed: boolean): SensitiveAlert[];
}

/** Keep a bounded review list for events delivered to this renderer window.
 * @param capacity Maximum retained alerts @returns Session tracker @since 0.17.0
 */
export function createSensitiveAlertTracker(capacity = 100): SensitiveAlertTracker {
  if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('Invalid alert capacity');
  const seen = new WeakSet<FileEvent>();
  let initialized = false;
  let nextId = 1;
  let items: SensitiveAlert[] = [];
  let evicted = 0;

  return {
    /** Ingest one immutable renderer snapshot. Initial history is reviewable but does not toast.
     * @param events Retained file observations @returns New and retained alerts @since 0.17.0
     */
    ingest(events: readonly FileEvent[]): SensitiveAlertDelivery {
      const added: SensitiveAlert[] = [];
      for (const event of events) {
        if (!event || typeof event !== 'object' || seen.has(event)) continue;
        seen.add(event);
        if (event.sensitive === true) added.push({ id: nextId++, event, reviewed: false });
      }
      if (added.length) {
        const combined = [...added].reverse().concat(items);
        evicted += Math.max(0, combined.length - capacity);
        items = combined.slice(0, capacity);
      }
      const fresh = initialized ? added : [];
      initialized = true;
      return { items, fresh, evicted };
    },
    /** Change review bookkeeping without altering a file, process or access policy.
     * @param id Alert identifier @param reviewed Review state @returns Current list @since 0.17.0
     */
    setReviewed(id: number, reviewed: boolean): SensitiveAlert[] {
      items = items.map((item) => (item.id === id ? { ...item, reviewed } : item));
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
