/**
 * @file bench/trace/wiring.js
 * @module bench/trace/wiring
 * @description Builds the product's module graph for a replay, out of seams the
 *   product already exports, and tears it down again.
 *
 *   NOTHING IN `src/` IS PATCHED. Every entry point used here is one the product
 *   publishes — `init(state)`, `_setDepsForTest`, `_resetForTest`, `reloadRules(dir)`,
 *   `_setSettingsPathForTest`, `_setBaselinesPathForTest`, `audit.init/shutdown`. The
 *   watcher even says so about the entry point that matters most: the comment above
 *   `bindWatcherEvents` in `src/main/file-watcher.js` notes that `handleWatcherEvent`
 *   "is exported and called directly with no root context by the attribution/ignore
 *   suites". Calling it from outside is a declared contract, not a bypass.
 *
 *   THE PROVIDERS ARE THE TRACE. Every fact a sensor would have gone to the OS for —
 *   the handle list, the Restart Manager holders, the TCP table, the DNS answers,
 *   whether the process population may be trusted — is served from the record being
 *   replayed. That is what makes a replay a function of the file rather than of the
 *   machine.
 *
 *   ONE PROCESS, ONE REPLAY, ONE PASS. `watcherDebounce`, `eventDedupMap`, `dnsCache`
 *   and `activeSessions` are module-level state, and not all of them have an external
 *   reset. A second replay in the same process would inherit the first one's memory,
 *   so {@link setUp} refuses one instead of producing a verdict that silently depends
 *   on what ran before it.
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.12.0
 */

'use strict';

const fs = require('fs');
const path = require('path');

const clockModule = require('./clock');
const schema = require('./schema');

/** @type {boolean} Whether a replay has already been wired in this process. */
let _wired = false;

/** @internal Reset the one-replay-per-process latch. Tests only. */
function _resetWiredForTest() {
  _wired = false;
}

/**
 * The product modules a replay drives, loaded once.
 *
 * Required lazily inside {@link setUp} rather than at file scope so that requiring
 * THIS module does not pull half the product into a process that only wanted to read
 * the orchestration declaration.
 * @returns {Object}
 */
function loadProductModules() {
  return {
    audit: require('../../src/main/audit-logger'),
    baselines: require('../../src/main/baselines'),
    config: require('../../src/main/config-manager'),
    fileWatcher: require('../../src/main/file-watcher'),
    networkMonitor: require('../../src/main/network-monitor'),
    ruleLoader: require('../../src/main/rule-loader'),
    scanLoop: require('../../src/main/scan-loop'),
  };
}

/**
 * A logger that answers every level and records nothing.
 *
 * The product's own logger writes `performance.now()` deltas, which can never compare
 * byte for byte; the operational log is deliberately outside the verdict. Refusing to
 * supply one at all is not an option — `scan-loop.js` calls `logger.debug` on paths a
 * replay takes.
 * @returns {Object}
 */
function silentLogger() {
  const noop = () => {};
  return { debug: noop, info: noop, warn: noop, error: noop };
}

/**
 * A tray that answers and does nothing. `doNetworkScan` and the file pipeline both
 * reach for one, and a replay has no UI to notify.
 * @returns {Object}
 */
function silentTray() {
  return { updateTrayIcon: () => {}, notifySensitive: () => {} };
}

/**
 * A batcher that swallows. The renderer is not part of a verdict — what reaches the
 * UI leaves no bytes on disk — and the audit write happens on its own line.
 * @returns {Object}
 */
function silentBatcher() {
  return { push: () => {}, flush: () => {} };
}

/**
 * Mutable ambient state, served to the product through the seams that read it.
 *
 * These are the two facts that change DURING a trace and decide what a sensor may
 * do: whether the agent population may be used as an observation scope, and whether
 * the "other agents" panel is open (which decides whether a handle scan covers every
 * agent or only the AI ones). Both are read through functions, because that is how
 * the product reads them.
 */
