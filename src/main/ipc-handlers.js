/**
 * @file ipc-handlers.js
 * @description All IPC handlers for renderer ↔ main communication.
 * @since v0.1.0
 */
'use strict';
const { ipcMain, app, dialog, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const config = require('./config-manager');
const scanner = require('./process-scanner');
const analysis = require('./ai-analysis');
const exporter = require('./exports');
const audit = require('./audit-logger');
const { killProcess, suspendProcess, resumeProcess } = require('./platform');
const zipWriter = require('./zip-writer');
const { getAllRules, reloadRules } = require('./rule-loader');
const logger = require('./logger');

let deps = {};

/**
 * @param {Object} injected — { getWindow, getStats, getResourceUsage }
 * @since v0.1.0
 */
function init(injected) {
  deps = injected;
}

/** @returns {void} @since v0.1.0 */
function register() {
  ipcMain.handle('get-stats', () => deps.getStats());
  ipcMain.handle('get-resource-usage', () => deps.getResourceUsage());
  ipcMain.handle('export-log', async () => {
    try {
      const data = await exporter.exportLog();
      return data;
    } catch (error) {
      logger.error(`IPC export-log failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle('export-csv', async () => {
    try {
      const data = await exporter.exportCsv();
      return data;
    } catch (error) {
      logger.error(`IPC export-csv failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle('generate-report', async () => {
    try {
      const data = await exporter.generateReport();
      return data;
    } catch (error) {
      logger.error(`IPC generate-report failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
  ipcMain.handle('get-settings', () => ({ ...config.getSettings() }));

  ipcMain.handle('save-settings', (_e, newSettings) => {
    config.saveSettings(newSettings);
    config.applySettings();
    return { success: true };
  });

  ipcMain.handle('test-notification', () => {
    if (!Notification.isSupported())
      return { success: false, error: 'Notifications not supported on this system' };
    new Notification({
      title: 'AEGIS \u2014 Test Notification',
      body: 'Desktop notifications are working correctly.',
    }).show();
    return { success: true };
  });

  ipcMain.handle('analyze-agent', async (_e, name) => {
    if (!config.getSettings().anthropicApiKey) {
      return { success: false, error: 'Set your Anthropic API key in Settings' };
    }
    try {
      return await analysis.analyzeAgentActivity(name);
    } catch (error) {
      logger.error(`IPC analyze-agent failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('analyze-session', async () => {
    if (!config.getSettings().anthropicApiKey) {
      return { success: false, error: 'Set your Anthropic API key in Settings' };
    }
    try {
      return await analysis.analyzeSessionActivity();
    } catch (error) {
      logger.error(`IPC analyze-session failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('open-threat-report', async (_e, html) => {
    try {
      const fp = path.join(app.getPath('temp'), `aegis-threat-report-${Date.now()}.html`);
      fs.writeFileSync(fp, html);
      shell.openExternal('file://' + fp.replace(/\\/g, '/'));
      return { success: true, path: fp };
    } catch (error) {
      logger.error(`IPC open-threat-report failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-all-permissions', () => {
    const settings = config.getSettings();
    const agentPerms = {};
    const instancePerms = {};
    for (const [key, val] of Object.entries(settings.agentPermissions)) {
      if (key.includes('::')) {
        instancePerms[key] = val;
      } else {
        agentPerms[key] = val;
      }
    }
    return {
      permissions: agentPerms,
      instancePermissions: instancePerms,
      seenAgents: settings.seenAgents,
    };
  });

  ipcMain.handle('save-agent-permissions', (_e, permMap) => {
    config.saveSettings({ ...config.getSettings(), agentPermissions: permMap });
    return { success: true };
  });

  ipcMain.handle(
    'save-instance-permissions',
    (_e, { agentName, parentEditor, permissions, cwd }) => {
      config.saveInstancePermissions(agentName, parentEditor, permissions, cwd);
      return { success: true };
    },
  );

  ipcMain.handle('reset-permissions-to-defaults', () => {
    const settings = config.getSettings();
    const newPerms = {};
    for (const agent of settings.seenAgents) newPerms[agent] = config.getDefaultPermissions(agent);
    config.saveSettings({ ...settings, agentPermissions: newPerms });
    return { permissions: newPerms, seenAgents: settings.seenAgents };
  });

  ipcMain.handle('get-agent-database', () => scanner.agentDb);
  ipcMain.handle('get-custom-agents', () => config.getCustomAgents());
  ipcMain.handle('save-custom-agents', (_e, agents) => {
    config.saveCustomAgents(agents);
    return { success: true };
  });

  ipcMain.handle('export-agent-database', async () => {
    try {
      const merged = { ...scanner.agentDb, customAgents: config.getCustomAgents() };
      const { filePath } = await dialog.showSaveDialog(deps.getWindow(), {
        title: 'Export Agent Database',
        defaultPath: 'aegis-agents.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!filePath) return { success: false };
      fs.writeFileSync(filePath, JSON.stringify(merged, null, 2));
      return { success: true, path: filePath };
    } catch (error) {
      logger.error(`IPC export-agent-database failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('import-agent-database', async () => {
    const { filePaths } = await dialog.showOpenDialog(deps.getWindow(), {
      title: 'Import Agent Database',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (!filePaths || filePaths.length === 0) return { success: false };
    try {
      const raw = JSON.parse(fs.readFileSync(filePaths[0], 'utf-8'));
      return { success: true, agents: raw.customAgents || raw.agents || [] };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ── Audit ──
  ipcMain.handle('get-audit-entries-before', (_e, beforeTs, limit) =>
    audit.getEntriesBefore(beforeTs, limit),
  );
  ipcMain.handle('open-audit-log-dir', () => {
    shell.openPath(audit.getLogDir());
    return { success: true };
  });

  ipcMain.handle('export-full-audit', async () => {
    try {
      const all = audit.exportAll();
      const defaultName = `aegis-full-audit-${new Date().toISOString().slice(0, 10)}.json`;
      const { filePath } = await dialog.showSaveDialog(deps.getWindow(), {
        title: 'Export Full Audit Log',
        defaultPath: defaultName,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!filePath) return { success: false };
      fs.writeFileSync(filePath, JSON.stringify(all, null, 2));
      return { success: true, path: filePath, count: all.length };
    } catch (error) {
      logger.error(`IPC export-full-audit failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // ── Config export/import ──
  ipcMain.handle('export-config', async () => {
    try {
      const { filePath } = await dialog.showSaveDialog(deps.getWindow(), {
        title: 'Export Config',
        defaultPath: 'aegis-config.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!filePath) return { success: false };
      fs.writeFileSync(filePath, JSON.stringify(config.getSettings(), null, 2));
      return { success: true, path: filePath };
    } catch (error) {
      logger.error(`IPC export-config failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('import-config', async () => {
    const { filePaths } = await dialog.showOpenDialog(deps.getWindow(), {
      title: 'Import Config',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (!filePaths || filePaths.length === 0) return { success: false };
    try {
      const raw = JSON.parse(fs.readFileSync(filePaths[0], 'utf-8'));
      config.saveSettings(raw);
      config.applySettings();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('reveal-in-explorer', (_e, filePath) => {
    shell.showItemInFolder(filePath);
    return { success: true };
  });

  // ── App info ──
  ipcMain.handle('get-app-version', () => app.getVersion());

  // ── Zip export ──
  ipcMain.handle('export-zip', async () => {
    try {
      const settingsCopy = { ...config.getSettings() };
      delete settingsCopy.anthropicApiKey;
      delete settingsCopy._encryptedApiKey;
      delete settingsCopy.apiKey;
      const entries = [
        { name: 'audit-log.json', data: Buffer.from(JSON.stringify(audit.exportAll(), null, 2)) },
        {
          name: 'activity-log.json',
          data: Buffer.from(JSON.stringify(scanner.activityLog.slice(-5000), null, 2)),
        },
        { name: 'config.json', data: Buffer.from(JSON.stringify(settingsCopy, null, 2)) },
      ];
      const zipBuf = zipWriter.createZip(entries);
      const defaultName = `aegis-export-${new Date().toISOString().slice(0, 10)}.zip`;
      const { filePath } = await dialog.showSaveDialog(deps.getWindow(), {
        title: 'Export All Data (ZIP)',
        defaultPath: defaultName,
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
      });
      if (!filePath) return { success: false };
      fs.writeFileSync(filePath, zipBuf);
      return { success: true, path: filePath };
    } catch (error) {
      logger.error(`IPC export-zip failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // ── Process control ──
  ipcMain.handle('kill-process', (_e, pid) => {
    pid = Number(pid);
    if (!Number.isInteger(pid) || pid <= 0) return { success: false, error: 'Invalid PID' };
    return killProcess(pid);
  });
  ipcMain.handle('suspend-process', (_e, pid) => {
    pid = Number(pid);
    if (!Number.isInteger(pid) || pid <= 0) return { success: false, error: 'Invalid PID' };
    return suspendProcess(pid);
  });
  ipcMain.handle('resume-process', (_e, pid) => {
    pid = Number(pid);
    if (!Number.isInteger(pid) || pid <= 0) return { success: false, error: 'Invalid PID' };
    return resumeProcess(pid);
  });

  // ── False positives ──
  ipcMain.handle('get-false-positives', () => config.getFalsePositives());
  ipcMain.handle('add-false-positive', (_e, entry) => {
    config.addFalsePositive(entry);
    return { success: true };
  });

  // ── Open external URL ──
  ipcMain.handle('open-external-url', (_e, url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(url);
        return { success: true };
      }
      return { success: false, error: 'Invalid URL scheme' };
    } catch (error) {
      return { success: false, error: 'Invalid URL length or format' };
    }
  });

  // ── Rules (YAML rulesets) ──
  ipcMain.handle('rules:getAll', () => {
    const rules = getAllRules();
    return Array.from(rules.values()).map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      risk: r.risk,
      reason: r.reason,
      enabled: r.enabled,
    }));
  });

  ipcMain.handle('rules:reload', () => {
    reloadRules();
    const rules = getAllRules();
    return { success: true, count: rules.size };
  });
}

module.exports = { init, register };
