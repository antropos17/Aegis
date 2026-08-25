/**
 * Steps A′ and G′/S — the ProcessCapabilities contract, and the stale-population
 * scope gate on every agent-scoped consumer.
 *
 * The invariant under test: no agent-scoped observation may be performed against, or
 * attributed to, a population the process sensor cannot currently vouch for. After a
 * hard enumeration failure `setAgents` never runs, so `latestAgents` still holds the
 * PREVIOUS population — and it is deliberately not cleared (clearing re-creates the
 * "zero agents = nothing running" false-clean). The consumers are gated instead.
 *
 * Every gate is asserted twice: once unreliable (the observation must not happen) and
 * once reliable (it must happen exactly as before). The second half is what catches a
 * gate that fires unconditionally — a gate that never lets anything through would pass
 * the first assertion of each pair on its own.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import { SENSOR_HEALTH_STATE } from '../../src/main/sensor-health.js';

const require_ = createRequire(import.meta.url);

/** The capability struct a dependant sees while the process leaf is trustworthy. */
const RELIABLE = Object.freeze({
  populationState: 'HEALTHY',
  populationReliable: true,
  populationAsOf: 1700000000000,
  identityQuality: 'witnessed',
});

/** The same struct after a hard enumeration failure — the list is stale. */
const UNRELIABLE = Object.freeze({
  populationState: 'FAILED',
  populationReliable: false,
  populationAsOf: 1700000000000,
  identityQuality: 'witnessed',
});

// ── A′: the capability contract ──

