/** @file Consent-driven update lifecycle; only verified installers become installable. @since 0.15.0 */
'use strict';
const { verifyInstaller } = require('./update-verification');

/** Create an isolated lifecycle with injected Electron boundaries. @param {object} deps @returns {object} @since 0.15.0 */
function createUpdateManager(deps) {
  let updater;
  let selected;
  let downloadedFile;
  let cancellation;
  let timer;
  let busy = false;
  let disposed = false;
  let state = {
    status: deps.supported ? 'idle' : 'unsupported',
    version: null,
    notes: '',
    progress: 0,
    error: null,
  };
  const verify = deps.verifyInstaller || verifyInstaller;
  function snapshot() {
    return { ...state };
  }
  function set(patch) {
    if (disposed) return;
    state = { ...state, ...patch };
    deps.onChange?.(snapshot());
  }
  function instance() {
    if (!updater) {
      updater = deps.createUpdater();
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      updater.allowDowngrade = false;
      updater.disableDifferentialDownload = true;
      updater.disableWebInstaller = true;
      updater.logger = null;
      updater.on('error', () => {
        // Check/download failures also reject their promises. Installation may fail
        // asynchronously after quitAndInstall returned, so report that path here.
        if (state.status === 'installing') {
          deps.prepareQuit(false);
          set({ status: 'error', error: 'update-install-failed' });
        }
      });
      updater.on('download-progress', (progress) => {
        if (state.status === 'downloading')
          set({ progress: Math.max(0, Math.min(100, Number(progress.percent) || 0)) });
      });
    }
    return updater;
  }
  async function check(automatic = false) {
    if (disposed || !deps.supported || busy || ['ready', 'installing'].includes(state.status))
      return snapshot();
    if (automatic && deps.getSettings().automaticUpdatesEnabled !== true) return snapshot();
    busy = true;
    selected = null;
    downloadedFile = null;
    set({ status: 'checking', error: null, version: null, notes: '', progress: 0 });
    try {
      const result = await instance().checkForUpdates();
      if (disposed) return snapshot();
      if (!result) throw new Error('update-check-unavailable');
      cancellation = result.cancellationToken;
      if (result.isUpdateAvailable) {
        if (!result.updateInfo.verified) throw new Error('update-unverified');
        selected = result.updateInfo.verified;
        set({
          status: 'available',
          version: selected.version,
          notes: result.updateInfo.releaseNotes || '',
        });
      } else set({ status: 'up-to-date' });
    } catch {
      set({ status: 'error', error: 'update-check-failed' });
    } finally {
      busy = false;
    }
    if (
      automatic &&
      state.status === 'available' &&
      deps.getSettings().automaticUpdatesEnabled === true
    )
      await download();
    return snapshot();
  }
  async function download() {
    if (disposed || busy || state.status !== 'available' || !selected) return snapshot();
    busy = true;
    set({ status: 'downloading', progress: 0, error: null });
    const timeout = setTimeout(() => cancellation?.cancel(), 15 * 60 * 1000);
    try {
      const files = await instance().downloadUpdate(cancellation);
      if (disposed) return snapshot();
      if (files.length !== 1 || files[0] !== updater.installerPath)
        throw new Error('update-file-invalid');
      await verify(files[0], selected);
      downloadedFile = files[0];
      set({ status: 'ready', progress: 100 });
    } catch {
      downloadedFile = null;
      selected = null;
      set({ status: 'error', error: 'update-download-failed' });
    } finally {
      clearTimeout(timeout);
      busy = false;
    }
    return snapshot();
  }
  async function install() {
    if (disposed || busy || state.status !== 'ready' || !selected || !downloadedFile)
      return snapshot();
    busy = true;
    try {
      if (!(await deps.confirmInstall(state.version))) return snapshot();
      if (disposed || downloadedFile !== updater.installerPath)
        throw new Error('update-file-invalid');
      await verify(downloadedFile, selected);
      if (disposed) return snapshot();
      set({ status: 'installing', error: null });
      deps.prepareQuit();
      // v6.8.9 positional API: silent installer, then relaunch the application.
      updater.quitAndInstall(true, true);
    } catch {
      if (state.status === 'installing') deps.prepareQuit(false);
      set({ status: 'error', error: 'update-install-failed' });
    } finally {
      busy = false;
    }
    return snapshot();
  }
  function schedule(delay = 30000) {
    clearTimeout(timer);
    if (disposed || !deps.supported || deps.getSettings().automaticUpdatesEnabled !== true) return;
    timer = setTimeout(async () => {
      await check(true);
      schedule(6 * 60 * 60 * 1000);
    }, delay);
    timer.unref?.();
  }
  function preferencesChanged() {
    if (deps.getSettings().automaticUpdatesEnabled !== true) cancellation?.cancel();
    schedule();
  }
  function dispose() {
    disposed = true;
    clearTimeout(timer);
    cancellation?.cancel();
  }
  return { snapshot, check, download, install, schedule, preferencesChanged, dispose };
}

module.exports = { createUpdateManager };