class Ambient {
  constructor() {
    /** @type {boolean} */
    this.populationReliable = true;
    /** @type {boolean} */
    this.isOtherPanelExpanded = false;
    /** @type {Object[]} */
    this.agents = [];
  }

  /** @returns {Object[]} Every agent this tick. */
  all() {
    return this.agents;
  }

  /** @returns {Object[]} The AI-category agents — what the watcher resolves owners from. */
  ai() {
    return this.agents.filter((a) => a.category === 'ai');
  }

  /**
   * The ProcessCapabilities struct the file watcher and the scan loop both gate on.
   * @returns {{populationState: string, populationReliable: boolean,
   *   populationAsOf: number|null, identityQuality: string}}
   */
  capabilities() {
    return {
      populationState: this.populationReliable ? 'HEALTHY' : 'FAILED',
      populationReliable: this.populationReliable,
      populationAsOf: null,
      identityQuality: 'unknown',
    };
  }
}

/**
 * Providers whose answers come from the record currently being replayed.
 *
 * Each starts as "this trace never said" and is REFUSED rather than defaulted: a
 * provider that answered `[]` because no record had set it would look exactly like a
 * provider that observed nothing, and the verdict would silently describe an absence
 * the recording never had.
 */
class Providers {
  constructor() {
    /** @type {Object<string, string[]>|null} */
    this.handlesByPid = null;
    /** @type {Object[]|null} */
    this.rmHolders = null;
    /** @type {Object[]|null} */
    this.tcp = null;
    /** @type {Object<string, {reverse: string[]|null, forward: string[]|null}>|null} */
    this.dns = null;
  }

  /**
   * @param {string} what - The provider's name, for the message.
   * @param {*} value - Whatever was set.
   * @returns {*} The value, once it is known to be one.
   */
  static require(what, value) {
    if (value === null) {
      schema.refuse(
        schema.REFUSAL.RECORD_MALFORMED,
        `the ${what} provider was called with nothing recorded for it — a replay serves every ` +
          'provider from the record being replayed, and answering "nothing" here would be an ' +
          'observation this trace never made',
      );
    }
    return value;
  }
}

/**
 * Wire the product's module graph, whatever the posture — replay or recording.
 *
 * The two postures differ ONLY in where the file and network providers point:
 * a replay serves them from the trace ({@link setUp}), a recording serves the real
 * ones wrapped record-and-pass-through (`./recorder.js`). Everything else — the
 * settings path, the rules reload, the baselines path, the audit profile, the
 * resets, the `state` object and the scan-loop wiring — must be the SAME lines,
 * or the two postures would drive two subtly different products and the
 * round-trip claim (a recording replays to its own verdicts) would compare
 * nothing.
 * @param {Object} opts
 * @param {string} opts.runDir - Directory this graph writes into. Created here.
 * @param {Object} [opts.settings] - Settings the sensors run under.
 * @param {string} [opts.rulesDir] - Rules to load. Defaults to this checkout's.
 * @param {Object} opts.fileWatcherDeps - `{getFileHandles, getHotSensitiveHolders}`.
 * @param {Object} opts.networkMonitorDeps - `{getRawTcpConnections, dnsReverse, dnsResolve}`.
 * @returns {Object} The wired graph: modules, ambient, and paths.
 * @throws {import('./schema').TraceError} When a graph was already wired in this process.
 */