describe('ProcessCapabilities contract (step A′)', () => {
  let scanner;
  let listProcesses;

  beforeEach(() => {
    scanner = require_('../../src/main/process-scanner.js');
    listProcesses = vi.fn().mockResolvedValue([{ name: 'chrome', pid: 1 }]);
    scanner._resetForTest();
    scanner._setPlatformForTest({ listProcesses });
    scanner.init({ trackSeenAgent: vi.fn() });
    scanner.peakAgents = 0;
  });

  afterEach(() => {
    scanner._resetForTest();
  });

  it('publishes exactly the four contract fields', () => {
    const caps = scanner.getProcessCapabilities();
    expect(Object.keys(caps).sort()).toEqual([
      'identityQuality',
      'populationAsOf',
      'populationReliable',
      'populationState',
    ]);
  });

  it('a never-scanned leaf is STARTING, not reliable, and has no asOf', () => {
    const caps = scanner.getProcessCapabilities();
    expect(caps.populationState).toBe(SENSOR_HEALTH_STATE.STARTING);
    expect(caps.populationReliable).toBe(false);
    expect(caps.populationAsOf).toBeNull();
  });

  it('a successful enumeration makes the population reliable and stamps asOf', async () => {
    await scanner.scanProcesses();
    const caps = scanner.getProcessCapabilities();
    expect(caps.populationState).toBe(SENSOR_HEALTH_STATE.HEALTHY);
    expect(caps.populationReliable).toBe(true);
    expect(caps.populationAsOf).toBeTypeOf('number');
  });

  it('a hard failure clears reliability but KEEPS asOf — the list is stale, not absent', async () => {
    await scanner.scanProcesses();
    const asOf = scanner.getProcessCapabilities().populationAsOf;
    scanner.noteProcessScanHardFailure(new Error('spawn ENOENT'));

    const caps = scanner.getProcessCapabilities();
    expect(caps.populationState).toBe(SENSOR_HEALTH_STATE.FAILED);
    expect(caps.populationReliable).toBe(false);
    // How old the list is, which is exactly the question a stale-scope consumer asks.
    expect(caps.populationAsOf).toBe(asOf);
  });

  it('permission denial is also not reliable', async () => {
    const eperm = Object.assign(new Error('Access is denied'), { code: 'EPERM' });
    listProcesses.mockRejectedValue(eperm);
    await scanner.scanProcesses();
    expect(scanner.getProcessCapabilities().populationReliable).toBe(false);
  });

  it('populationReliable agrees with the older isProcessPopulationReliable on every state', async () => {
    expect(scanner.getProcessCapabilities().populationReliable).toBe(
      scanner.isProcessPopulationReliable(),
    );
    await scanner.scanProcesses();
    expect(scanner.getProcessCapabilities().populationReliable).toBe(
      scanner.isProcessPopulationReliable(),
    );
    scanner.noteProcessScanHardFailure(new Error('boom'));
    expect(scanner.getProcessCapabilities().populationReliable).toBe(
      scanner.isProcessPopulationReliable(),
    );
  });

  it('identityQuality: no platform birth time → unknown, whatever the snapshot says', () => {
    scanner._setPlatformForTest({
      providesStartTime: false,
      getSnapshotHealth: () => ({ state: SENSOR_HEALTH_STATE.HEALTHY }),
    });
    expect(scanner.getProcessCapabilities().identityQuality).toBe('unknown');
  });

  it('identityQuality: snapshot HEALTHY → witnessed', () => {
    scanner._setPlatformForTest({
      providesStartTime: true,
      getSnapshotHealth: () => ({ state: SENSOR_HEALTH_STATE.HEALTHY }),
    });
    expect(scanner.getProcessCapabilities().identityQuality).toBe('witnessed');
  });

  it('identityQuality: snapshot DEGRADED (cim fallback) → birth-time', () => {
    scanner._setPlatformForTest({
      providesStartTime: true,
      getSnapshotHealth: () => ({ state: SENSOR_HEALTH_STATE.DEGRADED }),
    });
    expect(scanner.getProcessCapabilities().identityQuality).toBe('birth-time');
  });

  it('identityQuality: snapshot FAILED or STARTING → unknown (no witness was read)', () => {
    scanner._setPlatformForTest({
      providesStartTime: true,
      getSnapshotHealth: () => ({ state: SENSOR_HEALTH_STATE.FAILED }),
    });
    expect(scanner.getProcessCapabilities().identityQuality).toBe('unknown');
    scanner._setPlatformForTest({
      getSnapshotHealth: () => ({ state: SENSOR_HEALTH_STATE.STARTING }),
    });
    expect(scanner.getProcessCapabilities().identityQuality).toBe('unknown');
  });

  it('identityQuality gates nothing: a degraded witness leaves the population reliable', async () => {
    await scanner.scanProcesses();
    scanner._setPlatformForTest({
      providesStartTime: true,
      getSnapshotHealth: () => ({ state: SENSOR_HEALTH_STATE.FAILED }),
    });
    const caps = scanner.getProcessCapabilities();
    expect(caps.identityQuality).toBe('unknown');
    expect(caps.populationReliable).toBe(true);
  });
});

// ── G′: the orchestrator gates ──

