import { writable } from 'svelte/store';
import type { Writable } from 'svelte/store';

/** A pending request to stop (terminate) a monitored process, awaiting confirmation. */
export interface PendingStop {
  readonly pid: number;
  readonly name: string;
}

/**
 * The stop-process confirmation currently awaiting the user, or `null` when no
 * dialog is open. Stopping a process is destructive (`taskkill /F` on Windows),
 * so every UI entry point routes through this single gate. This store holds
 * intent only — the owning component performs the IPC call on confirm.
 * @since v0.10.0-alpha
 */
export const pendingStop: Writable<PendingStop | null> = writable(null);

/**
 * Open the stop-process confirmation for a specific PID.
 * @param pid - OS process ID to stop
 * @param name - Display name shown in the confirmation dialog
 * @since v0.10.0-alpha
 */
export function requestStop(pid: number, name: string): void {
  pendingStop.set({ pid, name });
}

/**
 * Dismiss the pending stop-process confirmation without acting.
 * @since v0.10.0-alpha
 */
export function clearStop(): void {
  pendingStop.set(null);
}
