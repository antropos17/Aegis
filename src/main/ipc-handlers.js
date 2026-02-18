/**
 * @file ipc-handlers.js
 * @description All IPC handlers for renderer ↔ main communication.
 * @since v0.1.0
 */
'use strict';
const { ipcMain, app, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const config = require('./config-manager');
const scanner = require('./process-scanner');
const procUtil = require('./process-utils');
const baselines = require('./baselines');
const analysis = require('./ai-analysis');
const exporter = require('./exports');
const audit = require('./audit-logger');

let deps = {};

/**
 * @param {Object} injected — { getWindow, getStats, getResourceUsage, setOtherPanelExpanded }
 * @since v0.1.0
 */
function init(injected) { deps = injected; }

/** @returns {void} @since v0.1.0 */
function register() {
  ipcMain.handle('scan-processes', async () => {
    const result = await scanner.scanProcesses();
    await procUtil.enrichWithParentChains(result.agents);
    procUtil.annotateHostApps(result.agents);
    return result.agents;
  });

  ipcMain.handle('get-stats', () => deps.getStats());
  ipcMain.handle('get-resource-usage', () => deps.getResourceUsage());
  ipcMain.handle('export-log', () => exporter.exportLog());
  ipcMain.handle('export-csv', () => exporter.exportCsv());
  ipcMain.handle('generate-report', () => exporter.generateReport());
  ipcMain.handle('get-settings', () => ({ ...config.getSettings() }));

  ipcMain.handle('save-settings', (_e, newSettings) => {
    config.saveSettings(newSettings);
    config.applySettings();
    return { success: true };
  });

  ipcMain.on('other-panel-expanded', (_e, val) => deps.setOtherPanelExpanded(val));

  ipcMain.handle('analyze-agent', async (_e, name) => {
    if (!config.getSettings().anthropicApiKey) {
      return { success: false, error: 'Set your Anthropic API key in Settings' };
    }
    return analysis.analyzeAgentActivity(name);
  });

  ipcMain.handle('analyze-session', async () => {
    if (!config.getSettings().anthropicApiKey) {
      return { success: false, error: 'Set your Anthropic API key in Settings' };
    }
    return analysis.analyzeSessionActivity();
  });

  ipcMain.handle('open-threat-report', async (_e, html) => {
    const fp = path.join(app.getPath('temp'), `aegis-threat-report-${Date.now()}.html`);
    fs.writeFileSync(fp, html);
    shell.openExternal('file://' + fp.replace(/\\/g, '/'));
    return { success: true, path: fp };
  });

  ipcMain.handle('get-agent-baseline', (_e, name) => {
    const bl = baselines.getBaselines().agents[name];
    const session = baselines.getSessionData()[name];
    return {
      sessionCount: bl ? bl.sessionCount : 0,
      averages: bl ? bl.averages : {
        filesPerSession: 0, sensitivePerSession: 0,
        typicalDirectories: [], knownEndpoints: []
      },
      currentSession: session ? {
        totalFiles: session.files.size, sensitiveCount: session.sensitiveCount,
        directoryCount: session.directories.size, endpointCount: session.endpoints.size
      } : { totalFiles: 0, sensitiveCount: 0, directoryCount: 0, endpointCount: 0 }
    };
  });

  ipcMain.handle('get-all-permissions', () => {
    const settings = config.getSettings();
    return { permissions: settings.agentPermissions, seenAgents: settings.seenAgents };
  });

  ipcMain.handle('get-agent-permissions', (_e, name) => config.getAgentPermissions(name));

  ipcMain.handle('save-agent-permissions', (_e, permMap) => {
    config.getSettings().agentPermissions = permMap;
    try { fs.writeFileSync(config.SETTINGS_PATH, JSON.stringify(config.getSettings(), null, 2)); } catch (_) {}
    return { success: true };
  });

  ipcMain.handle('reset-permissions-to-defaults', () => {
    const settings = config.getSettings();
    const newPerms = {};
    for (const agent of settings.seenAgents) newPerms[agent] = config.getDefaultPermissions(agent);
    settings.agentPermissions = newPerms;
    try { fs.writeFileSync(config.SETTINGS_PATH, JSON.stringify(settings, null, 2)); } catch (_) {}
    return { permissions: newPerms, seenAgents: settings.seenAgents };
  });

  ipcMain.handle('capture-screenshot', async () => {
    const win = deps.getWindow();
    if (!win) return { success: false };
    const img = await win.webContents.capturePage();
    const fp = path.join(__dirname, '..', '..', 'screenshot_electron.png');
    fs.writeFileSync(fp, img.toPNG());
    return { success: true, path: fp, width: img.getSize().width, height: img.getSize().height };
  });

  ipcMain.handle('get-agent-database', () => scanner.agentDb);
  ipcMain.handle('get-project-dir', () => path.join(__dirname, '..', '..'));
  ipcMain.handle('get-custom-agents', () => config.getCustomAgents());
  ipcMain.handle('save-custom-agents', (_e, agents) => { config.saveCustomAgents(agents); return { success: true }; });

  ipcMain.handle('export-agent-database', async () => {
    const merged = { ...scanner.agentDb, customAgents: config.getCustomAgents() };
    const { filePath } = await dialog.showSaveDialog(deps.getWindow(), {
      title: 'Export Agent Database', defaultPath: 'aegis-agents.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (!filePath) return { success: false };
    fs.writeFileSync(filePath, JSON.stringify(merged, null, 2));
    return { success: true, path: filePath };
  });

  ipcMain.handle('import-agent-database', async () => {
    const { filePaths } = await dialog.showOpenDialog(deps.getWindow(), {
      title: 'Import Agent Database',
      filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile']
    });
    if (!filePaths || filePaths.length === 0) return { success: false };
    try {
      const raw = JSON.parse(fs.readFileSync(filePaths[0], 'utf-8'));
      return { success: true, agents: raw.customAgents || raw.agents || [] };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // ── Audit ──
  ipcMain.handle('get-audit-stats', () => audit.getStats());
  ipcMain.handle('open-audit-log-dir', () => { shell.openPath(audit.getLogDir()); return { success: true }; });

  ipcMain.handle('export-full-audit', async () => {
    const all = audit.exportAll();
    const defaultName = `aegis-full-audit-${new Date().toISOString().slice(0, 10)}.json`;
    const { filePath } = await dialog.showSaveDialog(deps.getWindow(), {
      title: 'Export Full Audit Log', defaultPath: defaultName,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (!filePath) return { success: false };
    fs.writeFileSync(filePath, JSON.stringify(all, null, 2));
    return { success: true, path: filePath, count: all.length };
  });

  // ── Config export/import ──
  ipcMain.handle('export-config', async () => {
    const { filePath } = await dialog.showSaveDialog(deps.getWindow(), {
      title: 'Export Config', defaultPath: 'aegis-config.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (!filePath) return { success: false };
    fs.writeFileSync(filePath, JSON.stringify(config.getSettings(), null, 2));
    return { success: true, path: filePath };
  });

  ipcMain.handle('import-config', async () => {
    const { filePaths } = await dialog.showOpenDialog(deps.getWindow(), {
      title: 'Import Config',
      filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile']
    });
    if (!filePaths || filePaths.length === 0) return { success: false };
    try {
      const raw = JSON.parse(fs.readFileSync(filePaths[0], 'utf-8'));
      config.saveSettings(raw);
      config.applySettings();
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('reveal-in-explorer', (_e, filePath) => {
    shell.showItemInFolder(filePath);
    return { success: true };
  });

  // ── Process control ──
  ipcMain.handle('kill-process', (_e, pid) => {
    return new Promise((resolve) => {
      execFile('taskkill', ['/PID', String(pid), '/F'], (err) => {
        resolve(err ? { success: false, error: err.message } : { success: true });
      });
    });
  });

  ipcMain.handle('suspend-process', (_e, pid) => {
    const script = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class Ntdll{[DllImport("ntdll.dll")]public static extern int NtSuspendProcess(IntPtr h);}' -PassThru | Out-Null;$h=(Get-Process -Id ${Number(pid)}).Handle;[Ntdll]::NtSuspendProcess($h)`;
    return new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 5000 }, (err) => {
        resolve(err ? { success: false, error: err.message } : { success: true });
      });
    });
  });

  ipcMain.handle('resume-process', (_e, pid) => {
    const script = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class Ntdll2{[DllImport("ntdll.dll")]public static extern int NtResumeProcess(IntPtr h);}' -PassThru | Out-Null;$h=(Get-Process -Id ${Number(pid)}).Handle;[Ntdll2]::NtResumeProcess($h)`;
    return new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 5000 }, (err) => {
        resolve(err ? { success: false, error: err.message } : { success: true });
      });
    });
  });
}

module.exports = { init, register };
