// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { connectUpdates, updateStatus, updateAction } from '../../src/renderer/lib/stores/updates';

afterEach(() => {
  delete window.aegis;
});
const status = (state) => ({
  status: state,
  version: '0.15.0-alpha',
  notes: '',
  progress: 0,
  error: null,
});
describe('update state bridge', () => {
  it('does not overwrite a newer push with a delayed initial snapshot', async () => {
    let resolve;
    let push;
    const unsubscribe = vi.fn();
    window.aegis = {
      getUpdateStatus: () =>
        new Promise((r) => {
          resolve = r;
        }),
      onUpdateStatus: (cb) => {
        push = cb;
        return unsubscribe;
      },
    };
    const stop = connectUpdates();
    push(status('ready'));
    resolve(status('idle'));
    await Promise.resolve();
    expect(get(updateStatus).status).toBe('ready');
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
    push(status('error'));
    expect(get(updateStatus).status).toBe('ready');
  });
  it('only requests the action the user selected and passes no download paths', async () => {
    window.aegis = { checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), installUpdate: vi.fn() };
    await updateAction('check');
    expect(window.aegis.checkForUpdates).toHaveBeenCalledExactlyOnceWith();
    expect(window.aegis.downloadUpdate).not.toHaveBeenCalled();
    expect(window.aegis.installUpdate).not.toHaveBeenCalled();
  });
  it('keeps raw IPC exception text out of the displayed status', async () => {
    window.aegis = { installUpdate: vi.fn().mockRejectedValue(new Error('/private/local/path')) };
    await updateAction('install');
    expect(get(updateStatus).error).toBe('update-request-failed');
  });
});
