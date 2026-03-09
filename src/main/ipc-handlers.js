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

/** @type {Set<string>} Whitelist of allowed settings keys */
const SETTINGS_WHITELIST = new Set([
  'scanIntervalSec',
  'notificationsEnabled',
  'customSensitivePatterns',
  'startMinimized',
  'autoStartWithWindows',
  'anthropicApiKey',
  'darkMode',
  'uiScale',
  'timelineZoom',
  'agentPermissions',
  'ignoredDirectories',
  'ignoreCommonBuildDirs',
  'seenAgents',
  'customAgents',
  'hardwareAcceleration',
  'falsePositivePatterns',
]);

/** @type {string[]} Catch-all regex patterns to reject as false positives */
const CATCHALL_PATTERNS = ['.*', '.+', '^.*$', '^.+$', '[\\s\\S]*', '[\\s\\S]+'];

/**
 * Validate a settings object against the whitelist and type rules.
 * @param {Object} obj - Settings to validate
 * @returns {{ valid: boolean, error?: string }} Validation result
 */
function validateSettings(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { valid: false, error: 'Settings must be a plain object' };
  }
  const unknownKeys = Object.keys(obj).filter((k) => !SETTINGS_WHITELIST.has(k));
  if (unknownKeys.length > 0) {
    return { valid: false, error: `Unknown settings keys: ${unknownKeys.join(', ')}` };
  }
  if ('scanIntervalSec' in obj) {
    if (typeof obj.scanIntervalSec !== 'number' || obj.scanIntervalSec <= 0) {
      return { valid: false, error: 'scanIntervalSec must be a positive number' };
    }
  }
  if ('customSensitivePatterns' in obj) {
    if (!Array.isArray(obj.customSensitivePatterns)) {
      return { valid: false, error: 'customSensitivePatterns must be an array' };
    }
    for (const p of obj.customSensitivePatterns) {
      if (typeof p !== 'string') {
        return { valid: false, error: 'Each custom pattern must be a string' };
      }
      if (!config.isSafeRegex(p)) {
        return { valid: false, error: `Unsafe or invalid regex pattern: ${p}` };
      }
    }
  }
  if ('uiScale' in obj) {
    if (typeof obj.uiScale !== 'number' || obj.uiScale < 0.5 || obj.uiScale > 3) {
      return { valid: false, error: 'uiScale must be a number between 0.5 and 3' };
    }
  }
  if ('timelineZoom' in obj) {
    if (typeof obj.timelineZoom !== 'number' || obj.timelineZoom < 1 || obj.timelineZoom > 24) {
      return { valid: false, error: 'timelineZoom must be a number between 1 and 24' };
    }
  }
  return { valid: true };
}

/**
 * Validate a false positive entry shape.
 * @param {Object} entry
 * @returns {{ valid: boolean, error?: string }}
 */
function validateFalsePositive(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { valid: false, error: 'Entry must be a plain object' };
  }
  if (typeof entry.agentName !== 'string' || entry.agentName.length === 0) {
    return { valid: false, error: 'agentName must be a non-empty string' };
  }
  if (typeof entry.pattern !== 'string' || entry.pattern.length === 0) {
    return { valid: false, error: 'pattern must be a non-empty string' };
  }
  if (entry.pattern.length > 256) {
    return { valid: false, error: 'pattern exceeds max length of 256 characters' };
  }
  if (CATCHALL_PATTERNS.includes(entry.pattern)) {
    return { valid: false, error: 'Catch-all patterns are not allowed' };
  }
  if (typeof entry.timestamp !== 'number' || entry.timestamp <= 0) {
    return { valid: false, error: 'timestamp must be a positive number' };
  }
  return { valid: true };
}

let deps = {};

