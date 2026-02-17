/**
 * @file main.js
 * @module main/main
 * @description Electron main-process orchestrator. Wires sub-modules, registers
 *   IPC handlers, manages scan intervals, and controls app lifecycle.
 * @requires electron
 * @requires path
 * @requires fs
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.1.0
 */
'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const cfg = require('./config-manager');
const bl  = require('./baselines');
const sc  = require('./process-scanner');
const fw  = require('./file-watcher');
const net = require('./network-monitor');
const exp = require('./exports');
const ai  = require('./ai-analysis');
const ti  = require('./tray-icon');

let mainWindow = null, scanInterval = null, fileScanInterval = null;
let latestAgents = [], latestAiAgents = [], latestOtherAgents = [];
let isQuitting = false, monitoringPaused = false;
const watchers = [];
let latestNetConnections = [], otherPanelExpanded = false;

/** @returns {Object} @since v0.1.0 */
function getResourceUsage() { const m = process.memoryUsage(), c = process.cpuUsage(); return { memMB: Math.round(m.rss/1024/1024), heapMB: Math.round(m.heapUsed/1024/1024), cpuUser: c.user, cpuSystem: c.system }; }

/** @returns {Object} @since v0.1.0 */
function getStats() {
  const l = sc.activityLog, ts = l.filter(e => e.sensitive).length;
  const uniqueAi = new Set(latestAiAgents.map(a => a.agent)).size;
  const uniqueOther = new Set(latestOtherAgents.map(a => a.agent)).size;
  return { totalFiles: l.length, totalSensitive: ts, aiSensitive: l.filter(e => e.sensitive && e.category === 'ai').length, uptimeMs: Date.now() - sc.monitoringStarted, monitoringStarted: sc.monitoringStarted, peakAgents: sc.peakAgents, currentAgents: latestAgents.length, aiAgentCount: uniqueAi, otherAgentCount: uniqueOther, uniqueAgents: Array.from(sc.uniqueAgentNames) };
}

/** @returns {void} @since v0.1.0 */
function createWindow() {
  const s = cfg.getSettings();
  mainWindow = new BrowserWindow({ width: 1050, height: 800, title: 'AEGIS', backgroundColor: '#0a0e17', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);
  if (s.startMinimized) mainWindow.hide();
  mainWindow.on('close', (e) => { if (!isQuitting) { e.preventDefault(); mainWindow.hide(); } });
}

/** @returns {void} @since v0.1.0 */
function stopScanIntervals() {
  if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
  if (fileScanInterval) { clearInterval(fileScanInterval); fileScanInterval = null; }
  if (startScanIntervals._nr) { clearInterval(startScanIntervals._nr); startScanIntervals._nr = null; }
}

function sendToWin(ch, data) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ch, data); }
function doNetScan() {
  if (net.isNetworkScanRunning() || latestAgents.length === 0) return;
  net.setNetworkScanRunning(true);
  net.scanNetworkConnections(latestAgents).then(c => { latestNetConnections = c; for (const x of c) bl.recordNetworkEndpoint(x.agent, x.remoteIp, x.remotePort); sendToWin('network-update', c); }).catch(() => {}).finally(() => net.setNetworkScanRunning(false));
}

/** @returns {void} @since v0.1.0 */
function startScanIntervals() {
  const ms = (cfg.getSettings().scanIntervalSec || 10) * 1000;
  scanInterval = setInterval(async () => {
    try {
      const r = await sc.scanProcesses(); latestAgents = r.agents; latestAiAgents = latestAgents.filter(a => a.category === 'ai'); latestOtherAgents = latestAgents.filter(a => a.category === 'other');
      fw.pruneKnownHandles(latestAgents); await sc.enrichWithParentChains(latestAgents); sc.annotateHostApps(latestAgents);
      sendToWin('scan-results', latestAgents); sendToWin('stats-update', getStats()); sendToWin('resource-usage', getResourceUsage()); ti.updateTrayIcon();
      const d = bl.checkDeviations(); if (d.length > 0) sendToWin('baseline-warnings', d);
      const anomalyScores = {}; for (const a of latestAgents) anomalyScores[a.agent] = bl.calculateAnomalyScore(a.agent); sendToWin('anomaly-scores', anomalyScores);
      if (r.changed) doNetScan();
    } catch (_) {}
  }, ms);
  startScanIntervals._nr = setInterval(doNetScan, 30000);
  fileScanInterval = setInterval(async () => {
    if (latestAgents.length === 0) return;
    try { const ev = await fw.scanAllFileHandles(latestAgents); if (ev.length > 0) { sendToWin('file-access', ev); ti.notifySensitive(ev.filter(e => e.sensitive && e.category === 'ai')); } sendToWin('stats-update', getStats()); ti.updateTrayIcon(); } catch (_) {}
  }, Math.max(ms * 3, 30000));
}

