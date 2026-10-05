import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const isolatedModules = [
  'scan-loop',
  'network-monitor',
  'resource-monitor',
  'ide-extension-detector',
  'wsl-detector',
  'llm-runtime-detector',
];

describe('network recovery after a process-scope skip', () => {
  let scanLoop;
  let network;
  let getRawTcpConnections;
  let priorModules;

  beforeEach(() => {
    vi.useFakeTimers();
    priorModules = isolatedModules.map((name) => {
      const path = require_.resolve(`../../src/main/${name}.js`);
      const previous = require_.cache[path];
      delete require_.cache[path];
      return { path, previous };
    });
    const resource = require_('../../src/main/resource-monitor.js');
    resource._setExecForTest(async () => '');
    resource._setLoggerForTest({ warn: vi.fn() });
    const ide = require_('../../src/main/ide-extension-detector.js');
    ide._setDepsForTest({
      listProcesses: async () => [],
      readdir: async () => [],
      homedir: () => '/nonexistent-test-home',
    });
    require_('../../src/main/wsl-detector.js')._setDepsForTest({
      execFile: (_cmd, _args, _opts, callback) => callback(new Error('fixture'), ''),
    });
    const llm = require_('../../src/main/llm-runtime-detector.js');
    llm.detectOllamaModels = async () => ({ running: false, models: [] });
    llm.detectLMStudioModels = async () => ({ running: false, models: [] });
    network = require_('../../src/main/network-monitor.js');
    getRawTcpConnections = vi.fn().mockResolvedValue([]);
    network._setDepsForTest({ getRawTcpConnections });
    scanLoop = require_('../../src/main/scan-loop.js');
  });

  afterEach(async () => {
    scanLoop.stopScanIntervals();
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
    for (const { path, previous } of priorModules) {
      if (previous) require_.cache[path] = previous;
      else delete require_.cache[path];
    }
  });

  /** @returns {Promise<void>} Drain pending scan continuations without advancing a poll. */
  async function flush() {
    await vi.advanceTimersByTimeAsync(0);
  }

  /**
   * Actual network monitor and scan loop, with inert observation collaborators.
   * @param {object} [overrides]
   * @returns {object} Injected collaborators and captured publications.
   */
  function makeDeps(overrides = {}) {
    const agents = [{ agent: 'Fixture', process: 'fixture', pid: 42, instanceId: '42:1' }];
    let current = agents;
    return {
      network,
      scanner: {
        scanProcesses: vi.fn().mockResolvedValue({ agents, reliable: true, changed: false }),
        isProcessPopulationReliable: () => true,
      },
      procUtil: {
        enrichWithParentChains: vi.fn().mockResolvedValue(),
        annotateHostApps: vi.fn(),
        annotateWorkingDirs: vi.fn().mockResolvedValue(),
      },
      watcher: {
        pruneKnownHandles: vi.fn(),
        scanAllFileHandles: vi.fn().mockResolvedValue([]),
      },
      baselines: { recordNetworkEndpoint: vi.fn() },
      anomaly: {
        checkDeviations: () => [],
        calculateAnomalyScore: () => ({ score: 0 }),
      },
      audit: { log: vi.fn() },
      tray: { updateTrayIcon: vi.fn(), notifySensitive: vi.fn() },
      logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      sendToRenderer: vi.fn(),
      fileAccessBatcher: { push: vi.fn() },
      statsUpdateBatcher: { push: vi.fn(), pushLazy: vi.fn() },
      getStats: () => ({}),
      getResourceUsage: () => ({}),
      getLatestAgents: () => current,
      setAgents: (rows) => {
        current = rows;
      },
      setLatestNetConnections: vi.fn(),
      getPreviousPids: () => new Map(),
      setPreviousPids: vi.fn(),
      ...overrides,
    };
  }

  it('coalesces skipped polls and retries once after identity and annotations settle', async () => {
    let finishIdentity;
    let finishAnnotations;
    const deps = makeDeps({
      procUtil: {
        enrichWithParentChains: () =>
          new Promise((resolve) => {
            finishIdentity = resolve;
          }),
        annotateHostApps: vi.fn(),
        annotateWorkingDirs: () =>
          new Promise((resolve) => {
            finishAnnotations = resolve;
          }),
      },
    });
    scanLoop.init(deps);
    scanLoop.startScanIntervals(5000);
    await vi.advanceTimersByTimeAsync(5000);
    for (let i = 0; i < 3; i++) scanLoop.doNetworkScan();
    expect(network.getNetworkSensorHealth()).toMatchObject({
      state: 'DEGRADED',
      lastError: 'process-observation-unavailable',
    });
    expect(getRawTcpConnections).not.toHaveBeenCalled();
    finishIdentity();
    await flush();
    expect(getRawTcpConnections).not.toHaveBeenCalled();
    finishAnnotations();
    await flush();
    expect(getRawTcpConnections).toHaveBeenCalledExactlyOnceWith([42]);
    expect(network.getNetworkSensorHealth().state).toBe('HEALTHY');
    expect(deps.setLatestNetConnections).toHaveBeenCalledExactlyOnceWith([]);
    expect(deps.sendToRenderer).toHaveBeenCalledWith('network-update', []);
    expect(deps.logger.error).not.toHaveBeenCalled();
  });

  it('keeps the retry pending through an unreliable population and recovers on an unchanged reliable pass', async () => {
    let reliable = false;
    const agents = [{ agent: 'Fixture', process: 'fixture', pid: 42, instanceId: '42:1' }];
    const deps = makeDeps({
      scanner: {
        scanProcesses: async () => ({ agents, reliable, changed: false }),
        isProcessPopulationReliable: () => reliable,
      },
    });
    scanLoop.init(deps);
    for (let i = 0; i < 3; i++) scanLoop.doNetworkScan();
    scanLoop.startScanIntervals(5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(getRawTcpConnections).not.toHaveBeenCalled();
    expect(network.getNetworkSensorHealth().state).toBe('DEGRADED');
    reliable = true;
    await vi.advanceTimersByTimeAsync(5000);
    expect(getRawTcpConnections).toHaveBeenCalledExactlyOnceWith([42]);
    expect(network.getNetworkSensorHealth().state).toBe('HEALTHY');
  });

  it('consumes the queued request when a regular poll observes the recovered scope', async () => {
    let reliable = false;
    const deps = makeDeps();
    deps.scanner.isProcessPopulationReliable = () => reliable;
    scanLoop.init(deps);
    scanLoop.doNetworkScan();
    expect(getRawTcpConnections).not.toHaveBeenCalled();
    reliable = true;
    scanLoop.doNetworkScan();
    await flush();
    expect(getRawTcpConnections).toHaveBeenCalledExactlyOnceWith([42]);
    expect(network.getNetworkSensorHealth().state).toBe('HEALTHY');
  });

  it('cancels the queued replacement when monitoring stops before identity settles', async () => {
    let finishIdentity;
    const deps = makeDeps({
      procUtil: {
        enrichWithParentChains: () =>
          new Promise((resolve) => {
            finishIdentity = resolve;
          }),
        annotateHostApps: vi.fn(),
        annotateWorkingDirs: vi.fn().mockResolvedValue(),
      },
    });
    scanLoop.init(deps);
    scanLoop.startScanIntervals(5000);
    await vi.advanceTimersByTimeAsync(5000);
    scanLoop.doNetworkScan();
    scanLoop.stopScanIntervals();
    finishIdentity();
    await flush();
    expect(getRawTcpConnections).not.toHaveBeenCalled();
    expect(deps.setLatestNetConnections).not.toHaveBeenCalled();
  });
});
