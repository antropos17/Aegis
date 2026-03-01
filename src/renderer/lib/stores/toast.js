import { writable } from 'svelte/store';

const MAX_TOASTS = 3;
let _nextId = 1;
const _timers = new Map();

export const toasts = writable([]);

/**
 * Add a toast notification to the stack.
 * @param {string} message - Toast message text
 * @param {'success'|'warning'|'error'} [type='success'] - Toast severity
 * @param {number} [duration=5000] - Auto-dismiss delay in ms (0 = no auto-dismiss)
 * @returns {number} Toast ID
 * @since v0.2.0
 */
export function addToast(message, type = 'success', duration = 5000) {
  const id = _nextId++;
  const toast = { id, message, type, timestamp: Date.now() };

  toasts.update((arr) => {
    const next = [...arr, toast];
    // Evict oldest if over max
    while (next.length > MAX_TOASTS) {
      const removed = next.shift();
      clearToastTimer(removed.id);
    }
    return next;
  });

  if (duration > 0) {
    const timer = setTimeout(() => removeToast(id), duration);
    _timers.set(id, timer);
  }

  return id;
}

/**
 * Remove a toast by ID.
 * @param {number} id
 * @since v0.2.0
 */
export function removeToast(id) {
  clearToastTimer(id);
  toasts.update((arr) => arr.filter((t) => t.id !== id));
}

/** @param {number} id */
function clearToastTimer(id) {
  const timer = _timers.get(id);
  if (timer) {
    clearTimeout(timer);
    _timers.delete(id);
  }
}

/**
 * Clear all toasts (used for testing).
 * @since v0.2.0
 */
export function clearAllToasts() {
  for (const timer of _timers.values()) clearTimeout(timer);
  _timers.clear();
  toasts.set([]);
  _nextId = 1;
}
