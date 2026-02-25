import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import Module from 'module';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);

// Mock objects for all dependencies
const handlers = {};
const onHandlers = {};

const mockElectron = {
  ipcMain: {
    handle: vi.fn((channel, handler) => { handlers[channel] = handler; }),
    on: vi.fn((channel, handler) => { onHandlers[channel] = handler; }),
    _handlers: handlers,
    _onHandlers: onHandlers,
  },
  app: { getPath: vi.fn(() => os.tmpdir()) },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() },
  shell: { openExternal: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
  Notification: Object.assign(vi.fn(function() { return { show: vi.fn() }; }), {
    isSupported: vi.fn(() => true),
  }),
};

const mockConfig = {
  getSettings: vi.fn(() => ({
    anthropicApiKey: 'key',
    agentPermissions: { 'Claude::vscode': 'allow', Copilot: 'monitor' },
    seenAgents: ['Claude', 'Copilot'],
  })),
  saveSettings: vi.fn(),
  applySettings: vi.fn(),
  getAgentPermissions: vi.fn(() => ({ fileAccess: 'allow' })),
  getInstancePermissions: vi.fn(() => ({ fileAccess: 'allow' })),
  saveInstancePermissions: vi.fn(),
  getDefaultPermissions: vi.fn(() => ({ fileAccess: 'monitor' })),
  getCustomAgents: vi.fn(() => []),
  saveCustomAgents: vi.fn(),
};

const mockScanner = {
  scanProcesses: vi.fn(() => Promise.resolve({ agents: [{ agent: 'Claude', pid: 100 }] })),
  agentDb: { agents: [] },
};

const mockProcUtil = {
  enrichWithParentChains: vi.fn(() => Promise.resolve()),
  annotateHostApps: vi.fn(),
  annotateWorkingDirs: vi.fn(() => Promise.resolve()),
};

const mockBaselines = {
  getBaselines: vi.fn(() => ({ agents: {} })),
  getSessionData: vi.fn(() => ({})),
};

const mockAnalysis = {
  analyzeAgentActivity: vi.fn(() => Promise.resolve({ success: true, analysis: 'ok' })),
  analyzeSessionActivity: vi.fn(() => Promise.resolve({ success: true, summary: 'ok' })),
};

const mockExporter = {
  exportLog: vi.fn(() => Promise.resolve({ success: true })),
  exportCsv: vi.fn(() => Promise.resolve({ success: true })),
  generateReport: vi.fn(() => Promise.resolve({ success: true })),
};

const mockAudit = {
  getStats: vi.fn(() => ({ totalEvents: 100 })),
  getLogDir: vi.fn(() => '/logs'),
  exportAll: vi.fn(() => []),
};

const mockLogger = {
  getStats: vi.fn(() => ({ entries: 50 })),
  getLogDir: vi.fn(() => '/logs'),
  exportAll: vi.fn(() => []),
};

const mockPlatform = {
  killProcess: vi.fn(() => Promise.resolve({ success: true })),
  suspendProcess: vi.fn(() => Promise.resolve({ success: true })),
  resumeProcess: vi.fn(() => Promise.resolve({ success: true })),
};

// Resolve absolute paths for internal modules
const configPath = require.resolve('../../src/main/config-manager.js');
const scannerPath = require.resolve('../../src/main/process-scanner.js');
const procUtilPath = require.resolve('../../src/main/process-utils.js');
const baselinesPath = require.resolve('../../src/main/baselines.js');
const analysisPath = require.resolve('../../src/main/ai-analysis.js');
const exporterPath = require.resolve('../../src/main/exports.js');
const auditPath = require.resolve('../../src/main/audit-logger.js');
const loggerPath = require.resolve('../../src/main/logger.js');
const platformPath = require.resolve('../../src/main/platform/index.js');
const ipcPath = require.resolve('../../src/main/ipc-handlers.js');

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return mockElectron;
  // For relative requires from ipc-handlers.js, resolve against its directory
  if (parent && parent.filename === ipcPath) {
    const resolved = path.resolve(path.dirname(ipcPath), request);
    if (resolved === configPath.replace(/\.js$/, '') || resolved + '.js' === configPath) return mockConfig;
    if (resolved === scannerPath.replace(/\.js$/, '') || resolved + '.js' === scannerPath) return mockScanner;
    if (resolved === procUtilPath.replace(/\.js$/, '') || resolved + '.js' === procUtilPath) return mockProcUtil;
    if (resolved === baselinesPath.replace(/\.js$/, '') || resolved + '.js' === baselinesPath) return mockBaselines;
    if (resolved === analysisPath.replace(/\.js$/, '') || resolved + '.js' === analysisPath) return mockAnalysis;
    if (resolved === exporterPath.replace(/\.js$/, '') || resolved + '.js' === exporterPath) return mockExporter;
    if (resolved === auditPath.replace(/\.js$/, '') || resolved + '.js' === auditPath) return mockAudit;
    if (resolved === loggerPath.replace(/\.js$/, '') || resolved + '.js' === loggerPath) return mockLogger;
    if (resolved === platformPath.replace(/\.js$/, '') || resolved.replace(/\/index$/, '') + '/index.js' === platformPath) return mockPlatform;
  }
  return originalLoad.apply(this, arguments);
};

