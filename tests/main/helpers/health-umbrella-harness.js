/**
 * Block B8 — the harness behind `tests/main/app-health-umbrella.test.js`.
 *
 * One process, every real leaf: process-scanner, network-monitor, file-watcher with its
 * watch-root plan, the three secondary detectors, session-tracker and observation-gap,
 * driven through the REAL scan-loop schedulers and read through the REAL composer —
 * `main.getAppHealth()` / `main.getStats()`. Nothing in `src/` is spied on. Only the edges
 * that would touch the host are replaced, each at the seam the module already offers:
 *
 *   - `electron`    → a fake `app` whose `whenReady` never resolves: main.js loads, the
 *                     lifecycle never starts (main-app-health-stats.test.js).
 *   - `chokidar`    → fake FSWatcher objects the test drives with `ready` / `error`
 *                     (file-watcher-watch-roots.test.js).
 *   - `./platform`  → a fake façade, but ONLY as seen from main.js and file-watcher.js.
 *                     The sensors keep the real one and are shaped through their own
 *                     `_setPlatformForTest` / `_setDepsForTest`. This is what makes every
 *                     case read the same on win32 (this checkout) and ubuntu (CI): no
 *                     `proc-snapshot` leaf unless a case installs one, `fs-rm` UNSUPPORTED
 *                     unless a case opts into the Restart Manager path, no probe spawned.
 *   - the OS        → `listProcesses`, `getRawTcpConnections`, `getFileHandles`,
 *                     `getSensitiveHolders`, the detectors' `execFile` / `readdir` / `http`,
 *                     all injected.
 *
 * Fake timers throughout. A "sleep" is two emits on an EventEmitter standing in for
 * Electron's powerMonitor, exactly as scan-loop-observation-gap.test.js does it — no real
 * sleep anywhere. The clock starts at a fresh minute for every harness so nothing a
 * previous case timestamped can collide with the 15 s network re-trigger window.
 *
 * `main._loadDeferredModulesForTest` (the one src hook of this block) is what puts the
 * real modules behind the composer: the loaded `getAppHealth` branch reads bindings the
 * `_set*ForTest` hooks never cover, and without that pass it throws on the first read.
 */
import { vi, expect } from 'vitest';
import Module from 'module';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);

/** Fixed epoch; each harness starts one minute after the previous one. */
export const T0 = 1_700_000_000_000;
let harnessCount = 0;

/** One process the agent database recognises (`names: ["claude", …]` → Claude Code). */
export const CLAUDE = Object.freeze({ name: 'claude', pid: 4242 });
/** A second instance of the same agent — two pids, one name, both `category: 'ai'`. */
export const CLAUDE_2 = Object.freeze({ name: 'claude', pid: 4343 });

/** The Ollama probe port (llm-runtime-detector.js). */
export const OLLAMA_PORT = 11434;
/** The LM Studio probe port. */
export const LM_STUDIO_PORT = 1234;

/** Every sensor id the loaded composer registers when no `proc-snapshot` leaf exists. */
export const BASE_SENSOR_IDS = Object.freeze([
  'fs-chokidar',
  'fs-handle',
  'fs-rm',
  'ide-extension',
  'llm-lmstudio',
  'llm-ollama',
  'network',
  'process',
  'wsl',
]);

const originalLoad = Module._load;
const originalArgv = process.argv;

/** @param {string} rel @returns {string} */
function resolveSrc(rel) {
  return require_.resolve(`../../../src/main/${rel}`);
}

/**
 * @param {unknown} parent
 * @returns {boolean} whether `parent` is one of the two modules that see the fake platform
 */
function wantsFakePlatform(parent) {
  const filename = parent && typeof parent === 'object' ? parent.filename : null;
  return typeof filename === 'string' && /[\\/](main|file-watcher)\.js$/.test(filename);
}

/**
 * The fake Electron surface main.js touches at module scope. `whenReady` never resolves,
 * so `createWindow` / `initDeferredSubsystems` never run and nothing here spawns.
 */
