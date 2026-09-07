import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import updates from '../../src/main/app-updates.js';

const roots = [];
const managers = [];
afterEach(() => {
  managers.splice(0).forEach((m) => m.dispose());
  roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
  vi.useRealTimers();
});
function setup(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-updater-'));
  roots.push(root);
  const file = path.join(root, 'setup.exe');
  const data = Buffer.from('verified fixture');
  fs.writeFileSync(file, data);
  const verified = {
    version: '0.15.0-alpha',
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
    bytes: data.length,
  };
  const cancel = vi.fn();
  const updater = new EventEmitter();
  updater.installerPath = file;
  updater.checkForUpdates = vi.fn(async () => ({
    isUpdateAvailable: true,
    updateInfo: { verified, releaseNotes: 'Notes' },
    cancellationToken: { cancel },
  }));
  updater.downloadUpdate = vi.fn(async () => [file]);
  updater.quitAndInstall = vi.fn();
  const settings = { automaticUpdatesEnabled: false };
  const deps = {
    supported: true,
    createUpdater: vi.fn(() => updater),
    getSettings: () => settings,
    onChange: vi.fn(),
    confirmInstall: vi.fn(async () => true),
    prepareQuit: vi.fn(),
    ...overrides,
  };
  const manager = updates.createUpdateManager(deps);
  managers.push(manager);
  return { manager, updater, deps, settings, file, cancel };
}
describe('update consent and installation', () => {
  it.each([false, undefined, 'true'])(
    'does not check automatically without boolean consent (%s)',
    async (enabled) => {
      vi.useFakeTimers();
      const { manager, updater, settings } = setup();
      settings.automaticUpdatesEnabled = enabled;
      manager.schedule();
      await vi.advanceTimersByTimeAsync(31000);
      await manager.check(true);
      expect(updater.checkForUpdates).not.toHaveBeenCalled();
    },
  );
  it('does nothing on unsupported builds', async () => {
    const { manager, deps } = setup({ supported: false });
    await manager.check();
    await manager.download();
    await manager.install();
    expect(manager.snapshot().status).toBe('unsupported');
    expect(deps.createUpdater).not.toHaveBeenCalled();
  });
  it('checks after 30 seconds and six hours, then stops scheduling on opt-out', async () => {
    vi.useFakeTimers();
    const { manager, updater, settings } = setup();
    settings.automaticUpdatesEnabled = true;
    updater.checkForUpdates.mockResolvedValue({ isUpdateAvailable: false });
    manager.schedule();
    await vi.advanceTimersByTimeAsync(29999);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    settings.automaticUpdatesEnabled = false;
    manager.preferencesChanged();
    await vi.advanceTimersByTimeAsync(7 * 60 * 60 * 1000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });
  it('manual checking does not download; startup opt-in downloads but never installs', async () => {
    const { manager, updater, settings } = setup();
    await manager.check();
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    settings.automaticUpdatesEnabled = true;
    await manager.check(true);
    expect(manager.snapshot().status).toBe('ready');
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.autoDownload).toBe(false);
  });
  it('requires a verified download and native confirmation before restart', async () => {
    const { manager, updater, deps } = setup();
    await manager.install();
    expect(deps.confirmInstall).not.toHaveBeenCalled();
    await manager.check();
    await manager.download();
    deps.confirmInstall.mockResolvedValueOnce(false);
    await manager.install();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(manager.snapshot().status).toBe('ready');
    await manager.install();
    expect(updater.quitAndInstall).toHaveBeenCalledExactlyOnceWith(true, true);
    expect(deps.prepareQuit).toHaveBeenCalledOnce();
  });
  it('rejects a corrupt downloaded file and never offers installation', async () => {
    const { manager, updater, file } = setup();
    await manager.check();
    fs.writeFileSync(file, 'tampered');
    await manager.download();
    await manager.install();
    expect(manager.snapshot().status).toBe('error');
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(JSON.stringify(manager.snapshot())).not.toContain(file);
  });
  it('rechecks the installer after confirmation to catch cached-file replacement', async () => {
    const { manager, updater, deps, file } = setup();
    await manager.check();
    await manager.download();
    deps.confirmInstall.mockImplementation(async () => {
      fs.writeFileSync(file, 'tampered');
      return true;
    });
    await manager.install();
    expect(manager.snapshot().status).toBe('error');
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });
  it('coalesces concurrent checks and installations', async () => {
    const { manager, updater, deps } = setup();
    let resolve;
    updater.checkForUpdates.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const first = manager.check();
    await manager.check();
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    resolve({ isUpdateAvailable: false });
    await first;
    await manager.check();
    await manager.download();
    let confirm;
    deps.confirmInstall.mockImplementation(
      () =>
        new Promise((r) => {
          confirm = r;
        }),
    );
    const install = manager.install();
    await manager.install();
    confirm(true);
    await install;
    expect(updater.quitAndInstall).toHaveBeenCalledOnce();
  });
  it('retries after network failure without exposing the raw error', async () => {
    const { manager, updater } = setup();
    updater.checkForUpdates.mockRejectedValueOnce(new Error('secret path /private'));
    await manager.check();
    expect(manager.snapshot().error).toBe('update-check-failed');
    await manager.check();
    expect(manager.snapshot().status).toBe('available');
  });
  it('stops automatic downloading if consent is withdrawn during checking', async () => {
    const { manager, updater, settings } = setup();
    settings.automaticUpdatesEnabled = true;
    const original = updater.checkForUpdates.getMockImplementation();
    updater.checkForUpdates.mockImplementation(async () => {
      settings.automaticUpdatesEnabled = false;
      return original();
    });
    await manager.check(true);
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });
  it('cancels download on opt-out and ignores late state after disposal', async () => {
    const { manager, updater, cancel, deps } = setup();
    await manager.check();
    let resolve;
    updater.downloadUpdate.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const downloading = manager.download();
    manager.preferencesChanged();
    expect(cancel).toHaveBeenCalled();
    manager.dispose();
    deps.onChange.mockClear();
    resolve([updater.installerPath]);
    await downloading;
    expect(deps.onChange).not.toHaveBeenCalled();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });
  it('recovers the quit flag if launching the installer throws', async () => {
    const { manager, updater, deps } = setup();
    await manager.check();
    await manager.download();
    updater.quitAndInstall.mockImplementation(() => {
      throw new Error('launch failed');
    });
    await manager.install();
    expect(manager.snapshot().error).toBe('update-install-failed');
    expect(deps.prepareQuit).toHaveBeenLastCalledWith(false);
  });
  it('reports asynchronous installer launch failure', async () => {
    const { manager, updater, deps } = setup();
    await manager.check();
    await manager.download();
    await manager.install();
    updater.emit('error', new Error('private details'));
    expect(manager.snapshot().error).toBe('update-install-failed');
    expect(deps.prepareQuit).toHaveBeenLastCalledWith(false);
  });
});
