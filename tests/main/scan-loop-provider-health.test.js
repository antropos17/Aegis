/**
 * Stage-1 step A — provider-observation ownership boundaries for the `process`
 * and `network` leaves.
 *
 * The rule under test: a leaf health record is written only by the code that
 * performed or refused the provider observation that leaf names. A failure
 * downstream of the provider's return value — enrichment, session reconcile, an
 * audit write, a renderer send — must leave the record exactly as the provider
 * left it.
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
    scanner._setPlatformForTest({ listProcesses });
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
      statsUpdateBatcher: { push: vi.fn() },
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
    });

    it('a provider throw from _listProcesses still marks the record FAILED', async () => {
      listProcesses.mockRejectedValue(new Error('spawn ENOENT'));
      const deps = makeDeps();
      scanLoop.init(deps);
      await runOneProcessScan();

      const h = scanner.getProcessSensorHealth();
      expect(h.state).toBe(SENSOR_HEALTH_STATE.FAILED);
      expect(h.consecutiveFailures).toBe(1);
      expect(h.lastError).toMatch(/ENOENT/);
      expect(h.detail).toBe('hard-scan-failure');
      expect(scanner.isProcessPopulationReliable()).toBe(false);
      // The observation never returned, so the population was never replaced.
      expect(deps.setAgents).not.toHaveBeenCalled();
    });

    it('a provider throw calls noteProcessScanHardFailure exactly once', async () => {
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
