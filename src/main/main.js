/**
 * @file main.js
 * @description Electron main-process orchestrator. Wires sub-modules, manages
 *   app lifecycle. Scan intervals delegated to scan-loop.js.
 * @since v0.1.0
 */
'use strict';
const { app, BrowserWindow, globalShortcut } = require('electron');
const path = require('path');

app.name = 'Aegis';
if (process.platform === 'darwin') {
  app.setName('Aegis');
  app.dock.setIcon(path.join(__dirname, '..', '..', 'assets', 'icon.png'));
}
const config = require('./config-manager');
const baselines = require('./baselines');
const anomaly = require('./anomaly-detector');
const scanner = require('./process-scanner');
const procUtil = require('./process-utils');
const watcher = require('./file-watcher');
const network = require('./network-monitor');
const exporter = require('./exports');
const analysis = require('./ai-analysis');
const tray = require('./tray-icon');
const audit = require('./audit-logger');
const logger = require('./logger');
const ipc = require('./ipc-handlers');
const scanLoop = require('./scan-loop');

let mainWindow = null;
let latestAgents = [],
  latestAiAgents = [],
  latestOtherAgents = [];
let isQuitting = false,
  monitoringPaused = false;
let latestNetConnections = [],
  otherPanelExpanded = false;
let previousAgentPids = new Map();
const fileWatchers = [];

/** @returns {Object} Process memory and CPU usage @since v0.1.0 */
function getResourceUsage() {
  const mem = process.memoryUsage(),
    cpu = process.cpuUsage();
  return {
    memMB: Math.round(mem.rss / 1024 / 1024),
    heapMB: Math.round(mem.heapUsed / 1024 / 1024),
    cpuUser: cpu.user,
    cpuSystem: cpu.system,
  };
}

/** @returns {Object} Monitoring statistics @since v0.1.0 */
function getStats() {
  const log = scanner.activityLog;
  return {
    totalFiles: log.length,
    totalSensitive: log.filter((e) => e.sensitive).length,
    aiSensitive: log.filter((e) => e.sensitive && e.category === 'ai').length,
    uptimeMs: Date.now() - scanner.monitoringStarted,
    monitoringStarted: scanner.monitoringStarted,
    peakAgents: scanner.peakAgents,
    currentAgents: latestAgents.length,
    aiAgentCount: new Set(latestAiAgents.map((a) => a.agent)).size,
    otherAgentCount: new Set(latestOtherAgents.map((a) => a.agent)).size,
    uniqueAgents: Array.from(scanner.uniqueAgentNames),
  };
}

function sendToRenderer(channel, data) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
  } catch (err) {
    logger.warn('main', 'sendToRenderer failed', { channel, error: err.message });
  }
}

// ═══ WINDOW ═══

function createWindow() {
  const settings = config.getSettings();
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Aegis',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    backgroundColor: '#050507',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src * 'unsafe-inline' 'unsafe-eval' data: blob:"],
      },
    });
  });
  const distPath = path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html');
  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5174/').catch(() => mainWindow.loadFile(distPath));
  } else {
    mainWindow.loadFile(distPath);
  }
  mainWindow.setMenuBarVisibility(false);
  if (settings.startMinimized) mainWindow.hide();
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// ═══ MODULE WIRING ═══

scanLoop.init({
  scanner, procUtil, watcher, network, baselines, anomaly, audit, tray, logger,
  sendToRenderer, getStats, getResourceUsage,
  getLatestAgents: () => latestAgents,
  setAgents: (agents) => {
    latestAgents = agents;
    latestAiAgents = agents.filter((a) => a.category === 'ai');
    latestOtherAgents = agents.filter((a) => a.category === 'other');
  },
  setLatestNetConnections: (c) => {
    latestNetConnections = c;
  },
  getPreviousPids: () => previousAgentPids,
  setPreviousPids: (m) => {
    previousAgentPids = m;
  },
});