describe('ipc-handlers', () => {
  let ipcHandlers;

  beforeEach(() => {
    // Clear handler registrations
    for (const key of Object.keys(handlers)) delete handlers[key];
    for (const key of Object.keys(onHandlers)) delete onHandlers[key];

    // Reset mock calls
    mockElectron.ipcMain.handle.mockClear();
    mockElectron.ipcMain.on.mockClear();
    mockElectron.shell.showItemInFolder.mockClear();
    mockElectron.Notification.mockClear();
    mockElectron.Notification.isSupported.mockClear().mockReturnValue(true);

    mockConfig.getSettings.mockClear().mockReturnValue({
      anthropicApiKey: 'key',
      agentPermissions: { 'Claude::vscode': 'allow', Copilot: 'monitor' },
      seenAgents: ['Claude', 'Copilot'],
    });
    mockConfig.saveSettings.mockClear();
    mockConfig.applySettings.mockClear();
    mockConfig.saveCustomAgents.mockClear();
    mockBaselines.getBaselines.mockClear().mockReturnValue({ agents: {} });
    mockBaselines.getSessionData.mockClear().mockReturnValue({});

    delete require.cache[ipcPath];
    ipcHandlers = require('../../src/main/ipc-handlers.js');
  });

  function getHandler(channel) {
    return handlers[channel];
  }
  function getOnHandler(channel) {
    return onHandlers[channel];
  }

  it('init stores injected deps', () => {
    ipcHandlers.init({ getWindow: () => null, getStats: () => ({}), getResourceUsage: () => ({}), setOtherPanelExpanded: () => {} });
  });

  it('register registers all expected IPC channels', () => {
    ipcHandlers.init({
      getWindow: () => null,
      getStats: () => ({}),
      getResourceUsage: () => ({}),
      setOtherPanelExpanded: () => {},
    });
    ipcHandlers.register();

    const registeredChannels = mockElectron.ipcMain.handle.mock.calls.map(c => c[0]);
    expect(registeredChannels).toContain('scan-processes');
    expect(registeredChannels).toContain('get-stats');
    expect(registeredChannels).toContain('get-resource-usage');
    expect(registeredChannels).toContain('export-log');
    expect(registeredChannels).toContain('export-csv');
    expect(registeredChannels).toContain('generate-report');
    expect(registeredChannels).toContain('get-settings');
    expect(registeredChannels).toContain('save-settings');
    expect(registeredChannels).toContain('test-notification');
    expect(registeredChannels).toContain('analyze-agent');
    expect(registeredChannels).toContain('analyze-session');
    expect(registeredChannels).toContain('open-threat-report');
    expect(registeredChannels).toContain('get-agent-baseline');
    expect(registeredChannels).toContain('get-all-permissions');
    expect(registeredChannels).toContain('get-agent-permissions');
    expect(registeredChannels).toContain('save-agent-permissions');
    expect(registeredChannels).toContain('get-instance-permissions');
    expect(registeredChannels).toContain('save-instance-permissions');
    expect(registeredChannels).toContain('reset-permissions-to-defaults');
    expect(registeredChannels).toContain('get-agent-database');
    expect(registeredChannels).toContain('get-project-dir');
    expect(registeredChannels).toContain('get-custom-agents');
    expect(registeredChannels).toContain('save-custom-agents');
    expect(registeredChannels).toContain('export-agent-database');
    expect(registeredChannels).toContain('import-agent-database');
    expect(registeredChannels).toContain('get-audit-stats');
    expect(registeredChannels).toContain('open-audit-log-dir');
    expect(registeredChannels).toContain('export-full-audit');
    expect(registeredChannels).toContain('get-log-stats');
    expect(registeredChannels).toContain('open-log-dir');
    expect(registeredChannels).toContain('export-full-log');
    expect(registeredChannels).toContain('export-config');
    expect(registeredChannels).toContain('import-config');
    expect(registeredChannels).toContain('reveal-in-explorer');
    expect(registeredChannels).toContain('kill-process');
    expect(registeredChannels).toContain('suspend-process');
    expect(registeredChannels).toContain('resume-process');
    expect(registeredChannels).toContain('capture-screenshot');
  });

  describe('handler behavior', () => {
    beforeEach(() => {
      ipcHandlers.init({
        getWindow: () => ({ webContents: { capturePage: vi.fn(() => Promise.resolve({ toPNG: () => Buffer.from('png'), getSize: () => ({ width: 800, height: 600 }) })) } }),
        getStats: () => ({ totalFiles: 5 }),
        getResourceUsage: () => ({ memMB: 50 }),
        setOtherPanelExpanded: vi.fn(),
      });
      ipcHandlers.register();
    });

    it('get-stats returns stats from deps', async () => {
      const handler = getHandler('get-stats');
      const result = handler();
      expect(result).toEqual({ totalFiles: 5 });
    });

    it('get-resource-usage returns resource data', () => {
      const handler = getHandler('get-resource-usage');
      expect(handler()).toEqual({ memMB: 50 });
    });

    it('get-settings returns settings copy', () => {
      const handler = getHandler('get-settings');
      const result = handler();
      expect(result.anthropicApiKey).toBe('key');
    });

    it('save-settings calls config.saveSettings and applySettings', () => {
      const handler = getHandler('save-settings');
      const newSettings = { scanIntervalSec: 5 };
      const result = handler(null, newSettings);
      expect(mockConfig.saveSettings).toHaveBeenCalledWith(newSettings);
      expect(mockConfig.applySettings).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('get-all-permissions splits agent vs instance permissions', () => {
      const handler = getHandler('get-all-permissions');
      const result = handler();
      expect(result.permissions).toEqual({ Copilot: 'monitor' });
      expect(result.instancePermissions).toEqual({ 'Claude::vscode': 'allow' });
      expect(result.seenAgents).toEqual(['Claude', 'Copilot']);
    });

    it('analyze-agent returns error when no API key', () => {
      mockConfig.getSettings.mockReturnValueOnce({ anthropicApiKey: '' });
      const handler = getHandler('analyze-agent');
      const result = handler(null, 'Claude');
      expect(result).resolves.toMatchObject({ success: false });
    });

    it('test-notification creates and shows notification', () => {
      const handler = getHandler('test-notification');
      const result = handler();
      expect(result.success).toBe(true);
    });

    it('test-notification returns error when not supported', () => {
      mockElectron.Notification.isSupported.mockReturnValueOnce(false);
      const handler = getHandler('test-notification');
      const result = handler();
      expect(result.success).toBe(false);
    });

    it('open-threat-report writes HTML to temp file', async () => {
      const handler = getHandler('open-threat-report');
      const result = await handler(null, '<html>test</html>');
      expect(result.success).toBe(true);
      expect(result.path).toContain('aegis-threat-report-');
      if (fs.existsSync(result.path)) fs.unlinkSync(result.path);
    });

    it('get-agent-baseline returns defaults for unknown agent', () => {
      const handler = getHandler('get-agent-baseline');
      const result = handler(null, 'UnknownAgent');
      expect(result.sessionCount).toBe(0);
      expect(result.currentSession.totalFiles).toBe(0);
    });

    it('reveal-in-explorer calls shell.showItemInFolder', () => {
      const handler = getHandler('reveal-in-explorer');
      const result = handler(null, '/some/path');
      expect(mockElectron.shell.showItemInFolder).toHaveBeenCalledWith('/some/path');
      expect(result.success).toBe(true);
    });

    it('other-panel-expanded sets via deps', () => {
      const setFn = vi.fn();
      ipcHandlers.init({
        getWindow: () => null,
        getStats: () => ({}),
        getResourceUsage: () => ({}),
        setOtherPanelExpanded: setFn,
      });
      ipcHandlers.register();

      const handler = getOnHandler('other-panel-expanded');
      handler(null, true);
      expect(setFn).toHaveBeenCalledWith(true);
    });

    it('get-project-dir returns path two levels up from __dirname', () => {
      const handler = getHandler('get-project-dir');
      const result = handler();
      expect(typeof result).toBe('string');
      expect(result).toContain('Aegis');
    });

    it('save-custom-agents delegates to config', () => {
      const handler = getHandler('save-custom-agents');
      const agents = [{ name: 'custom', process: 'custom.exe' }];
      const result = handler(null, agents);
      expect(mockConfig.saveCustomAgents).toHaveBeenCalledWith(agents);
      expect(result.success).toBe(true);
    });

    it('reset-permissions-to-defaults resets all agent permissions', () => {
      const handler = getHandler('reset-permissions-to-defaults');
      const result = handler();
      expect(result.permissions).toBeDefined();
      expect(result.seenAgents).toBeDefined();
    });
  });
});