// ── Module wiring ──
cfg.init({ knownAgentNames: sc.AI_AGENTS.map(a => a.name), applyCallback: () => { stopScanIntervals(); if (!monitoringPaused) startScanIntervals(); } });
sc.init({ trackSeenAgent: cfg.trackSeenAgent });
fw.init({ getCustomRules: cfg.getCustomSensitiveRules, getLatestAgents: () => latestAgents, getLatestAiAgents: () => latestAiAgents, isMonitoringPaused: () => monitoringPaused, activityLog: sc.activityLog, knownHandles: sc.knownHandles, watchers, recordFileAccess: bl.recordFileAccess, onFileEvent: (ev) => { sendToWin('file-access', [ev]); if (ev.sensitive && ev.category === 'ai') ti.notifySensitive([ev]); sendToWin('stats-update', getStats()); ti.updateTrayIcon(); }, isOtherPanelExpanded: () => otherPanelExpanded });
exp.init({ activityLog: sc.activityLog, getLatestNetConnections: () => latestNetConnections, monitoringStarted: sc.monitoringStarted, getMainWindow: () => mainWindow, getStats });
ai.init({ getSettings: cfg.getSettings, activityLog: sc.activityLog, getLatestAgents: () => latestAgents, getLatestNetConnections: () => latestNetConnections });
ti.init({ tray: null, currentTrayColor: 'green', lastNotificationTime: 0, getActivityLog: () => sc.activityLog, getSettings: cfg.getSettings, isMonitoringPaused: () => monitoringPaused, setMonitoringPaused: (v) => { monitoringPaused = v; }, stopScanIntervals, startScanIntervals, getMainWindow: () => mainWindow, setIsQuitting: (v) => { isQuitting = v; }, appQuit: () => app.quit() });