config.init({
  knownAgentNames: scanner.AI_AGENTS.map((a) => a.name),
  applyCallback: () => {
    scanLoop.stopScanIntervals();
    if (!monitoringPaused) {
      const ms = (config.getSettings().scanIntervalSec || 10) * 1000;
      scanLoop.startScanIntervals(ms);
    }
  },
});
scanner.init({ trackSeenAgent: config.trackSeenAgent });
watcher.init({
  getCustomRules: config.getCustomSensitiveRules,
  getLatestAgents: () => latestAgents,
  getLatestAiAgents: () => latestAiAgents,
  isMonitoringPaused: () => monitoringPaused,
  activityLog: scanner.activityLog,
  knownHandles: scanner.knownHandles,
  watchers: fileWatchers,
  recordFileAccess: baselines.recordFileAccess,
  onFileEvent: (ev) => {
    const deduped = scanLoop.dedupFileEvent(ev);
    if (!deduped) return;
    sendToRenderer('file-access', [deduped]);
    if (deduped.sensitive && deduped.category === 'ai') tray.notifySensitive([deduped]);
    sendToRenderer('stats-update', getStats());
    tray.updateTrayIcon();
    scanLoop.logAuditForFile(deduped);
  },
  isOtherPanelExpanded: () => otherPanelExpanded,
});
exporter.init({
  activityLog: scanner.activityLog,
  getLatestNetConnections: () => latestNetConnections,
  monitoringStarted: scanner.monitoringStarted,
  getMainWindow: () => mainWindow,
  getStats,
});
analysis.init({
  getSettings: config.getSettings,
  activityLog: scanner.activityLog,
  getLatestAgents: () => latestAgents,
  getLatestNetConnections: () => latestNetConnections,
  getAnomalyScores: () => {
    const scores = {};
    for (const a of latestAgents) scores[a.agent] = anomaly.calculateAnomalyScore(a.agent);
    return scores;
  },
});
tray.init({
  tray: null,
  currentTrayColor: 'green',
  lastNotificationTime: 0,
  getActivityLog: () => scanner.activityLog,
  getSettings: config.getSettings,
  isMonitoringPaused: () => monitoringPaused,
  setMonitoringPaused: (v) => {
    monitoringPaused = v;
  },
  stopScanIntervals: scanLoop.stopScanIntervals,
  startScanIntervals: () => {
    const ms = (config.getSettings().scanIntervalSec || 10) * 1000;
    scanLoop.startScanIntervals(ms);
  },
  getMainWindow: () => mainWindow,
  setIsQuitting: (v) => {
    isQuitting = v;
  },
  appQuit: () => app.quit(),
  getAgentCount: () => latestAgents.length,
});
ipc.init({
  getWindow: () => mainWindow,
  getStats,
  getResourceUsage,
  setOtherPanelExpanded: (v) => {
    otherPanelExpanded = v;
  },
});

// ═══ SINGLE INSTANCE ═══

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ═══ LIFECYCLE ═══

app.whenReady().then(() => {
  if (!gotLock) return;
  const userData = app.getPath('userData');
  logger.init({ userDataPath: userData, isDev: !app.isPackaged });
  logger.info('main', 'App starting', { version: app.getVersion(), platform: process.platform });
  config.loadSettings();
  baselines.loadBaselines();
  audit.init({
    userDataPath: userData,
    onFlushError: (err) => logger.error('audit-logger', 'Flush failed', { error: err.message }),
  });
  createWindow();
  tray.createTray();
  ipc.register();
  watcher.setupFileWatchers();
  globalShortcut.register('CommandOrControl+Shift+T', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('toggle-theme');
    }
  });
  const ms = (config.getSettings().scanIntervalSec || 10) * 1000;
  scanLoop.staggeredStartup(ms, monitoringPaused);
});

app.on('before-quit', () => {
  globalShortcut.unregisterAll();
  logger.info('main', 'App quitting');
  audit.shutdown();
  baselines.finalizeSession();
  logger.shutdown();
  isQuitting = true;
  if (tray._state && tray._state.tray) {
    tray._state.tray.destroy();
    tray._state.tray = null;
  }
});
app.on('window-all-closed', () => {});
app.on('quit', () => {
  scanLoop.stopScanIntervals();
  fileWatchers.forEach((w) => w.close());
});
