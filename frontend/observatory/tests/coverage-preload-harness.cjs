'use strict';
// Dedicated fixture host. Never import the normal application entry point.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const process = require('node:process');
const { URL } = require('node:url');
const { app, BrowserWindow, ipcMain, powerMonitor, session } = require('electron');
const input = JSON.parse(readFileSync(process.env.AEGIS_COVERAGE_INPUT, 'utf8'));
assert.equal(process.platform, 'win32', 'This dormant probe requires actual Windows');
assert.equal(process.arch, 'x64');
app.setPath('userData', join(input.scratch, 'profile'));
app.setPath('sessionData', join(input.scratch, 'session'));
app.setAppLogsPath(join(input.scratch, 'logs'));
app.commandLine.appendSwitch('disable-logging');
app.commandLine.appendSwitch('disk-cache-size', '1048576');
app.commandLine.appendSwitch('media-cache-size', '1048576');
const { createRuntime } = require(join(input.repo, 'src/main/platform/etw-file-runtime.js'));
const { createSensorRuntime } = require(join(input.repo, 'src/main/platform/sensor-runtime.js'));
const { deriveAppHealth } = require(join(input.repo, 'src/main/app-health.js'));
let runtime;
app.whenReady().then(async () => {
  const forbidden = { spawn: 0, exists: 0, rootCheck: 0, agents: 0, population: 0 };
  const refuse = (key) => () => {
    forbidden[key]++;
    throw new Error('Dormant runtime attempted ' + key);
  };
  assert.equal(app.isPackaged, false);
  // Real platform selection; no _test platform or provider/health replacement.
  const native = createSensorRuntime({ packaged: app.isPackaged });
  assert.equal(native, null);
  runtime = createRuntime({
    app,
    powerMonitor,
    argv: [],
    spawnProcess: refuse('spawn'),
    exists: refuse('exists'),
    checkRoot: refuse('rootCheck'),
    getAgents: refuse('agents'),
    getPopulationHealth: refuse('population'),
  });
  const snapshot = () => {
    // The envelope is fixture composition; only this leaf is the actual runtime health.
    const leaf = runtime.getHealth();
    return {
      appHealth: {
        ...deriveAppHealth({ bootPhase: false }),
        populationState: null,
        populationReliable: false,
        populationAsOf: null,
        identityDegraded: false,
        sensors: { byId: { [leaf.sensorId]: leaf } },
      },
      nativeSensor: native,
    };
  };
  const calls = [];
  const window = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      preload: join(input.repo, 'src/main/preload.js'),
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  const blockedRequests = [];
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const blocked = !details.url.startsWith('file:') && !details.url.startsWith('devtools:');
    if (blocked) blockedRequests.push(new URL(details.url).protocol);
    callback({ cancel: blocked });
  });
  const register = (channel, value) => {
    ipcMain.handle(channel, (event) => {
      // Fixture sender restriction. This does not exercise production authorization.
      assert.equal(event.sender, window.webContents);
      assert.equal(event.senderFrame, window.webContents.mainFrame);
      calls.push(channel);
      assert(calls.length <= 100, 'Unexpected IPC volume');
      return typeof value === 'function' ? value() : value;
    });
  };
  register('get-stats', snapshot);
  register('get-settings', { darkMode: true, uiScale: 1, animationsEnabled: false });
  register('get-resource-usage', {});
  register('get-false-positives', []);
  register('get-app-version', 'isolated-dormant-probe');
  register('get-all-permissions', { permissions: {}, instancePermissions: {} });
  register('sensitive-alerts:list', { success: true, items: [], status: 'ready' });
  global.__coveragePreload = {
    inspect: () => ({
      raw: snapshot(),
      diagnostics: runtime.getDiagnostics(),
      active: runtime.isActive(),
      forbidden,
      calls,
      blockedRequests,
      paths: {
        userData: app.getPath('userData'),
        sessionData: app.getPath('sessionData'),
        logs: app.getPath('logs'),
      },
      window: {
        visible: window.isVisible(),
        preferences: window.webContents.getLastWebPreferences(),
      },
      loaded: Object.keys(require.cache).filter((file) => file.startsWith(input.repo)),
    }),
    publish: (omitLeaf = false) => {
      const stats = snapshot();
      if (omitLeaf) stats.appHealth.sensors.byId = {};
      window.webContents.send('stats-update', stats);
    },
  };
  await window.loadFile(join(input.repo, 'dist/renderer/index.html'));
});
app.on('before-quit', () => runtime?.dispose());
app.on('window-all-closed', () => app.quit());
