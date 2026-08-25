/**
 * @file events-retention.ts — the cap policy for the renderer `events` store.
 * @module renderer/stores/events-retention
 * @description The renderer counterpart of main's `file-access` display-lane policy
 *   (src/main/file-access-batching.js + ipc-batcher `retain`). Pure: no store, no
 *   Svelte, no clock — stores/ipc.ts applies it on every `file-access` push.
 *
 * ## What an eviction here is, and what it is not
 *
 * The `events` store is the renderer's copy of the display lane. A row evicted here has
 * left EVERY renderer consumer — the activity feed, the grouped feed, the timeline, risk
 * correlation, reports — and nothing in this process can bring it back. It is still not
 * an observation loss and not an audit drop: main delivered the row, and the activityLog
 * ring and the audit JSONL hold it on their own lane. A count from here answers "what did
 * this window stop showing", never "what was not observed" or "what was not recorded".
 *
 * The feed's own 200-row slice (ActivityFeed.svelte, grouped-feed-utils `filterEvents`)
 * is NOT an eviction: the row stays in the store and the severity filter re-surfaces it.
 * Only the store cap loses rows for good, so only the store cap is counted.
 * @since v0.14.0
 */
import type { FileEvent } from '../../../shared/types';

/**
 * Rows the `events` store holds at most. The number the store has advertised since the
 * cap was introduced (`slice(-499)` + batch); it is now a bound rather than a floor — a
 * batch larger than the cap leaves exactly this many rows, not 499 plus the batch.
 * @since v0.14.0
 */
export const EVENTS_CAPACITY = 500;

/**
 * What one `appendWithRetention` call did, in the same words as main's `BatcherStats`:
 * `evicted` rows left the store, `retainedEvicted` of them were retained rows that went
 * only because nothing else was left to take.
 * @since v0.14.0
 */
export interface RetentionResult {
  /** The store's next contents, at most `capacity` rows, arrival order preserved. */
  readonly next: FileEvent[];
  /** Rows dropped to honour `capacity` in this call. */
  readonly evicted: number;
  /** Of `evicted`, rows the predicate retained — the store held nothing else. */
  readonly retainedEvicted: number;
}

/**
 * Retention predicate for the renderer display lane: `true` for a sensitive event,
 * `false` for everything else.
 *
 * `sensitive === true` exactly, the same reading main's `fileAccessRetain` makes: a
 * merely truthy value is not a sensitive event as file-watcher.js builds one. Total — any
 * input answers, none throws — because it runs on the push path.
 * @param ev - A file event as delivered on `file-access`.
 * @returns Whether the row must outlive non-sensitive rows under capacity pressure.
 * @since v0.14.0
 */
export function fileEventRetain(ev: FileEvent): boolean {
  return ev !== null && typeof ev === 'object' && ev.sensitive === true;
}

/**
 * Append `batch` to `prev` and bring the result back under `capacity`, evicting the
 * oldest rows the predicate does NOT retain first. A retained row goes only when the
 * excess cannot be covered by non-retained rows at all, and each such loss is counted in
 * `retainedEvicted` rather than hidden. Something always goes: the result never exceeds
 * `capacity`.
 *
 * Same victim rule as ipc-batcher `push`, applied over the whole post-append array: the
 * store has the entire batch in hand where the batcher sees one push at a time, so a
 * non-retained row at the tail of the batch is taken before a retained row at the head —
 * never the other way round.
 *
 * Pure: neither input is mutated, and the same inputs give the same result.
 * @param prev - Current store contents.
 * @param batch - Rows just delivered, oldest first.
 * @param capacity - Largest number of rows the result may hold; must be at least 1.
 * @param retain - Which rows outlive the others under pressure.
 * @returns The next contents and what it cost to get there.
 * @since v0.14.0
 */
export function appendWithRetention(
  prev: readonly FileEvent[],
  batch: readonly FileEvent[],
  capacity: number,
  retain: (ev: FileEvent) => boolean,
): RetentionResult {
  const all = [...prev, ...batch];
  const excess = all.length - capacity;
  if (excess <= 0) return { next: all, evicted: 0, retainedEvicted: 0 };

  // One pass, oldest first: mark the first `excess` non-retained rows as victims. What
  // the pass could not cover comes off the retained rows, oldest first, and is counted.
  const retained = all.map((ev) => retain(ev) === true);
  const victim = new Array<boolean>(all.length).fill(false);
  let remaining = excess;
  for (let i = 0; i < all.length && remaining > 0; i += 1) {
    if (!retained[i]) {
      victim[i] = true;
      remaining -= 1;
    }
  }
  const retainedEvicted = remaining;
  for (let i = 0; i < all.length && remaining > 0; i += 1) {
    if (retained[i]) {
      victim[i] = true;
      remaining -= 1;
    }
  }

  const next: FileEvent[] = [];
  for (let i = 0; i < all.length; i += 1) {
    if (!victim[i]) next.push(all[i]);
  }
  return { next, evicted: excess, retainedEvicted };
}
