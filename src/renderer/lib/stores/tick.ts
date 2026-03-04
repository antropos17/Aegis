/**
 * Shared 1-second tick store — replaces per-component setInterval(1000).
 * Reference-counted: interval starts on first subscriber, stops on last.
 * @module renderer/stores/tick
 */
import { writable } from 'svelte/store';

export const tick = writable(0);

let interval: ReturnType<typeof globalThis.setInterval> | null = null;
let subscribers = 0;

/**
 * Start the shared 1s tick. Returns a cleanup function.
 * Call inside `$effect(() => { return startTick(); })`.
 * @returns {() => void} unsubscribe / cleanup function
 */
export function startTick(): () => void {
  subscribers++;
  if (!interval) {
    interval = globalThis.setInterval(() => tick.update((n) => n + 1), 1000);
  }
  return () => {
    subscribers--;
    if (subscribers <= 0 && interval) {
      globalThis.clearInterval(interval);
      interval = null;
      subscribers = 0;
    }
  };
}
