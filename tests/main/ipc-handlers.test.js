import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import Module from 'module';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock objects for all dependencies
const handlers = {};
const onHandlers = {};

const mockElectron = {
  ipcMain: {
    handle: vi.fn((channel, handler) => {
      handlers[channel] = handler;
    }),
    on: vi.fn((channel, handler) => {
      onHandlers[channel] = handler;
    }),
    _handlers: handlers,
    _onHandlers: onHandlers,
  },
  app: { getPath: vi.fn(() => os.tmpdir()) },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() },
  shell: { openExternal: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
  Notification: Object.assign(
    vi.fn(function () {
      return { show: vi.fn() };
    }),
    {
      isSupported: vi.fn(() => true),
    },
  ),
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
  activityLog: [],
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
  getStats: vi.fn(() => ({
    totalEntries: 100,
    totalSize: 5120,
    currentSize: 2048,
    firstEntry: null,
    lastEntry: null,
  })),
  getLogDir: vi.fn(() => '/logs'),
  exportAll: vi.fn(() => []),
  prepareExport: vi.fn(() => []),
  getEntriesBefore: vi.fn(() => []),
};
const mockStreamExport = { writeAuditExport: vi.fn(async () => ({ success: true })) };

const mockLogger = {
  getStats: vi.fn(() => ({
    logDir: '/logs',
    todayEntries: 50,
    totalFiles: 3,
    recordingSince: null,
  })),
  getLogDir: vi.fn(() => '/logs'),
  exportAll: vi.fn(() => []),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
};

const mockPlatform = {
  killProcess: vi.fn(() => Promise.resolve({ success: true })),
  suspendProcess: vi.fn(() => Promise.resolve({ success: true })),
  resumeProcess: vi.fn(() => Promise.resolve({ success: true })),
};

// Resolve absolute paths for internal modules
const configPath = path.resolve(__dirname, '../../src/main/config-manager.js');
const scannerPath = path.resolve(__dirname, '../../src/main/process-scanner.js');
const procUtilPath = path.resolve(__dirname, '../../src/main/process-utils.js');
const baselinesPath = path.resolve(__dirname, '../../src/main/baselines.js');
const analysisPath = path.resolve(__dirname, '../../src/main/ai-analysis.js');
const exporterPath = path.resolve(__dirname, '../../src/main/exports.js');
const auditPath = path.resolve(__dirname, '../../src/main/audit-logger.js');
const streamExportPath = path.resolve(__dirname, '../../src/main/audit-export-stream.js');
const loggerPath = path.resolve(__dirname, '../../src/main/logger.js');
const platformPath = path.resolve(__dirname, '../../src/main/platform/index.js');
const ipcPath = path.resolve(__dirname, '../../src/main/ipc-handlers.js');

const originalLoad = Module._load;
Module._load = function (request, parent, _isMain) {
  if (request === 'electron') return mockElectron;
  // For relative requires from ipc-handlers.js, resolve against its directory
  if (parent && parent.filename === ipcPath) {
    const resolved = path.resolve(path.dirname(ipcPath), request);
    if (resolved === configPath.replace(/\.js$/, '') || resolved + '.js' === configPath)
      return mockConfig;
    if (resolved === scannerPath.replace(/\.js$/, '') || resolved + '.js' === scannerPath)
      return mockScanner;
    if (resolved === procUtilPath.replace(/\.js$/, '') || resolved + '.js' === procUtilPath)
      return mockProcUtil;
    if (resolved === baselinesPath.replace(/\.js$/, '') || resolved + '.js' === baselinesPath)
      return mockBaselines;
    if (resolved === analysisPath.replace(/\.js$/, '') || resolved + '.js' === analysisPath)
      return mockAnalysis;
    if (resolved === exporterPath.replace(/\.js$/, '') || resolved + '.js' === exporterPath)
      return mockExporter;
    if (resolved === auditPath.replace(/\.js$/, '') || resolved + '.js' === auditPath)
      return mockAudit;
    if (resolved + '.js' === streamExportPath) return mockStreamExport;
    if (resolved === loggerPath.replace(/\.js$/, '') || resolved + '.js' === loggerPath)
      return mockLogger;
    if (
      resolved === platformPath.replace(/\.js$/, '') ||
      resolved.replace(/[/\\]index$/, '') + path.sep + 'index.js' === platformPath ||
      resolved + path.sep + 'index.js' === platformPath
    )
      return mockPlatform;
  }
  return originalLoad.apply(this, arguments);
};