describe('stale-population scope gate — orchestration (step G′)', () => {
  let scanLoop;

  const inertExec = () => Promise.resolve('');

  function isolateResourceMonitor() {
    const rm = require_('../../src/main/resource-monitor.js');
    rm._resetForTest();
    rm._setLoggerForTest({ warn: vi.fn() });
    rm._setExecForTest(inertExec);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    delete require_.cache[require_.resolve('../../src/main/scan-loop.js')];
    isolateResourceMonitor();
    scanLoop = require_('../../src/main/scan-loop.js');
  });

  afterEach(async () => {
    scanLoop.stopScanIntervals();
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
    isolateResourceMonitor();
  });

  /**
   * The stale population a hard enumeration failure leaves behind: a non-empty list
   * of agents that may already be dead, with pids the OS may have reissued.
   */
  const STALE_AGENTS = [
    { agent: 'Claude Code', pid: 4242, instanceId: '4242:t', category: 'ai', cwd: '/home/user/a' },
  ];

  /**
   * @param {boolean} reliable
   * @param {Object} [overrides]
   * @returns {Object}
   */
  function makeDeps(reliable, overrides = {}) {
    return {
      scanner: {
        scanProcesses: vi.fn().mockResolvedValue({ agents: [], changed: false }),
        getProcessCapabilities: vi.fn().mockReturnValue(reliable ? RELIABLE : UNRELIABLE),
      },
      network: {
        isNetworkScanRunning: vi.fn().mockReturnValue(false),
        setNetworkScanRunning: vi.fn(),
        scanNetworkConnections: vi.fn().mockResolvedValue([]),
        noteNetworkSkip: vi.fn(),
        noteNetworkScanHardFailure: vi.fn(),
        getNetworkSensorHealth: vi.fn().mockReturnValue({ state: 'HEALTHY' }),
      },
      watcher: {
        pruneKnownHandles: vi.fn(),
        scanAllFileHandles: vi.fn().mockResolvedValue([]),
        scanHotFileHolders: vi.fn().mockResolvedValue([]),
        noteFileScanSkip: vi.fn(),
        isHotReadScanActive: vi.fn().mockReturnValue(true),
      },
      procUtil: {
        enrichWithParentChains: vi.fn().mockResolvedValue(),
        annotateHostApps: vi.fn(),
        annotateWorkingDirs: vi.fn().mockResolvedValue(),
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
      getLatestAgents: vi.fn().mockReturnValue(STALE_AGENTS),
      setAgents: vi.fn(),
      setLatestNetConnections: vi.fn(),
      ...overrides,
    };
  }

  /** @param {Object} deps @param {string} kind @returns {Object|undefined} */
  function skipLine(deps, kind) {
    return deps.logger.debug.mock.calls.find((c) => c[0] === 'scan' && c[1] === kind);
  }

  /** Drive one doFileScan: staggeredStartup fires it at 8s. @returns {Promise<void>} */
  async function runFileScan() {
    scanLoop.staggeredStartup(5000, true);
    await vi.advanceTimersByTimeAsync(8000);
    await vi.advanceTimersByTimeAsync(0);
  }

  /**
   * Drive one doHotReadScan: it has no startup timer, only the post-warmup interval.
   * @returns {Promise<void>}
   */
  async function runHotReadScan() {
    scanLoop.startScanIntervals(60000);
    await vi.advanceTimersByTimeAsync(10000);
    await vi.advanceTimersByTimeAsync(0);
  }

  describe('network', () => {
    it('unreliable population + stale non-empty list → the TCP provider is not called', () => {
      const deps = makeDeps(false);
      scanLoop.init(deps);
      scanLoop.doNetworkScan();

      expect(deps.network.scanNetworkConnections).not.toHaveBeenCalled();
      expect(deps.network.noteNetworkSkip).toHaveBeenCalledWith('process-observation-unavailable');
      expect(skipLine(deps, 'network-skip')[2]).toEqual({
        reason: 'process-observation-unavailable',
        agents: 1,
      });
    });

    it('reliable population + the same list → the provider runs against those pids', async () => {
      const deps = makeDeps(true);
      scanLoop.init(deps);
      scanLoop.doNetworkScan();
      await vi.advanceTimersByTimeAsync(0);

      expect(deps.network.scanNetworkConnections).toHaveBeenCalledWith(STALE_AGENTS);
      expect(deps.network.noteNetworkSkip).not.toHaveBeenCalled();
    });

    it('reliable + empty stays confirmed-zero — cardinality is still not health', () => {
      const deps = makeDeps(true, { getLatestAgents: vi.fn().mockReturnValue([]) });
      scanLoop.init(deps);
      scanLoop.doNetworkScan();

      expect(deps.network.noteNetworkSkip).toHaveBeenCalledWith('confirmed-zero-agents');
      expect(deps.network.scanNetworkConnections).not.toHaveBeenCalled();
    });

    it('unreliable + empty is process-unavailable, not confirmed-zero', () => {
      const deps = makeDeps(false, { getLatestAgents: vi.fn().mockReturnValue([]) });
      scanLoop.init(deps);
      scanLoop.doNetworkScan();

      expect(deps.network.noteNetworkSkip).toHaveBeenCalledWith('process-observation-unavailable');
    });
  });

  describe('file scan (RM / handle)', () => {
    it('unreliable population → no handle scan against stale pids, skip recorded', async () => {
      const deps = makeDeps(false);
      scanLoop.init(deps);
      await runFileScan();

      expect(deps.watcher.scanAllFileHandles).not.toHaveBeenCalled();
      expect(deps.watcher.noteFileScanSkip).toHaveBeenCalledWith('process-observation-unavailable');
      expect(skipLine(deps, 'file-skip')[2]).toEqual({
        reason: 'process-observation-unavailable',
        agents: 1,
      });
    });

    it('reliable population → the scan runs against exactly that list', async () => {
      const deps = makeDeps(true);
      scanLoop.init(deps);
      await runFileScan();

      expect(deps.watcher.scanAllFileHandles).toHaveBeenCalledWith(STALE_AGENTS);
      expect(deps.watcher.noteFileScanSkip).not.toHaveBeenCalled();
    });

    it('reliable + empty is confirmed-zero — the read leaf records a scoped success, no scan', async () => {
      const deps = makeDeps(true, { getLatestAgents: vi.fn().mockReturnValue([]) });
      scanLoop.init(deps);
      await runFileScan();

      expect(deps.watcher.noteFileScanSkip).toHaveBeenCalledWith('confirmed-zero-agents');
      expect(deps.watcher.scanAllFileHandles).not.toHaveBeenCalled();
      expect(skipLine(deps, 'file-skip')[2]).toEqual({
        reason: 'confirmed-zero-agents',
        agents: 0,
      });
    });

    it('unreliable + empty is process-unavailable, not confirmed-zero', async () => {
      const deps = makeDeps(false, { getLatestAgents: vi.fn().mockReturnValue([]) });
      scanLoop.init(deps);
      await runFileScan();

      expect(deps.watcher.noteFileScanSkip).toHaveBeenCalledWith('process-observation-unavailable');
      expect(deps.watcher.noteFileScanSkip).not.toHaveBeenCalledWith('confirmed-zero-agents');
    });
  });

  describe('hot read', () => {
    it('unreliable population → no hot RM poll against stale pids, skip recorded', async () => {
      const deps = makeDeps(false);
      scanLoop.init(deps);
      await runHotReadScan();

      expect(deps.watcher.scanHotFileHolders).not.toHaveBeenCalled();
      expect(deps.watcher.noteFileScanSkip).toHaveBeenCalledWith('process-observation-unavailable');
      expect(skipLine(deps, 'hot-read-skip')[2]).toEqual({
        reason: 'process-observation-unavailable',
        agents: 1,
      });
    });

    it('reliable population → the hot poll runs against exactly that list', async () => {
      const deps = makeDeps(true);
      scanLoop.init(deps);
      await runHotReadScan();

      expect(deps.watcher.scanHotFileHolders).toHaveBeenCalledWith(STALE_AGENTS);
      expect(deps.watcher.noteFileScanSkip).not.toHaveBeenCalled();
    });

    it('reliable + empty is confirmed-zero on the hot cycle too', async () => {
      const deps = makeDeps(true, { getLatestAgents: vi.fn().mockReturnValue([]) });
      scanLoop.init(deps);
      await runHotReadScan();

      expect(deps.watcher.noteFileScanSkip).toHaveBeenCalledWith('confirmed-zero-agents');
      expect(deps.watcher.scanHotFileHolders).not.toHaveBeenCalled();
      expect(skipLine(deps, 'hot-read-skip')[2]).toEqual({
        reason: 'confirmed-zero-agents',
        agents: 0,
      });
    });

    it('unreliable + empty on the hot cycle is process-unavailable, not confirmed-zero', async () => {
      const deps = makeDeps(false, { getLatestAgents: vi.fn().mockReturnValue([]) });
      scanLoop.init(deps);
      await runHotReadScan();

      expect(deps.watcher.noteFileScanSkip).toHaveBeenCalledWith('process-observation-unavailable');
      expect(deps.watcher.noteFileScanSkip).not.toHaveBeenCalledWith('confirmed-zero-agents');
    });
  });

  it('the gate never clears latestAgents — the list survives for display', async () => {
    const deps = makeDeps(false);
    scanLoop.init(deps);
    // Only the GATED consumers, never a process tick: the point is that refusing to
    // observe does not touch the population, so the display keeps its last known list
    // instead of showing zero agents (which would re-create the flagship false-clean).
    scanLoop.doNetworkScan();
    await runHotReadScan();

    expect(deps.setAgents).not.toHaveBeenCalled();
    expect(deps.getLatestAgents()).toEqual(STALE_AGENTS);
  });

  it('a scanner exposing no capability API is treated as reliable (collaborator stubs)', () => {
    const deps = makeDeps(true, { scanner: { scanProcesses: vi.fn() } });
    scanLoop.init(deps);
    scanLoop.doNetworkScan();

    expect(deps.network.scanNetworkConnections).toHaveBeenCalled();
  });
});

