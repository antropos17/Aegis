/**
 * @file preload.js
 * @module preload
 * @description Secure IPC bridge exposing window.aegis API to the renderer process via contextBridge
 * @requires electron
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.1.0
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aegis', {
  getStats: () => ipcRenderer.invoke('get-stats'),
  getResourceUsage: () => ipcRenderer.invoke('get-resource-usage'),
  exportLog: () => ipcRenderer.invoke('export-log'),
  exportCsv: () => ipcRenderer.invoke('export-csv'),
  generateReport: () => ipcRenderer.invoke('generate-report'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  analyzeAgent: (name) => ipcRenderer.invoke('analyze-agent', name),
  analyzeSession: () => ipcRenderer.invoke('analyze-session'),
  openThreatReport: (html) => ipcRenderer.invoke('open-threat-report', html),
  getAllPermissions: () => ipcRenderer.invoke('get-all-permissions'),
  saveAgentPermissions: (permMap) => ipcRenderer.invoke('save-agent-permissions', permMap),
  saveInstancePermissions: (data) => ipcRenderer.invoke('save-instance-permissions', data),
  resetPermissionsToDefaults: () => ipcRenderer.invoke('reset-permissions-to-defaults'),
  onFileAccess: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('file-access', handler);
    return () => ipcRenderer.removeListener('file-access', handler);
  },
  onStatsUpdate: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('stats-update', handler);
    return () => ipcRenderer.removeListener('stats-update', handler);
  },
  onNetworkUpdate: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('network-update', handler);
    return () => ipcRenderer.removeListener('network-update', handler);
  },
  onToggleTheme: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('toggle-theme', handler);
    return () => ipcRenderer.removeListener('toggle-theme', handler);
  },
  getAgentDatabase: () => ipcRenderer.invoke('get-agent-database'),
  killProcess: (pid) => ipcRenderer.invoke('kill-process', pid),
  suspendProcess: (pid) => ipcRenderer.invoke('suspend-process', pid),
  resumeProcess: (pid) => ipcRenderer.invoke('resume-process', pid),
  getCustomAgents: () => ipcRenderer.invoke('get-custom-agents'),
  saveCustomAgents: (agents) => ipcRenderer.invoke('save-custom-agents', agents),
  exportAgentDatabase: () => ipcRenderer.invoke('export-agent-database'),
  importAgentDatabase: () => ipcRenderer.invoke('import-agent-database'),
  getAuditEntriesBefore: (beforeTs, limit) =>
    ipcRenderer.invoke('get-audit-entries-before', beforeTs, limit),
  openAuditLogDir: () => ipcRenderer.invoke('open-audit-log-dir'),
  exportFullAudit: () => ipcRenderer.invoke('export-full-audit'),
  testNotification: () => ipcRenderer.invoke('test-notification'),
  exportConfig: () => ipcRenderer.invoke('export-config'),
  importConfig: () => ipcRenderer.invoke('import-config'),
  revealInExplorer: (filePath) => ipcRenderer.invoke('reveal-in-explorer', filePath),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  exportZip: () => ipcRenderer.invoke('export-zip'),
  getFalsePositives: () => ipcRenderer.invoke('get-false-positives'),
  addFalsePositive: (entry) => ipcRenderer.invoke('add-false-positive', entry),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
  getRules: () => ipcRenderer.invoke('rules:getAll'),
  reloadRules: () => ipcRenderer.invoke('rules:reload'),
  onRulesReloaded: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('rules:reloaded', handler);
    return () => ipcRenderer.removeListener('rules:reloaded', handler);
  },
  onScanBatch: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('scan-batch', handler);
    return () => ipcRenderer.removeListener('scan-batch', handler);
  },
  onScanStatus: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('scan-status', handler);
    return () => ipcRenderer.removeListener('scan-status', handler);
  },
});
