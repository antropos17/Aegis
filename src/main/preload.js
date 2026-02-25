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
  setOtherPanelExpanded: (v) => ipcRenderer.send('other-panel-expanded', v),
  exportLog: () => ipcRenderer.invoke('export-log'),
  exportCsv: () => ipcRenderer.invoke('export-csv'),
  generateReport: () => ipcRenderer.invoke('generate-report'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  analyzeAgent: (name) => ipcRenderer.invoke('analyze-agent', name),
  analyzeSession: () => ipcRenderer.invoke('analyze-session'),
  openThreatReport: (html) => ipcRenderer.invoke('open-threat-report', html),
  getAgentBaseline: (name) => ipcRenderer.invoke('get-agent-baseline', name),
  getAllPermissions: () => ipcRenderer.invoke('get-all-permissions'),
  getAgentPermissions: (name) => ipcRenderer.invoke('get-agent-permissions', name),
  saveAgentPermissions: (permMap) => ipcRenderer.invoke('save-agent-permissions', permMap),
  getInstancePermissions: (agentName, parentEditor, cwd) =>
    ipcRenderer.invoke('get-instance-permissions', agentName, parentEditor, cwd),
  saveInstancePermissions: (data) => ipcRenderer.invoke('save-instance-permissions', data),
  resetPermissionsToDefaults: () => ipcRenderer.invoke('reset-permissions-to-defaults'),
  onScanResults: (cb) => {
    ipcRenderer.on('scan-results', (_e, data) => cb(data));
  },
  onFileAccess: (cb) => {
    ipcRenderer.on('file-access', (_e, data) => cb(data));
  },
  onStatsUpdate: (cb) => {
    ipcRenderer.on('stats-update', (_e, data) => cb(data));
  },
  onMonitoringPaused: (cb) => {
    ipcRenderer.on('monitoring-paused', (_e, paused) => cb(paused));
  },
  onNetworkUpdate: (cb) => {
    ipcRenderer.on('network-update', (_e, data) => cb(data));
  },
  onResourceUsage: (cb) => {
    ipcRenderer.on('resource-usage', (_e, data) => cb(data));
  },
  onBaselineWarnings: (cb) => {
    ipcRenderer.on('baseline-warnings', (_e, data) => cb(data));
  },
  onAnomalyScores: (cb) => {
    ipcRenderer.on('anomaly-scores', (_e, data) => cb(data));
  },
  onToggleTheme: (cb) => {
    ipcRenderer.on('toggle-theme', () => cb());
  },
  getAgentDatabase: () => ipcRenderer.invoke('get-agent-database'),
  getProjectDir: () => ipcRenderer.invoke('get-project-dir'),
  killProcess: (pid) => ipcRenderer.invoke('kill-process', pid),
  suspendProcess: (pid) => ipcRenderer.invoke('suspend-process', pid),
  resumeProcess: (pid) => ipcRenderer.invoke('resume-process', pid),
  getCustomAgents: () => ipcRenderer.invoke('get-custom-agents'),
  saveCustomAgents: (agents) => ipcRenderer.invoke('save-custom-agents', agents),
  exportAgentDatabase: () => ipcRenderer.invoke('export-agent-database'),
  importAgentDatabase: () => ipcRenderer.invoke('import-agent-database'),
  getAuditStats: () => ipcRenderer.invoke('get-audit-stats'),
  getAuditEntriesBefore: (beforeTs, limit) =>
    ipcRenderer.invoke('get-audit-entries-before', beforeTs, limit),
  openAuditLogDir: () => ipcRenderer.invoke('open-audit-log-dir'),
  exportFullAudit: () => ipcRenderer.invoke('export-full-audit'),
  getLogStats: () => ipcRenderer.invoke('get-log-stats'),
  exportFullLog: () => ipcRenderer.invoke('export-full-log'),
  openLogDir: () => ipcRenderer.invoke('open-log-dir'),
  testNotification: () => ipcRenderer.invoke('test-notification'),
  exportConfig: () => ipcRenderer.invoke('export-config'),
  importConfig: () => ipcRenderer.invoke('import-config'),
  revealInExplorer: (filePath) => ipcRenderer.invoke('reveal-in-explorer', filePath),
});