const fakeElectron = {
  app: {
    name: 'Aegis',
    getPath: () => os.tmpdir(),
    getVersion: () => '0.0.0-test',
    setName: () => {},
    disableHardwareAcceleration: () => {},
    requestSingleInstanceLock: () => true,
    whenReady: () => new Promise(() => {}),
    on: () => {},
    quit: () => {},
  },
  BrowserWindow: class {},
  globalShortcut: { register: () => {}, unregisterAll: () => {} },
  shell: { openExternal: () => {} },
  ipcMain: { handle: () => {}, on: () => {} },
  dialog: {},
  Notification: class {},
  Tray: class {},
  Menu: { buildFromTemplate: (t) => t },
  nativeImage: { createFromBuffer: (b) => b },
  safeStorage: { isEncryptionAvailable: () => false },
};

/**
 * Install the three module shims and load main.js behind them. Call ONCE at the top of
 * the test file; `shims.restore()` in `afterAll`.
 *
 * `file-watcher` is required here, under the shim, BEFORE main.js: its `_platform` is a
 * module-scope const, so the fake must be in place on the one load that binds it, and
 * every later `require('./file-watcher')` — main.js's included — returns that instance.
 * @returns {{
 *   main: object,
 *   fakePlatform: object,
 *   watchers: Array<{on: Function, close: Function, emit: Function, paths: unknown}>,
 *   watchMock: Function,
 *   restore: () => void,
 * }}
 */
export function installShims() {
  // The real façade's ignore list rides along so a delivered path is classified exactly
  // as production classifies it; everything else the two modules read is injected.
  const { IGNORE_FILE_PATTERNS } = require_(resolveSrc('platform/index.js'));
  const fakePlatform = {
    IGNORE_FILE_PATTERNS,
    getFileHandles: async () => [],
    isReadDetectionAvailable: () => true,
  };
  /** @type {Array<{on: Function, close: Function, emit: Function, paths: unknown}>} */
  const watchers = [];
  const watchMock = vi.fn((paths) => {
    const handlers = new Map();
    const w = {
      on: vi.fn((event, cb) => {
        if (!handlers.has(event)) handlers.set(event, []);
        handlers.get(event).push(cb);
        return w;
      }),
      close: vi.fn(),
      paths,
      emit(event, ...args) {
        for (const cb of handlers.get(event) || []) cb(...args);
      },
    };
    watchers.push(w);
    return w;
  });

  Module._load = function (request, parent) {
    if (request === 'electron') return fakeElectron;
    if (request === 'chokidar') return { watch: watchMock };
    if (request === './platform' && wantsFakePlatform(parent)) return fakePlatform;
    return originalLoad.apply(this, arguments);
  };
  // main.js exits early via a module-scope `return` when argv carries a CLI flag —
  // vitest's own argv must not trip that branch and blank out module.exports.
  process.argv = ['node', 'main.js'];
  // The preflight `fs.promises.access` decides the watch plan; four groups on a
  // developer box, two on a fresh runner. Pin it so the plan is the same everywhere.
  vi.spyOn(require_('fs').promises, 'access').mockImplementation(async () => {});

  for (const rel of ['file-watcher.js', 'scan-loop.js', 'main.js']) {
    delete require_.cache[resolveSrc(rel)];
  }
  require_(resolveSrc('file-watcher.js'));
  const main = require_(resolveSrc('main.js'));

  return {
    main,
    fakePlatform,
    watchers,
    watchMock,
    restore() {
      Module._load = originalLoad;
      process.argv = originalArgv;
      vi.restoreAllMocks();
    },
  };
}

/** Inert command runner for resource-monitor — see scan-loop.test.js for why. */
const inertExec = () => Promise.resolve('');

function isolateResourceMonitor() {
  const rm = require_(resolveSrc('resource-monitor.js'));
  rm._resetForTest();
  rm._setLoggerForTest({ warn: vi.fn() });
  rm._setExecForTest(inertExec);
}

/**
 * A fake `http` whose every request answers per port: `'refused'` (ECONNREFUSED — a
 * definite negative, HEALTHY) or `'timeout'` (no observation, DEGRADED). The detector
 * registers its `error` / `timeout` listeners between `request()` and `end()`, so the
 * answer is delivered from `end()` on a microtask.
 * @param {Record<number, 'refused'|'timeout'>} answers
 * @returns {{request: Function}}
 */
