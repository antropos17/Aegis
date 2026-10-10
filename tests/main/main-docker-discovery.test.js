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
let podmanDiscovery = pending;
let onPodmanUpdate;
const pendingWslInventory = { ...pending, distributions: [] };
delete pendingWslInventory.candidates;
let wslInventory = pendingWslInventory;
let onWslUpdate;
const refresh = vi.fn();
const stop = vi.fn();
const refreshPodman = vi.fn();
const stopPodman = vi.fn();
const refreshWsl = vi.fn();
const stopWsl = vi.fn();
const cancelWsl = vi.fn();
const createDockerDiscovery = vi.fn((options) => {
  onUpdate = options.onUpdate;
  return { refresh, stop, snapshot: () => structuredClone(discovery) };
});
const createPodmanDiscovery = vi.fn((options) => {
  onPodmanUpdate = options.onUpdate;
  return {
    refresh: refreshPodman,
    stop: stopPodman,
    snapshot: () => structuredClone(podmanDiscovery),
  };
});
const createWslInventory = vi.fn((options) => {
  onWslUpdate = options.onUpdate;
  return {
    refresh: refreshWsl,
    stop: stopWsl,
    cancelRefresh: cancelWsl,
    snapshot: () => structuredClone(wslInventory),
  };
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
  if (parent?.filename.endsWith('main.js') && request === './podman-scanner')
    return { createPodmanDiscovery };
  if (parent?.filename.endsWith('main.js') && request === './wsl-inventory')
    return { createWslInventory };
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

describe('main container discovery stats', () => {
  it('publishes an unobserved pending snapshot before deferred startup', () => {
    expect(main.getStats().dockerDiscovery).toEqual(pending);
    expect(main.getStats().podmanDiscovery).toEqual(pending);
    expect(main.getStats().wslInventory).toEqual(pendingWslInventory);
    expect(createDockerDiscovery).not.toHaveBeenCalled();
    expect(createPodmanDiscovery).not.toHaveBeenCalled();
    expect(createWslInventory).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(refreshPodman).not.toHaveBeenCalled();
    expect(refreshWsl).not.toHaveBeenCalled();
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
    podmanDiscovery = {
      ...discovery,
      candidates: discovery.candidates.map((candidate) => ({
        ...candidate,
        id: `podman:${candidate.containerId}`,
        runtime: 'podman',
      })),
    };
    wslInventory = {
      status: 'ready',
      reason: null,
      observedAt: 1700000000000,
      attemptedAt: 1700000000000,
      stale: false,
      distributions: ['Ubuntu', 'Agent Zero'],
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
      expect(stats.podmanDiscovery).toEqual(podmanDiscovery);
      expect(stats.wslInventory).toEqual(wslInventory);
      expect(stats.currentAgents).toBe(0);
      expect(stats.aiAgentCount).toBe(0);
      expect(stats.appHealth).not.toHaveProperty('dockerDiscovery');
      expect(stats.appHealth).not.toHaveProperty('podmanDiscovery');
      expect(stats.appHealth).not.toHaveProperty('wslInventory');
    }
    main._setScannerForTest(null);
    main._loadDeferredModulesForTest();
    expect(createDockerDiscovery).toHaveBeenCalledTimes(1);
    expect(createPodmanDiscovery).toHaveBeenCalledTimes(1);
    expect(createWslInventory).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(refreshPodman).not.toHaveBeenCalled();
    expect(refreshWsl).not.toHaveBeenCalled();
  });

  it('retains stale WSL names without changing host agent or health statistics', () => {
    const health = main.getStats().appHealth;
    wslInventory = {
      ...wslInventory,
      status: 'unavailable',
      reason: 'runtime-unavailable',
      attemptedAt: wslInventory.attemptedAt + 30000,
      stale: true,
    };
    const stats = main.getStats();
    expect(stats.wslInventory).toEqual(wslInventory);
    expect(stats.appHealth).toEqual(health);
    expect(stats.dockerDiscovery).toEqual(discovery);
    expect(stats.currentAgents).toBe(0);
    expect(stats.aiAgentCount).toBe(0);
    expect(stats.uniqueAgents).toEqual([]);
    expect(refreshWsl).not.toHaveBeenCalled();
  });

  it('keeps a stale Podman result independent of ready Docker metadata', () => {
    podmanDiscovery = {
      ...podmanDiscovery,
      status: 'unavailable',
      reason: 'runtime-unavailable',
      attemptedAt: podmanDiscovery.attemptedAt + 30000,
      stale: true,
    };
    const stats = main.getStats();
    expect(stats.podmanDiscovery).toEqual(podmanDiscovery);
    expect(stats.dockerDiscovery).toEqual(discovery);
    expect(stats.currentAgents).toBe(0);
    expect(refreshPodman).not.toHaveBeenCalled();
  });

  it('delivers settled discovery through the existing latest-stats batcher', async () => {
    vi.useFakeTimers();
    const send = vi.fn();
    main._setMainWindowForTest({ isDestroyed: () => false, webContents: { send } });
    onUpdate();
    onPodmanUpdate();
    onWslUpdate();
    discovery = { ...discovery, candidates: [] };
    podmanDiscovery = { ...podmanDiscovery, candidates: [] };
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledWith(
      'stats-update',
      expect.objectContaining({ dockerDiscovery: discovery, podmanDiscovery, wslInventory }),
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(refreshPodman).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('cancels WSL inventory on pause and suppresses its late stats delivery', async () => {
    vi.useFakeTimers();
    const send = vi.fn();
    main._setMainWindowForTest({ isDestroyed: () => false, webContents: { send } });
    main._setMonitoringPausedForTest(true);
    expect(cancelWsl).toHaveBeenCalledTimes(1);
    onWslUpdate();
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).not.toHaveBeenCalled();
    expect(main.getStats().monitoringPaused).toBe(true);
    main._setMonitoringPausedForTest(false);
    onWslUpdate();
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledWith('stats-update', expect.objectContaining({ wslInventory }));
    expect(refreshWsl).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('stops both discoveries before quit and at quit, suppressing late updates', async () => {
    vi.useFakeTimers();
    const send = vi.fn();
    main._setMainWindowForTest({ isDestroyed: () => false, webContents: { send } });
    main._setSensitiveAlertJournalForTest({
      hasPending: () => true,
      flush: vi.fn().mockResolvedValue(false),
    });
    listeners.get('before-quit')({ preventDefault: vi.fn() });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(stopPodman).toHaveBeenCalledTimes(1);
    expect(stopWsl).toHaveBeenCalledTimes(1);
    onUpdate();
    onPodmanUpdate();
    onWslUpdate();
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).not.toHaveBeenCalled();
    listeners.get('quit')();
    expect(stop).toHaveBeenCalledTimes(2);
    expect(stopPodman).toHaveBeenCalledTimes(2);
    expect(stopWsl).toHaveBeenCalledTimes(2);
    onUpdate();
    onPodmanUpdate();
    onWslUpdate();
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
