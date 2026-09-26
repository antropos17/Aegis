/**
 * Stage-1 step A — provider-observation ownership boundaries for the `process`
 * and `network` leaves.
 *
 * The rule under test: a failure downstream of scanProcesses — enrichment,
 * session reconcile, an audit write, a renderer send — leaves the leaf record as
 * scanProcesses left it. A catalog or tracking callback inside scanProcesses can
 * still trigger existing hard-failure health handling, but cannot prove the OS
 * enumeration failed and must not produce a process-population outage audit record.
 *
 * Both leaves are driven through their REAL modules, so every assertion reads the
 * health record itself rather than a spy on the note function. The spy assertions
 * are kept as a second, weaker witness: they pin the call site, the record pins
 * the outcome, and a refactor that moved the write elsewhere would still be caught.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import { SENSOR_HEALTH_STATE } from '../../src/main/sensor-health.js';

const require_ = createRequire(import.meta.url);

describe('scan-loop provider-health ownership (Stage-1 step A)', () => {
  let scanLoop;
  let scanner;
  let network;
  let listProcesses;
  let getRawTcpConnections;
  /** @type {{detectOllamaModels: Function, detectLMStudioModels: Function}} */
  let llmOriginals;

  /** Inert command runner for resource-monitor — see scan-loop.test.js for why. */
  const inertExec = () => Promise.resolve('');

  /** Reset resource-monitor's module state and re-arm the inert exec. */
  function isolateResourceMonitor() {
    const rm = require_('../../src/main/resource-monitor.js');
    rm._resetForTest();
    rm._setLoggerForTest({ warn: vi.fn() });
    rm._setExecForTest(inertExec);
  }

  /**
   * Neutralise the two synthetic-agent detectors `doProcessScan` reads through
   * `injectDetectedExternalAgents`. Both return a cache synchronously and kick off
   * a background refresh that spawns — under fake timers those spawns settle on
   * real time inside whichever test is running then (ai-mistakes #26).
   */
  function isolateExternalDetectors() {
    const ide = require_('../../src/main/ide-extension-detector.js');
    ide._resetForTest();
    ide._setDepsForTest({
      listProcesses: async () => [],
      readdir: async () => [],
      homedir: () => '/nonexistent-home',
    });
    const wsl = require_('../../src/main/wsl-detector.js');
    wsl._resetForTest();
    wsl._setDepsForTest({ execFile: (cmd, args, opts, cb) => cb(new Error('stubbed'), '') });
  }

  /**
   * Point llm-runtime-detector at fixed "not running" answers. `enrichWithLocalModels`
   * re-requires the module per call, so patching its exports is enough — and it keeps
   * the localhost probes out of the suite.
   */
  function isolateLlmDetectors() {
    const llm = require_('../../src/main/llm-runtime-detector.js');
    llmOriginals = {
      detectOllamaModels: llm.detectOllamaModels,
      detectLMStudioModels: llm.detectLMStudioModels,
    };
    llm.detectOllamaModels = async () => ({ running: false, models: [] });
    llm.detectLMStudioModels = async () => ({ running: false, models: [] });
  }

  /** Restore llm-runtime-detector's real probes. */
  function restoreLlmDetectors() {
    const llm = require_('../../src/main/llm-runtime-detector.js');
    llm.detectOllamaModels = llmOriginals.detectOllamaModels;
    llm.detectLMStudioModels = llmOriginals.detectLMStudioModels;
  }

  /**
   * Drain the promise chains a scan leaves behind. Neither path schedules a timer,
   * so advancing by 0 only flushes microtasks; several rounds cover the nested awaits
   * inside the real network provider (reverse DNS, then forward confirmation).
   * @param {number} [rounds]
   * @returns {Promise<void>}
   */
  async function flush(rounds = 8) {
    for (let i = 0; i < rounds; i++) await vi.advanceTimersByTimeAsync(0);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    const scanLoopPath = require_.resolve('../../src/main/scan-loop.js');
    delete require_.cache[scanLoopPath];
    isolateResourceMonitor();
    isolateExternalDetectors();
    isolateLlmDetectors();

    scanner = require_('../../src/main/process-scanner.js');
    listProcesses = vi.fn().mockResolvedValue([{ name: 'chrome', pid: 1 }]);
    scanner._resetForTest();
    scanner._setPlatformForTest({ listProcesses, providesStartTime: false });
    scanner.init({ trackSeenAgent: vi.fn() });
    scanner.peakAgents = 0;

    network = require_('../../src/main/network-monitor.js');
    getRawTcpConnections = vi
      .fn()
      .mockResolvedValue([{ pid: 42, ip: '8.8.8.8', port: 443, state: 'Established' }]);
    network._resetForTest();
    network._setDepsForTest({
      getRawTcpConnections,
      dnsReverse: vi.fn().mockRejectedValue(new Error('ENOTFOUND')),
      dnsResolve: vi.fn().mockResolvedValue([]),
    });

    scanLoop = require_('../../src/main/scan-loop.js');
  });

  afterEach(async () => {
    scanLoop.stopScanIntervals();
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
    restoreLlmDetectors();
    isolateResourceMonitor();
    const ide = require_('../../src/main/ide-extension-detector.js');
    ide._resetForTest();
    const wsl = require_('../../src/main/wsl-detector.js');
    wsl._resetForTest();
  });

  /**
   * Every collaborator a scan reaches, stubbed inert. `scanner` and `network` default
   * to the REAL modules; a caller that wants a spy passes its own.
   * @param {Object} [overrides]
   * @returns {Object}
   */
  function makeDeps(overrides = {}) {
    return {
      scanner,
      network,
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
        checkDeviations: vi.fn().mockReturnValue([]),
        calculateAnomalyScore: vi.fn().mockReturnValue({ score: 0 }),
      },
      audit: { log: vi.fn() },
      tray: { updateTrayIcon: vi.fn(), notifySensitive: vi.fn() },
      logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      sendToRenderer: vi.fn(),
      fileAccessBatcher: { push: vi.fn() },
      statsUpdateBatcher: { push: vi.fn(), pushLazy: vi.fn() },
      getStats: vi.fn().mockReturnValue({}),
      getResourceUsage: vi.fn().mockReturnValue({}),
      getLatestAgents: vi.fn().mockReturnValue([]),
      setAgents: vi.fn(),
      setLatestNetConnections: vi.fn(),
      getPreviousPids: vi.fn().mockReturnValue(new Map()),
      setPreviousPids: vi.fn(),
      ...overrides,
    };
  }

  /**
   * A `sendToRenderer` that throws on ONE channel only. An unconditional thrower
   * would fire from `updateScanStatus('scan-status')`, which sits OUTSIDE the try —
   * the throw would escape `doProcessScan` before the provider was ever called and
   * leave the reentrancy guard latched.
   * @param {string} channel
   * @returns {Function}
   */
  function throwingSendOn(channel) {
    return vi.fn((ch) => {
      if (ch === channel) throw new Error(`renderer-send-failed:${ch}`);
    });
  }

  /** One deviation, so the anomaly-alert audit write is reached with an empty fleet. */
  const ONE_DEVIATION = [
    { agent: 'Claude Code', instanceId: '42:t', type: 'burst', message: 'm', anomalyScore: 9 },
  ];

  /** Agents the network scan is scoped to — a pid the stubbed TCP table answers for. */
  const NET_AGENTS = [{ agent: 'Claude Code', pid: 42, instanceId: '42:t', category: 'ai' }];

  /**
   * Run exactly one `doProcessScan`. It is not exported, so the 3s startup timer is
   * the entry point; `paused = true` keeps the warm-up intervals out of the way.
   * @returns {Promise<void>}
   */
  async function runOneProcessScan() {
    scanLoop.staggeredStartup(5000, true);
    await vi.advanceTimersByTimeAsync(3000);
    await flush();
  }

  /** Run exactly one `doNetworkScan` and drain its chain. @returns {Promise<void>} */
  async function runOneNetworkScan() {
    scanLoop.doNetworkScan();
    await flush();
  }

  // ── process leaf ──

  describe('process leaf', () => {
    it('a renderer-send throw after a successful scanProcesses leaves the record HEALTHY', async () => {
      const deps = makeDeps({ sendToRenderer: throwingSendOn('scan-batch') });
      scanLoop.init(deps);
      await runOneProcessScan();

      expect(listProcesses).toHaveBeenCalledTimes(1);
      expect(deps.sendToRenderer).toHaveBeenCalledWith('scan-batch', expect.any(Object));
      const h = scanner.getProcessSensorHealth();
      expect(h.state).toBe(SENSOR_HEALTH_STATE.HEALTHY);
      expect(h.consecutiveFailures).toBe(0);
      expect(h.lastError).toBeNull();
      expect(scanner.isProcessPopulationReliable()).toBe(true);
    });

    it('an audit-write throw after a successful scanProcesses leaves the record HEALTHY', async () => {
      const deps = makeDeps({
        anomaly: {
          checkDeviations: vi.fn().mockReturnValue(ONE_DEVIATION),
          calculateAnomalyScore: vi.fn().mockReturnValue({ score: 0 }),
        },
        audit: {
          log: vi.fn(() => {
            throw new Error('audit-write-failed');
          }),
        },
      });
      scanLoop.init(deps);
      await runOneProcessScan();

      expect(deps.audit.log).toHaveBeenCalled();
      const h = scanner.getProcessSensorHealth();
      expect(h.state).toBe(SENSOR_HEALTH_STATE.HEALTHY);
      expect(h.consecutiveFailures).toBe(0);
      expect(scanner.isProcessPopulationReliable()).toBe(true);
    });

    it('a downstream throw never calls noteProcessScanHardFailure', async () => {
      const note = vi.fn();
      const deps = makeDeps({
        scanner: {
          scanProcesses: vi.fn().mockResolvedValue({ agents: [], changed: false, reliable: true }),
          noteProcessScanHardFailure: note,
        },
        sendToRenderer: throwingSendOn('scan-batch'),
      });
      scanLoop.init(deps);
      await runOneProcessScan();

      expect(deps.scanner.scanProcesses).toHaveBeenCalledTimes(1);
      expect(note).not.toHaveBeenCalled();
      expect(deps.audit.log).not.toHaveBeenCalledWith('observation-gap', expect.anything());
    });

    it('a provider throw from _listProcesses still marks the record FAILED', async () => {
      const providerError = new Error('spawn ENOENT private path');
      listProcesses.mockRejectedValue(providerError);
      const deps = makeDeps();
      scanLoop.init(deps);
      await runOneProcessScan();

      const h = scanner.getProcessSensorHealth();
      expect(h.state).toBe(SENSOR_HEALTH_STATE.FAILED);
      expect(h.consecutiveFailures).toBe(1);
      expect(h.lastError).toMatch(/ENOENT/);
      expect(h.detail).toBe('hard-scan-failure');
      expect(scanner.isProcessPopulationReliable()).toBe(false);
      expect(scanner.isPopulationProviderFailure(providerError)).toBe(true);
      expect(deps.audit.log).toHaveBeenCalledWith(
        'observation-gap',
        expect.objectContaining({
          agent: '',
          pid: null,
          path: '',
          action: 'process-population-unavailable',
          extra: { cause: 'process-enumeration', state: 'unavailable' },
        }),
      );
      expect(JSON.stringify(deps.audit.log.mock.calls)).not.toContain('private path');
      // The observation never returned, so the population was never replaced.
      expect(deps.setAgents).not.toHaveBeenCalled();

      listProcesses.mockResolvedValue([{ name: 'chrome', pid: 1 }]);
      await runOneProcessScan();
      expect(deps.audit.log.mock.calls.map(([type, record]) => [type, record.action])).toEqual([
        ['observation-gap', 'process-population-unavailable'],
        ['observation-gap', 'process-population-restored'],
      ]);
    });

    it('an unproven scanProcesses rejection keeps health handling but adds no provider gap', async () => {
      const note = vi.fn();
      const deps = makeDeps({
        scanner: {
          scanProcesses: vi.fn().mockRejectedValue(new Error('spawn ENOENT')),
          noteProcessScanHardFailure: note,
        },
      });
      scanLoop.init(deps);
      await runOneProcessScan();

      expect(note).toHaveBeenCalledTimes(1);
      expect(note.mock.calls[0][0].message).toMatch(/ENOENT/);
      expect(deps.audit.log).not.toHaveBeenCalledWith('observation-gap', expect.anything());

      deps.scanner.scanProcesses.mockResolvedValue({ agents: [], changed: false, reliable: true });
      await runOneProcessScan();
      expect(note).toHaveBeenCalledTimes(1);
      expect(deps.audit.log).not.toHaveBeenCalledWith('observation-gap', expect.anything());
    });

    it('a catalog callback rejection after enumeration adds no provider gap', async () => {
      scanner.init({
        trackSeenAgent: vi.fn(),
        getCustomAgents: () => {
          throw new Error('catalog callback failed');
        },
      });
      const deps = makeDeps();
      scanLoop.init(deps);
      await runOneProcessScan();

      expect(listProcesses).toHaveBeenCalledTimes(1);
      expect(scanner.getProcessSensorHealth().state).toBe(SENSOR_HEALTH_STATE.FAILED);
      expect(deps.logger.error).toHaveBeenCalledWith('main', 'Process scan failed', {
        error: 'catalog callback failed',
      });
      expect(deps.audit.log).not.toHaveBeenCalledWith('observation-gap', expect.anything());
    });

    it('a trackSeenAgent rejection after enumeration adds no provider gap', async () => {
      listProcesses.mockResolvedValue([{ name: 'claude', pid: 42 }]);
      scanner.init({
        trackSeenAgent: () => {
          throw new Error('tracking callback failed');
        },
      });
      const deps = makeDeps();
      scanLoop.init(deps);
      await runOneProcessScan();

      expect(listProcesses).toHaveBeenCalledTimes(1);
      expect(scanner.getProcessSensorHealth().state).toBe(SENSOR_HEALTH_STATE.FAILED);
      expect(deps.logger.error).toHaveBeenCalledWith('main', 'Process scan failed', {
        error: 'tracking callback failed',
      });
      expect(deps.audit.log).not.toHaveBeenCalledWith('observation-gap', expect.anything());
    });

    it('both paths keep the existing "Process scan failed" log', async () => {
      const downstream = makeDeps({ sendToRenderer: throwingSendOn('scan-batch') });
      scanLoop.init(downstream);
      await runOneProcessScan();
      expect(downstream.logger.error).toHaveBeenCalledWith('main', 'Process scan failed', {
        error: 'renderer-send-failed:scan-batch',
      });

      scanLoop.stopScanIntervals();
      listProcesses.mockRejectedValue(new Error('spawn ENOENT'));
      const provider = makeDeps();
      scanLoop.init(provider);
      await runOneProcessScan();
      expect(provider.logger.error).toHaveBeenCalledWith('main', 'Process scan failed', {
        error: 'spawn ENOENT',
      });
    });

    it('a downstream throw does not wedge the loop — the next tick still enumerates', async () => {
      const deps = makeDeps({ sendToRenderer: throwingSendOn('scan-batch') });
      scanLoop.init(deps);
      scanLoop.startScanIntervals(5000);
      await vi.advanceTimersByTimeAsync(5000);
      await flush();
      await vi.advanceTimersByTimeAsync(5000);
      await flush();

      expect(listProcesses).toHaveBeenCalledTimes(2);
      expect(scanner.getProcessSensorHealth().state).toBe(SENSOR_HEALTH_STATE.HEALTHY);
    });
  });

  // ── network leaf ──

  describe('network leaf', () => {
    beforeEach(async () => {
      // The network scan is gated on population reliability (G′), and a freshly reset
      // process leaf sits at STARTING. One real enumeration puts it at HEALTHY so these
      // tests reach the provider at all; the gate itself is proven in its own suite.
      await scanner.scanProcesses();
    });

    it('a renderer-send throw after a successful provider run leaves the record HEALTHY', async () => {
      const deps = makeDeps({
        getLatestAgents: vi.fn().mockReturnValue(NET_AGENTS),
        sendToRenderer: throwingSendOn('network-update'),
      });
      scanLoop.init(deps);
      await runOneNetworkScan();

      expect(getRawTcpConnections).toHaveBeenCalledTimes(1);
      expect(deps.sendToRenderer).toHaveBeenCalledWith('network-update', expect.any(Array));
      const h = network.getNetworkSensorHealth();
      expect(h.state).toBe(SENSOR_HEALTH_STATE.HEALTHY);
      expect(h.consecutiveFailures).toBe(0);
      expect(h.lastError).toBeNull();
      expect(h.lastSuccessAt).toBeTypeOf('number');
      expect(deps.audit.log).not.toHaveBeenCalledWith('observation-gap', expect.anything());
    });

    it('an audit-write throw after a successful provider run leaves the record HEALTHY', async () => {
      const deps = makeDeps({
        getLatestAgents: vi.fn().mockReturnValue(NET_AGENTS),
        audit: {
          log: vi.fn(() => {
            throw new Error('audit-write-failed');
          }),
        },
      });
      scanLoop.init(deps);
      await runOneNetworkScan();

      expect(deps.audit.log).toHaveBeenCalledWith('network-connection', expect.any(Object));
      const h = network.getNetworkSensorHealth();
      expect(h.state).toBe(SENSOR_HEALTH_STATE.HEALTHY);
      expect(h.consecutiveFailures).toBe(0);
      expect(deps.audit.log).not.toHaveBeenCalledWith('observation-gap', expect.anything());
    });

    it('a baseline throw after provider fulfillment never starts a provider gap', async () => {
      const deps = makeDeps({
        getLatestAgents: vi.fn().mockReturnValue(NET_AGENTS),
        baselines: {
          recordNetworkEndpoint: vi.fn(() => {
            throw new Error('baseline-write-failed');
          }),
        },
      });
      scanLoop.init(deps);
      await runOneNetworkScan();

      expect(getRawTcpConnections).toHaveBeenCalledTimes(1);
      expect(deps.baselines.recordNetworkEndpoint).toHaveBeenCalledOnce();
      expect(network.getNetworkSensorHealth().state).toBe(SENSOR_HEALTH_STATE.HEALTHY);
      expect(deps.audit.log).not.toHaveBeenCalledWith('observation-gap', expect.anything());
    });

    it('audits one fixed-code network gap across failure, skips and recovery', async () => {
      let running = false;
      let reliable = true;
      let agents = NET_AGENTS;
      const provider = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error('private-network-error 203.0.113.77'))
        .mockRejectedValueOnce(new Error('private-network-error 203.0.113.77'))
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      const deps = makeDeps({
        scanner: { getProcessCapabilities: () => ({ populationReliable: reliable }) },
        network: {
          isNetworkScanRunning: () => running,
          setNetworkScanRunning: (value) => {
            running = value;
          },
          scanNetworkConnections: provider,
          noteNetworkSkip: vi.fn(),
        },
        audit: { log: vi.fn(), flush: vi.fn() },
        getLatestAgents: () => agents,
      });
      const gapRecords = () =>
        deps.audit.log.mock.calls
          .filter(([type]) => type === 'observation-gap')
          .map(([, record]) => record);
      scanLoop.init(deps);

      await runOneNetworkScan();
      expect(gapRecords()).toEqual([]);
      await runOneNetworkScan();
      await runOneNetworkScan();
      expect(gapRecords()).toEqual([
        {
          agent: '',
          pid: null,
          instanceId: null,
          action: 'network-provider-unavailable',
          path: '',
          severity: 'normal',
          attribution: null,
          extra: { cause: 'network-provider', state: 'unavailable' },
        },
      ]);
      expect(JSON.stringify(gapRecords())).not.toMatch(/private-network-error|203\.0\.113\.77|Claude Code/);

      reliable = false;
      await runOneNetworkScan();
      reliable = true;
      agents = [];
      await runOneNetworkScan();
      agents = NET_AGENTS;
      running = true;
      await runOneNetworkScan();
      running = false;
      scanLoop.stopScanIntervals();
      expect(provider).toHaveBeenCalledTimes(3);
      expect(gapRecords()).toHaveLength(1);

      await runOneNetworkScan();
      await runOneNetworkScan();
      expect(gapRecords().map((record) => [record.action, record.extra])).toEqual([
        ['network-provider-unavailable', { cause: 'network-provider', state: 'unavailable' }],
        ['network-provider-restored', { cause: 'network-provider', state: 'restored' }],
      ]);
      expect(provider).toHaveBeenCalledTimes(5);
      expect(deps.audit.flush).toHaveBeenCalledTimes(2);
    });

    it('records recovery before downstream processing even when delivery fails', async () => {
      const provider = vi
        .fn()
        .mockRejectedValueOnce(new Error('provider-failed'))
        .mockResolvedValueOnce([]);
      const deps = makeDeps({
        getLatestAgents: vi.fn().mockReturnValue(NET_AGENTS),
        network: {
          isNetworkScanRunning: vi.fn().mockReturnValue(false),
          setNetworkScanRunning: vi.fn(),
          scanNetworkConnections: provider,
        },
        sendToRenderer: throwingSendOn('network-update'),
      });
      scanLoop.init(deps);
      await runOneNetworkScan();
      await runOneNetworkScan();

      const gaps = deps.audit.log.mock.calls.filter(([type]) => type === 'observation-gap');
      expect(gaps.map(([, record]) => record.action)).toEqual([
        'network-provider-unavailable',
        'network-provider-restored',
      ]);
      expect(gaps[1][1].extra).toEqual({ cause: 'network-provider', state: 'restored' });
      expect(deps.audit.log.mock.invocationCallOrder[1]).toBeLessThan(
        deps.setLatestNetConnections.mock.invocationCallOrder[0],
      );
      expect(deps.logger.error).toHaveBeenCalledWith('main', 'Network scan failed', {
        error: 'renderer-send-failed:network-update',
      });
    });

    it('a downstream throw never calls noteNetworkScanHardFailure', async () => {
      const note = vi.fn();
      const deps = makeDeps({
        getLatestAgents: vi.fn().mockReturnValue(NET_AGENTS),
        network: {
          isNetworkScanRunning: vi.fn().mockReturnValue(false),
          setNetworkScanRunning: vi.fn(),
          scanNetworkConnections: vi
            .fn()
            .mockResolvedValue([
              { agent: 'Claude Code', pid: 42, remoteIp: '8.8.8.8', remotePort: 443 },
            ]),
          getNetworkSensorHealth: vi.fn().mockReturnValue({ state: 'HEALTHY' }),
          noteNetworkScanHardFailure: note,
        },
        sendToRenderer: throwingSendOn('network-update'),
      });
      scanLoop.init(deps);
      await runOneNetworkScan();

      expect(deps.network.scanNetworkConnections).toHaveBeenCalledTimes(1);
      expect(note).not.toHaveBeenCalled();
      // The reentrancy flag is still released on the downstream-throw path.
      expect(deps.network.setNetworkScanRunning).toHaveBeenLastCalledWith(false);
    });

    it('a provider throw still marks the record FAILED, counted once', async () => {
      getRawTcpConnections.mockRejectedValue(new Error('spawn ETIMEDOUT'));
      const deps = makeDeps({ getLatestAgents: vi.fn().mockReturnValue(NET_AGENTS) });
      scanLoop.init(deps);
      await runOneNetworkScan();

      const h = network.getNetworkSensorHealth();
      expect(h.state).toBe(SENSOR_HEALTH_STATE.FAILED);
      // One increment: scanNetworkConnections marked FAILED before rethrowing, so the
      // scan-loop fallback must have short-circuited rather than written a second time.
      expect(h.consecutiveFailures).toBe(1);
      expect(h.lastError).toMatch(/ETIMEDOUT/i);
      expect(h.lastSuccessAt).toBeNull();
      expect(deps.sendToRenderer).not.toHaveBeenCalledWith('network-update', expect.anything());
    });

    it('a provider rejection notes hard failure when the provider left health non-FAILED', async () => {
      const note = vi.fn();
      const deps = makeDeps({
        getLatestAgents: vi.fn().mockReturnValue(NET_AGENTS),
        network: {
          isNetworkScanRunning: vi.fn().mockReturnValue(false),
          setNetworkScanRunning: vi.fn(),
          scanNetworkConnections: vi.fn().mockRejectedValue(new Error('spawn ETIMEDOUT')),
          getNetworkSensorHealth: vi.fn().mockReturnValue({ state: 'STARTING' }),
          noteNetworkScanHardFailure: note,
        },
      });
      scanLoop.init(deps);
      await runOneNetworkScan();

      expect(note).toHaveBeenCalledTimes(1);
      expect(note.mock.calls[0][0].message).toMatch(/ETIMEDOUT/);
      expect(deps.network.setNetworkScanRunning).toHaveBeenLastCalledWith(false);
    });

    it('audits the direct provider rejection even if fallback health handling throws', async () => {
      const deps = makeDeps({
        getLatestAgents: vi.fn().mockReturnValue(NET_AGENTS),
        network: {
          isNetworkScanRunning: vi.fn().mockReturnValue(false),
          setNetworkScanRunning: vi.fn(),
          scanNetworkConnections: vi.fn().mockRejectedValue(new Error('provider-failed')),
          getNetworkSensorHealth: vi.fn().mockReturnValue({ state: 'STARTING' }),
          noteNetworkScanHardFailure: vi.fn(() => {
            throw new Error('health-fallback-failed');
          }),
        },
      });
      scanLoop.init(deps);
      await runOneNetworkScan();

      expect(deps.network.noteNetworkScanHardFailure).toHaveBeenCalledOnce();
      expect(deps.audit.log).toHaveBeenCalledWith(
        'observation-gap',
        expect.objectContaining({
          action: 'network-provider-unavailable',
          extra: { cause: 'network-provider', state: 'unavailable' },
        }),
      );
      expect(deps.network.setNetworkScanRunning).toHaveBeenLastCalledWith(false);
    });

    it('keeps the gap latch across interval shutdown and resets it only on init', async () => {
      const deps = makeDeps({
        getLatestAgents: vi.fn().mockReturnValue(NET_AGENTS),
        network: {
          isNetworkScanRunning: vi.fn().mockReturnValue(false),
          setNetworkScanRunning: vi.fn(),
          scanNetworkConnections: vi.fn().mockRejectedValue(new Error('provider-failed')),
        },
      });
      const gapActions = () =>
        deps.audit.log.mock.calls
          .filter(([type]) => type === 'observation-gap')
          .map(([, record]) => record.action);
      scanLoop.init(deps);
      await runOneNetworkScan();
      scanLoop.stopScanIntervals();
      await runOneNetworkScan();
      expect(gapActions()).toEqual(['network-provider-unavailable']);

      scanLoop.init(deps);
      await runOneNetworkScan();
      expect(gapActions()).toEqual([
        'network-provider-unavailable',
        'network-provider-unavailable',
      ]);
    });

    it('both paths keep the existing "Network scan failed" log', async () => {
      const downstream = makeDeps({
        getLatestAgents: vi.fn().mockReturnValue(NET_AGENTS),
        sendToRenderer: throwingSendOn('network-update'),
      });
      scanLoop.init(downstream);
      await runOneNetworkScan();
      expect(downstream.logger.error).toHaveBeenCalledWith('main', 'Network scan failed', {
        error: 'renderer-send-failed:network-update',
      });

      network._resetForTest();
      network._setDepsForTest({
        getRawTcpConnections: vi.fn().mockRejectedValue(new Error('spawn ETIMEDOUT')),
        dnsReverse: vi.fn().mockRejectedValue(new Error('ENOTFOUND')),
        dnsResolve: vi.fn().mockResolvedValue([]),
      });
      const provider = makeDeps({ getLatestAgents: vi.fn().mockReturnValue(NET_AGENTS) });
      scanLoop.init(provider);
      await runOneNetworkScan();
      expect(provider.logger.error).toHaveBeenCalledWith('main', 'Network scan failed', {
        error: 'spawn ETIMEDOUT',
      });
    });

    it('a downstream throw does not wedge the loop — the next scan still queries', async () => {
      const deps = makeDeps({
        getLatestAgents: vi.fn().mockReturnValue(NET_AGENTS),
        sendToRenderer: throwingSendOn('network-update'),
      });
      scanLoop.init(deps);
      await runOneNetworkScan();
      await runOneNetworkScan();

      expect(getRawTcpConnections).toHaveBeenCalledTimes(2);
      expect(network.getNetworkSensorHealth().state).toBe(SENSOR_HEALTH_STATE.HEALTHY);
    });
  });
});