function fakeHttp(answers) {
  return {
    request(opts) {
      const req = new EventEmitter();
      req.destroy = vi.fn();
      req.end = () => {
        queueMicrotask(() => {
          const kind = answers[opts.port] || 'refused';
          if (kind === 'timeout') {
            req.emit('timeout');
          } else {
            req.emit(
              'error',
              Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
            );
          }
        });
      };
      return req;
    },
  };
}

/**
 * @param {string} sensorId
 * @param {string} state
 * @param {string|null} detail
 * @returns {object} a record `sensor-health.assertRecord` accepts
 */
function leafRecord(sensorId, state, detail) {
  const now = Date.now();
  return {
    sensorId,
    state,
    lastAttemptAt: now,
    lastSuccessAt: state === 'HEALTHY' || detail === 'cim-fallback' ? now : null,
    lastError: state === 'FAILED' ? 'no provider produced a process map' : null,
    consecutiveFailures: state === 'FAILED' ? 1 : 0,
    lossCount: 0,
    detail,
  };
}

/**
 * Reset every leaf, wire the real modules to their injected edges, run the deferred
 * require pass and hand back the drivers. One per test, in `beforeEach`; `tearDown()`
 * in `afterEach`.
 * @param {ReturnType<typeof installShims>} shims
 * @param {{
 *   processes?: Array<{name: string, pid: number}>,
 *   llm?: Record<number, 'refused'|'timeout'>,
 * }} [opts]
 * @returns {object}
 */