afterAll(() => {
  Module._load = originalLoad;
});

describe('ipc-handlers', () => {
  let ipcHandlers;

  beforeEach(async () => {
    // Clear handler registrations
    for (const key of Object.keys(handlers)) delete handlers[key];
    for (const key of Object.keys(onHandlers)) delete onHandlers[key];

    // Reset mock calls
    mockElectron.ipcMain.handle.mockClear();
    mockElectron.ipcMain.on.mockClear();
    mockElectron.shell.showItemInFolder.mockClear();
    mockElectron.shell.openExternal.mockClear();
    mockPlatform.killProcess.mockClear();
    mockPlatform.suspendProcess.mockClear();
    mockPlatform.resumeProcess.mockClear();
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

    vi.resetModules();
    const mod = await import('../../src/main/ipc-handlers.js');
    ipcHandlers = mod.default;
  });

  function getHandler(channel) {
    return handlers[channel];
  }

  it.each(['export-full-audit', 'export-zip'])(
    '%s reports incomplete history without writing a partial file',
    async (channel) => {
      ipcHandlers.init({ getWindow: () => null });
      ipcHandlers.register();
      mockElectron.dialog.showSaveDialog.mockClear();
      mockElectron.dialog.showSaveDialog.mockResolvedValue({ filePath: '/fixture/export.json' });
      const write = vi.spyOn(fs, 'writeFileSync');
      const message =
        'Audit export incomplete: a log file could not be read or contains invalid JSON.';
      mockAudit.prepareExport.mockImplementationOnce(() => {
        throw new Error(message);
      });
      try {
        expect(await getHandler(channel)()).toEqual({ success: false, error: message });
        expect(mockElectron.dialog.showSaveDialog).toHaveBeenCalledOnce();
        expect(write).not.toHaveBeenCalled();
      } finally {
        write.mockRestore();
      }
    },
  );

  it.each(['export-full-audit', 'export-zip'])(
    '%s does no journal work after cancellation',
    async (channel) => {
      ipcHandlers.init({ getWindow: () => null });
      ipcHandlers.register();
      mockElectron.dialog.showSaveDialog.mockResolvedValue({});
      mockAudit.prepareExport.mockClear();
      expect(await getHandler(channel)()).toEqual({ success: false });
      expect(mockAudit.prepareExport).not.toHaveBeenCalled();
    },
  );

  it('excludes provider credentials from configuration exports', async () => {
    ipcHandlers.init({ getWindow: () => null });
    ipcHandlers.register();
    mockElectron.dialog.showSaveDialog.mockResolvedValueOnce({ filePath: '/fixture/config.json' });
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {});
    try {
      expect(await handlers['export-config']()).toMatchObject({ success: true });
      const exported = JSON.parse(write.mock.calls[0][1]);
      expect(exported).not.toHaveProperty('anthropicApiKey');
      expect(exported.seenAgents).toEqual(['Claude', 'Copilot']);
      expect(mockConfig.getSettings().anthropicApiKey).toBe('key');
    } finally {
      write.mockRestore();
    }
  });
  it('reports native audit-folder failures instead of an unconditional success', async () => {
    ipcHandlers.init({ getWindow: () => null });
    ipcHandlers.register();
    mockElectron.shell.openPath.mockResolvedValueOnce('Folder unavailable');
    expect(await handlers['open-audit-log-dir']()).toEqual({
      success: false,
      error: 'Folder unavailable',
    });
    mockElectron.shell.openPath.mockRejectedValueOnce(new Error('Shell offline'));
    expect(await handlers['open-audit-log-dir']()).toEqual({
      success: false,
      error: 'Shell offline',
    });
    mockElectron.shell.openPath.mockResolvedValueOnce('');
    expect(await handlers['open-audit-log-dir']()).toEqual({ success: true });
  });
  it('update operations only accept the owned main frame and never forward caller parameters', () => {
    const frame = {};
    const window = { isDestroyed: () => false, webContents: { mainFrame: frame } };
    const updates = { snapshot: vi.fn(), check: vi.fn(), download: vi.fn(), install: vi.fn() };
    ipcHandlers.init({ getWindow: () => window, updates });
    ipcHandlers.register();
    for (const [channel, method] of [
      ['status', 'snapshot'],
      ['check', 'check'],
      ['download', 'download'],
      ['install', 'install'],
    ]) {
      const handler = getHandler(`updates:${channel}`);
      expect(() => handler({ sender: {}, senderFrame: frame })).toThrow('denied');
      expect(() => handler({ sender: window.webContents, senderFrame: {} })).toThrow('denied');
      handler(
        { sender: window.webContents, senderFrame: frame },
        'https://attacker.invalid',
        'evil.exe',
      );
      expect(updates[method]).toHaveBeenCalledExactlyOnceWith();
    }
  });

  it('streams the ZIP with bounded activity and sanitized settings', async () => {
    ipcHandlers.init({ getWindow: () => null });
    ipcHandlers.register();
    mockElectron.dialog.showSaveDialog.mockResolvedValue({ filePath: '/fixture/export.zip' });
    mockConfig.getSettings.mockReturnValue({
      anthropicApiKey: 'fixture',
      _encryptedApiKey: 'fixture',
      apiKey: 'fixture',
      theme: 'dark',
    });
    mockScanner.activityLog = Array.from({ length: 5100 }, (_, i) => ({ i }));
    mockStreamExport.writeAuditExport.mockClear();
    try {
      expect(await getHandler('export-zip')()).toEqual({ success: true });
      const options = mockStreamExport.writeAuditExport.mock.calls[0][0];
      expect(options.extraEntries[0].data).toHaveLength(5000);
      expect(options.extraEntries[0].data[0]).toEqual({ i: 100 });
      expect(options.extraEntries[1]).toEqual({ name: 'config.json', data: { theme: 'dark' } });
      expect(options.zip).toBe(true);
    } finally {
      mockScanner.activityLog = [];
    }
  });

  it('init stores injected deps', () => {
    ipcHandlers.init({
      getWindow: () => null,
      getStats: () => ({
        totalFiles: 0,
        totalSensitive: 0,
        aiSensitive: 0,
        uptimeMs: 0,
        monitoringStarted: null,
        peakAgents: 0,
        currentAgents: 0,
        aiAgentCount: 0,
        otherAgentCount: 0,
        uniqueAgents: [],
      }),
      getResourceUsage: () => ({}),
      setOtherPanelExpanded: () => {},
    });
  });

  it('register registers all expected IPC channels', () => {
    ipcHandlers.init({
      getWindow: () => null,
      getStats: () => ({
        totalFiles: 0,
        totalSensitive: 0,
        aiSensitive: 0,
        uptimeMs: 0,
        monitoringStarted: null,
        peakAgents: 0,
        currentAgents: 0,
        aiAgentCount: 0,
        otherAgentCount: 0,
        uniqueAgents: [],
      }),
      getResourceUsage: () => ({}),
      setOtherPanelExpanded: () => {},
    });
    ipcHandlers.register();

    const registeredChannels = mockElectron.ipcMain.handle.mock.calls.map((c) => c[0]);
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
    expect(registeredChannels).toContain('get-all-permissions');
    expect(registeredChannels).toContain('save-agent-permissions');
    expect(registeredChannels).toContain('save-instance-permissions');
    expect(registeredChannels).toContain('reset-permissions-to-defaults');
    expect(registeredChannels).toContain('get-agent-database');
    expect(registeredChannels).toContain('get-custom-agents');
    expect(registeredChannels).toContain('save-custom-agents');
    expect(registeredChannels).toContain('export-agent-database');
    expect(registeredChannels).toContain('import-agent-database');
    expect(registeredChannels).toContain('get-audit-stats');
    expect(registeredChannels).toContain('get-audit-entries-before');
    expect(registeredChannels).toContain('open-audit-log-dir');
    expect(registeredChannels).toContain('export-full-audit');
    expect(registeredChannels).toContain('export-config');
    expect(registeredChannels).toContain('import-config');
    expect(registeredChannels).toContain('reveal-in-explorer');
    expect(registeredChannels).toContain('kill-process');
    expect(registeredChannels).toContain('suspend-process');
    expect(registeredChannels).toContain('resume-process');
  });

  describe('handler behavior', () => {
    beforeEach(() => {
      ipcHandlers.init({
        getWindow: () => ({
          webContents: {
            capturePage: vi.fn(() =>
              Promise.resolve({
                toPNG: () => Buffer.from('png'),
                getSize: () => ({ width: 800, height: 600 }),
              }),
            ),
          },
        }),
        getStats: () => ({
          totalFiles: 5,
          totalSensitive: 1,
          aiSensitive: 0,
          uptimeMs: 10000,
          monitoringStarted: Date.now() - 10000,
          peakAgents: 1,
          currentAgents: 1,
          aiAgentCount: 1,
          otherAgentCount: 0,
          uniqueAgents: ['Claude'],
        }),
        getResourceUsage: () => ({ memMB: 50 }),
        getLatestAgents: () => [
          { agent: 'Claude', pid: 1234, category: 'ai' },
          { agent: 'Copilot', pid: 5678, category: 'ai' },
        ],
        setOtherPanelExpanded: vi.fn(),
      });
      ipcHandlers.register();
    });

    it('get-stats returns stats from deps', async () => {
      const handler = getHandler('get-stats');
      const result = handler();
      expect(result.totalFiles).toBe(5);
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

    it('forwards patch and clear intent without exposing settings in the response', () => {
      const options = { patch: true, clearAnthropicApiKey: true };
      expect(getHandler('save-settings')(null, { anthropicApiKey: '' }, options)).toEqual({
        success: true,
      });
      expect(mockConfig.saveSettings).toHaveBeenCalledExactlyOnceWith(
        { anthropicApiKey: '' },
        options,
      );
    });

    it('does not strip invalid options or apply settings after a rejected save', () => {
      const options = { patch: 'true', unknown: true };
      mockConfig.saveSettings.mockImplementationOnce(() => {
        throw new Error('Invalid settings save options');
      });
      expect(() => getHandler('save-settings')(null, { darkMode: true }, options)).toThrow(
        'Invalid settings save options',
      );
      expect(mockConfig.saveSettings).toHaveBeenCalledExactlyOnceWith({ darkMode: true }, options);
      expect(mockConfig.applySettings).not.toHaveBeenCalled();
    });

    it('get-audit-entries-before passes cursor, limit and types through untouched', () => {
      // Validation of all three lives in getEntriesBefore, so the handler forwards them raw.
      const handler = getHandler('get-audit-entries-before');
      handler(null, '2026-08-25T00:00:00.000Z', 25, ['file-access', 'network-connection']);
      expect(mockAudit.getEntriesBefore).toHaveBeenCalledWith('2026-08-25T00:00:00.000Z', 25, [
        'file-access',
        'network-connection',
      ]);
    });

    it('get-all-permissions splits agent vs instance permissions', () => {
      const handler = getHandler('get-all-permissions');
      const result = handler();
      expect(result.permissions).toEqual({ Copilot: 'monitor' });
      expect(result.instancePermissions).toEqual({ 'Claude::vscode': 'allow' });
      expect(result.seenAgents).toEqual(['Claude', 'Copilot']);
    });

    it('analyze-agent returns error when no API key', async () => {
      mockConfig.getSettings.mockReturnValueOnce({ anthropicApiKey: '' });
      const handler = getHandler('analyze-agent');
      const result = handler(null, 'Claude');
      await expect(result).resolves.toMatchObject({ success: false });
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

    it('open-threat-report generates HTML from structured data', async () => {
      const handler = getHandler('open-threat-report');
      const data = {
        riskRating: 'HIGH',
        summary: 'Test summary',
        findings: ['Finding 1'],
        recommendations: ['Rec 1'],
        counts: { totalFiles: 10, totalSensitive: 2, totalAgents: 3, totalNet: 1 },
      };
      const result = await handler(null, data);
      expect(result.success).toBe(true);
      expect(result.path).toContain('aegis-threat-report-');
      if (fs.existsSync(result.path)) {
        const content = fs.readFileSync(result.path, 'utf-8');
        expect(content).toContain('Test summary');
        expect(content).toContain('Finding 1');
        expect(content).toContain('AEGIS Threat Analysis Report');
        fs.unlinkSync(result.path);
      }
    });

    it('open-threat-report escapes HTML in data fields', async () => {
      const handler = getHandler('open-threat-report');
      const data = {
        riskRating: '<script>alert(1)</script>',
        summary: '<img onerror=alert(1)>',
        findings: ['<b>xss</b>'],
        recommendations: [],
        counts: { totalFiles: 0, totalSensitive: 0, totalAgents: 0, totalNet: 0 },
      };
      const result = await handler(null, data);
      expect(result.success).toBe(true);
      if (fs.existsSync(result.path)) {
        const content = fs.readFileSync(result.path, 'utf-8');
        expect(content).not.toContain('<script>');
        expect(content).not.toContain('<img');
        expect(content).not.toContain('<b>xss</b>');
        expect(content).toContain('&lt;script&gt;');
        fs.unlinkSync(result.path);
      }
    });

    it('keeps a provider riskLevel and captured counts when opening the HTML report', async () => {
      const result = await getHandler('open-threat-report')(null, {
        riskLevel: 'HIGH',
        summary: 'Scoped fixture',
        counts: { totalFiles: 7, totalSensitive: 2, totalAgents: 1, totalNet: 3 },
      });
      expect(result.success).toBe(true);
      try {
        const content = fs.readFileSync(result.path, 'utf8');
        expect(content).toContain('>HIGH<');
        expect(content).not.toContain('UNKNOWN');
        expect(content).toContain('>7<');
      } finally {
        fs.unlinkSync(result.path);
      }
    });

    it('open-threat-report rejects non-object data', async () => {
      const handler = getHandler('open-threat-report');
      const result = await handler(null, '<html>raw</html>');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid report data');
    });

    it('reveal-in-explorer calls shell.showItemInFolder for existing paths', () => {
      const handler = getHandler('reveal-in-explorer');
      // Use a path that exists (the test file itself)
      const existingPath = path.resolve(__dirname, '../../package.json');
      const result = handler(null, existingPath);
      expect(mockElectron.shell.showItemInFolder).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('reveal-in-explorer rejects path traversal with ..', () => {
      const handler = getHandler('reveal-in-explorer');
      const result = handler(null, '/some/path/../../etc/passwd');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Path traversal not allowed');
      expect(mockElectron.shell.showItemInFolder).not.toHaveBeenCalled();
    });

    it('reveal-in-explorer rejects invalid path types', () => {
      const handler = getHandler('reveal-in-explorer');
      expect(handler(null, null).success).toBe(false);
      expect(handler(null, '').success).toBe(false);
      expect(handler(null, 123).success).toBe(false);
    });

    it('kill-process rejects invalid PID at IPC boundary', async () => {
      const handler = getHandler('kill-process');
      for (const bad of [0, -1, 1.5, 'abc', null, undefined]) {
        const result = await handler(null, bad);
        expect(result).toEqual({ success: false, error: 'Invalid PID' });
      }
      expect(mockPlatform.killProcess).not.toHaveBeenCalled();
    });

    it('suspend-process rejects invalid PID at IPC boundary', async () => {
      const handler = getHandler('suspend-process');
      for (const bad of [0, -1, 1.5, 'abc', null, undefined]) {
        const result = await handler(null, bad);
        expect(result).toEqual({ success: false, error: 'Invalid PID' });
      }
      expect(mockPlatform.suspendProcess).not.toHaveBeenCalled();
    });

    it('resume-process rejects invalid PID at IPC boundary', async () => {
      const handler = getHandler('resume-process');
      for (const bad of [0, -1, 1.5, 'abc', null, undefined]) {
        const result = await handler(null, bad);
        expect(result).toEqual({ success: false, error: 'Invalid PID' });
      }
      expect(mockPlatform.resumeProcess).not.toHaveBeenCalled();
    });

    it.each(['kill-process', 'suspend-process', 'resume-process'])(
      '%s rejects a reused PID or observation outage for stamped requests',
      async (channel) => {
        let reliable = true;
        let currentId = '1234:new';
        ipcHandlers.init({
          getStats: () => ({
            appHealth: { populationReliable: reliable },
            observationGap: { state: 'NONE' },
          }),
          getLatestAgents: () => [
            { agent: 'Claude', pid: 1234, instanceId: currentId, instanceIdSource: 'os' },
          ],
        });
        const handler = getHandler(channel);
        expect(await handler(null, { pid: 1234, instanceId: '1234:old' })).toEqual({
          success: false,
          error: 'Process instance changed or is no longer observed',
        });
        reliable = false;
        expect((await handler(null, { pid: 1234, instanceId: currentId })).success).toBe(false);
        expect(mockPlatform.killProcess).not.toHaveBeenCalled();
        expect(mockPlatform.suspendProcess).not.toHaveBeenCalled();
        expect(mockPlatform.resumeProcess).not.toHaveBeenCalled();
        reliable = true;
        expect((await handler(null, { pid: 1234, instanceId: currentId })).success).toBe(true);
      },
    );

    it('kill-process accepts monitored PID', async () => {
      const handler = getHandler('kill-process');
      const result = await handler(null, 1234);
      expect(result).toEqual({ success: true });
      expect(mockPlatform.killProcess).toHaveBeenCalledWith(1234);
    });

    it('kill-process rejects unmonitored PID', async () => {
      const handler = getHandler('kill-process');
      const result = await handler(null, 9999);
      expect(result).toEqual({ success: false, error: 'Process not monitored by Aegis' });
      expect(mockPlatform.killProcess).not.toHaveBeenCalled();
    });

    it('suspend-process rejects unmonitored PID', async () => {
      const handler = getHandler('suspend-process');
      const result = await handler(null, 9999);
      expect(result).toEqual({ success: false, error: 'Process not monitored by Aegis' });
      expect(mockPlatform.suspendProcess).not.toHaveBeenCalled();
    });

    it('resume-process rejects unmonitored PID', async () => {
      const handler = getHandler('resume-process');
      const result = await handler(null, 9999);
      expect(result).toEqual({ success: false, error: 'Process not monitored by Aegis' });
      expect(mockPlatform.resumeProcess).not.toHaveBeenCalled();
    });

    it('kill-process refuses AEGIS own PID even when it is monitored', async () => {
      // Inject AEGIS's own PID as a monitored agent so the monitored-agent
      // check would otherwise pass — only the own-PID self-guard must block it.
      ipcHandlers.init({
        getWindow: () => null,
        getStats: () => ({}),
        getResourceUsage: () => ({}),
        getLatestAgents: () => [{ agent: 'Self', pid: process.pid, category: 'ai' }],
        setOtherPanelExpanded: vi.fn(),
      });
      ipcHandlers.register();
      mockPlatform.killProcess.mockClear();
      const handler = getHandler('kill-process');
      const result = await handler(null, process.pid);
      expect(result).toEqual({ success: false, error: 'Refusing to act on AEGIS itself' });
      expect(mockPlatform.killProcess).not.toHaveBeenCalled();
    });

    it('suspend-process refuses AEGIS own PID even when it is monitored', async () => {
      ipcHandlers.init({
        getWindow: () => null,
        getStats: () => ({}),
        getResourceUsage: () => ({}),
        getLatestAgents: () => [{ agent: 'Self', pid: process.pid, category: 'ai' }],
        setOtherPanelExpanded: vi.fn(),
      });
      ipcHandlers.register();
      mockPlatform.suspendProcess.mockClear();
      const handler = getHandler('suspend-process');
      const result = await handler(null, process.pid);
      expect(result).toEqual({ success: false, error: 'Refusing to act on AEGIS itself' });
      expect(mockPlatform.suspendProcess).not.toHaveBeenCalled();
    });

    it('resume-process refuses AEGIS own PID even when it is monitored', async () => {
      // Mirror of the kill/suspend own-PID tests: inject AEGIS's own PID as a
      // monitored agent so the monitored-agent check passes — only the own-PID
      // self-guard must block resume-process.
      ipcHandlers.init({
        getWindow: () => null,
        getStats: () => ({}),
        getResourceUsage: () => ({}),
        getLatestAgents: () => [{ agent: 'Self', pid: process.pid, category: 'ai' }],
        setOtherPanelExpanded: vi.fn(),
      });
      ipcHandlers.register();
      mockPlatform.resumeProcess.mockClear();
      const handler = getHandler('resume-process');
      const result = await handler(null, process.pid);
      expect(result).toEqual({ success: false, error: 'Refusing to act on AEGIS itself' });
      expect(mockPlatform.resumeProcess).not.toHaveBeenCalled();
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
