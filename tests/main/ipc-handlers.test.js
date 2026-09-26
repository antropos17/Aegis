import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import Module from 'module';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath, pathToFileURL } from 'url';

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
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
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
  hasPendingLegacyApiKey: vi.fn(() => false),
  saveSettings: vi.fn(),
  applySettings: vi.fn(),
  getAgentPermissions: vi.fn(() => ({ fileAccess: 'allow' })),
  getInstancePermissions: vi.fn(() => ({ fileAccess: 'allow' })),
  saveInstancePermissions: vi.fn(),
  getDefaultPermissions: vi.fn(() => ({ fileAccess: 'monitor' })),
  getCustomAgents: vi.fn(() => []),
  isSafeRegex: vi.fn((pattern) => {
    try {
      new RegExp(pattern);
      return true;
    } catch (_) {
      return false;
    }
  }),
  saveCustomAgents: vi.fn(),
  addFalsePositive: vi.fn(),
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
const mockRules = {
  getAllRules: vi.fn(() => new Map([['rule-a', { id: 'rule-a' }]])),
  reloadRules: vi.fn(),
};
const mockBlocklist = {
  add: vi.fn((entry) => entry),
  remove: vi.fn(() => true),
  list: vi.fn(() => []),
};

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
  getParentProcessMap: vi.fn(async () => new Map()),
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
const rulesPath = path.resolve(__dirname, '../../src/main/rule-loader.js');
const blocklistPath = path.resolve(__dirname, '../../src/main/blocklist.js');
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
    if (resolved + '.js' === rulesPath) return mockRules;
    if (resolved + '.js' === blocklistPath) return mockBlocklist;
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
  let threatTempRoot;

  beforeEach(async () => {
    // Clear handler registrations
    for (const key of Object.keys(handlers)) delete handlers[key];
    for (const key of Object.keys(onHandlers)) delete onHandlers[key];

    // Reset mock calls
    mockElectron.ipcMain.handle.mockClear();
    mockElectron.ipcMain.on.mockClear();
    mockElectron.shell.showItemInFolder.mockClear();
    mockElectron.shell.openExternal.mockClear();
    mockElectron.shell.openPath.mockReset();
    mockElectron.dialog.showSaveDialog.mockReset();
    mockElectron.dialog.showOpenDialog.mockReset();
    mockElectron.dialog.showMessageBox.mockReset();
    mockElectron.app.getPath.mockReset().mockReturnValue(os.tmpdir());
    mockLogger.error.mockClear();
    mockLogger.warn.mockClear();
    mockExporter.exportLog.mockReset().mockResolvedValue({ success: true });
    mockExporter.exportCsv.mockReset().mockResolvedValue({ success: true });
    mockExporter.generateReport.mockReset().mockResolvedValue({ success: true });
    mockAudit.getStats.mockClear();
    mockAudit.getEntriesBefore.mockClear();
    mockAudit.getLogDir.mockClear();
    mockAudit.prepareExport.mockClear();
    mockStreamExport.writeAuditExport.mockClear();
    mockPlatform.killProcess.mockClear();
    mockPlatform.suspendProcess.mockClear();
    mockPlatform.resumeProcess.mockClear();
    mockPlatform.getParentProcessMap.mockReset().mockResolvedValue(new Map());
    mockElectron.Notification.mockClear();
    mockElectron.Notification.isSupported.mockClear().mockReturnValue(true);

    mockConfig.getSettings.mockReset().mockReturnValue({
      anthropicApiKey: 'key',
      agentPermissions: { 'Claude::vscode': 'allow', Copilot: 'monitor' },
      seenAgents: ['Claude', 'Copilot'],
    });
    mockConfig.saveSettings.mockClear();
    mockConfig.applySettings.mockClear();
    mockConfig.saveInstancePermissions.mockClear();
    mockConfig.getDefaultPermissions.mockClear();
    mockConfig.getCustomAgents.mockClear();
    mockConfig.saveCustomAgents.mockClear();
    mockConfig.addFalsePositive.mockClear();
    mockAnalysis.analyzeAgentActivity
      .mockReset()
      .mockResolvedValue({ success: true, analysis: 'ok' });
    mockAnalysis.analyzeSessionActivity
      .mockReset()
      .mockResolvedValue({ success: true, summary: 'ok' });
    mockRules.getAllRules.mockClear();
    mockRules.reloadRules.mockClear();
    mockBlocklist.add.mockClear();
    mockBlocklist.remove.mockClear();
    mockBaselines.getBaselines.mockClear().mockReturnValue({ agents: {} });
    mockBaselines.getSessionData.mockClear().mockReturnValue({});

    vi.resetModules();
    const mod = await import('../../src/main/ipc-handlers.js');
    ipcHandlers = mod.default;
  });

  afterEach(() => {
    if (threatTempRoot) {
      expect(path.dirname(threatTempRoot)).toBe(path.resolve(os.tmpdir()));
      fs.rmSync(threatTempRoot, { recursive: true, force: true });
      threatTempRoot = undefined;
    }
  });

  function getHandler(channel) {
    return handlers[channel];
  }

  function registerOwnedRenderer(extraDeps = {}) {
    const rendererUrl =
      process.env.VITE_DEV_SERVER_URL ||
      pathToFileURL(path.join(__dirname, '../../dist/renderer/index.html')).href;
    const frame = { url: rendererUrl, isDestroyed: vi.fn(() => false) };
    const contents = {
      mainFrame: frame,
      getURL: vi.fn(() => rendererUrl),
      isDestroyed: vi.fn(() => false),
    };
    const window = { webContents: contents, isDestroyed: vi.fn(() => false) };
    ipcHandlers.init({ getWindow: () => window, ...extraDeps });
    ipcHandlers.register();
    return { window, contents, frame, event: { sender: contents, senderFrame: frame } };
  }

  function registerThreatRenderer() {
    threatTempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-threat-report-test-'));
    mockElectron.app.getPath.mockReturnValue(threatTempRoot);
    return registerOwnedRenderer();
  }

  it.each([
    'export-log',
    'export-csv',
    'export-agent-database',
    'import-agent-database',
    'export-config',
    'reveal-in-explorer',
    'test-notification',
  ])('%s denies a foreign renderer before opening a dialog or acting', async (channel) => {
    const { event } = registerOwnedRenderer();
    expect(await getHandler(channel)({ ...event, sender: {} }, '/private/fixture')).toEqual({
      success: false,
      error: 'Renderer request denied',
    });
    expect(mockExporter.exportLog).not.toHaveBeenCalled();
    expect(mockExporter.exportCsv).not.toHaveBeenCalled();
    expect(mockElectron.dialog.showSaveDialog).not.toHaveBeenCalled();
    expect(mockElectron.dialog.showOpenDialog).not.toHaveBeenCalled();
    expect(mockElectron.shell.showItemInFolder).not.toHaveBeenCalled();
    expect(mockElectron.Notification).not.toHaveBeenCalled();
  });

  it.each([
    ['export-agent-database', 'Agent Database'],
    ['export-config', 'Config'],
  ])('%s refuses to write when its renderer changes during the save dialog', async (channel) => {
    const { contents, event } = registerOwnedRenderer();
    let finishDialog;
    mockElectron.dialog.showSaveDialog.mockImplementationOnce(
      () => new Promise((resolve) => (finishDialog = resolve)),
    );
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    try {
      const pending = getHandler(channel)(event);
      expect(mockElectron.dialog.showSaveDialog).toHaveBeenCalledOnce();
      contents.mainFrame = { url: 'file:///foreign.html' };
      finishDialog({ filePath: path.join(os.tmpdir(), 'denied-export.json') });
      expect(await pending).toEqual({ success: false, error: 'Renderer request denied' });
      expect(write).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
    }
  });

  it('import-agent-database refuses to read after its renderer changes during the open dialog', async () => {
    const { contents, event } = registerOwnedRenderer();
    let finishDialog;
    mockElectron.dialog.showOpenDialog.mockImplementationOnce(
      () => new Promise((resolve) => (finishDialog = resolve)),
    );
    const read = vi.spyOn(fs, 'readFileSync');
    try {
      const pending = getHandler('import-agent-database')(event);
      expect(mockElectron.dialog.showOpenDialog).toHaveBeenCalledOnce();
      contents.mainFrame = { url: 'file:///foreign.html' };
      finishDialog({ filePaths: [path.join(os.tmpdir(), 'denied-import.json')] });
      expect(await pending).toEqual({ success: false, error: 'Renderer request denied' });
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });

  it.each([
    ['export-log', 'exportLog'],
    ['export-csv', 'exportCsv'],
  ])('%s passes a live ownership check to the exporter', async (channel, method) => {
    const { contents, event } = registerOwnedRenderer();
    mockExporter[method].mockImplementationOnce(async (canComplete) => {
      expect(canComplete()).toBe(true);
      contents.mainFrame = { url: 'file:///foreign.html' };
      expect(canComplete()).toBe(false);
      return { success: false };
    });
    expect(await getHandler(channel)(event)).toEqual({
      success: false,
      error: 'Renderer request denied',
    });
    expect(mockExporter[method]).toHaveBeenCalledOnce();
  });

  it.each([
    ['export-log', 'exportLog'],
    ['export-csv', 'exportCsv'],
  ])('%s still completes for its owned renderer', async (channel, method) => {
    const { event } = registerOwnedRenderer();
    expect(await getHandler(channel)(event)).toEqual({ success: true });
    expect(mockExporter[method]).toHaveBeenCalledOnce();
    expect(mockExporter[method].mock.calls[0][0]()).toBe(true);
  });

  it('import-agent-database still returns the selected agent records to its owned renderer', async () => {
    const { event } = registerOwnedRenderer();
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({
      filePaths: ['selected-agents.json'],
    });
    const read = vi
      .spyOn(fs, 'readFileSync')
      .mockReturnValueOnce('{"customAgents":[{"name":"Fixture"}]}');
    try {
      expect(await getHandler('import-agent-database')(event)).toEqual({
        success: true,
        agents: [{ name: 'Fixture' }],
      });
    } finally {
      read.mockRestore();
    }
  });

  it.each([
    ['export-log', 'exportLog'],
    ['export-csv', 'exportCsv'],
  ])(
    '%s keeps an exporter failure out of persistent logs and IPC results',
    async (channel, method) => {
      const { event } = registerOwnedRenderer();
      mockExporter[method].mockRejectedValueOnce(new Error('PRIVATE_EXPORT_PATH_CANARY'));
      const result = await getHandler(channel)(event);
      expect(result.success).toBe(false);
      expect(JSON.stringify(result)).not.toContain('PRIVATE_EXPORT_PATH_CANARY');
      expect(JSON.stringify(mockLogger.error.mock.calls)).not.toContain(
        'PRIVATE_EXPORT_PATH_CANARY',
      );
    },
  );

  it.each(['export-agent-database', 'export-config'])(
    '%s keeps a native dialog failure out of persistent logs and IPC results',
    async (channel) => {
      const { event } = registerOwnedRenderer();
      mockElectron.dialog.showSaveDialog.mockRejectedValueOnce(
        new Error('PRIVATE_DIALOG_PATH_CANARY'),
      );
      const result = await getHandler(channel)(event);
      expect(result.success).toBe(false);
      expect(JSON.stringify(result)).not.toContain('PRIVATE_DIALOG_PATH_CANARY');
      expect(JSON.stringify(mockLogger.error.mock.calls)).not.toContain(
        'PRIVATE_DIALOG_PATH_CANARY',
      );
    },
  );

  it('import-agent-database hides a native dialog failure from IPC results', async () => {
    const { event } = registerOwnedRenderer();
    mockElectron.dialog.showOpenDialog.mockRejectedValueOnce(
      new Error('PRIVATE_IMPORT_PATH_CANARY'),
    );
    const result = await getHandler('import-agent-database')(event);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_IMPORT_PATH_CANARY');
  });

  it('import-agent-database hides malformed selected file content from IPC results and logs', async () => {
    const { event } = registerOwnedRenderer();
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({
      filePaths: ['private-import.json'],
    });
    const read = vi.spyOn(fs, 'readFileSync').mockReturnValueOnce('PRIVATE_IMPORT_CONTENT_CANARY');
    try {
      const result = await getHandler('import-agent-database')(event);
      expect(result).toEqual({ success: false, error: 'Agent database import failed' });
      expect(JSON.stringify(mockLogger.error.mock.calls)).not.toContain(
        'PRIVATE_IMPORT_CONTENT_CANARY',
      );
    } finally {
      read.mockRestore();
    }
  });

  function registerObservedProcess(extraDeps = {}) {
    const agent = {
      agent: 'Claude',
      pid: 1234,
      startTime: 1700000000000,
      instanceId: '1234:1700000000000',
      instanceIdSource: 'os',
      generationWitness: '17000000000000000',
      generationWitnessSource: 'createTime100ns',
    };
    mockPlatform.getParentProcessMap.mockResolvedValue(
      new Map([
        [
          agent.pid,
          {
            startTime: agent.startTime,
            createTime100ns: agent.generationWitness,
            witness: agent.generationWitness,
            witnessSource: agent.generationWitnessSource,
          },
        ],
      ]),
    );
    const owned = registerOwnedRenderer({
      getStats: () => ({
        appHealth: {
          populationReliable: true,
          populationAsOf: Date.now(),
          identityDegraded: false,
        },
        monitoringPaused: false,
        observationGap: { state: 'NONE' },
      }),
      getLatestAgents: () => [agent],
      ...extraDeps,
    });
    return {
      ...owned,
      agent,
      request: {
        pid: agent.pid,
        instanceId: agent.instanceId,
        generationWitness: agent.generationWitness,
        generationWitnessSource: agent.generationWitnessSource,
      },
    };
  }

  it.each([
    'get-stats',
    'get-resource-usage',
    'get-settings',
    'get-all-permissions',
    'get-agent-database',
    'get-custom-agents',
    'get-false-positives',
    'rules:getAll',
    'blocklist-list',
  ])('%s denies a foreign renderer before returning local records', (channel) => {
    const { event } = registerOwnedRenderer();
    expect(getHandler(channel)({ ...event, sender: {} })).toEqual({
      success: false,
      error: 'Renderer request denied',
    });
  });

  it.each([
    ['foreign sender', ({ event }) => ({ ...event, sender: {} })],
    [
      'child frame',
      ({ event }) => ({
        ...event,
        senderFrame: { url: event.senderFrame.url, isDestroyed: () => false },
      }),
    ],
    [
      'stale frame',
      ({ event, contents }) => {
        contents.mainFrame = { ...event.senderFrame };
        return event;
      },
    ],
    [
      'foreign frame document',
      ({ event, frame }) => {
        frame.url = 'https://other.invalid/';
        return event;
      },
    ],
    [
      'foreign webContents document',
      ({ event, contents }) => {
        contents.getURL.mockReturnValue('https://other.invalid/');
        return event;
      },
    ],
  ])('denies settings and policy mutations from a %s before side effects', async (_name, alter) => {
    const updates = { preferencesChanged: vi.fn() };
    const renderer = registerOwnedRenderer({ updates });
    const event = alter(renderer);
    const denied = { success: false, error: 'Renderer request denied' };
    for (const [channel, args] of [
      ['save-settings', [{ darkMode: true }]],
      ['save-agent-permissions', [{ Claude: { fileAccess: 'allow' } }]],
      ['save-instance-permissions', [null]],
      ['save-custom-agents', [[{ id: 'custom' }]]],
      ['reset-permissions-to-defaults', []],
      ['import-config', []],
      ['add-false-positive', [{ agentName: 'Claude', pattern: 'safe', timestamp: 1 }]],
      ['rules:reload', []],
      ['blocklist-add', [{ signature: 'claude-code', pid: null }]],
      ['blocklist-remove', [{ signature: 'claude-code', pid: null }]],
    ]) {
      expect(await getHandler(channel)(event, ...args), channel).toEqual(denied);
    }
    expect(mockConfig.getSettings).not.toHaveBeenCalled();
    expect(mockConfig.saveSettings).not.toHaveBeenCalled();
    expect(mockConfig.applySettings).not.toHaveBeenCalled();
    expect(mockConfig.saveInstancePermissions).not.toHaveBeenCalled();
    expect(mockConfig.getDefaultPermissions).not.toHaveBeenCalled();
    expect(mockConfig.getCustomAgents).not.toHaveBeenCalled();
    expect(mockConfig.saveCustomAgents).not.toHaveBeenCalled();
    expect(mockConfig.addFalsePositive).not.toHaveBeenCalled();
    expect(updates.preferencesChanged).not.toHaveBeenCalled();
    expect(mockRules.reloadRules).not.toHaveBeenCalled();
    expect(mockRules.getAllRules).not.toHaveBeenCalled();
    expect(mockBlocklist.add).not.toHaveBeenCalled();
    expect(mockBlocklist.remove).not.toHaveBeenCalled();
    expect(mockElectron.dialog.showOpenDialog).not.toHaveBeenCalled();
  });

  it('preserves successful settings and policy mutation responses for the owned renderer', async () => {
    const updates = { preferencesChanged: vi.fn() };
    const { event, window } = registerOwnedRenderer({ updates });
    expect(getHandler('save-settings')(event, { darkMode: true })).toEqual({ success: true });
    expect(mockConfig.saveSettings).toHaveBeenCalledWith({ darkMode: true });
    expect(mockConfig.applySettings).toHaveBeenCalledOnce();
    expect(updates.preferencesChanged).toHaveBeenCalledOnce();

    const agentPermissions = { Claude: { fileAccess: 'block' } };
    expect(getHandler('save-agent-permissions')(event, agentPermissions)).toEqual({
      success: true,
    });
    expect(mockConfig.saveSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ agentPermissions }),
    );
    const instance = {
      agentName: 'Claude',
      parentEditor: 'vscode',
      permissions: { fileAccess: 'allow' },
      cwd: '/fixture/work',
    };
    expect(getHandler('save-instance-permissions')(event, instance)).toEqual({ success: true });
    expect(mockConfig.saveInstancePermissions).toHaveBeenCalledExactlyOnceWith(
      'Claude',
      'vscode',
      instance.permissions,
      '/fixture/work',
    );
    expect(getHandler('reset-permissions-to-defaults')(event)).toEqual({
      permissions: {
        Claude: { fileAccess: 'monitor' },
        Copilot: { fileAccess: 'monitor' },
      },
      seenAgents: ['Claude', 'Copilot'],
    });
    const agents = [{ id: 'custom' }];
    expect(getHandler('save-custom-agents')(event, agents)).toEqual({ success: true });
    expect(mockConfig.saveCustomAgents).toHaveBeenCalledExactlyOnceWith(agents);

    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({
      filePaths: ['/fixture/settings.json'],
    });
    const read = vi.spyOn(fs, 'readFileSync').mockReturnValueOnce('{"darkMode":true}');
    try {
      expect(await getHandler('import-config')(event)).toEqual({ success: true });
      expect(mockElectron.dialog.showOpenDialog).toHaveBeenCalledExactlyOnceWith(
        window,
        expect.objectContaining({ title: 'Import Config' }),
      );
      expect(read).toHaveBeenCalledExactlyOnceWith('/fixture/settings.json', 'utf-8');
      expect(mockConfig.saveSettings).toHaveBeenLastCalledWith({
        darkMode: true,
        anthropicApiKey: 'key',
      });
    } finally {
      read.mockRestore();
    }

    const falsePositive = { agentName: 'Claude', pattern: 'safe', timestamp: 1 };
    expect(getHandler('add-false-positive')(event, falsePositive)).toEqual({ success: true });
    expect(mockConfig.addFalsePositive).toHaveBeenCalledExactlyOnceWith(falsePositive);
    expect(getHandler('rules:reload')(event)).toEqual({ success: true, count: 1 });
    expect(mockRules.reloadRules).toHaveBeenCalledOnce();
    const entry = { signature: 'claude-code', pid: null };
    expect(getHandler('blocklist-add')(event, entry)).toEqual({ success: true, entry });
    expect(getHandler('blocklist-remove')(event, entry)).toEqual({ success: true, removed: true });
    expect(mockBlocklist.add).toHaveBeenCalledExactlyOnceWith(entry);
    expect(mockBlocklist.remove).toHaveBeenCalledExactlyOnceWith(entry);
  });

  it.each([
    [
      'stale frame',
      ({ contents, frame }) => {
        contents.mainFrame = { ...frame };
      },
    ],
    [
      'foreign document',
      ({ contents }) => {
        contents.getURL.mockReturnValue('https://other.invalid/');
      },
    ],
  ])(
    'import-config denies a %s after the native dialog before reading a file',
    async (_name, alter) => {
      const renderer = registerOwnedRenderer();
      let resolveDialog;
      mockElectron.dialog.showOpenDialog.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveDialog = resolve;
        }),
      );
      const read = vi.spyOn(fs, 'readFileSync');
      try {
        const pending = getHandler('import-config')(renderer.event);
        expect(mockElectron.dialog.showOpenDialog).toHaveBeenCalledOnce();
        alter(renderer);
        resolveDialog({ filePaths: ['/fixture/settings.json'] });
        expect(await pending).toEqual({ success: false, error: 'Renderer request denied' });
        expect(read).not.toHaveBeenCalled();
        expect(mockConfig.saveSettings).not.toHaveBeenCalled();
        expect(mockConfig.applySettings).not.toHaveBeenCalled();
      } finally {
        read.mockRestore();
      }
    },
  );

  it.each([
    ['foreign sender', ({ event }) => ({ ...event, sender: {} })],
    [
      'child frame',
      ({ event }) => ({
        ...event,
        senderFrame: { url: event.senderFrame.url, isDestroyed: () => false },
      }),
    ],
    [
      'stale frame',
      ({ event, contents }) => {
        contents.mainFrame = { url: event.senderFrame.url, isDestroyed: () => false };
        return event;
      },
    ],
    [
      'foreign frame document',
      ({ event, frame }) => {
        frame.url = 'https://other.invalid/';
        return event;
      },
    ],
    [
      'foreign webContents document',
      ({ event, contents }) => {
        contents.getURL.mockReturnValue('https://other.invalid/');
        return event;
      },
    ],
  ])('denies every audit IPC call from a %s before reading or exporting', async (_name, alter) => {
    const renderer = registerOwnedRenderer();
    const event = alter(renderer);
    const denied = { success: false, error: 'Renderer request denied' };
    expect(await getHandler('get-audit-stats')(event)).toEqual(denied);
    expect(await getHandler('get-audit-entries-before')(event, '2026-09-01', 25, [])).toEqual(
      denied,
    );
    expect(await getHandler('open-audit-log-dir')(event)).toEqual(denied);
    expect(await getHandler('export-full-audit')(event)).toEqual(denied);
    expect(await getHandler('export-zip')(event)).toEqual(denied);
    expect(mockAudit.getStats).not.toHaveBeenCalled();
    expect(mockAudit.getEntriesBefore).not.toHaveBeenCalled();
    expect(mockAudit.getLogDir).not.toHaveBeenCalled();
    expect(mockAudit.prepareExport).not.toHaveBeenCalled();
    expect(mockElectron.shell.openPath).not.toHaveBeenCalled();
    expect(mockElectron.dialog.showSaveDialog).not.toHaveBeenCalled();
    expect(mockStreamExport.writeAuditExport).not.toHaveBeenCalled();
  });

  it('keeps audit read and export results for the owned renderer', async () => {
    const { event, window } = registerOwnedRenderer();
    const stats = {
      totalEntries: 100,
      totalSize: 5120,
      currentSize: 2048,
      firstEntry: null,
      lastEntry: null,
    };
    expect(getHandler('get-audit-stats')(event)).toEqual(stats);
    expect(mockAudit.getStats).toHaveBeenCalledOnce();
    expect(getHandler('get-audit-entries-before')(event, 'cursor', 25, ['file-access'], 3)).toEqual(
      [],
    );
    expect(mockAudit.getEntriesBefore).toHaveBeenCalledExactlyOnceWith(
      'cursor',
      25,
      ['file-access'],
      3,
    );
    mockElectron.shell.openPath.mockResolvedValueOnce('');
    expect(await getHandler('open-audit-log-dir')(event)).toEqual({ success: true });
    expect(mockElectron.shell.openPath).toHaveBeenCalledExactlyOnceWith('/logs');
    mockElectron.dialog.showSaveDialog
      .mockResolvedValueOnce({ filePath: '/fixture/audit.json' })
      .mockResolvedValueOnce({ filePath: '/fixture/audit.zip' });
    expect(await getHandler('export-full-audit')(event)).toEqual({ success: true });
    expect(await getHandler('export-zip')(event)).toEqual({ success: true });
    expect(mockElectron.dialog.showSaveDialog).toHaveBeenCalledTimes(2);
    expect(mockElectron.dialog.showSaveDialog.mock.calls.map((call) => call[0])).toEqual([
      window,
      window,
    ]);
    expect(mockAudit.prepareExport).toHaveBeenCalledTimes(2);
    expect(mockStreamExport.writeAuditExport).toHaveBeenCalledTimes(2);
    expect(mockStreamExport.writeAuditExport.mock.calls[0][0]).toMatchObject({
      filePath: '/fixture/audit.json',
      files: [],
    });
    expect(mockStreamExport.writeAuditExport.mock.calls[1][0]).toMatchObject({
      filePath: '/fixture/audit.zip',
      files: [],
      zip: true,
    });
  });

  it.each(['export-full-audit', 'export-zip'])(
    '%s denies a stale frame after the save dialog without reading the journal',
    async (channel) => {
      const { event, contents, frame } = registerOwnedRenderer();
      let resolveDialog;
      mockElectron.dialog.showSaveDialog.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveDialog = resolve;
        }),
      );
      const pending = getHandler(channel)(event);
      expect(mockElectron.dialog.showSaveDialog).toHaveBeenCalledOnce();
      contents.mainFrame = { ...frame };
      resolveDialog({ filePath: '/fixture/audit.zip' });
      expect(await pending).toEqual({ success: false, error: 'Renderer request denied' });
      expect(mockAudit.prepareExport).not.toHaveBeenCalled();
      expect(mockStreamExport.writeAuditExport).not.toHaveBeenCalled();
    },
  );

  it.each(['export-full-audit', 'export-zip'])(
    '%s rechecks renderer ownership during the stream and before returning success',
    async (channel) => {
      const { event, contents, frame } = registerOwnedRenderer();
      mockElectron.dialog.showSaveDialog.mockResolvedValueOnce({
        filePath: '/fixture/export.json',
      });
      mockStreamExport.writeAuditExport.mockImplementationOnce(async ({ canComplete }) => {
        expect(canComplete()).toBe(true);
        contents.mainFrame = { ...frame };
        expect(canComplete()).toBe(false);
        return { success: true };
      });
      expect(await getHandler(channel)(event)).toEqual({
        success: false,
        error: 'Renderer request denied',
      });
    },
  );

  it.each(['export-full-audit', 'export-zip'])(
    '%s keeps native dialog failures out of logs and IPC results',
    async (channel) => {
      const { event } = registerOwnedRenderer();
      mockElectron.dialog.showSaveDialog.mockRejectedValueOnce(
        new Error('PRIVATE_AUDIT_PATH_CANARY'),
      );
      const result = await getHandler(channel)(event);
      expect(result.success).toBe(false);
      expect(JSON.stringify(result)).not.toContain('PRIVATE_AUDIT_PATH_CANARY');
      expect(JSON.stringify(mockLogger.error.mock.calls)).not.toContain(
        'PRIVATE_AUDIT_PATH_CANARY',
      );
    },
  );

  it('import-config hides a native dialog failure from the renderer', async () => {
    const { event } = registerOwnedRenderer();
    mockElectron.dialog.showOpenDialog.mockRejectedValueOnce(
      new Error('PRIVATE_CONFIG_PATH_CANARY'),
    );
    const result = await getHandler('import-config')(event);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_CONFIG_PATH_CANARY');
  });

  it('import-config hides malformed selected file content from the renderer', async () => {
    const { event } = registerOwnedRenderer();
    mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({
      filePaths: ['private-settings.json'],
    });
    const read = vi.spyOn(fs, 'readFileSync').mockReturnValueOnce('PRIVATE_CONFIG_CONTENT_CANARY');
    try {
      const result = await getHandler('import-config')(event);
      expect(result).toEqual({ success: false, error: 'Config import failed' });
    } finally {
      read.mockRestore();
    }
  });

  it('open-audit-log-dir does not copy an OS path error into the renderer', async () => {
    const { event } = registerOwnedRenderer();
    mockElectron.shell.openPath.mockResolvedValueOnce('PRIVATE_AUDIT_DIR_CANARY');
    const result = await getHandler('open-audit-log-dir')(event);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_AUDIT_DIR_CANARY');
  });

  it('opens each exact AEGIS setup guide directly for the owned top-level renderer', async () => {
    const { event } = registerOwnedRenderer();
    for (const file of [
      'ACTION-MCP-CONFIG.md',
      'ACTION-MCP-REVIEW.md',
      'ACTION-DELETE-FILE.md',
      'MCP-STDIO-GATEWAY.md',
      'ACTION-MCP-STATUS.md',
    ]) {
      const url = `https://github.com/antropos17/Aegis/blob/master/docs/${file}`;
      expect(await handlers['open-external-url'](event, url)).toEqual({ success: true });
      expect(mockElectron.shell.openExternal).toHaveBeenLastCalledWith(url);
    }
    expect(mockElectron.dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it('requires a parented Cancel-default confirmation for catalog and modified guide URLs', async () => {
    const { event, window } = registerOwnedRenderer();
    const vendor = 'HTTPS://Example.COM:443/Website?source=catalog';
    mockElectron.dialog.showMessageBox.mockResolvedValueOnce({ response: 0 });
    expect(await handlers['open-external-url'](event, vendor)).toEqual({
      success: false,
      error: 'External URL cancelled',
    });
    expect(mockElectron.shell.openExternal).not.toHaveBeenCalled();
    expect(mockElectron.dialog.showMessageBox).toHaveBeenCalledWith(
      window,
      expect.objectContaining({
        defaultId: 0,
        cancelId: 0,
        buttons: ['Cancel / Cancelar', 'Open website / Abrir site'],
        detail:
          'Origin / Origem: https://example.com\n\nFull URL / URL completa:\nhttps://example.com/Website?source=catalog',
      }),
    );
    mockElectron.dialog.showMessageBox.mockResolvedValueOnce({ response: 1 });
    expect(await handlers['open-external-url'](event, vendor)).toEqual({ success: true });
    expect(mockElectron.shell.openExternal).toHaveBeenCalledExactlyOnceWith(
      'https://example.com/Website?source=catalog',
    );
    const guideWithQuery =
      'https://github.com/antropos17/Aegis/blob/master/docs/ACTION-MCP-CONFIG.md?next=elsewhere';
    mockElectron.dialog.showMessageBox.mockResolvedValueOnce({ response: 0 });
    expect(await handlers['open-external-url'](event, guideWithQuery)).toMatchObject({
      success: false,
    });
    expect(mockElectron.dialog.showMessageBox).toHaveBeenCalledTimes(3);
  });

  it('rejects malformed inputs and foreign sender frames before a dialog or shell call', async () => {
    const { event, contents } = registerOwnedRenderer();
    const website = 'https://example.com';
    for (const value of [
      null,
      {},
      'https://github.com@evil.test/',
      'https://example.com/' + 'x'.repeat(2048),
    ]) {
      expect(await handlers['open-external-url'](event, value)).toMatchObject({ success: false });
    }
    expect(await handlers['open-external-url']({ ...event, sender: {} }, website)).toEqual({
      success: false,
      error: 'Renderer request denied',
    });
    expect(
      await handlers['open-external-url'](
        { ...event, senderFrame: { url: event.senderFrame.url } },
        website,
      ),
    ).toMatchObject({ success: false });
    contents.getURL.mockReturnValue('https://evil.test/');
    expect(await handlers['open-external-url'](event, website)).toMatchObject({ success: false });
    expect(mockElectron.dialog.showMessageBox).not.toHaveBeenCalled();
    expect(mockElectron.shell.openExternal).not.toHaveBeenCalled();
  });

  it('fails closed if the frame or app document changes while the native dialog is open', async () => {
    const { event, contents, frame } = registerOwnedRenderer();
    let answer;
    mockElectron.dialog.showMessageBox.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const pending = handlers['open-external-url'](event, 'https://example.com/vendor');
    contents.mainFrame = { ...frame };
    answer({ response: 1 });
    expect(await pending).toEqual({ success: false, error: 'Renderer request denied' });
    expect(mockElectron.shell.openExternal).not.toHaveBeenCalled();

    contents.mainFrame = frame;
    mockElectron.dialog.showMessageBox.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const second = handlers['open-external-url'](event, 'https://example.com/vendor');
    contents.getURL.mockReturnValue('file:///elsewhere/index.html');
    answer({ response: 1 });
    expect(await second).toMatchObject({ success: false });
    expect(mockElectron.shell.openExternal).not.toHaveBeenCalled();
  });

  it('returns generic errors when confirmation or shell opening fails', async () => {
    const { event } = registerOwnedRenderer();
    mockElectron.dialog.showMessageBox.mockRejectedValueOnce(new Error('sensitive-query=123'));
    expect(await handlers['open-external-url'](event, 'https://example.com')).toEqual({
      success: false,
      error: 'External URL confirmation unavailable',
    });
    mockElectron.dialog.showMessageBox.mockResolvedValueOnce({ response: 1 });
    mockElectron.shell.openExternal.mockRejectedValueOnce(new Error('sensitive-query=123'));
    expect(await handlers['open-external-url'](event, 'https://example.com')).toEqual({
      success: false,
      error: 'External URL could not be opened',
    });
  });

  it.each(['export-full-audit', 'export-zip'])(
    '%s reports incomplete history without writing a partial file',
    async (channel) => {
      const { event } = registerOwnedRenderer();
      mockElectron.dialog.showSaveDialog.mockClear();
      mockElectron.dialog.showSaveDialog.mockResolvedValue({ filePath: '/fixture/export.json' });
      const write = vi.spyOn(fs, 'writeFileSync');
      const message =
        'Audit export incomplete: a log file could not be read or contains invalid JSON.';
      mockAudit.prepareExport.mockImplementationOnce(() => {
        throw new Error(message);
      });
      try {
        expect(await getHandler(channel)(event)).toEqual({
          success: false,
          error: 'Audit export incomplete',
        });
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
      const { event } = registerOwnedRenderer();
      mockElectron.dialog.showSaveDialog.mockResolvedValue({});
      mockAudit.prepareExport.mockClear();
      expect(await getHandler(channel)(event)).toEqual({ success: false });
      expect(mockAudit.prepareExport).not.toHaveBeenCalled();
    },
  );

  it('excludes provider credentials from configuration exports', async () => {
    const { event } = registerOwnedRenderer();
    mockElectron.dialog.showSaveDialog.mockResolvedValueOnce({ filePath: '/fixture/config.json' });
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {});
    try {
      expect(await handlers['export-config'](event)).toMatchObject({ success: true });
      const exported = JSON.parse(write.mock.calls[0][1]);
      expect(exported).not.toHaveProperty('anthropicApiKey');
      expect(exported.seenAgents).toEqual(['Claude', 'Copilot']);
      expect(mockConfig.getSettings().anthropicApiKey).toBe('key');
    } finally {
      write.mockRestore();
    }
  });
  it('reports native audit-folder failures instead of an unconditional success', async () => {
    const { event } = registerOwnedRenderer();
    mockElectron.shell.openPath.mockResolvedValueOnce('Folder unavailable');
    expect(await handlers['open-audit-log-dir'](event)).toEqual({
      success: false,
      error: 'Audit log folder could not be opened',
    });
    mockElectron.shell.openPath.mockRejectedValueOnce(new Error('Shell offline'));
    expect(await handlers['open-audit-log-dir'](event)).toEqual({
      success: false,
      error: 'Audit log folder could not be opened',
    });
    mockElectron.shell.openPath.mockResolvedValueOnce('');
    expect(await handlers['open-audit-log-dir'](event)).toEqual({ success: true });
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
    const { event } = registerOwnedRenderer();
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
      expect(await getHandler('export-zip')(event)).toEqual({ success: true });
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
      const { event } = registerOwnedRenderer({ getStats: () => ({ totalFiles: 5 }) });
      const handler = getHandler('get-stats');
      const result = handler(event);
      expect(result.totalFiles).toBe(5);
    });

    it('get-resource-usage returns resource data', () => {
      const { event } = registerOwnedRenderer({ getResourceUsage: () => ({ memMB: 50 }) });
      const handler = getHandler('get-resource-usage');
      expect(handler(event)).toEqual({ memMB: 50 });
    });

    it('denies generate-report from a foreign sender before generating a file', async () => {
      const { event } = registerOwnedRenderer();
      const handler = getHandler('generate-report');
      expect(await handler({ ...event, sender: {} })).toEqual({
        success: false,
        error: 'Renderer request denied',
      });
      expect(mockExporter.generateReport).not.toHaveBeenCalled();
      expect(await handler(event)).toEqual({ success: true });
      expect(mockExporter.generateReport).toHaveBeenCalledOnce();
    });

    it('redacts a failed generate-report exception in logs and IPC', async () => {
      const { event } = registerOwnedRenderer();
      const privatePath = path.join(os.tmpdir(), 'private-report-canary.html');
      mockExporter.generateReport.mockRejectedValueOnce(new Error(`Cannot open ${privatePath}`));
      const result = await getHandler('generate-report')(event);
      expect(result).toEqual({ success: false, error: 'Session report could not be opened' });
      expect(JSON.stringify(result)).not.toContain(privatePath);
      expect(mockLogger.error).toHaveBeenCalledExactlyOnceWith('IPC generate-report failed');
    });

    it('get-settings returns nonsecret settings and only the provider key state', () => {
      const { event } = registerOwnedRenderer();
      const handler = getHandler('get-settings');
      const source = {
        darkMode: true,
        anthropicApiKey: 'plaintext-provider-key-canary',
        _encryptedApiKey: 'encrypted-provider-blob-canary',
      };
      mockConfig.getSettings.mockReturnValueOnce(source);
      const result = handler(event);
      expect(result).toEqual({
        darkMode: true,
        anthropicApiKeyConfigured: true,
        anthropicApiKeyMigrationPending: false,
      });
      expect(JSON.stringify(result)).not.toContain('plaintext-provider-key-canary');
      expect(JSON.stringify(result)).not.toContain('encrypted-provider-blob-canary');
      expect(source.anthropicApiKey).toBe('plaintext-provider-key-canary');

      mockConfig.getSettings.mockReturnValueOnce({ darkMode: false, anthropicApiKey: '' });
      mockConfig.hasPendingLegacyApiKey.mockReturnValueOnce(true);
      expect(handler(event)).toEqual({
        darkMode: false,
        anthropicApiKeyConfigured: false,
        anthropicApiKeyMigrationPending: true,
      });
    });

    it('save-settings calls config.saveSettings and applySettings', () => {
      const { event } = registerOwnedRenderer();
      const handler = getHandler('save-settings');
      const newSettings = { scanIntervalSec: 5 };
      const result = handler(event, newSettings);
      expect(mockConfig.saveSettings).toHaveBeenCalledWith(newSettings);
      expect(mockConfig.applySettings).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('keeps unknown settings keys out of persistent rejection diagnostics', () => {
      const { event } = registerOwnedRenderer();
      const canary = 'PRIVATE_SETTINGS_KEY_CANARY';
      const result = getHandler('save-settings')(event, { [canary]: true });

      expect(result).toEqual({ success: false, error: `Unknown settings keys: ${canary}` });
      expect(mockLogger.warn).toHaveBeenCalledExactlyOnceWith(
        'ipc-handlers',
        'save-settings rejected: invalid settings',
      );
      expect(JSON.stringify(mockLogger.warn.mock.calls)).not.toContain(canary);
      expect(mockConfig.saveSettings).not.toHaveBeenCalled();
    });

    it('keeps invalid custom regex text out of imported config rejection diagnostics', async () => {
      const { event } = registerOwnedRenderer();
      const canary = '[PRIVATE_REGEX_CANARY';
      mockElectron.dialog.showOpenDialog.mockResolvedValueOnce({
        filePaths: ['/fixture/settings.json'],
      });
      const read = vi
        .spyOn(fs, 'readFileSync')
        .mockReturnValueOnce(JSON.stringify({ customSensitivePatterns: [canary] }));
      try {
        const result = await getHandler('import-config')(event);
        expect(result).toEqual({
          success: false,
          error: 'Invalid imported settings',
        });
        expect(JSON.stringify(result)).not.toContain(canary);
        expect(mockLogger.warn).toHaveBeenCalledExactlyOnceWith(
          'ipc-handlers',
          'import-config rejected: invalid settings',
        );
        expect(JSON.stringify(mockLogger.warn.mock.calls)).not.toContain(canary);
        expect(mockConfig.saveSettings).not.toHaveBeenCalled();
      } finally {
        read.mockRestore();
      }
    });

    it('forwards patch and clear intent without exposing settings in the response', () => {
      const { event } = registerOwnedRenderer();
      const options = { patch: true, clearAnthropicApiKey: true };
      expect(getHandler('save-settings')(event, { anthropicApiKey: '' }, options)).toEqual({
        success: true,
      });
      expect(mockConfig.saveSettings).toHaveBeenCalledExactlyOnceWith(
        { anthropicApiKey: '' },
        options,
      );
    });

    it('does not strip invalid options or apply settings after a rejected save', () => {
      const { event } = registerOwnedRenderer();
      const options = { patch: 'true', unknown: true };
      mockConfig.saveSettings.mockImplementationOnce(() => {
        throw new Error('Invalid settings save options');
      });
      expect(() => getHandler('save-settings')(event, { darkMode: true }, options)).toThrow(
        'Invalid settings save options',
      );
      expect(mockConfig.saveSettings).toHaveBeenCalledExactlyOnceWith({ darkMode: true }, options);
      expect(mockConfig.applySettings).not.toHaveBeenCalled();
    });

    it('get-audit-entries-before passes cursor, limit and types through untouched', () => {
      // Validation of all three lives in getEntriesBefore, so the handler forwards them raw.
      const { event } = registerOwnedRenderer();
      const handler = getHandler('get-audit-entries-before');
      handler(event, '2026-08-25T00:00:00.000Z', 25, ['file-access', 'network-connection']);
      expect(mockAudit.getEntriesBefore).toHaveBeenCalledWith('2026-08-25T00:00:00.000Z', 25, [
        'file-access',
        'network-connection',
      ]);
    });

    it('get-all-permissions splits agent vs instance permissions', () => {
      const { event } = registerOwnedRenderer();
      const handler = getHandler('get-all-permissions');
      const result = handler(event);
      expect(result.permissions).toEqual({ Copilot: 'monitor' });
      expect(result.instancePermissions).toEqual({ 'Claude::vscode': 'allow' });
      expect(result.seenAgents).toEqual(['Claude', 'Copilot']);
    });

    it('analyze-agent returns error when no API key', async () => {
      const { event } = registerOwnedRenderer();
      mockConfig.getSettings.mockReturnValueOnce({ anthropicApiKey: '' });
      const handler = getHandler('analyze-agent');
      const result = handler(event, 'Claude');
      await expect(result).resolves.toMatchObject({ success: false });
      expect(mockElectron.dialog.showMessageBox).not.toHaveBeenCalled();
    });

    it.each(['analyze-agent', 'analyze-session'])(
      '%s rejects a foreign renderer before showing consent or sending activity',
      async (channel) => {
        const { event } = registerOwnedRenderer();
        const result = await getHandler(channel)({ ...event, sender: {} }, 'Claude');
        expect(result).toEqual({ success: false, error: 'Renderer request denied' });
        expect(mockElectron.dialog.showMessageBox).not.toHaveBeenCalled();
        expect(mockAnalysis.analyzeAgentActivity).not.toHaveBeenCalled();
        expect(mockAnalysis.analyzeSessionActivity).not.toHaveBeenCalled();
      },
    );

    it.each(['analyze-agent', 'analyze-session'])(
      '%s requires a parented Cancel-default disclosure before sending activity',
      async (channel) => {
        const { event, window } = registerOwnedRenderer();
        mockElectron.dialog.showMessageBox.mockResolvedValueOnce({ response: 0 });
        const result = await getHandler(channel)(event, 'PRIVATE_ANALYSIS_CANARY');
        expect(result).toEqual({ success: false, error: 'Analysis cancelled' });
        expect(mockElectron.dialog.showMessageBox).toHaveBeenCalledExactlyOnceWith(
          window,
          expect.objectContaining({
            defaultId: 0,
            cancelId: 0,
            buttons: expect.arrayContaining(['Cancel / Cancelar']),
            detail: expect.stringContaining('api.anthropic.com'),
          }),
        );
        const disclosure = JSON.stringify(mockElectron.dialog.showMessageBox.mock.calls);
        expect(disclosure).toContain('file paths');
        expect(disclosure).toContain('network endpoints');
        expect(disclosure).not.toContain('PRIVATE_ANALYSIS_CANARY');
        expect(mockAnalysis.analyzeAgentActivity).not.toHaveBeenCalled();
        expect(mockAnalysis.analyzeSessionActivity).not.toHaveBeenCalled();
      },
    );

    it.each(['analyze-agent', 'analyze-session'])(
      '%s sends activity only after an owned renderer confirms',
      async (channel) => {
        const { event } = registerOwnedRenderer();
        mockElectron.dialog.showMessageBox.mockResolvedValueOnce({ response: 1 });
        const result = await getHandler(channel)(event, 'Claude');
        expect(result.success).toBe(true);
        if (channel === 'analyze-agent') {
          expect(mockAnalysis.analyzeAgentActivity).toHaveBeenCalledExactlyOnceWith('Claude');
          expect(mockAnalysis.analyzeSessionActivity).not.toHaveBeenCalled();
        } else {
          expect(mockAnalysis.analyzeSessionActivity).toHaveBeenCalledExactlyOnceWith();
          expect(mockAnalysis.analyzeAgentActivity).not.toHaveBeenCalled();
        }
      },
    );

    it('denies analysis if the renderer frame changes while native consent is open', async () => {
      const { event, contents, frame } = registerOwnedRenderer();
      let answer;
      mockElectron.dialog.showMessageBox.mockReturnValueOnce(
        new Promise((resolve) => {
          answer = resolve;
        }),
      );
      const pending = getHandler('analyze-session')(event);
      contents.mainFrame = { ...frame };
      answer({ response: 1 });
      expect(await pending).toEqual({ success: false, error: 'Renderer request denied' });
      expect(mockAnalysis.analyzeSessionActivity).not.toHaveBeenCalled();
    });

    it('rejects concurrent analysis requests while the native consent dialog is pending', async () => {
      const { event } = registerOwnedRenderer();
      let answer;
      mockElectron.dialog.showMessageBox.mockReturnValueOnce(
        new Promise((resolve) => {
          answer = resolve;
        }),
      );
      const first = getHandler('analyze-agent')(event, 'Claude');
      expect(await getHandler('analyze-session')(event)).toEqual({
        success: false,
        error: 'Analysis confirmation in progress',
      });
      expect(mockElectron.dialog.showMessageBox).toHaveBeenCalledTimes(1);
      answer({ response: 0 });
      expect(await first).toEqual({ success: false, error: 'Analysis cancelled' });
      expect(mockAnalysis.analyzeAgentActivity).not.toHaveBeenCalled();
      expect(mockAnalysis.analyzeSessionActivity).not.toHaveBeenCalled();
    });

    it('fails closed without exposing a native consent error', async () => {
      const { event } = registerOwnedRenderer();
      mockElectron.dialog.showMessageBox.mockRejectedValueOnce(
        new Error('PRIVATE_CONFIRMATION_FAILURE_CANARY'),
      );
      expect(await getHandler('analyze-session')(event)).toEqual({
        success: false,
        error: 'Analysis confirmation unavailable',
      });
      expect(mockAnalysis.analyzeSessionActivity).not.toHaveBeenCalled();
      expect(JSON.stringify(mockLogger.error.mock.calls)).not.toContain(
        'PRIVATE_CONFIRMATION_FAILURE_CANARY',
      );
    });

    it('test-notification creates and shows notification', () => {
      const handler = getHandler('test-notification');
      const { event } = registerOwnedRenderer();
      const result = handler(event);
      expect(result.success).toBe(true);
    });

    it('test-notification returns error when not supported', () => {
      mockElectron.Notification.isSupported.mockReturnValueOnce(false);
      const handler = getHandler('test-notification');
      const { event } = registerOwnedRenderer();
      const result = handler(event);
      expect(result.success).toBe(false);
    });

    it('open-threat-report generates HTML from structured data', async () => {
      const { event } = registerThreatRenderer();
      const handler = getHandler('open-threat-report');
      const data = {
        riskRating: 'HIGH',
        summary: 'Test summary',
        findings: ['Finding 1'],
        recommendations: ['Rec 1'],
        counts: { totalFiles: 10, totalSensitive: 2, totalAgents: 3, totalNet: 1 },
      };
      const result = await handler(event, data);
      expect(result.success).toBe(true);
      expect(result.path).toContain('aegis-threat-report-');
      expect(path.dirname(result.path)).toBe(path.join(threatTempRoot, 'aegis-private-reports-v1'));
      expect(mockElectron.shell.openExternal).toHaveBeenCalledWith(pathToFileURL(result.path).href);
      if (fs.existsSync(result.path)) {
        const content = fs.readFileSync(result.path, 'utf-8');
        expect(content).toContain('Test summary');
        expect(content).toContain('Finding 1');
        expect(content).toContain('AEGIS Threat Analysis Report');
        expect(content).toContain("default-src 'none'; style-src 'unsafe-inline'");
      }
    });

    it('open-threat-report escapes HTML in data fields', async () => {
      const { event } = registerThreatRenderer();
      const handler = getHandler('open-threat-report');
      const data = {
        riskRating: '<script>alert(1)</script>',
        summary: '<img onerror=alert(1)>',
        findings: ['<b>xss</b>'],
        recommendations: [],
        counts: { totalFiles: 0, totalSensitive: 0, totalAgents: 0, totalNet: 0 },
      };
      const result = await handler(event, data);
      expect(result.success).toBe(true);
      if (fs.existsSync(result.path)) {
        const content = fs.readFileSync(result.path, 'utf-8');
        expect(content).not.toContain('<script>');
        expect(content).not.toContain('<img');
        expect(content).not.toContain('<b>xss</b>');
        expect(content).toContain('&lt;script&gt;');
      }
    });

    it('keeps a provider riskLevel and captured counts when opening the HTML report', async () => {
      const { event } = registerThreatRenderer();
      const result = await getHandler('open-threat-report')(event, {
        riskLevel: 'HIGH',
        summary: 'Scoped fixture',
        counts: { totalFiles: 7, totalSensitive: 2, totalAgents: 1, totalNet: 3 },
      });
      expect(result.success).toBe(true);
      const content = fs.readFileSync(result.path, 'utf8');
      expect(content).toContain('>HIGH<');
      expect(content).not.toContain('UNKNOWN');
      expect(content).toContain('>7<');
    });

    it('open-threat-report rejects non-object data', async () => {
      const { event } = registerThreatRenderer();
      const handler = getHandler('open-threat-report');
      const result = await handler(event, '<html>raw</html>');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid report data');
    });

    it('does not write a threat report for a foreign renderer or oversized fields', async () => {
      const { event } = registerThreatRenderer();
      const handler = getHandler('open-threat-report');
      expect(await handler({ ...event, senderFrame: {} }, { summary: 'private' })).toEqual({
        success: false,
        error: 'Renderer request denied',
      });
      expect(await handler(event, { summary: 'PRIVATE'.repeat(6000) })).toEqual({
        success: false,
        error: 'Invalid report data',
      });
      expect(fs.existsSync(path.join(threatTempRoot, 'aegis-private-reports-v1'))).toBe(false);
      expect(mockElectron.shell.openExternal).not.toHaveBeenCalled();
      expect(mockLogger.error).not.toHaveBeenCalledWith(expect.stringContaining('PRIVATE'));
    });

    it('keeps a failed threat report path and contents out of logs and IPC', async () => {
      const { event } = registerThreatRenderer();
      const outside = path.join(threatTempRoot, 'outside');
      fs.mkdirSync(outside);
      fs.symlinkSync(
        outside,
        path.join(threatTempRoot, 'aegis-private-reports-v1'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const result = await getHandler('open-threat-report')(event, {
        summary: 'PRIVATE_THREAT_CONTENT',
      });
      expect(result).toEqual({ success: false, error: 'Threat report could not be opened' });
      expect(mockLogger.error).toHaveBeenCalledExactlyOnceWith('IPC open-threat-report failed');
      expect(JSON.stringify(result)).not.toContain('PRIVATE_THREAT_CONTENT');
      expect(fs.readdirSync(outside)).toEqual([]);
      expect(mockElectron.shell.openExternal).not.toHaveBeenCalled();
    });

    it('reveal-in-explorer calls shell.showItemInFolder for existing paths', () => {
      const handler = getHandler('reveal-in-explorer');
      const { event } = registerOwnedRenderer();
      // Use a path that exists (the test file itself)
      const existingPath = path.resolve(__dirname, '../../package.json');
      const result = handler(event, existingPath);
      expect(mockElectron.shell.showItemInFolder).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('keeps a missing watched secret path out of persistent rejection diagnostics', () => {
      const { event } = registerOwnedRenderer();
      const canary = path.resolve(__dirname, '../../.env-PRIVATE_MISSING_CANARY');
      const result = getHandler('reveal-in-explorer')(event, canary);

      expect(result).toEqual({ success: false, error: 'Path not allowed' });
      expect(mockLogger.warn).toHaveBeenCalledExactlyOnceWith(
        'ipc-handlers',
        'reveal-in-explorer rejected: path outside allowed scope',
      );
      expect(JSON.stringify(mockLogger.warn.mock.calls)).not.toContain(canary);
      expect(mockElectron.shell.showItemInFolder).not.toHaveBeenCalled();
    });

    it('keeps a traversal secret path out of persistent rejection diagnostics', () => {
      const { event } = registerOwnedRenderer();
      const canary =
        path.resolve(__dirname, '../../.ssh') +
        path.sep +
        '..' +
        path.sep +
        '.ssh' +
        path.sep +
        'id_ed25519_PRIVATE_TRAVERSAL_CANARY';
      const result = getHandler('reveal-in-explorer')(event, canary);

      expect(result).toEqual({ success: false, error: 'Path traversal not allowed' });
      expect(mockLogger.warn).toHaveBeenCalledExactlyOnceWith(
        'ipc-handlers',
        'reveal-in-explorer rejected: path traversal',
      );
      expect(JSON.stringify(mockLogger.warn.mock.calls)).not.toContain(canary);
      expect(mockElectron.shell.showItemInFolder).not.toHaveBeenCalled();
    });

    it('reveal-in-explorer rejects path traversal with ..', () => {
      const handler = getHandler('reveal-in-explorer');
      const { event } = registerOwnedRenderer();
      const result = handler(event, '/some/path/../../etc/passwd');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Path traversal not allowed');
      expect(mockElectron.shell.showItemInFolder).not.toHaveBeenCalled();
    });

    it('reveal-in-explorer rejects invalid path types', () => {
      const handler = getHandler('reveal-in-explorer');
      const { event } = registerOwnedRenderer();
      expect(handler(event, null).success).toBe(false);
      expect(handler(event, '').success).toBe(false);
      expect(handler(event, 123).success).toBe(false);
    });

    it.each([
      ['kill-process', 'killProcess'],
      ['suspend-process', 'suspendProcess'],
      ['resume-process', 'resumeProcess'],
    ])('%s acts only on an owned, freshly observed stamped instance', async (channel, method) => {
      const { event, request } = registerObservedProcess();
      expect(await getHandler(channel)(event, request)).toEqual({ success: true });
      expect(mockPlatform.getParentProcessMap).toHaveBeenCalledOnce();
      expect(mockPlatform[method]).toHaveBeenCalledWith(request.pid, request.generationWitness);
    });

    it('passes the raw creation FILETIME when sequence is the generation witness', async () => {
      const { event, agent, request } = registerObservedProcess();
      agent.generationWitness = '918273';
      agent.generationWitnessSource = 'sequence';
      mockPlatform.getParentProcessMap.mockResolvedValue(
        new Map([
          [
            agent.pid,
            {
              startTime: agent.startTime,
              createTime100ns: '17000000000000000',
              witness: '918273',
              witnessSource: 'sequence',
            },
          ],
        ]),
      );
      expect(
        await getHandler('kill-process')(event, {
          ...request,
          generationWitness: '918273',
          generationWitnessSource: 'sequence',
        }),
      ).toEqual({ success: true });
      expect(mockPlatform.killProcess).toHaveBeenCalledWith(agent.pid, '17000000000000000');
    });

    it('refuses a matching witness when the fresh map lacks raw creation FILETIME', async () => {
      const { event, agent, request } = registerObservedProcess();
      mockPlatform.getParentProcessMap.mockResolvedValue(
        new Map([
          [
            agent.pid,
            {
              startTime: agent.startTime,
              witness: agent.generationWitness,
              witnessSource: agent.generationWitnessSource,
            },
          ],
        ]),
      );
      expect(await getHandler('kill-process')(event, request)).toEqual({
        success: false,
        error: 'Process instance changed or is no longer observed',
      });
      expect(mockPlatform.killProcess).not.toHaveBeenCalled();
    });

    it('refuses an inconsistent raw FILETIME even when the witness matches', async () => {
      const { event, agent, request } = registerObservedProcess();
      mockPlatform.getParentProcessMap.mockResolvedValue(
        new Map([
          [
            agent.pid,
            {
              startTime: agent.startTime,
              createTime100ns: '17000000000000001',
              witness: agent.generationWitness,
              witnessSource: agent.generationWitnessSource,
            },
          ],
        ]),
      );
      expect(await getHandler('kill-process')(event, request)).toEqual({
        success: false,
        error: 'Process instance changed or is no longer observed',
      });
      expect(mockPlatform.killProcess).not.toHaveBeenCalled();
    });

    it('retains the Linux process action contract without Windows FILETIME', async () => {
      const { event, agent, request } = registerObservedProcess();
      agent.generationWitness = '492781';
      agent.generationWitnessSource = 'linuxStartTicks';
      mockPlatform.getParentProcessMap.mockResolvedValue(
        new Map([
          [
            agent.pid,
            {
              startTime: agent.startTime,
              witness: agent.generationWitness,
              witnessSource: agent.generationWitnessSource,
            },
          ],
        ]),
      );
      expect(
        await getHandler('kill-process')(event, {
          ...request,
          generationWitness: agent.generationWitness,
          generationWitnessSource: agent.generationWitnessSource,
        }),
      ).toEqual({ success: true });
      expect(mockPlatform.killProcess).toHaveBeenCalledWith(agent.pid);
    });

    it('rejects overlapping process-control channels without another process-map read or queue', async () => {
      const { event, agent, request } = registerObservedProcess();
      const map = new Map([
        [
          agent.pid,
          {
            startTime: agent.startTime,
            createTime100ns: agent.generationWitness,
            witness: agent.generationWitness,
            witnessSource: agent.generationWitnessSource,
          },
        ],
      ]);
      let releaseMap;
      mockPlatform.getParentProcessMap.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseMap = resolve;
          }),
      );
      const first = getHandler('kill-process')(event, request);
      const second = await getHandler('suspend-process')(event, request);
      const third = await getHandler('resume-process')(event, request);
      releaseMap(map);
      expect(await first).toEqual({ success: true });
      expect(second).toEqual({ success: false, error: 'Process control is already in progress' });
      expect(third).toEqual({ success: false, error: 'Process control is already in progress' });
      expect(mockPlatform.getParentProcessMap).toHaveBeenCalledOnce();
      expect(mockPlatform.killProcess).toHaveBeenCalledOnce();
      expect(mockPlatform.suspendProcess).not.toHaveBeenCalled();
      expect(mockPlatform.resumeProcess).not.toHaveBeenCalled();
      expect(await getHandler('resume-process')(event, request)).toEqual({ success: true });
    });

    it('holds the process-control gate until the platform action settles', async () => {
      const { event, request } = registerObservedProcess();
      let finishAction;
      mockPlatform.killProcess.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishAction = resolve;
          }),
      );
      const first = getHandler('kill-process')(event, request);
      await vi.waitFor(() => expect(mockPlatform.killProcess).toHaveBeenCalledOnce());
      const second = await getHandler('suspend-process')(event, request);
      finishAction({ success: true });
      expect(await first).toEqual({ success: true });
      expect(second).toEqual({ success: false, error: 'Process control is already in progress' });
      expect(mockPlatform.getParentProcessMap).toHaveBeenCalledOnce();
      expect(mockPlatform.suspendProcess).not.toHaveBeenCalled();
    });

    it.each([
      ['kill-process', 'killProcess'],
      ['suspend-process', 'suspendProcess'],
      ['resume-process', 'resumeProcess'],
    ])('%s rejects a foreign sender and an unstamped PID', async (channel, method) => {
      const { event, request } = registerObservedProcess();
      expect(await getHandler(channel)({ ...event, sender: {} }, request)).toEqual({
        success: false,
        error: 'Renderer request denied',
      });
      expect(await getHandler(channel)(event, request.pid)).toEqual({
        success: false,
        error: 'Invalid process instance',
      });
      expect(mockPlatform.getParentProcessMap).not.toHaveBeenCalled();
      expect(mockPlatform[method]).not.toHaveBeenCalled();
    });

    it.each([
      ['kill-process', 'killProcess'],
      ['suspend-process', 'suspendProcess'],
      ['resume-process', 'resumeProcess'],
    ])('%s refuses paused, failed, reused and unproved instances', async (channel, method) => {
      let stats = {
        appHealth: {
          populationReliable: true,
          populationAsOf: Date.now(),
          identityDegraded: false,
        },
        monitoringPaused: true,
        observationGap: { state: 'NONE' },
      };
      const { event, agent, request } = registerObservedProcess({ getStats: () => stats });
      const handler = getHandler(channel);
      expect((await handler(event, request)).success).toBe(false);
      stats = { ...stats, monitoringPaused: false, appHealth: { populationReliable: false } };
      expect((await handler(event, request)).success).toBe(false);
      stats = {
        ...stats,
        appHealth: { populationReliable: true, populationAsOf: Date.now() - 60000 },
      };
      expect((await handler(event, request)).success).toBe(false);
      stats = {
        ...stats,
        appHealth: { populationReliable: true, populationAsOf: Date.now() },
      };
      mockPlatform.getParentProcessMap.mockResolvedValue(
        new Map([[agent.pid, { startTime: agent.startTime + 1 }]]),
      );
      expect((await handler(event, request)).success).toBe(false);
      mockPlatform.getParentProcessMap.mockResolvedValue(
        new Map([
          [
            agent.pid,
            {
              startTime: agent.startTime,
              witness: 'different',
              witnessSource: agent.generationWitnessSource,
            },
          ],
        ]),
      );
      expect((await handler(event, request)).success).toBe(false);
      mockPlatform.getParentProcessMap.mockResolvedValue(new Map());
      expect((await handler(event, request)).success).toBe(false);
      expect(mockPlatform[method]).not.toHaveBeenCalled();
    });

    it('kill-process rechecks renderer ownership and health after the fresh observation', async () => {
      let resolveMap;
      let paused = false;
      const { event, frame, request } = registerObservedProcess({
        getStats: () => ({
          appHealth: { populationReliable: true, populationAsOf: Date.now() },
          monitoringPaused: paused,
        }),
      });
      mockPlatform.getParentProcessMap.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveMap = resolve;
          }),
      );
      const pending = getHandler('kill-process')(event, request);
      paused = true;
      resolveMap(
        new Map([
          [
            1234,
            {
              startTime: 1700000000000,
              createTime100ns: '17000000000000000',
              witness: '17000000000000000',
              witnessSource: 'createTime100ns',
            },
          ],
        ]),
      );
      expect((await pending).success).toBe(false);
      expect(mockPlatform.killProcess).not.toHaveBeenCalled();

      paused = false;
      const pendingAfterNavigation = getHandler('kill-process')(event, request);
      frame.url = 'https://other.invalid/';
      resolveMap(
        new Map([
          [
            1234,
            {
              startTime: 1700000000000,
              createTime100ns: '17000000000000000',
              witness: '17000000000000000',
              witnessSource: 'createTime100ns',
            },
          ],
        ]),
      );
      expect(await pendingAfterNavigation).toEqual({
        success: false,
        error: 'Renderer request denied',
      });
      expect(mockPlatform.killProcess).not.toHaveBeenCalled();
    });

    it('kill-process fails closed and releases the gate when the process-map provider fails', async () => {
      const { event, request } = registerObservedProcess();
      mockPlatform.getParentProcessMap.mockRejectedValueOnce(new Error('private provider details'));
      expect(await getHandler('kill-process')(event, request)).toEqual({
        success: false,
        error: 'Process observation is unavailable or stale',
      });
      expect(mockPlatform.killProcess).not.toHaveBeenCalled();
      expect(await getHandler('kill-process')(event, request)).toEqual({ success: true });
    });

    it('releases the process-control gate after a platform action rejects', async () => {
      const { event, request } = registerObservedProcess();
      mockPlatform.killProcess.mockRejectedValueOnce(new Error('mock action failure'));
      await expect(getHandler('kill-process')(event, request)).rejects.toThrow(
        'mock action failure',
      );
      expect(await getHandler('suspend-process')(event, request)).toEqual({ success: true });
      expect(mockPlatform.getParentProcessMap).toHaveBeenCalledTimes(2);
    });

    it('kill-process does not borrow a newer witness from a mutated latest-agent record', async () => {
      const { event, agent, request } = registerObservedProcess();
      let resolveMap;
      mockPlatform.getParentProcessMap.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveMap = resolve;
          }),
      );
      const pending = getHandler('kill-process')(event, request);
      agent.generationWitness = 'different-generation';
      resolveMap(
        new Map([
          [
            agent.pid,
            {
              startTime: agent.startTime,
              witness: agent.generationWitness,
              witnessSource: agent.generationWitnessSource,
            },
          ],
        ]),
      );
      expect((await pending).success).toBe(false);
      expect(mockPlatform.killProcess).not.toHaveBeenCalled();
    });

    it('rejects an old request after same-millisecond PID reuse reaches latestAgents', async () => {
      const { event, agent, request } = registerObservedProcess();
      agent.generationWitness = 'new-generation-in-same-millisecond';
      mockPlatform.getParentProcessMap.mockResolvedValue(
        new Map([
          [
            agent.pid,
            {
              startTime: agent.startTime,
              witness: agent.generationWitness,
              witnessSource: agent.generationWitnessSource,
            },
          ],
        ]),
      );
      expect(await getHandler('kill-process')(event, request)).toEqual({
        success: false,
        error: 'Process instance changed or is no longer observed',
      });
      expect(mockPlatform.killProcess).not.toHaveBeenCalled();
    });

    it('refuses CIM birth-time-only fallback for process control', async () => {
      const { event, agent, request } = registerObservedProcess();
      agent.generationWitness = String(agent.startTime);
      agent.generationWitnessSource = 'startTimeMs';
      mockPlatform.getParentProcessMap.mockResolvedValue(
        new Map([[agent.pid, { startTime: agent.startTime }]]),
      );
      expect(
        await getHandler('kill-process')(event, {
          ...request,
          generationWitness: agent.generationWitness,
          generationWitnessSource: agent.generationWitnessSource,
        }),
      ).toEqual({ success: false, error: 'Invalid process instance' });
      expect(mockPlatform.getParentProcessMap).not.toHaveBeenCalled();
      expect(mockPlatform.killProcess).not.toHaveBeenCalled();
    });

    it('kill-process rejects invalid or unstamped requests at IPC boundary', async () => {
      const { event } = registerObservedProcess();
      const handler = getHandler('kill-process');
      for (const bad of [
        0,
        -1,
        1.5,
        'abc',
        null,
        undefined,
        { pid: 0, instanceId: '0:1' },
        { pid: 1234, instanceId: '1234:1700000000000' },
      ]) {
        const result = await handler(event, bad);
        expect(result).toEqual({ success: false, error: 'Invalid process instance' });
      }
      expect(mockPlatform.killProcess).not.toHaveBeenCalled();
    });

    it('suspend-process rejects invalid or unstamped requests at IPC boundary', async () => {
      const { event } = registerObservedProcess();
      const handler = getHandler('suspend-process');
      for (const bad of [0, -1, 1.5, 'abc', null, undefined, { pid: 0, instanceId: '0:1' }]) {
        const result = await handler(event, bad);
        expect(result).toEqual({ success: false, error: 'Invalid process instance' });
      }
      expect(mockPlatform.suspendProcess).not.toHaveBeenCalled();
    });

    it('resume-process rejects invalid or unstamped requests at IPC boundary', async () => {
      const { event } = registerObservedProcess();
      const handler = getHandler('resume-process');
      for (const bad of [0, -1, 1.5, 'abc', null, undefined, { pid: 0, instanceId: '0:1' }]) {
        const result = await handler(event, bad);
        expect(result).toEqual({ success: false, error: 'Invalid process instance' });
      }
      expect(mockPlatform.resumeProcess).not.toHaveBeenCalled();
    });

    it.each(['kill-process', 'suspend-process', 'resume-process'])(
      '%s rejects a stale stamped request even when the PID remains monitored',
      async (channel) => {
        const { event, request } = registerObservedProcess();
        const handler = getHandler(channel);
        expect(await handler(event, { ...request, instanceId: '1234:old' })).toEqual({
          success: false,
          error: 'Process instance changed or is no longer observed',
        });
        expect(mockPlatform.killProcess).not.toHaveBeenCalled();
        expect(mockPlatform.suspendProcess).not.toHaveBeenCalled();
        expect(mockPlatform.resumeProcess).not.toHaveBeenCalled();
      },
    );

    it('kill-process accepts a verified monitored instance', async () => {
      const { event, request } = registerObservedProcess();
      const handler = getHandler('kill-process');
      const result = await handler(event, request);
      expect(result).toEqual({ success: true });
      expect(mockPlatform.killProcess).toHaveBeenCalledWith(1234, '17000000000000000');
    });

    it('kill-process rejects unmonitored PID', async () => {
      const { event, request } = registerObservedProcess();
      const handler = getHandler('kill-process');
      const result = await handler(event, {
        ...request,
        pid: 9999,
        instanceId: '9999:1700000000000',
      });
      expect(result).toEqual({
        success: false,
        error: 'Process instance changed or is no longer observed',
      });
      expect(mockPlatform.killProcess).not.toHaveBeenCalled();
    });

    it('suspend-process rejects unmonitored PID', async () => {
      const { event, request } = registerObservedProcess();
      const handler = getHandler('suspend-process');
      const result = await handler(event, {
        ...request,
        pid: 9999,
        instanceId: '9999:1700000000000',
      });
      expect(result).toEqual({
        success: false,
        error: 'Process instance changed or is no longer observed',
      });
      expect(mockPlatform.suspendProcess).not.toHaveBeenCalled();
    });

    it('resume-process rejects unmonitored PID', async () => {
      const { event, request } = registerObservedProcess();
      const handler = getHandler('resume-process');
      const result = await handler(event, {
        ...request,
        pid: 9999,
        instanceId: '9999:1700000000000',
      });
      expect(result).toEqual({
        success: false,
        error: 'Process instance changed or is no longer observed',
      });
      expect(mockPlatform.resumeProcess).not.toHaveBeenCalled();
    });

    it('kill-process refuses AEGIS own PID', async () => {
      const { event, request } = registerObservedProcess();
      const handler = getHandler('kill-process');
      const result = await handler(event, { ...request, pid: process.pid });
      expect(result).toEqual({ success: false, error: 'Refusing to act on AEGIS itself' });
      expect(mockPlatform.killProcess).not.toHaveBeenCalled();
    });

    it('suspend-process refuses AEGIS own PID', async () => {
      const { event, request } = registerObservedProcess();
      const handler = getHandler('suspend-process');
      const result = await handler(event, { ...request, pid: process.pid });
      expect(result).toEqual({ success: false, error: 'Refusing to act on AEGIS itself' });
      expect(mockPlatform.suspendProcess).not.toHaveBeenCalled();
    });

    it('resume-process refuses AEGIS own PID', async () => {
      const { event, request } = registerObservedProcess();
      const handler = getHandler('resume-process');
      const result = await handler(event, { ...request, pid: process.pid });
      expect(result).toEqual({ success: false, error: 'Refusing to act on AEGIS itself' });
      expect(mockPlatform.resumeProcess).not.toHaveBeenCalled();
    });

    it('save-custom-agents delegates to config', () => {
      const { event } = registerOwnedRenderer();
      const handler = getHandler('save-custom-agents');
      const agents = [{ name: 'custom', process: 'custom.exe' }];
      const result = handler(event, agents);
      expect(mockConfig.saveCustomAgents).toHaveBeenCalledWith(agents);
      expect(result.success).toBe(true);
    });

    it('reset-permissions-to-defaults resets all agent permissions', () => {
      const { event } = registerOwnedRenderer();
      const handler = getHandler('reset-permissions-to-defaults');
      const result = handler(event);
      expect(result.permissions).toBeDefined();
      expect(result.seenAgents).toBeDefined();
    });
  });
});
