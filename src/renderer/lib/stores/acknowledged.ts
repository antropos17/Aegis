/**
 * @file acknowledged.ts — session-local "acknowledged agents" triage marks.
 * @module renderer/stores/acknowledged
 * @description In-memory only. Acknowledging an agent is a cheap, renderer-side
 *   triage flag ("I have seen this") — it never persists, never touches the main
 *   process, and never changes monitoring in any way. Marks are keyed by the
 *   agent's display name and live only for the current session.
 */

import { writable, get } from 'svelte/store';
import type { Writable } from 'svelte/store';

/**
 * Reactive set of acknowledged agent keys (agent display name). In-memory and
 * session-only — never serialized, never sent to the main process.
 */
export const acknowledgedAgents: Writable<Set<string>> = writable(new Set());

/**
 * Toggle the acknowledged state for an agent key. Replaces the backing Set with
 * a fresh reference so the store notifies subscribers (reactivity).
 * @param key - Agent key (display name).
 * @returns The resulting acknowledged state (true = now acknowledged).
 * @since v0.10.0-alpha
 */
export function toggleAcknowledged(key: string): boolean {
  let result = false;
  acknowledgedAgents.update((set) => {
    const next = new Set(set);
    if (next.has(key)) {
      next.delete(key);
      result = false;
    } else {
      next.add(key);
      result = true;
    }
    return next;
  });
  return result;
}

/**
 * Read whether an agent key is currently acknowledged (non-reactive snapshot).
 * Components should prefer the reactive `$acknowledgedAgents.has(key)`.
 * @param key - Agent key (display name).
 * @returns True when acknowledged.
 * @since v0.10.0-alpha
 */
export function isAcknowledged(key: string): boolean {
  return get(acknowledgedAgents).has(key);
}

/**
 * Clear all acknowledged marks (full reset; also used by tests).
 * @since v0.10.0-alpha
 */
export function clearAcknowledged(): void {
  acknowledgedAgents.set(new Set());
}
