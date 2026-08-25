/**
 * Block B5 — the tick side of the observation gap, driven through the REAL scan-loop,
 * process-scanner, session-tracker and observation-gap modules under fake timers.
 *
 * Three rules under test:
 *   - the flag clears ONLY from a process tick whose session reconcile was not frozen;
 *   - a tick whose provider `await` straddled a suspend/resume pair is frozen: the
 *     straddle witness is a SNAPSHOT of `suspendCount` taken before the await and
 *     compared with one taken after — never a live read of the module, which would
 *     freeze the honest first tick after resume too;
 *   - the `observation-gap` audit record lands before any post-resume `agent-exit`.
 *
 * No real sleep anywhere: the "sleep" is `vi.advanceTimersByTimeAsync` between two
 * emits on an injected EventEmitter standing in for Electron's powerMonitor.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import { EventEmitter } from 'events';
import { SENSOR_HEALTH_STATE } from '../../src/main/sensor-health.js';

const require_ = createRequire(import.meta.url);

const T0 = 1_700_000_000_000;
/** One process the agent database recognises (`names: ["claude", …]` → Claude Code). */
const CLAUDE = { name: 'claude', pid: 4242 };

describe('scan-loop observation gap (B5)', () => {
  let scanLoop;
  let scanner;
  let network;
  let sessionTracker;
  let gap;
  let listProcesses;
  /** @type {EventEmitter} */
  let powerMonitor;
  /** @type {{detectOllamaModels: Function, detectLMStudioModels: Function}} */
  let llmOriginals;

  const inertExec = () => Promise.resolve('');

  function isolateResourceMonitor() {
    const rm = require_('../../src/main/resource-monitor.js');
    rm._resetForTest();
    rm._setLoggerForTest({ warn: vi.fn() });
    rm._setExecForTest(inertExec);
  }

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

  function isolateLlmDetectors() {
    const llm = require_('../../src/main/llm-runtime-detector.js');
    llmOriginals = {
      detectOllamaModels: llm.detectOllamaModels,
      detectLMStudioModels: llm.detectLMStudioModels,
    };
    llm.detectOllamaModels = async () => ({ running: false, models: [] });
    llm.detectLMStudioModels = async () => ({ running: false, models: [] });
  }

  function restoreLlmDetectors() {
    const llm = require_('../../src/main/llm-runtime-detector.js');
    llm.detectOllamaModels = llmOriginals.detectOllamaModels;
    llm.detectLMStudioModels = llmOriginals.detectLMStudioModels;
  }

  /** Drain the promise chains a scan leaves behind (no timer is scheduled by either). */
  async function flush(rounds = 8) {
    for (let i = 0; i < rounds; i++) await vi.advanceTimersByTimeAsync(0);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const scanLoopPath = require_.resolve('../../src/main/scan-loop.js');
    delete require_.cache[scanLoopPath];
    isolateResourceMonitor();
    isolateExternalDetectors();
    isolateLlmDetectors();

    scanner = require_('../../src/main/process-scanner.js');
    listProcesses = vi.fn().mockResolvedValue([CLAUDE]);
    scanner._resetForTest();
    // `providesStartTime: false` is the linux/darwin steady state (`<pid>:u` keys, never
    // identity-degraded). On a win32 host the reset would otherwise read the platform's
    // `true`, and with no snapshot leaf written every tick would freeze for
    // `identity-degraded` — a cause this file is not about. Case 5 sets it on purpose.
    scanner._setPlatformForTest({ listProcesses, providesStartTime: false });
    scanner.init({ trackSeenAgent: vi.fn() });
    scanner.peakAgents = 0;

    network = require_('../../src/main/network-monitor.js');
    network._resetForTest();
    network._setDepsForTest({
      getRawTcpConnections: vi.fn().mockResolvedValue([]),
      dnsReverse: vi.fn().mockRejectedValue(new Error('ENOTFOUND')),
      dnsResolve: vi.fn().mockResolvedValue([]),
    });

    sessionTracker = require_('../../src/main/session-tracker.js');
    sessionTracker._resetForTest();

    gap = require_('../../src/main/observation-gap.js');
    gap._resetForTest();
    gap.init({ now: () => Date.now() });
    powerMonitor = new EventEmitter();

    scanLoop = require_('../../src/main/scan-loop.js');
  });

  afterEach(async () => {
    scanLoop.stopScanIntervals();
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
    restoreLlmDetectors();
    isolateResourceMonitor();
    sessionTracker._resetForTest();
    gap._resetForTest();
    const ide = require_('../../src/main/ide-extension-detector.js');
    ide._resetForTest();
    const wsl = require_('../../src/main/wsl-detector.js');
    wsl._resetForTest();
  });

  /**
   * Every collaborator a process scan reaches, stubbed inert, with the REAL scanner,
   * session tracker and gap module. The identity stamp is the one thing the stub does
   * for real: `reconcile` keys on `instanceId`, and an unstamped agent has no session.
   * @param {Object} [overrides]
   * @returns {Object}
   */
  function makeDeps(overrides = {}) {
    return {
      scanner,
      network,
      observationGap: gap,
      procUtil: {
        enrichWithParentChains: vi.fn(async (agents) => {
          for (const a of agents) a.instanceId = `${a.pid}:u`;
        }),
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
      ...overrides,
    };
  }

  /**
   * Wire the gap module to the fake powerMonitor the way main.js wires the real one:
   * the resume callback writes the `observation-gap` audit record through the same
   * `audit.log` spy the scan writes `agent-enter` / `agent-exit` through, so ordering
   * between the two is observable on one call list.
   * @param {Object} deps
   */
  function attachPowerMonitor(deps) {
    gap.attach(powerMonitor, {
      onGap: (snap) =>
        deps.audit.log('observation-gap', {
          agent: '',
          pid: null,
          instanceId: null,
          action: 'os-resume',
          path: '',
          severity: 'normal',
          attribution: null,
          extra: gap.buildGapAuditDetails(snap, {
            monitoringPaused: false,
            activeSessions: sessionTracker.activeCount(),
          }),
        }),
    });
  }

  /** Sleep: suspend now, wake `gapMs` later. No timer fires inside — see the 5 s note. */
  async function sleep(gapMs) {
    powerMonitor.emit('suspend');
    await vi.advanceTimersByTimeAsync(gapMs);
    powerMonitor.emit('resume');
  }

  /**
   * Start exactly one `doProcessScan` through the 3 s startup timer (`paused = true`
   * keeps warm-up intervals out). The 8 s file and 12 s network one-shots also queue;
   * every sleep in this file is shorter than 5 s so neither ever fires inside one.
   * @returns {Promise<void>}
   */
  async function runOneProcessScan() {
    scanLoop.staggeredStartup(5000, true);
    await vi.advanceTimersByTimeAsync(3000);
    await flush();
  }

  /** The `type` argument of every audit write, in call order. @param {Object} deps */
  function auditTypes(deps) {
    return deps.audit.log.mock.calls.map((c) => c[0]);
  }

  /** @param {Object} deps @returns {Array} every `scan/session-freeze` debug payload */
  function freezeLogs(deps) {
    return deps.logger.debug.mock.calls
      .filter((c) => c[0] === 'scan' && c[1] === 'session-freeze')
      .map((c) => c[2]);
  }

  /** @param {Object} deps @returns {Array} every `scan/process` debug payload */
  function processLogs(deps) {
    return deps.logger.debug.mock.calls
      .filter((c) => c[0] === 'scan' && c[1] === 'process')
      .map((c) => c[2]);
  }

  it('1. the first tick after resume clears RESUMED → NONE and is tagged postGap', async () => {
    const deps = makeDeps();
    scanLoop.init(deps);
    attachPowerMonitor(deps);
    await sleep(4000);
    expect(gap.snapshot().state).toBe(gap.OBSERVATION_GAP_STATE.RESUMED);

    await runOneProcessScan();

    const s = gap.snapshot();
    expect(s.state).toBe(gap.OBSERVATION_GAP_STATE.NONE);
    expect(s.clearedAt).toBe(T0 + 4000 + 3000);
    expect(sessionTracker.activeCount()).toBe(1);
    expect(auditTypes(deps)).toEqual(['observation-gap', 'agent-enter']);
    expect(processLogs(deps)).toEqual([
      expect.objectContaining({
        postGap: { suspendedAt: T0, resumedAt: T0 + 4000, gapMs: 4000, cleared: true },
      }),
    ]);
    expect(freezeLogs(deps)).toEqual([]);
  });

  it('2. a tick that straddled the sleep is frozen and leaves the flag armed', async () => {
    let resolveList;
    listProcesses.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );
    const deps = makeDeps();
    scanLoop.init(deps);
    attachPowerMonitor(deps);

    // The tick starts at T0+3000 and parks on the provider. The scanner has already
    // taken its `now` — the pre-sleep one.
    scanLoop.staggeredStartup(5000, true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(listProcesses).toHaveBeenCalledTimes(1);
    expect(resolveList).toBeTypeOf('function');

    await sleep(4000);
    resolveList([CLAUDE]);
    await flush();

    // Frozen: no session, no enter, and the freeze is named in the log.
    expect(sessionTracker.activeCount()).toBe(0);
    expect(auditTypes(deps)).toEqual(['observation-gap']);
    expect(freezeLogs(deps)).toEqual([{ reason: 'suspend-straddle', agents: 1 }]);
    // Still armed — a straddled tick is not an observation.
    const s = gap.snapshot();
    expect(s.state).toBe(gap.OBSERVATION_GAP_STATE.RESUMED);
    expect(s.clearedAt).toBeNull();
    // The leaf was written with the PRE-sleep clock (process-scanner takes `now` before
    // its await), so the population's freshness claim is honest about the gap.
    const caps = scanner.getProcessCapabilities();
    expect(caps.populationState).toBe(SENSOR_HEALTH_STATE.HEALTHY);
    expect(caps.populationAsOf).toBe(T0 + 3000);

    // The next clean tick reconciles and clears.
    await runOneProcessScan();
    expect(sessionTracker.activeCount()).toBe(1);
    expect(auditTypes(deps)).toEqual(['observation-gap', 'agent-enter']);
    expect(gap.snapshot().state).toBe(gap.OBSERVATION_GAP_STATE.NONE);
    expect(freezeLogs(deps)).toHaveLength(1);
  });

  it('3. the witness covers the identity stamp: a sleep inside enrichWithParentChains freezes too', async () => {
    let resolveEnrich;
    const deps = makeDeps({
      procUtil: {
        enrichWithParentChains: vi.fn(
          (agents) =>
            new Promise((resolve) => {
              resolveEnrich = () => {
                for (const a of agents) a.instanceId = `${a.pid}:u`;
                resolve();
              };
            }),
        ),
        annotateHostApps: vi.fn(),
        annotateWorkingDirs: vi.fn().mockResolvedValue(),
      },
    });
    scanLoop.init(deps);
    attachPowerMonitor(deps);

    scanLoop.staggeredStartup(5000, true);
    await vi.advanceTimersByTimeAsync(3000);
    await flush(2);
    expect(resolveEnrich).toBeTypeOf('function');

    await sleep(4000);
    resolveEnrich();
    await flush();

    expect(sessionTracker.activeCount()).toBe(0);
    expect(freezeLogs(deps)).toEqual([{ reason: 'suspend-straddle', agents: 1 }]);
    expect(gap.snapshot().state).toBe(gap.OBSERVATION_GAP_STATE.RESUMED);
  });

  it('4. a permission-denied tick after resume observes nothing and leaves the flag armed', async () => {
    const eperm = Object.assign(new Error('access is denied'), { code: 'EPERM' });
    listProcesses.mockRejectedValueOnce(eperm);
    const deps = makeDeps();
    scanLoop.init(deps);
    attachPowerMonitor(deps);
    await sleep(4000);

    await runOneProcessScan();

    expect(scanner.getProcessCapabilities().populationState).toBe(SENSOR_HEALTH_STATE.FAILED);
    expect(gap.snapshot().state).toBe(gap.OBSERVATION_GAP_STATE.RESUMED);
    expect(auditTypes(deps)).toEqual(['observation-gap']);
    // Tagged as a post-gap tick, but not as the one that cleared it.
    expect(processLogs(deps)).toEqual([
      expect.objectContaining({
        postGap: { suspendedAt: T0, resumedAt: T0 + 4000, gapMs: 4000, cleared: false },
      }),
    ]);

    await runOneProcessScan();
    expect(gap.snapshot().state).toBe(gap.OBSERVATION_GAP_STATE.NONE);
    expect(sessionTracker.activeCount()).toBe(1);
  });

  it('5. an identity-degraded tick after resume leaves the flag armed', async () => {
    const deps = makeDeps({ scanner: { ...scanner, isIdentityDegraded: () => true } });
    scanLoop.init(deps);
    attachPowerMonitor(deps);
    await sleep(4000);

    await runOneProcessScan();

    expect(sessionTracker.activeCount()).toBe(0);
    expect(freezeLogs(deps)).toEqual([{ reason: 'identity-degraded', agents: 1 }]);
    expect(gap.snapshot().state).toBe(gap.OBSERVATION_GAP_STATE.RESUMED);
  });

  it('6. an agent gone across the sleep exits after grace, behind the observation-gap record', async () => {
    const deps = makeDeps();
    scanLoop.init(deps);
    attachPowerMonitor(deps);

    await runOneProcessScan(); // sighting → agent-enter
    expect(sessionTracker.activeCount()).toBe(1);

    // The machine still lists SOMETHING — an empty table is `empty-process-table`
    // DEGRADED (B3), not an observation, and would freeze for a reason this case is
    // not about. The agent is simply no longer in it.
    listProcesses.mockResolvedValue([{ name: 'explorer.exe', pid: 1 }]);
    await sleep(4000);
    await runOneProcessScan(); // miss 1 — clears the flag, no exit yet
    expect(gap.snapshot().state).toBe(gap.OBSERVATION_GAP_STATE.NONE);
    expect(sessionTracker.activeCount()).toBe(1);
    await runOneProcessScan(); // miss 2 → exit
    expect(sessionTracker.activeCount()).toBe(0);

    expect(auditTypes(deps)).toEqual(['agent-enter', 'observation-gap', 'agent-exit']);
    const gapRecord = deps.audit.log.mock.calls[1][1];
    expect(gapRecord.extra).toEqual({
      cause: 'os-suspend',
      suspendedAt: new Date(T0 + 3000).toISOString(),
      resumedAt: new Date(T0 + 7000).toISOString(),
      gapMs: 4000,
      suspendCount: 1,
      monitoringPaused: false,
      activeSessions: 1,
    });
    // The exit still names the last PRE-sleep sighting — nothing was re-stamped.
    const exitRecord = deps.audit.log.mock.calls[2][1];
    expect(exitRecord.pid).toBe(CLAUDE.pid);
  });

  it('7. without the collaborator the scan runs exactly as before', async () => {
    const deps = makeDeps({ observationGap: undefined });
    scanLoop.init(deps);
    await runOneProcessScan();
    expect(sessionTracker.activeCount()).toBe(1);
    expect(auditTypes(deps)).toEqual(['agent-enter']);
    expect(processLogs(deps)).toEqual([
      expect.not.objectContaining({ postGap: expect.anything() }),
    ]);
  });
});
