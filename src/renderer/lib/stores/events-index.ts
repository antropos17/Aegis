/**
 * @file events-index.ts
 * @module renderer/stores/events-index
 * @description Pre-built events index grouped by process INSTANCE. Eliminates O(N*M)
 *   per-card flat+filter+sort by computing the grouping once when $events changes.
 * @since v0.6.0
 */

import { derived } from 'svelte/store';
import { events } from './ipc.js';
import type { FileEvent } from '../../../shared/types';

/**
 * Derived store: events grouped by `instanceId`, pre-sorted by timestamp desc, limited to
 * 50 per instance. Recomputes once on $events change instead of N times in N AgentCards.
 *
 * Keyed on the canonical `instanceId` the main process stamped, not on the pid it used to
 * bucket by: Windows recycles pids, and an event stamped before a recycle landed in the
 * new process's card (IDENTITY-RECON.md §5 C6).
 *
 * An event with no `instanceId` is quarantined — same policy, same reasons as `byInstance`
 * in stores/risk.ts: no bucket, no fallback to a name or a pid, and it stays visible in the
 * Activity feed and Timeline, which read `$events` directly.
 */
export const eventsByInstance = derived(events, ($events: FileEvent[]) => {
  const map = new Map<string, FileEvent[]>();
  for (const evt of $events) {
    // Skip by STATUS, before bucketing. Redundant with the key guard below today — an
    // unattributed event carries no instanceId either — and kept deliberately: the two
    // say different things, and the intent has to be readable and independently testable.
    if (evt.attribution?.status === 'unattributed') continue;
    const instanceId = evt.instanceId;
    if (!instanceId) continue;
    let list = map.get(instanceId);
    if (!list) {
      list = [];
      map.set(instanceId, list);
    }
    list.push(evt);
  }
  for (const [instanceId, list] of map) {
    list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    if (list.length > 50) map.set(instanceId, list.slice(0, 50));
  }
  return map;
});
