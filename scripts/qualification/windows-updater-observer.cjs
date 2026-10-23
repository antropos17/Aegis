'use strict';

/**
 * Observe public discovery in the disposable guest, preserving returned objects.
 * Serialized into Electron's main process; no feed or decision is replaced.
 * @param {object} electron Electron main-process API exposed by Playwright.
 * @returns {void}
 * @since 0.20.1
 */
function installUpdaterObserver({ net, app }) {
  const evidence = { metadata: [], decisions: [], errors: [] };
  const pending = [];
  globalThis.__qualificationUpdater = evidence;
  globalThis.__qualificationUpdaterPending = pending;
  const originalFetch = net.fetch;
  net.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    if (
      args[0] !== 'https://api.github.com/repos/antropos17/Aegis/releases?per_page=30' ||
      evidence.metadata.length >= 4
    )
      return response;
    const entry = {
      url: args[0],
      status: response.status,
      at: new Date().toISOString(),
      headers: Object.fromEntries(
        ['date', 'age', 'etag', 'content-type', 'x-github-request-id'].map((name) => [
          name,
          response.headers.get(name),
        ]),
      ),
    };
    evidence.metadata.push(entry);
    // Clone consumption is independent of the application's reader. A capture
    // error is diagnostic only and cannot alter the original fetch outcome.
    const capture = async () => {
      const reader = response.clone().body.getReader();
      let size = 0;
      const chunks = [];
      const timer = setTimeout(() => reader.cancel('capture deadline'), 20000);
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 2 * 1024 * 1024) throw Error('metadata capture exceeds 2 MiB');
          chunks.push(Buffer.from(part.value));
        }
        entry.bytes = size;
        entry.body = Buffer.concat(chunks).toString('utf8');
        JSON.parse(entry.body);
      } catch (error) {
        entry.error = error.message;
        await reader.cancel().catch(() => {});
      } finally {
        clearTimeout(timer);
      }
    };
    pending.push(capture().catch((error) => (entry.error = error.message)));
    return response;
  };
  try {
    const requireFromApp = process.mainModule.require.bind(process.mainModule);
    const { SignedReleaseProvider } = requireFromApp(
      app.getAppPath() + '/src/main/update-provider.js',
    );
    const originalLatest = SignedReleaseProvider.prototype.getLatestVersion;
    SignedReleaseProvider.prototype.getLatestVersion = async function (...args) {
      const info = await originalLatest.apply(this, args);
      if (evidence.decisions.length < 20)
        evidence.decisions.push({
          stage: 'provider',
          current: this.updater.currentVersion.version,
          latest: info.version,
          verified: Boolean(info.verified),
          files: info.files.length,
          allowPrerelease: this.updater.allowPrerelease,
          allowDowngrade: this.updater.allowDowngrade,
        });
      return info;
    };
    const { NsisUpdater } = requireFromApp('electron-updater');
    const originalCheck = NsisUpdater.prototype.checkForUpdates;
    NsisUpdater.prototype.checkForUpdates = async function (...args) {
      const result = await originalCheck.apply(this, args);
      if (evidence.decisions.length < 20)
        evidence.decisions.push({
          stage: 'updater',
          current: this.currentVersion.version,
          latest: result?.updateInfo?.version,
          isUpdateAvailable: result?.isUpdateAvailable,
        });
      return result;
    };
  } catch (error) {
    evidence.errors.push(error.message);
  }
}

module.exports = { installUpdaterObserver };
