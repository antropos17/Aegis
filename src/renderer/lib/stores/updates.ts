import { writable } from 'svelte/store';
import type { UpdateStatus } from '../../../shared/types/ipc';

export const updateStatus = writable<UpdateStatus>({
  status: 'idle',
  version: null,
  notes: '',
  progress: 0,
  error: null,
});

/** Subscribe before requesting a snapshot, preserving any newer push. @returns cleanup @since 0.15.0 */
export function connectUpdates(): () => void {
  const api = window.aegis;
  if (!api?.getUpdateStatus || !api.onUpdateStatus) return () => {};
  let active = true;
  let receivedPush = false;
  const unsubscribe = api.onUpdateStatus((status) => {
    receivedPush = true;
    if (active) updateStatus.set(status);
  });
  void api
    .getUpdateStatus()
    .then((status) => {
      if (active && !receivedPush) updateStatus.set(status);
    })
    .catch(() => {});
  return () => {
    active = false;
    unsubscribe();
  };
}

/** Invoke a fixed bridge operation; event pushes own state ordering. @param action @returns completion @since 0.15.0 */
export async function updateAction(action: 'check' | 'download' | 'install'): Promise<void> {
  try {
    const api = window.aegis;
    if (!api) return;
    if (action === 'check') await api.checkForUpdates();
    else if (action === 'download') await api.downloadUpdate();
    else await api.installUpdate();
  } catch {
    updateStatus.update((status) => ({
      ...status,
      status: 'error',
      error: 'update-request-failed',
    }));
  }
}
