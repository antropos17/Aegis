/**
 * @file main.js
 * @description Electron main-process orchestrator. Wires sub-modules, manages
 *   scan intervals, and controls app lifecycle.
 * @since v0.1.0
 */
'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');
const config   = require('./config-manager');
const baselines = require('./baselines');
const anomaly  = require('./anomaly-detector');
const scanner  = require('./process-scanner');
const procUtil = require('./process-utils');
const watcher  = require('./file-watcher');
const network  = require('./network-monitor');
const exporter = require('./exports');
const analysis = require('./ai-analysis');
const tray     = require('./tray-icon');
const audit    = require('./audit-logger');
const ipc      = require('./ipc-handlers');

let mainWindow = null, scanInterval = null, fileScanInterval = null;
let latestAgents = [], latestAiAgents = [], latestOtherAgents = [];
let isQuitting = false, monitoringPaused = false;
let latestNetConnections = [], otherPanelExpanded = false;
let previousAgentPids = new Map();
const fileWatchers = [];

/** @returns {Object} Process memory and CPU usage @since v0.1.0 */
function getResourceUsage() {
  const mem = process.memoryUsage(), cpu = process.cpuUsage();
  return { memMB: Math.round(mem.rss / 1024 / 1024), heapMB: Math.round(mem.heapUsed / 1024 / 1024), cpuUser: cpu.user, cpuSystem: cpu.system };
}

/** @returns {Object} Monitoring statistics @since v0.1.0 */
function getStats() {
  const log = scanner.activityLog;
  return {
    totalFiles: log.length,
    totalSensitive: log.filter(e => e.sensitive).length,
    aiSensitive: log.filter(e => e.sensitive && e.category === 'ai').length,
    uptimeMs: Date.now() - scanner.monitoringStarted,
    monitoringStarted: scanner.monitoringStarted,
    peakAgents: scanner.peakAgents, currentAgents: latestAgents.length,
    aiAgentCount: new Set(latestAiAgents.map(a => a.agent)).size,
    otherAgentCount: new Set(latestOtherAgents.map(a => a.agent)).size,
    uniqueAgents: Array.from(scanner.uniqueAgentNames)
  };
}

function sendToRenderer(channel, data) {
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data); } catch (_) {}
}

// ═══ WINDOW ═══

function createWindow() {
  const settings = config.getSettings();
  mainWindow = new BrowserWindow({
    width: 1200, height: 800, minWidth: 900, minHeight: 600,
    title: 'AEGIS', backgroundColor: '#050507',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders,
      'Content-Security-Policy': ["default-src * 'unsafe-inline' 'unsafe-eval' data: blob:"]
    }});
  });
  const distPath = path.join(__dirname, '..', '..', 'dist', 'renderer', 'app.html');
  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5174/app.html').catch(() => mainWindow.loadFile(distPath));
  } else {
    mainWindow.loadFile(distPath);
  }
  mainWindow.setMenuBarVisibility(false);
  if (settings.startMinimized) mainWindow.hide();
  mainWindow.on('close', (e) => { if (!isQuitting) { e.preventDefault(); mainWindow.hide(); } });
}

// ═══ SCANNING ═══

function stopScanIntervals() {
  if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
  if (fileScanInterval) { clearInterval(fileScanInterval); fileScanInterval = null; }
  if (startScanIntervals._netInterval) { clearInterval(startScanIntervals._netInterval); startScanIntervals._netInterval = null; }
}

function doNetworkScan() {
  if (network.isNetworkScanRunning() || latestAgents.length === 0) return;
  network.setNetworkScanRunning(true);
  network.scanNetworkConnections(latestAgents).then(connections => {
    latestNetConnections = connections;
    for (const conn of connections) {
      baselines.recordNetworkEndpoint(conn.agent, conn.remoteIp, conn.remotePort);
      audit.log('network-connection', { agent: conn.agent, action: conn.state,
        path: `${conn.remoteIp}:${conn.remotePort}`, severity: conn.flagged ? 'high' : 'normal',
        extra: { domain: conn.domain, flagged: conn.flagged } });
    }
    sendToRenderer('network-update', connections);
  }).catch(() => {}).finally(() => network.setNetworkScanRunning(false));
}

function logAuditForFile(ev) {
  const type = (ev.reason && ev.reason.startsWith('AI agent config')) ? 'config-access' : 'file-access';
  audit.log(type, { agent: ev.agent, action: ev.action, path: ev.file, severity: ev.sensitive ? 'sensitive' : 'normal' });
}

