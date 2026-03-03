/**
 * @file events-index.ts
 * @module renderer/stores/events-index
 * @description Pre-built events index grouped by PID. Eliminates O(N*M) per-card
 *   flat+filter+sort by computing the grouping once when $events changes.
 * @since v0.6.0
 */

import { derived } from 'svelte/store';
import { events } from './ipc.js';

interface TimelineEvent {
  pid: number;
  timestamp: number;
  [key: string]: unknown;
}

/**
 * Derived store: events grouped by PID, pre-sorted by timestamp desc, limited to 50 per PID.
 * Recomputes once on $events change instead of N times in N AgentCards.
 */
export const eventsByPid = derived(events, ($events: TimelineEvent[][]) => {
  const map = new Map<number, TimelineEvent[]>();
  for (const batch of $events) {
    for (const evt of batch) {
      const pid = evt.pid;
      if (pid == null) continue;
      let list = map.get(pid);
      if (!list) {
        list = [];
        map.set(pid, list);
      }
      list.push(evt);
    }
  }
  for (const [pid, list] of map) {
    list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    if (list.length > 50) map.set(pid, list.slice(0, 50));
  }
  return map;
});
