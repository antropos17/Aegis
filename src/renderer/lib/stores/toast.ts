import { writable } from 'svelte/store';
import type { Writable } from 'svelte/store';

/** Toast severity levels */
type ToastType = 'success' | 'warning' | 'error';

/** Single toast notification */
interface Toast {
  readonly id: number;
  readonly message: string;
  readonly type: ToastType;
  readonly timestamp: number;
}

const MAX_TOASTS = 3;
let _nextId = 1;
const _timers = new Map<number, ReturnType<typeof setTimeout>>();

export const toasts: Writable<Toast[]> = writable([]);

/**
 * Add a toast notification to the stack.
 * @param message - Toast message text
 * @param type - Toast severity
 * @param duration - Auto-dismiss delay in ms (0 = no auto-dismiss)
 * @returns Toast ID
 * @since v0.2.0
 */
export function addToast(message: string, type: ToastType = 'success', duration = 5000): number {
  const id = _nextId++;
  const toast: Toast = { id, message, type, timestamp: Date.now() };

  toasts.update((arr) => {
    const next = [...arr, toast];
    // Evict oldest if over max
    while (next.length > MAX_TOASTS) {
      const removed = next.shift()!;
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
 * @param id - Toast identifier
 * @since v0.2.0
 */
export function removeToast(id: number): void {
  clearToastTimer(id);
  toasts.update((arr) => arr.filter((t) => t.id !== id));
}

/** Clear auto-dismiss timer for a toast */
function clearToastTimer(id: number): void {
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
export function clearAllToasts(): void {
  for (const timer of _timers.values()) clearTimeout(timer);
  _timers.clear();
  toasts.set([]);
  _nextId = 1;
}