function startScanIntervals() {
  const ms = (config.getSettings().scanIntervalSec || 10) * 1000;
  scanInterval = setInterval(async () => {
    try {
      const result = await scanner.scanProcesses();
      latestAgents = result.agents;
      latestAiAgents = latestAgents.filter(a => a.category === 'ai');
      latestOtherAgents = latestAgents.filter(a => a.category === 'other');
      // Agent enter/exit tracking
      const curPids = new Map();
      for (const a of latestAgents) curPids.set(a.pid, a.agent);
      for (const [pid, name] of curPids) {
        if (!previousAgentPids.has(pid))
          audit.log('agent-enter', { agent: name, action: 'started', path: '', severity: 'normal', extra: { pid } });
      }
      for (const [pid, name] of previousAgentPids) {
        if (!curPids.has(pid))
          audit.log('agent-exit', { agent: name, action: 'exited', path: '', severity: 'normal', extra: { pid } });
      }
      previousAgentPids = curPids;
      watcher.pruneKnownHandles(latestAgents);
      await procUtil.enrichWithParentChains(latestAgents);
      procUtil.annotateHostApps(latestAgents);
      sendToRenderer('scan-results', latestAgents);
      sendToRenderer('stats-update', getStats());
      sendToRenderer('resource-usage', getResourceUsage());
      tray.updateTrayIcon();
      const deviations = anomaly.checkDeviations();
      if (deviations.length > 0) {
        sendToRenderer('baseline-warnings', deviations);
        for (const d of deviations)
          audit.log('anomaly-alert', { agent: d.agent, action: d.type, path: '', severity: 'high',
            extra: { message: d.message, anomalyScore: d.anomalyScore } });
      }
      const scores = {};
      for (const a of latestAgents) scores[a.agent] = anomaly.calculateAnomalyScore(a.agent);
      sendToRenderer('anomaly-scores', scores);
      if (result.changed) doNetworkScan();
    } catch (_) {}
  }, ms);
  startScanIntervals._netInterval = setInterval(doNetworkScan, 30000);
  fileScanInterval = setInterval(async () => {
    if (latestAgents.length === 0) return;
    try {
      const events = await watcher.scanAllFileHandles(latestAgents);
      if (events.length > 0) {
        sendToRenderer('file-access', events);
        tray.notifySensitive(events.filter(e => e.sensitive && e.category === 'ai'));
        for (const ev of events) logAuditForFile(ev);
      }
      sendToRenderer('stats-update', getStats());
      tray.updateTrayIcon();
    } catch (_) {}
  }, Math.max(ms * 3, 30000));
}

// ═══ MODULE WIRING ═══

config.init({ knownAgentNames: scanner.AI_AGENTS.map(a => a.name),
  applyCallback: () => { stopScanIntervals(); if (!monitoringPaused) startScanIntervals(); } });
scanner.init({ trackSeenAgent: config.trackSeenAgent });
watcher.init({
  getCustomRules: config.getCustomSensitiveRules,
  getLatestAgents: () => latestAgents, getLatestAiAgents: () => latestAiAgents,
  isMonitoringPaused: () => monitoringPaused,
  activityLog: scanner.activityLog, knownHandles: scanner.knownHandles, watchers: fileWatchers,
  recordFileAccess: baselines.recordFileAccess,
  onFileEvent: (ev) => {
    sendToRenderer('file-access', [ev]);
    if (ev.sensitive && ev.category === 'ai') tray.notifySensitive([ev]);
    sendToRenderer('stats-update', getStats());
    tray.updateTrayIcon();
    logAuditForFile(ev);
  },
  isOtherPanelExpanded: () => otherPanelExpanded
});
exporter.init({ activityLog: scanner.activityLog, getLatestNetConnections: () => latestNetConnections,
  monitoringStarted: scanner.monitoringStarted, getMainWindow: () => mainWindow, getStats });
analysis.init({ getSettings: config.getSettings, activityLog: scanner.activityLog,
  getLatestAgents: () => latestAgents, getLatestNetConnections: () => latestNetConnections,
  getAnomalyScores: () => {
    const scores = {};
    for (const a of latestAgents) scores[a.agent] = anomaly.calculateAnomalyScore(a.agent);
    return scores;
  }
});
tray.init({ tray: null, currentTrayColor: 'green', lastNotificationTime: 0,
  getActivityLog: () => scanner.activityLog, getSettings: config.getSettings,
  isMonitoringPaused: () => monitoringPaused, setMonitoringPaused: (v) => { monitoringPaused = v; },
  stopScanIntervals, startScanIntervals, getMainWindow: () => mainWindow,
  setIsQuitting: (v) => { isQuitting = v; }, appQuit: () => app.quit() });
ipc.init({ getWindow: () => mainWindow, getStats, getResourceUsage,
  setOtherPanelExpanded: (v) => { otherPanelExpanded = v; } });

// ═══ SINGLE INSTANCE ═══

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
  });
}

// ═══ LIFECYCLE ═══

app.whenReady().then(() => {
  if (!gotLock) return;
  config.loadSettings(); baselines.loadBaselines();
  audit.init({ userDataPath: app.getPath('userData') });
  createWindow(); tray.createTray(); ipc.register(); watcher.setupFileWatchers();
  // Staggered startup: process 3s → files 5s → network 8s
  setTimeout(async () => {
    try {
      const result = await scanner.scanProcesses();
      latestAgents = result.agents;
      latestAiAgents = latestAgents.filter(a => a.category === 'ai');
      latestOtherAgents = latestAgents.filter(a => a.category === 'other');
      await procUtil.enrichWithParentChains(latestAgents);
      procUtil.annotateHostApps(latestAgents);
      sendToRenderer('scan-results', latestAgents);
      sendToRenderer('stats-update', getStats());
      sendToRenderer('resource-usage', getResourceUsage());
      tray.updateTrayIcon();
    } catch (_) {}
  }, 3000);
  setTimeout(async () => {
    try {
      if (latestAgents.length === 0) return;
      const events = await watcher.scanAllFileHandles(latestAgents);
      if (events.length > 0) {
        sendToRenderer('file-access', events);
        tray.notifySensitive(events.filter(e => e.sensitive && e.category === 'ai'));
      }
      sendToRenderer('stats-update', getStats());
      tray.updateTrayIcon();
    } catch (_) {}
  }, 5000);
  setTimeout(() => { doNetworkScan(); if (!monitoringPaused) startScanIntervals(); }, 8000);
});

app.on('before-quit', () => {
  audit.shutdown(); baselines.finalizeSession(); isQuitting = true;
  if (tray._state && tray._state.tray) { tray._state.tray.destroy(); tray._state.tray = null; }
});
app.on('window-all-closed', () => {});
app.on('quit', () => { stopScanIntervals(); fileWatchers.forEach(w => w.close()); });