// ── G′: the in-module invariants ──

describe('stale-population scope gate — file-watcher (step G′)', () => {
  let fileWatcher;
  let state;

  /** One AI agent whose cwd contains the probe path, so an owner IS findable. */
  const AI_AGENTS = [
    {
      pid: 100,
      agent: 'Claude Code',
      category: 'ai',
      cwd: '/home/user/a',
      instanceId: '100:1700000000000',
    },
  ];

  /** @param {Object} [overrides] @returns {Object} */
  function makeState(overrides = {}) {
    return {
      getCustomRules: () => [],
      getLatestAgents: () => AI_AGENTS,
      getLatestAiAgents: () => AI_AGENTS,
      isMonitoringPaused: () => false,
      isOtherPanelExpanded: () => false,
      activityLog: [],
      knownHandles: new Map(),
      watchers: [],
      recordFileAccess: vi.fn(),
      onFileEvent: vi.fn(),
      onActivityPush: vi.fn(),
      ...overrides,
    };
  }

  /** @param {boolean} reliable @returns {void} */
  function setPopulation(reliable) {
    fileWatcher._setDepsForTest({
      getProcessCapabilities: () => (reliable ? RELIABLE : UNRELIABLE),
    });
  }

  beforeEach(() => {
    fileWatcher = require_('../../src/main/file-watcher.js');
    state = makeState();
    fileWatcher.init(state);
    fileWatcher._resetForTest();
  });

  afterEach(() => {
    fileWatcher._resetForTest();
  });

  describe('chokidar owner inference', () => {
    it('unreliable population → path evidence kept, attribution unattributed', () => {
      setPopulation(false);
      fileWatcher.handleWatcherEvent('modified', '/home/user/a/src/secrets.js');

      expect(state.activityLog).toHaveLength(1);
      const ev = state.activityLog[0];
      // The path observation is intact — chokidar saw a real write.
      expect(ev.file).toBe(require_('path').resolve('/home/user/a/src/secrets.js'));
      expect(ev.action).toBe('modified');
      expect(ev.timestamp).toBeTypeOf('number');
      // The owner is not: no stale identity anywhere on the record.
      expect(ev.attribution).toEqual({
        status: 'unattributed',
        evidence: ['population-unavailable'],
      });
      expect(ev.agent).toBe('');
      expect(ev.pid).toBeNull();
      expect(ev.instanceId).toBeNull();
      expect(ev.cwd).toBeNull();
      expect(ev.parentEditor).toBeNull();
    });

    it('reliable population + the same path → the real owner, inferred by cwd', () => {
      setPopulation(true);
      fileWatcher.handleWatcherEvent('modified', '/home/user/a/src/secrets.js');

      const ev = state.activityLog[0];
      expect(ev.attribution).toEqual({ status: 'inferred', evidence: ['cwd-containment'] });
      expect(ev.agent).toBe('Claude Code');
      expect(ev.pid).toBe(100);
      expect(ev.instanceId).toBe('100:1700000000000');
    });

    it('unreliable population does not consult latestAiAgents at all', () => {
      const getLatestAiAgents = vi.fn().mockReturnValue(AI_AGENTS);
      state = makeState({ getLatestAiAgents });
      fileWatcher.init(state);
      setPopulation(false);
      fileWatcher.handleWatcherEvent('modified', '/home/user/a/src/other.js');

      expect(getLatestAiAgents).not.toHaveBeenCalled();
    });

    it('an unattributed event enters no baseline — no stale bucket is created', () => {
      setPopulation(false);
      fileWatcher.handleWatcherEvent('modified', '/home/user/a/src/secrets.js');

      expect(state.recordFileAccess).not.toHaveBeenCalled();
    });

    it('a sensitive path stays sensitive: a self-access exemption needs a proven owner', () => {
      setPopulation(false);
      fileWatcher.handleWatcherEvent('modified', '/home/user/.ssh/id_rsa');

      const ev = state.activityLog[0];
      expect(ev.sensitive).toBe(true);
      expect(ev.selfAccess).toBe(false);
      expect(ev.attribution.evidence).toEqual(['population-unavailable']);
    });

    it('chokidar health is untouched by the gate — W is not a population input', () => {
      const before = fileWatcher.getFileSensorHealth()['fs-chokidar'];
      setPopulation(false);
      fileWatcher.handleWatcherEvent('modified', '/home/user/a/src/secrets.js');

      expect(fileWatcher.getFileSensorHealth()['fs-chokidar']).toEqual(before);
    });
  });

  describe('RM holder scan', () => {
    /** Install an RM holder source that would map onto the stale agent's pid. */
    function armRm() {
      fileWatcher._setDepsForTest({
        getSensitiveHolders: vi.fn(async () => [{ pid: 100, group: '/home/user/.aws' }]),
        getHotSensitiveHolders: vi.fn(async () => [{ pid: 100, group: '/home/user/.aws' }]),
      });
    }

    it('unreliable population → no RM_HOLDER_PID stamp, RM marked DEGRADED', async () => {
      armRm();
      setPopulation(false);
      const events = await fileWatcher.scanAllFileHandles(AI_AGENTS);

      expect(events).toEqual([]);
      expect(state.activityLog).toHaveLength(0);
      const rm = fileWatcher.getFileSensorHealth()['fs-rm'];
      expect(rm.state).toBe(SENSOR_HEALTH_STATE.DEGRADED);
      expect(rm.detail).toBe('process-observation-unavailable');
      // Not a provider failure — nothing failed, the scope was refused.
      expect(rm.consecutiveFailures).toBe(0);
      expect(rm.lastSuccessAt).toBeNull();
    });

    it('reliable population → the holder is stamped confirmed as before', async () => {
      armRm();
      setPopulation(true);
      const events = await fileWatcher.scanAllFileHandles(AI_AGENTS);

      expect(events).toHaveLength(1);
      expect(events[0].attribution.status).toBe('confirmed');
      expect(events[0].attribution.evidence).toContain('rm-holder-pid');
      expect(events[0].agent).toBe('Claude Code');
      expect(fileWatcher.getFileSensorHealth()['fs-rm'].state).toBe(SENSOR_HEALTH_STATE.HEALTHY);
    });

    it('the hot cycle is gated the same way', async () => {
      armRm();
      setPopulation(false);
      const events = await fileWatcher.scanHotFileHolders(AI_AGENTS);

      expect(events).toEqual([]);
      expect(state.activityLog).toHaveLength(0);
      expect(fileWatcher.getFileSensorHealth()['fs-rm'].state).toBe(SENSOR_HEALTH_STATE.DEGRADED);
    });

    it('the hot cycle still runs on a reliable population', async () => {
      armRm();
      setPopulation(true);
      const events = await fileWatcher.scanHotFileHolders(AI_AGENTS);

      expect(events).toHaveLength(1);
      expect(events[0].attribution.evidence).toContain('rm-holder-pid');
    });
  });

  describe('handle pool', () => {
    it('unreliable population → no per-pid handle scan, handle sensor DEGRADED', async () => {
      const getFileHandles = vi.fn(async () => ['/home/user/.aws/credentials']);
      fileWatcher._setDepsForTest({ getFileHandles });
      setPopulation(false);
      const events = await fileWatcher.scanAllFileHandles(AI_AGENTS);

      expect(events).toEqual([]);
      expect(getFileHandles).not.toHaveBeenCalled();
      const handle = fileWatcher.getFileSensorHealth()['fs-handle'];
      expect(handle.state).toBe(SENSOR_HEALTH_STATE.DEGRADED);
      expect(handle.detail).toBe('process-observation-unavailable');
      expect(handle.lastSuccessAt).toBeNull();
    });

    it('reliable population → the pool scans and stamps handle-scan-pid', async () => {
      const getFileHandles = vi.fn(async () => ['/home/user/.aws/credentials']);
      fileWatcher._setDepsForTest({ getFileHandles });
      setPopulation(true);
      const events = await fileWatcher.scanAllFileHandles(AI_AGENTS);

      expect(getFileHandles).toHaveBeenCalled();
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].attribution.evidence).toContain('handle-scan-pid');
      expect(fileWatcher.getFileSensorHealth()['fs-handle'].state).toBe(
        SENSOR_HEALTH_STATE.HEALTHY,
      );
    });

    it('unreliable population + an empty AI scope → the gate wins over cardinality: DEGRADED, no zero claimed', async () => {
      const getFileHandles = vi.fn(async () => []);
      fileWatcher._setDepsForTest({ getFileHandles });
      setPopulation(false);
      const events = await fileWatcher.scanAllFileHandles([]);

      expect(events).toEqual([]);
      expect(getFileHandles).not.toHaveBeenCalled();
      const handle = fileWatcher.getFileSensorHealth()['fs-handle'];
      expect(handle.state).toBe(SENSOR_HEALTH_STATE.DEGRADED);
      expect(handle.detail).toBe('process-observation-unavailable');
      expect(handle.lastSuccessAt).toBeNull();
    });
  });

  describe('noteFileScanSkip', () => {
    it('marks the ACTIVE mechanism: RM when the RM path owns observation', () => {
      fileWatcher._setDepsForTest({ getSensitiveHolders: vi.fn(async () => []) });
      fileWatcher.noteFileScanSkip('process-observation-unavailable');

      expect(fileWatcher.getFileSensorHealth()['fs-rm'].state).toBe(SENSOR_HEALTH_STATE.DEGRADED);
      // The pool is not the mechanism this process observes with, so its leaf is out of
      // the worst-of — not STARTING, which would hold the app at SENSORS_STARTING forever.
      const handle = fileWatcher.getFileSensorHealth()['fs-handle'];
      expect(handle.state).toBe(SENSOR_HEALTH_STATE.UNSUPPORTED);
      expect(handle.detail).toBe('rm-owns-observation');
    });

    it('marks the handle sensor when RM is not the active mechanism', () => {
      fileWatcher.noteFileScanSkip('process-observation-unavailable');

      expect(fileWatcher.getFileSensorHealth()['fs-handle'].state).toBe(
        SENSOR_HEALTH_STATE.DEGRADED,
      );
    });

    it('never advances lastSuccessAt — a refusal is not a scoped success', async () => {
      const getFileHandles = vi.fn(async () => []);
      fileWatcher._setDepsForTest({ getFileHandles });
      setPopulation(true);
      await fileWatcher.scanAllFileHandles(AI_AGENTS);
      const successAt = fileWatcher.getFileSensorHealth()['fs-handle'].lastSuccessAt;
      expect(successAt).toBeTypeOf('number');

      fileWatcher.noteFileScanSkip('process-observation-unavailable');
      const handle = fileWatcher.getFileSensorHealth()['fs-handle'];
      expect(handle.state).toBe(SENSOR_HEALTH_STATE.DEGRADED);
      expect(handle.lastSuccessAt).toBe(successAt);
    });
  });
});
