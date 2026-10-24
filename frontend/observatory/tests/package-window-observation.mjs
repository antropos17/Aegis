import assert from 'node:assert/strict';
import fs from 'node:fs';

const BOOLEAN_FIELDS = Object.freeze([
  'packaged',
  'appIsPackaged',
  'archivePath',
  'diagnosticBuild',
  'windowPresent',
  'sameWindow',
  'windowStateObserved',
  'isolationRequested',
  'windowInputIsolated',
  'focusable',
  'focused',
  'visible',
  'readyToShowObserved',
  'settled',
  'timedOut',
]);

/** Runs in the actual Electron main process. Keep this function self-contained:
 * Playwright serializes it, so it cannot depend on this module's imports.
 * @param {object} electron Actual Electron module supplied by Playwright.
 * @param {object} limits Bounded event-loop polling policy.
 * @returns {Promise<object>} Actual PID and closed boolean observations.
 * @since v0.20.1
 */
export async function capturePackageWindow(electron, limits) {
  const { app, BrowserWindow } = electron;
  const { timeoutMs, pollMs } = limits;
  const observation = {
    packaged: false,
    appIsPackaged: false,
    archivePath: false,
    diagnosticBuild: false,
    windowPresent: false,
    sameWindow: false,
    windowStateObserved: false,
    isolationRequested: false,
    windowInputIsolated: false,
    focusable: false,
    focused: false,
    visible: false,
    readyToShowObserved: false,
    settled: false,
    timedOut: false,
  };
  let owned = null;
  let ready = false;
  let stable = 0;
  const onReady = () => {
    ready = true;
  };
  try {
    observation.appIsPackaged = app.isPackaged === true;
    const appPath = app.getAppPath();
    observation.archivePath = typeof appPath === 'string' && appPath.endsWith('app.asar');
    observation.packaged = observation.appIsPackaged && observation.archivePath;
    const load = process.mainModule.require('node:module').createRequire(appPath + '/package.json');
    observation.diagnosticBuild = load('./package.json').aegisEtwDiagnostic === true;
    const attempts = Math.ceil(timeoutMs / pollMs);
    for (let attempt = 0; attempt <= attempts; attempt++) {
      const windows = BrowserWindow.getAllWindows();
      if (!owned && windows.length === 1 && !windows[0].isDestroyed()) {
        owned = windows[0];
        owned.once('ready-to-show', onReady);
        try {
          owned.setIgnoreMouseEvents(true);
          owned.setFocusable(false);
          owned.blur();
          observation.isolationRequested = true;
        } catch {
          // Still sample the real focus/visibility bits; an unsuccessful request
          // cannot become an isolated-window result.
        }
      }
      observation.windowPresent = owned !== null && !owned.isDestroyed();
      observation.sameWindow = observation.windowPresent && windows.includes(owned);
      observation.windowStateObserved = false;
      if (observation.windowPresent && observation.sameWindow) {
        observation.focusable = owned.isFocusable();
        observation.focused = owned.isFocused();
        observation.visible = owned.isVisible();
        observation.windowStateObserved = true;
        observation.readyToShowObserved = ready;
        observation.windowInputIsolated =
          observation.isolationRequested && !observation.focusable && !observation.focused;
        const rendered = ready || observation.visible;
        stable = rendered && observation.windowInputIsolated ? stable + 1 : 0;
        observation.settled = stable >= 2;
        if (observation.settled || !observation.packaged || !observation.diagnosticBuild) break;
      } else {
        observation.windowInputIsolated = false;
        if (owned !== null) break; // Never substitute a newly-created window.
      }
      if (attempt === attempts) {
        observation.timedOut = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  } catch {
    // Retain the last observed booleans; an incomplete observation cannot pass.
    observation.settled = false;
  } finally {
    try {
      if (owned && !owned.isDestroyed()) owned.removeListener('ready-to-show', onReady);
    } catch {
      observation.windowStateObserved = false;
      observation.settled = false;
    }
  }
  return { mainPid: process.pid, observation };
}

/** Project only known booleans. Unknown paths, settings and exception text are excluded.
 * @param {unknown} value Main-process observation.
 * @returns {object} Detached closed flags.
 * @since v0.20.1
 */
export function projectWindowObservation(value) {
  const valid =
    value !== null &&
    typeof value === 'object' &&
    BOOLEAN_FIELDS.every((key) => typeof value[key] === 'boolean');
  return Object.freeze({
    observationValid: valid,
    ...Object.fromEntries(BOOLEAN_FIELDS.map((key) => [key, value?.[key] === true])),
  });
}

/** Retain all true package/marker/isolation gates with field-specific failures.
 * @param {object} observation Closed flags, already persisted by the caller.
 * @returns {void}
 * @since v0.20.1
 */
export function assertWindowObservation(observation) {
  for (const key of [
    'observationValid',
    'packaged',
    'diagnosticBuild',
    'windowPresent',
    'sameWindow',
    'windowStateObserved',
    'isolationRequested',
    'windowInputIsolated',
    'settled',
  ]) {
    assert.equal(observation[key], true, `Package window guard failed: ${key}`);
  }
  assert.equal(observation.timedOut, false, 'Package window guard failed: timedOut');
  assert.equal(observation.focusable, false, 'Package window guard failed: focusable');
  assert.equal(observation.focused, false, 'Package window guard failed: focused');
}

/** Observe the same real owned window, persist its flags BEFORE checking them.
 * @param {object} application Actual Playwright ElectronApplication.
 * @param {string} destination Fresh private JSON path below the owned output tree.
 * @param {object} [options] Short bounded settling policy.
 * @returns {Promise<object>} Legacy-compatible PID plus observed flags.
 * @since v0.20.1
 */
export async function observePackageWindow(application, destination, options = {}) {
  const timeoutMs = options.timeoutMs ?? 2500;
  const pollMs = options.pollMs ?? 50;
  assert(Number.isInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 5000);
  assert(Number.isInteger(pollMs) && pollMs >= 10 && pollMs <= 100 && timeoutMs / pollMs <= 100);
  let timer;
  const raw = await Promise.race([
    application.evaluate(capturePackageWindow, { timeoutMs, pollMs }).catch(() => null),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs + 2000);
    }),
  ]).finally(() => clearTimeout(timer));
  const observation = projectWindowObservation(raw?.observation);
  fs.writeFileSync(destination, JSON.stringify(observation) + '\n', { flag: 'wx', mode: 0o600 });
  assertWindowObservation(observation);
  assert(Number.isSafeInteger(raw.mainPid) && raw.mainPid > 0, 'Package window PID unavailable');
  return { mainPid: raw.mainPid, ...observation };
}