export function createHarness(shims, opts = {}) {
  const { main, fakePlatform, watchers } = shims;
  const t0 = T0 + harnessCount * 60_000;
  harnessCount += 1;
  vi.useFakeTimers();
  vi.setSystemTime(t0);
  watchers.length = 0;
  delete fakePlatform.getSnapshotHealth;
  isolateResourceMonitor();

  // ── process ──
  const scanner = require_(resolveSrc('process-scanner.js'));
  const listProcesses = vi.fn().mockResolvedValue(opts.processes || [CLAUDE]);
  scanner._resetForTest();
  // `providesStartTime: false` is the linux/darwin steady state (`<pid>:u` keys, never
  // identity-degraded). A case that wants the win32 shape installs a snapshot leaf.
  scanner._setPlatformForTest({ listProcesses, providesStartTime: false });
  scanner.init({ trackSeenAgent: vi.fn() });
  scanner.peakAgents = 0;

  // ── network ──
  const network = require_(resolveSrc('network-monitor.js'));
  const getRawTcpConnections = vi
    .fn()
    .mockImplementation(async (pids) =>
      pids.map((pid) => ({ pid, ip: '8.8.8.8', port: 443, state: 'Established' })),
    );
  network._resetForTest();
  network._setDepsForTest({
    getRawTcpConnections,
    dnsReverse: vi.fn().mockRejectedValue(new Error('ENOTFOUND')),
    dnsResolve: vi.fn().mockResolvedValue([]),
  });

  // ── file (handle pool by default; a case opts into RM with getSensitiveHolders) ──
  let latest = [];
  const watcher = require_(resolveSrc('file-watcher.js'));
  const getFileHandles = vi.fn(async () => []);
  const fsState = {
    getCustomRules: () => [],
    getSettings: () => ({}),
    getLatestAgents: () => latest,
    getLatestAiAgents: () => latest.filter((a) => a.category === 'ai'),
    isMonitoringPaused: () => false,
    isOtherPanelExpanded: () => false,
    activityLog: [],
    knownHandles: new Map(),
    watchers: [],
    recordFileAccess: vi.fn(),
    onFileEvent: vi.fn(),
    onActivityPush: vi.fn(),
  };
  watcher.init(fsState);
  watcher._resetForTest();
  // `_resetForTest` installs an always-HEALTHY capability stub for the attribution
  // suites; the umbrella needs the gate to read the REAL process leaf.
  watcher._setDepsForTest({
    getProcessCapabilities: () => scanner.getProcessCapabilities(),
    getFileHandles,
    isReadDetectionAvailable: true,
  });

  // ── secondary detectors ──
  const ide = require_(resolveSrc('ide-extension-detector.js'));
  ide._resetForTest();
  ide._setDepsForTest({
    listProcesses: async () => [],
    readdir: async () => [],
    homedir: () => '/nonexistent-home',
  });
  const wsl = require_(resolveSrc('wsl-detector.js'));
  wsl._resetForTest();
  // ENOENT is the one answer that is UNSUPPORTED on win32 (`wsl-not-installed`); every
  // other platform is UNSUPPORTED before the probe. Out of the worst-of everywhere.
  wsl._setDepsForTest({
    execFile: (cmd, args, options, cb) =>
      cb(Object.assign(new Error('spawn wsl.exe ENOENT'), { code: 'ENOENT' }), ''),
  });
  const llm = require_(resolveSrc('llm-runtime-detector.js'));
  llm._resetForTest();
  llm._setDepsForTest({ http: fakeHttp(opts.llm || {}) });

  // ── sessions, gap ──
  const sessionTracker = require_(resolveSrc('session-tracker.js'));
  sessionTracker._resetForTest();
  const gap = require_(resolveSrc('observation-gap.js'));
  gap._resetForTest();
  gap.init({ now: () => Date.now() });
  const powerMonitor = new EventEmitter();

  // ── the composer's deferred pass, then the scan-loop it now holds ──
  delete require_.cache[resolveSrc('scan-loop.js')];
  main._loadDeferredModulesForTest();
  const scanLoop = require_(resolveSrc('scan-loop.js'));

  const deps = {
    scanner,
    network,
    watcher,
    observationGap: gap,
    procUtil: {
      enrichWithParentChains: vi.fn(async (agents) => {
        for (const a of agents) a.instanceId = `${a.pid}:u`;
      }),
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
    // The REAL payload, so the `scan-batch` a renderer would receive carries the
    // composed app health and not a stub.
    getStats: () => main.getStats(),
    getResourceUsage: vi.fn().mockReturnValue({}),
    getLatestAgents: () => latest,
    setAgents: (agents) => {
      latest = agents;
    },
    setLatestNetConnections: vi.fn(),
  };
  scanLoop.init(deps);

  // Wired the way main.js wires the real one: the resume callback writes the
  // `observation-gap` audit record through the same `audit.log` spy the scan writes
  // `agent-enter` / `agent-exit` through.
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

  /** Drain the promise chains a scan leaves behind (no timer is scheduled by either). */
  async function flush(rounds = 8) {
    for (let i = 0; i < rounds; i++) await vi.advanceTimersByTimeAsync(0);
  }

  /** @param {number} ms */
  async function advance(ms) {
    await vi.advanceTimersByTimeAsync(ms);
    await flush();
  }

  /**
   * Arm the production startup schedule from now: process at +3 s, file at +8 s,
   * network at +12 s (`paused = true` keeps the warm-up intervals out). Any schedule a
   * previous call armed is dropped first, so each call is one bounded run.
   */
  function startup() {
    scanLoop.stopScanIntervals();
    scanLoop.staggeredStartup(5000, true);
  }

  /** Exactly one process tick, nothing else scheduled behind it fires. */
  async function tickProcess() {
    startup();
    await advance(3000);
  }

  /**
   * The whole startup run: process, file, network. A process tick whose pid set changed
   * also fires `doNetworkScan` at once (scan-loop.js), so the network leaf may already
   * be written before the 12 s one-shot.
   */
  async function runStartup() {
    startup();
    await advance(3000);
    await advance(5000);
    await advance(4000);
  }

  /** Exactly one network tick through the exported entry point. */
  async function tickNetwork() {
    scanLoop.doNetworkScan();
    await flush();
  }

  /** Sleep: suspend now, wake `ms` later. Keep it under 5 s inside a startup run. */
  async function sleep(ms) {
    powerMonitor.emit('suspend');
    await vi.advanceTimersByTimeAsync(ms);
    powerMonitor.emit('resume');
  }

  /**
   * Build the watch plan through the real `setupFileWatchers` and bring every root to
   * `ready`, so `fs-chokidar` is HEALTHY and the plan is HEALTHY. The invariant is
   * asserted here: a case that starts from a half-built plane would test the harness.
   */
  async function readyWatchPlane() {
    await watcher.setupFileWatchers();
    await flush();
    for (const w of watchers) w.emit('ready');
    expect(watchers.length, 'four watch roots registered').toBe(4);
    expect(watcher.getFileSensorHealth()['fs-chokidar'].state).toBe('HEALTHY');
    expect(watcher.getWatchPlan().state).toBe('HEALTHY');
  }

  /** @param {number} index @param {string} message */
  function errorWatchRoot(index, message) {
    watchers[index].emit('error', new Error(message));
  }

  /** @param {number} index @param {string} filePath — delivered as a `change`. */
  function deliverWatchEvent(index, filePath) {
    watchers[index].emit('change', filePath);
  }

  /** The plane ready, then the full startup run — the healthy baseline every case rests on. */
  async function bringUp() {
    await readyWatchPlane();
    await runStartup();
    return main.getAppHealth();
  }

  /**
   * Install a `proc-snapshot` leaf on BOTH readers — the scanner's identity view and the
   * composer's registration — as one record, and switch the platform to the birth-time
   * shape. Returns a setter so a case can move the leaf between states.
   * @param {'HEALTHY'|'DEGRADED'|'FAILED'} state
   * @param {string|null} [detail]
   * @returns {(state: string, detail?: string|null) => void}
   */
  function installSnapshotLeaf(state, detail = null) {
    let current = leafRecord('proc-snapshot', state, detail);
    const read = () => current;
    scanner._setPlatformForTest({ providesStartTime: true, getSnapshotHealth: read });
    fakePlatform.getSnapshotHealth = read;
    return (next, nextDetail = null) => {
      current = leafRecord('proc-snapshot', next, nextDetail);
    };
  }

  /** @returns {string[]} the `type` of every audit write, in call order */
  function auditTypes() {
    return deps.audit.log.mock.calls.map((c) => c[0]);
  }

  /** @returns {Array<object>} every `scan/session-freeze` debug payload */
  function freezeLogs() {
    return deps.logger.debug.mock.calls
      .filter((c) => c[0] === 'scan' && c[1] === 'session-freeze')
      .map((c) => c[2]);
  }

  /**
   * The three siblings on one payload: the gap and the pause ride BESIDE `appHealth`,
   * never inside it. Returns the payload for further assertions.
   * @returns {object}
   */
  function expectSiblings() {
    const stats = main.getStats();
    expect(stats).toHaveProperty('appHealth');
    expect(stats).toHaveProperty('observationGap');
    expect(typeof stats.monitoringPaused).toBe('boolean');
    expect(stats.appHealth).not.toHaveProperty('observationGap');
    expect(stats.appHealth).not.toHaveProperty('monitoringPaused');
    return stats;
  }

  async function tearDown() {
    scanLoop.stopScanIntervals();
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
    isolateResourceMonitor();
    sessionTracker._resetForTest();
    gap._resetForTest();
    ide._resetForTest();
    wsl._resetForTest();
    llm._resetForTest();
    watcher._resetForTest();
    network._resetForTest();
    scanner._resetForTest();
    delete fakePlatform.getSnapshotHealth;
  }

  return {
    t0,
    main,
    scanner,
    network,
    watcher,
    sessionTracker,
    gap,
    scanLoop,
    deps,
    fsState,
    watchers,
    listProcesses,
    getRawTcpConnections,
    getFileHandles,
    latest: () => latest,
    health: () => main.getAppHealth(),
    stats: () => main.getStats(),
    flush,
    advance,
    startup,
    tickProcess,
    runStartup,
    tickNetwork,
    sleep,
    readyWatchPlane,
    errorWatchRoot,
    deliverWatchEvent,
    bringUp,
    installSnapshotLeaf,
    auditTypes,
    freezeLogs,
    expectSiblings,
    tearDown,
  };
}

/** A path under the tmp dir that no ignore rule drops, for delivered watch events. */
export function samplePath(name) {
  return path.join(os.tmpdir(), 'aegis-b8', 'src', name);
}