function wireGraph(opts) {
  if (_wired) {
    schema.refuse(
      schema.REFUSAL.RECORD_MALFORMED,
      'the product has already been wired in this process. `watcherDebounce`, `eventDedupMap`, ' +
        '`dnsCache` and `activeSessions` are module state and not all of them have an external ' +
        'reset, so a second pass would inherit the first one’s memory. Run one trace — replay ' +
        'or recording — per process',
    );
  }

  const profileDir = path.join(opts.runDir, 'profile');
  fs.mkdirSync(profileDir, { recursive: true });

  const modules = loadProductModules();
  const ambient = new Ambient();

  // Settings the sensors run under come from the caller, written where the product
  // reads them. Never the developer's own settings file: `scanIntervalSec`, the
  // ignore lists and the custom patterns all change what a sensor does.
  modules.config._setSettingsPathForTest(path.join(opts.runDir, 'settings.json'));
  modules.config.saveSettings(opts.settings || {});

  // Rules from this checkout (whose digest the header pins). `reloadRules` is the
  // product's own public reload, not a cache poke.
  modules.ruleLoader.reloadRules(opts.rulesDir || path.join(schema.REPO_ROOT, 'rules'));

  modules.baselines._setBaselinesPathForTest(path.join(opts.runDir, 'baselines.json'));
  modules.audit.init({ userDataPath: profileDir });

  modules.fileWatcher._resetForTest();
  modules.networkMonitor._resetForTest();

  modules.fileWatcher._setDepsForTest({
    getFileHandles: opts.fileWatcherDeps.getFileHandles,
    getHotSensitiveHolders: opts.fileWatcherDeps.getHotSensitiveHolders,
    getProcessCapabilities: () => ambient.capabilities(),
    // win32 probes the platform for this; both postures answer `true` instead, so
    // the pool path is reached on every platform — and, just as load-bearing, a
    // recording and its replay take the SAME branch.
    isReadDetectionAvailable: true,
  });

  modules.networkMonitor._setDepsForTest(opts.networkMonitorDeps);

  const state = {
    getCustomRules: modules.config.getCustomSensitiveRules,
    getLatestAgents: () => ambient.all(),
    getLatestAiAgents: () => ambient.ai(),
    isMonitoringPaused: () => false,
    activityLog: [],
    knownHandles: new Map(),
    watchers: [],
    recordFileAccess: modules.baselines.recordFileAccess,
    onActivityPush: () => {},
    onActivityEvict: () => {},
    // Left unset on purpose. `main.js` wires the dedup → audit pipeline here, and the
    // harness reproduces those lines explicitly so they are visible and can be held
    // against the original. See `./harness.js` `ORCHESTRATION`.
    onFileEvent: null,
    isOtherPanelExpanded: () => ambient.isOtherPanelExpanded,
  };
  modules.fileWatcher.init(state);

  modules.scanLoop.init({
    scanner: { getProcessCapabilities: () => ambient.capabilities() },
    network: modules.networkMonitor,
    baselines: modules.baselines,
    audit: modules.audit,
    logger: silentLogger(),
    tray: silentTray(),
    fileAccessBatcher: silentBatcher(),
    statsUpdateBatcher: silentBatcher(),
    getStats: () => ({}),
    getLatestAgents: () => ambient.all(),
    setLatestNetConnections: () => {},
    sendToRenderer: () => {},
  });

  _wired = true;
  return { ambient, modules, profileDir, state };
}

/**
 * Wire the product for one replay.
 *
 * @param {Object} opts
 * @param {Object} opts.header - A validated trace header.
 * @param {string} opts.runDir - Directory this replay writes into. Created here.
 * @param {string} [opts.rulesDir] - Rules to load. Defaults to this checkout's.
 * @returns {Object} The wired graph: modules, ambient, providers, and paths.
 * @throws {import('./schema').TraceError} When the clock is absent, the clock does not
 *   read the trace's own epoch, or a second replay is attempted in one process.
 */
