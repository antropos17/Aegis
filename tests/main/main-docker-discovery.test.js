import { afterAll, describe, expect, it, vi } from 'vitest';
import Module, { createRequire } from 'node:module';
import os from 'node:os';

const require_ = createRequire(import.meta.url);
const listeners = new Map();
const pending = {
  status: 'pending',
  reason: null,
  observedAt: null,
  attemptedAt: null,
  stale: true,
  candidates: [],
};
let discovery = pending;
let onUpdate;
const refresh = vi.fn();
const stop = vi.fn();
const createDockerDiscovery = vi.fn((options) => {
  onUpdate = options.onUpdate;
  return { refresh, stop, snapshot: () => structuredClone(discovery) };
});
const fakeElectron = {
  app: {
    name: 'Aegis',
    getPath: () => os.tmpdir(),
    getVersion: () => '0.0.0-test',
    setName: () => {},
    disableHardwareAcceleration: () => {},
    requestSingleInstanceLock: () => true,
    whenReady: () => new Promise(() => {}),
    on: (event, callback) => listeners.set(event, callback),
    quit: () => {},
  },
  BrowserWindow: class {},
  globalShortcut: { register: () => {}, unregisterAll: () => {} },
  shell: { openExternal: () => {} },
  ipcMain: { handle: () => {}, on: () => {} },
  dialog: {},
  Notification: class {},
  Tray: class {},
  Menu: { buildFromTemplate: (template) => template },
  nativeImage: { createFromBuffer: (buffer) => buffer },
  safeStorage: { isEncryptionAvailable: () => false },
};
const originalLoad = Module._load;
const originalArgv = process.argv;
Module._load = function (request, parent) {
  if (request === 'electron') return fakeElectron;
  if (parent?.filename.endsWith('main.js') && request === './container-scanner')
    return { createDockerDiscovery };
  if (parent?.filename.endsWith('main.js') && request === './scan-loop')
    return { stopScanIntervals: vi.fn() };
  return originalLoad.apply(this, arguments);
};
process.argv = ['node', 'main.js'];
const main = require_('../../src/main/main.js');

afterAll(() => {
  main._setMainWindowForTest(null);
  listeners.get('quit')();
  vi.useRealTimers();
  Module._load = originalLoad;
  process.argv = originalArgv;
});

describe('main Docker discovery stats', () => {
  it('publishes an unobserved pending snapshot before deferred startup', () => {
    expect(main.getStats().dockerDiscovery).toEqual(pending);
    expect(createDockerDiscovery).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('reads the deferred discovery snapshot on both stats branches without scanning', () => {
    main._loadDeferredModulesForTest();
    main._setWatcherForTest(null);
    discovery = {
      status: 'ready',
      reason: null,
      observedAt: 1700000000000,
      attemptedAt: 1700000000000,
      stale: false,
      candidates: [
        {
          id: `docker:${'a'.repeat(64)}`,
          containerId: 'a'.repeat(64),
          name: 'fixture-container',
          image: 'agent0ai/agent-zero:latest',
          agent: 'Agent Zero',
          match: 'image',
          runtime: 'docker',
        },
      ],
    };
    for (const scanner of [
      null,
      {
        activityLog: [],
        monitoringStarted: Date.now(),
        peakAgents: 0,
        uniqueAgentNames: new Set(),
        permissionDeniedScans: 0,
      },
    ]) {
      main._setScannerForTest(scanner);
      const stats = main.getStats();
      expect(stats.dockerDiscovery).toEqual(discovery);
      expect(stats.currentAgents).toBe(0);
      expect(stats.appHealth).not.toHaveProperty('dockerDiscovery');
    }
    main._setScannerForTest(null);
    expect(createDockerDiscovery).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('delivers settled discovery through the existing latest-stats batcher', async () => {
    vi.useFakeTimers();
    const send = vi.fn();
    main._setMainWindowForTest({ isDestroyed: () => false, webContents: { send } });
    onUpdate();
    discovery = { ...discovery, candidates: [] };
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledWith(
      'stats-update',
      expect.objectContaining({ dockerDiscovery: discovery }),
    );
    expect(refresh).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('stops discovery at quit and suppresses subsequent update delivery', async () => {
    vi.useFakeTimers();
    const send = vi.fn();
    main._setMainWindowForTest({ isDestroyed: () => false, webContents: { send } });
    listeners.get('quit')();
    expect(stop).toHaveBeenCalledTimes(1);
    onUpdate();
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