/** @returns {void} @since v0.1.0 */
function registerIpc() {
  ipcMain.handle('scan-processes', async () => { const r = await sc.scanProcesses(); await sc.enrichWithParentChains(r.agents); sc.annotateHostApps(r.agents); return r.agents; });
  ipcMain.handle('get-stats', () => getStats());
  ipcMain.handle('get-resource-usage', () => getResourceUsage());
  ipcMain.handle('export-log', () => exp.exportLog());
  ipcMain.handle('export-csv', () => exp.exportCsv());
  ipcMain.handle('generate-report', () => exp.generateReport());
  ipcMain.handle('get-settings', () => ({ ...cfg.getSettings() }));
  ipcMain.handle('save-settings', (_e, ns) => { cfg.saveSettings(ns); cfg.applySettings(); return { success: true }; });
  ipcMain.on('other-panel-expanded', (_e, v) => { otherPanelExpanded = v; });
  ipcMain.handle('analyze-agent', async (_e, n) => !cfg.getSettings().anthropicApiKey ? { success: false, error: 'Set your Anthropic API key in Settings' } : ai.analyzeAgentActivity(n));
  ipcMain.handle('get-agent-baseline', (_e, n) => { const b = bl.getBaselines().agents[n], sd = bl.getSessionData()[n]; return { sessionCount: b ? b.sessionCount : 0, averages: b ? b.averages : { filesPerSession: 0, sensitivePerSession: 0, typicalDirectories: [], knownEndpoints: [] }, currentSession: sd ? { totalFiles: sd.files.size, sensitiveCount: sd.sensitiveCount, directoryCount: sd.directories.size, endpointCount: sd.endpoints.size } : { totalFiles: 0, sensitiveCount: 0, directoryCount: 0, endpointCount: 0 } }; });
  ipcMain.handle('get-all-permissions', () => { const s = cfg.getSettings(); return { permissions: s.agentPermissions, seenAgents: s.seenAgents }; });
  ipcMain.handle('get-agent-permissions', (_e, n) => cfg.getAgentPermissions(n));
  ipcMain.handle('save-agent-permissions', (_e, pm) => { cfg.getSettings().agentPermissions = pm; try { fs.writeFileSync(cfg.SETTINGS_PATH, JSON.stringify(cfg.getSettings(), null, 2)); } catch (_) {} return { success: true }; });
  ipcMain.handle('reset-permissions-to-defaults', () => { const s = cfg.getSettings(), np = {}; for (const a of s.seenAgents) np[a] = cfg.getDefaultPermissions(a); s.agentPermissions = np; try { fs.writeFileSync(cfg.SETTINGS_PATH, JSON.stringify(s, null, 2)); } catch (_) {} return { permissions: np, seenAgents: s.seenAgents }; });
  ipcMain.handle('capture-screenshot', async () => { if (!mainWindow) return { success: false }; const img = await mainWindow.webContents.capturePage(); const p = path.join(__dirname, '..', '..', 'screenshot_electron.png'); fs.writeFileSync(p, img.toPNG()); return { success: true, path: p, width: img.getSize().width, height: img.getSize().height }; });
  ipcMain.handle('get-agent-database', () => sc.agentDb);
  ipcMain.handle('get-project-dir', () => path.join(__dirname, '..', '..'));
  ipcMain.handle('get-custom-agents', () => cfg.getCustomAgents());
  ipcMain.handle('save-custom-agents', (_e, agents) => { cfg.saveCustomAgents(agents); return { success: true }; });
  ipcMain.handle('export-agent-database', async () => {
    const { dialog } = require('electron');
    const merged = { ...sc.agentDb, customAgents: cfg.getCustomAgents() };
    const { filePath } = await dialog.showSaveDialog(mainWindow, { title: 'Export Agent Database', defaultPath: 'aegis-agents.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!filePath) return { success: false };
    fs.writeFileSync(filePath, JSON.stringify(merged, null, 2));
    return { success: true, path: filePath };
  });
  ipcMain.handle('import-agent-database', async () => {
    const { dialog } = require('electron');
    const { filePaths } = await dialog.showOpenDialog(mainWindow, { title: 'Import Agent Database', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
    if (!filePaths || filePaths.length === 0) return { success: false };
    try {
      const raw = JSON.parse(fs.readFileSync(filePaths[0], 'utf-8'));
      const imported = raw.customAgents || raw.agents || [];
      return { success: true, agents: imported };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // ── Process control IPC handlers ──
  ipcMain.handle('kill-process', (_e, pid) => {
    return new Promise((resolve) => {
      execFile('taskkill', ['/PID', String(pid), '/F'], (err) => {
        if (err) resolve({ success: false, error: err.message });
        else resolve({ success: true });
      });
    });
  });

  ipcMain.handle('suspend-process', (_e, pid) => {
    const psScript = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class Ntdll{[DllImport("ntdll.dll")]public static extern int NtSuspendProcess(IntPtr h);}' -PassThru | Out-Null;$h=(Get-Process -Id ${Number(pid)}).Handle;[Ntdll]::NtSuspendProcess($h)`;
    return new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], { timeout: 5000 }, (err) => {
        if (err) resolve({ success: false, error: err.message });
        else resolve({ success: true });
      });
    });
  });

  ipcMain.handle('resume-process', (_e, pid) => {
    const psScript = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class Ntdll2{[DllImport("ntdll.dll")]public static extern int NtResumeProcess(IntPtr h);}' -PassThru | Out-Null;$h=(Get-Process -Id ${Number(pid)}).Handle;[Ntdll2]::NtResumeProcess($h)`;
    return new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], { timeout: 5000 }, (err) => {
        if (err) resolve({ success: false, error: err.message });
        else resolve({ success: true });
      });
    });
  });
}

// ── Single instance lock ──
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); } else { app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } }); }

// ── Lifecycle ──
app.whenReady().then(() => {
  if (!gotLock) return;
  cfg.loadSettings(); bl.loadBaselines(); createWindow(); ti.createTray(); registerIpc(); fw.setupFileWatchers();
  setTimeout(async () => { try { const r = await sc.scanProcesses(); latestAgents = r.agents; latestAiAgents = latestAgents.filter(a => a.category === 'ai'); latestOtherAgents = latestAgents.filter(a => a.category === 'other'); await sc.enrichWithParentChains(latestAgents); sc.annotateHostApps(latestAgents); sendToWin('scan-results', latestAgents); sendToWin('stats-update', getStats()); sendToWin('resource-usage', getResourceUsage()); ti.updateTrayIcon(); } catch (_) {} }, 3000);
  setTimeout(async () => { try { if (latestAgents.length > 0) { const ev = await fw.scanAllFileHandles(latestAgents); if (ev.length > 0) { sendToWin('file-access', ev); ti.notifySensitive(ev.filter(e => e.sensitive && e.category === 'ai')); } sendToWin('stats-update', getStats()); ti.updateTrayIcon(); } } catch (_) {} }, 5000);
  setTimeout(() => { doNetScan(); if (!monitoringPaused) startScanIntervals(); }, 8000);
});
app.on('before-quit', () => { bl.finalizeSession(); isQuitting = true; if (ti._state && ti._state.tray) { ti._state.tray.destroy(); ti._state.tray = null; } });
app.on('window-all-closed', () => {});
app.on('quit', () => { stopScanIntervals(); watchers.forEach(w => w.close()); });