function setUp(opts) {
  if (_wired) {
    schema.refuse(
      schema.REFUSAL.RECORD_MALFORMED,
      'a replay has already run in this process. `watcherDebounce`, `eventDedupMap`, `dnsCache` ' +
        'and `activeSessions` are module state and not all of them have an external reset, so a ' +
        'second pass would inherit the first one’s memory. Run one trace per process',
    );
  }

  // BEFORE anything else, and this order is the point. A preload that did not run
  // looks exactly like one that worked — right up until the verdict cannot be
  // reproduced — so the clock is proved present AND proved to be reading this
  // trace's own epoch, not merely present and reading something.
  if (!clockModule.isInstalled()) {
    schema.refuse(
      schema.REFUSAL.RECORD_MALFORMED,
      'no virtual clock is installed. Run the entrypoint with ' +
        '`node --require bench/trace/preload.js` — a replay on the wall clock produces a verdict ' +
        'nobody can reproduce, and it looks exactly like one that can',
    );
  }
  const seeded = clockModule.installedEpochMs();
  if (seeded !== opts.header.clock.epochMs) {
    schema.refuse(
      schema.REFUSAL.RECORD_MALFORMED,
      `the installed clock was seeded at ${seeded} and this trace starts at ` +
        `${opts.header.clock.epochMs} — the preload ran, but against a different trace`,
    );
  }
  if (Date.now() !== opts.header.clock.epochMs) {
    schema.refuse(
      schema.REFUSAL.RECORD_MALFORMED,
      `Date.now() reads ${Date.now()} where this trace starts at ${opts.header.clock.epochMs} — ` +
        'the clock is installed but something has already moved it',
    );
  }

  const providers = new Providers();

  const wired = wireGraph({
    runDir: opts.runDir,
    settings: opts.header.settings || {},
    rulesDir: opts.rulesDir,
    fileWatcherDeps: {
      getFileHandles: (pid) =>
        Promise.resolve(
          Providers.require('file handle', providers.handlesByPid)[String(pid)] || [],
        ),
      getHotSensitiveHolders: () =>
        Promise.resolve(Providers.require('Restart Manager holder', providers.rmHolders)),
    },
    networkMonitorDeps: {
      getRawTcpConnections: () => Promise.resolve(Providers.require('TCP table', providers.tcp)),
      dnsReverse: (ip) => {
        const answer = Providers.require('DNS', providers.dns)[ip];
        // A recorded `null` means the lookup THREW, and the product distinguishes that
        // from an empty answer. Replaying it as `[]` would turn "we never learned" into
        // "the resolver said nothing", which is a different observation.
        if (!answer || answer.reverse === null)
          return Promise.reject(new Error('recorded-failure'));
        return Promise.resolve(answer.reverse);
      },
      dnsResolve: (hostname) => {
        const dns = Providers.require('DNS', providers.dns);
        for (const answer of Object.values(dns)) {
          if (answer.reverse && answer.reverse.includes(hostname)) {
            if (answer.forward === null) return Promise.reject(new Error('recorded-failure'));
            return Promise.resolve(answer.forward);
          }
        }
        return Promise.reject(new Error('recorded-failure'));
      },
    },
  });

  return { ...wired, providers };
}

/**
 * Stop the product cleanly and return where its records landed.
 *
 * `audit.shutdown()` is the product's own stop: it clears the flush interval — the
 * only live timer a replay leaves running — and flushes what is still buffered. A
 * replay that skipped it would produce a verdict missing its last records and a
 * process that never exits.
 * @param {Object} wired - What {@link setUp} returned.
 * @returns {{auditDir: string, auditFiles: string[]}}
 */
function tearDown(wired) {
  wired.modules.audit.shutdown();
  const auditDir = path.join(wired.profileDir, 'audit-logs');
  /** @type {string[]} Empty when the product wrote nothing — an absence, not a failure. */
  let auditFiles;
  try {
    auditFiles = fs
      .readdirSync(auditDir)
      .filter((n) => /^aegis-audit-\d{4}-\d{2}-\d{2}\.json$/.test(n))
      .sort();
  } catch (_) {
    auditFiles = [];
  }
  return { auditDir, auditFiles };
}

module.exports = {
  Ambient,
  Providers,
  _resetWiredForTest,
  loadProductModules,
  setUp,
  silentBatcher,
  silentLogger,
  silentTray,
  tearDown,
  wireGraph,
};