/**
 * Escape HTML special characters to prevent injection.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
    const check = validateSettings(newSettings);
    if (!check.valid) {
      logger.warn(`IPC save-settings rejected: ${check.error}`);
      return { success: false, error: check.error };
    }
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

  ipcMain.handle('open-threat-report', async (_e, data) => {
    try {
      if (!data || typeof data !== 'object') {
        return { success: false, error: 'Invalid report data' };
      }
      const { riskRating, summary, findings, recommendations, counts } = data;
      const safe = {
        riskRating: escapeHtml(riskRating || 'UNKNOWN'),
        summary: escapeHtml(summary || '').replace(/\n/g, '<br>'),
        findings: Array.isArray(findings) ? findings.map((f) => escapeHtml(f)) : [],
        recs: Array.isArray(recommendations) ? recommendations.map((r) => escapeHtml(r)) : [],
        totalFiles: Number(counts?.totalFiles) || 0,
        totalSensitive: Number(counts?.totalSensitive) || 0,
        totalAgents: Number(counts?.totalAgents) || 0,
        totalNet: Number(counts?.totalNet) || 0,
      };
      const colors = {
        CLEAR: '#38A169',
        LOW: '#38A169',
        MEDIUM: '#ED8936',
        HIGH: '#ED8936',
        CRITICAL: '#E53E3E',
      };
      const rc = colors[riskRating] || '#ED8936';
      const now = new Date().toLocaleString();
      const findingsHtml = safe.findings.length
        ? `<div class="sec"><div class="t">FINDINGS</div><ul>${safe.findings.map((f) => `<li>${f}</li>`).join('')}</ul></div>`
        : '';
      const recsHtml = safe.recs.length
        ? `<div class="sec"><div class="t">RECOMMENDATIONS</div><ul>${safe.recs.map((r) => `<li>${r}</li>`).join('')}</ul></div>`
        : '';
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>AEGIS Threat Report</title>
<style>body{font-family:'Segoe UI',sans-serif;background:#0a0e17;color:#E0E5EC;margin:0;padding:24px}
h1{color:#7a8a9e;font-size:28px;margin-bottom:4px}.meta{color:#8896A6;font-size:12px;margin-bottom:20px}
.g{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0}
.s{text-align:center;padding:12px;background:#12162b;border-radius:8px}
.sv{font-size:24px;font-weight:700}.sl{font-size:10px;color:#8896A6;letter-spacing:1px}
.sec{background:#12162b;border-radius:10px;padding:16px;margin-bottom:16px}
.t{font-size:12px;letter-spacing:2px;color:#8896A6;margin-bottom:8px;font-weight:700}
.r{display:inline-block;padding:6px 20px;border-radius:12px;font-weight:800;font-size:18px;letter-spacing:2px;color:#fff;background:${rc}}
ul{margin:8px 0;padding-left:20px}li{margin:4px 0;color:#c8d0da}
.f{margin-top:20px;text-align:center;color:#8896A6;font-size:11px}
@media print{body{background:#fff;color:#222}.sec,.s{background:#f5f5f5;border:1px solid #ddd}h1{color:#2a9d8f}.r{border:2px solid ${rc}}}</style></head>
<body><h1>AEGIS Threat Analysis Report</h1><div class="meta">Generated: ${now}</div>
<div class="g">
<div class="s"><div class="sv" style="color:#7a8a9e">${safe.totalFiles}</div><div class="sl">FILES ACCESSED</div></div>
<div class="s"><div class="sv" style="color:#c87a7a">${safe.totalSensitive}</div><div class="sl">SENSITIVE ALERTS</div></div>
<div class="s"><div class="sv" style="color:#7a8a9e">${safe.totalAgents}</div><div class="sl">AGENTS DETECTED</div></div>
<div class="s"><div class="sv" style="color:#7a8a9e">${safe.totalNet}</div><div class="sl">NETWORK CONNECTIONS</div></div>
</div>
<div class="sec"><div class="t">THREAT LEVEL</div><span class="r">${safe.riskRating}</span></div>
<div class="sec"><div class="t">SUMMARY</div><p>${safe.summary}</p></div>
${findingsHtml}${recsHtml}
<div class="f">Generated by AEGIS — AI Agent Privacy Shield</div></body></html>`;
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
      const check = validateSettings(raw);
      if (!check.valid) {
        logger.warn(`IPC import-config rejected: ${check.error}`);
        return { success: false, error: check.error };
      }
      config.saveSettings(raw);
      config.applySettings();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('reveal-in-explorer', (_e, filePath) => {
    if (typeof filePath !== 'string' || !filePath) {
      return { success: false, error: 'Invalid path' };
    }
    const normalized = path.resolve(filePath);
    if (normalized !== filePath && filePath.includes('..')) {
      logger.warn(`reveal-in-explorer: path traversal rejected: ${filePath}`);
      return { success: false, error: 'Path traversal not allowed' };
    }
    const userData = app.getPath('userData');
    const isInsideUserData = normalized.startsWith(userData + path.sep) || normalized === userData;
    const pathExists = fs.existsSync(normalized);
    if (!isInsideUserData && !pathExists) {
      logger.warn(`reveal-in-explorer: path outside allowed scope: ${filePath}`);
      return { success: false, error: 'Path not allowed' };
    }
    shell.showItemInFolder(normalized);
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
    const agents = deps.getLatestAgents ? deps.getLatestAgents() : [];
    if (!agents.some((a) => a.pid === pid)) {
      logger.warn(`kill-process: PID ${pid} not monitored by Aegis`);
      return { success: false, error: 'Process not monitored by Aegis' };
    }
    return killProcess(pid);
  });
  ipcMain.handle('suspend-process', (_e, pid) => {
    pid = Number(pid);
    if (!Number.isInteger(pid) || pid <= 0) return { success: false, error: 'Invalid PID' };
    const agents = deps.getLatestAgents ? deps.getLatestAgents() : [];
    if (!agents.some((a) => a.pid === pid)) {
      logger.warn(`suspend-process: PID ${pid} not monitored by Aegis`);
      return { success: false, error: 'Process not monitored by Aegis' };
    }
    return suspendProcess(pid);
  });
  ipcMain.handle('resume-process', (_e, pid) => {
    pid = Number(pid);
    if (!Number.isInteger(pid) || pid <= 0) return { success: false, error: 'Invalid PID' };
    const agents = deps.getLatestAgents ? deps.getLatestAgents() : [];
    if (!agents.some((a) => a.pid === pid)) {
      logger.warn(`resume-process: PID ${pid} not monitored by Aegis`);
      return { success: false, error: 'Process not monitored by Aegis' };
    }
    return resumeProcess(pid);
  });

  // ── False positives ──
  ipcMain.handle('get-false-positives', () => config.getFalsePositives());
  ipcMain.handle('add-false-positive', (_e, entry) => {
    const check = validateFalsePositive(entry);
    if (!check.valid) {
      logger.warn(`IPC add-false-positive rejected: ${check.error}`);
      return { success: false, error: check.error };
    }
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
