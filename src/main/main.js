/**
 * @file main.js
 * @description Electron main-process orchestrator. Wires sub-modules, manages
 *   app lifecycle. Scan intervals delegated to scan-loop.js.
 * @since v0.1.0
 */
'use strict';

// ═══ CLI MODE (before Electron imports) ═══
const _cliFlags = new Set(['--scan-json', '--version', '--help']);
if (process.argv.slice(2).some((a) => _cliFlags.has(a))) {
  require('./cli')
    .handleCLI()
    .then((code) => process.exit(code ?? 0));
  return; // CJS module-scope return — stops rest of file from executing
}

const { app, BrowserWindow, globalShortcut, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// ═══ HW ACCELERATION (must run before app.whenReady) ═══
try {
  const settingsFile = path.join(app.getPath('userData'), 'settings.json');
  if (fs.existsSync(settingsFile)) {
    const raw = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    if (raw.hardwareAcceleration === false) {
      app.disableHardwareAcceleration();
    }
  }
} catch (_) {
  // Settings unreadable — keep HW accel enabled (default)
}

app.name = 'Aegis';
if (process.platform === 'darwin') {
  app.setName('Aegis');
  app.dock.setIcon(path.join(__dirname, '..', '..', 'assets', 'icon.png'));
}
// ═══ CRITICAL (needed before ready-to-show) ═══
const config = require('./config-manager');
const logger = require('./logger');
const tray = require('./tray-icon');
const ipc = require('./ipc-handlers');
const { createBatcher } = require('./ipc-batcher');
// Pure domain modules — no I/O, no Electron, no timers — so they cost nothing to load
// on the fast path to a visible window. `file-access-batching` must be here rather than
// deferred: the file-access batcher is built at module scope below, long before
// loadDeferredModules runs.
const appHealth = require('./app-health');
const { FILE_ACCESS_BATCHER_OPTIONS } = require('./file-access-batching');

// ═══ DEFERRED (loaded after ready-to-show via loadDeferredModules) ═══
// `network` is here rather than local to initDeferredSubsystems because getAppHealth()
// reads its sensor leaf: a module the composer must ask cannot be a local const. The
// three secondary detectors are here for the same one reason and no other — scan-loop
// still requires them itself, and this file never calls their detection functions.
let baselines,
  anomaly,
  scanner,
  procUtil,
  watcher,
  exporter,
  audit,
  scanLoop,
  sequenceEngine,
  network,
  platform,
  ideDetector,
  wslDetector,
  llmDetector;

let mainWindow = null;
let latestAgents = [],
  latestAiAgents = [],
  latestOtherAgents = [];
let isQuitting = false,
  monitoringPaused = false;
let oomIntervalId = null;
let latestNetConnections = [],
  otherPanelExpanded = false;
const fileWatchers = [];

// ═══ RUNNING COUNTERS for getStats() — O(1) instead of O(n) ═══
let totalSensitive = 0;
let aiSensitive = 0;
// ── Attribution counters (blindness metric) ──
// How many events in the CURRENT activity log we could attach to an agent by PID
// (confirmed), only by path heuristic (inferred), or not at all (unattributed).
// attrUnattributedSensitive is the honest blindness number: sensitive accesses we
// observed but could not blame on anyone.
let attrConfirmed = 0;
let attrInferred = 0;
let attrUnattributed = 0;
let attrUnattributedSensitive = 0;

/**
 * Move the attribution counters by `delta` for one event. Called with +1 on push
 * and -1 on eviction so the counters always describe the current activity log.
 * Events without an `attribution` field (pre-v0.11.0 entries) move nothing.
 * @param {Object} ev - Activity log event.
 * @param {number} delta - +1 when added, -1 when evicted.
 */
function bumpAttribution(ev, delta) {
  const status = ev && ev.attribution && ev.attribution.status;
  if (status === 'confirmed') {
    attrConfirmed += delta;
  } else if (status === 'inferred') {
    attrInferred += delta;
  } else if (status === 'unattributed') {
    attrUnattributed += delta;
    if (ev.sensitive) attrUnattributedSensitive += delta;
  }
}

/** @param {Object} ev - Activity log event being added */
function onActivityPush(ev) {
  if (ev.sensitive) {
    totalSensitive++;
    if (ev.category === 'ai') aiSensitive++;
  }
  bumpAttribution(ev, 1);
}

/** @param {Object} ev - Activity log event being evicted */
function onActivityEvict(ev) {
  if (ev.sensitive) {
    totalSensitive--;
    if (ev.category === 'ai') aiSensitive--;
  }
  bumpAttribution(ev, -1);
}

/** Loads modules not needed until first scan cycle. Called after ready-to-show. */
function loadDeferredModules() {
  baselines = require('./baselines');
  anomaly = require('./anomaly-detector');
  scanner = require('./process-scanner');
  procUtil = require('./process-utils');
  watcher = require('./file-watcher');
  exporter = require('./exports');
  audit = require('./audit-logger');
  scanLoop = require('./scan-loop');
  sequenceEngine = require('./sequence-engine');
  network = require('./network-monitor');
  platform = require('./platform');
  ideDetector = require('./ide-extension-detector');
  wslDetector = require('./wsl-detector');
  llmDetector = require('./llm-runtime-detector');
}

/**
 * Compose the app-level health from the honest signals the sensor modules already
 * publish. READ-ONLY: not one `mark*` call happens here. A leaf record is written only
 * by the code that performed or refused the observation it names, and this is the
 * display composer, not an observer.
 *
 * Total by construction, which matters because `statsUpdateBatcher.pushLazy` resolves
 * `getStats` on the flush timer, where a throw would have nowhere to go. `bootPhase`
 * is false until `loadDeferredModules` has run, and on that branch `deriveAppHealth`
 * returns before it reads anything else — so the module reads below cannot happen
 * against an undefined module.
 *
 * `monitoringPaused` is deliberately NOT passed: operator control is a separate
 * dimension, and it travels beside this value in {@link getStats}, never inside it.
 * @returns {Object} the plain {@link module:main/app-health}.AppHealth payload.
 * @since v0.12.0
 */
function getAppHealth() {
  if (!scanner || !watcher) {
    const derived = appHealth.deriveAppHealth({ bootPhase: false });
    return {
      state: derived.state,
      reasons: derived.reasons,
      // Null, not a guessed 'STARTING': no leaf record exists yet, so there is no
      // population state to report. A reader must be able to tell "not yet observed"
      // from "observed and starting".
      populationState: null,
      populationReliable: false,
      populationAsOf: null,
      identityQuality: null,
      identityDegraded: false,
      sensors: { byId: {}, raw: null, effective: null, projections: [] },
      watchPlan: null,
    };
  }
  const capabilities = scanner.getProcessCapabilities();
  const watchPlan = watcher.getWatchPlan();
  const identityDegraded = scanner.isIdentityDegraded() === true;
  const fsHealth = watcher.getFileSensorHealth();
  const llmHealth = llmDetector.getLlmRuntimeSensorHealth();
  // Every leaf that owns a record, RAW. Order is stable so the payload does not
  // reshuffle between ticks for a reader diffing it.
  const records = [
    scanner.getProcessSensorHealth(),
    ...Object.keys(fsHealth)
      .sort()
      .map((id) => fsHealth[id]),
    network.getNetworkSensorHealth(),
    // Secondary agent discovery (B-S12): whether the SYNTHETIC half of the fleet —
    // extension-hosted, WSL-inner and local-runtime agents — was actually looked for.
    // Deliberately NOT folded into the `process` leaf: that leaf's state drives
    // `populationReliable`, the gate every pid-scoped sensor reads before observing,
    // and a failed WSL probe says nothing about whether the pid list can be trusted.
    ideDetector.getIdeExtensionSensorHealth(),
    wslDetector.getWslSensorHealth(),
    ...Object.keys(llmHealth)
      .sort()
      .map((id) => llmHealth[id]),
  ];
  // win32 only (gap F). linux and darwin own no snapshot leaf and must not contribute
  // a fabricated one — their `providesStartTime: false` already answers the question.
  if (typeof platform.getSnapshotHealth === 'function') {
    records.push(platform.getSnapshotHealth());
  }
  const derived = appHealth.deriveAppHealth({
    bootPhase: true,
    capabilities,
    identityDegraded,
    records,
    watchPlan,
  });
  // Field copying, never a second derivation: `state` and `reasons` are taken from the
  // pure module as they are. Re-deriving either here would be the two-sources-of-truth
  // this whole split exists to prevent.
  return {
    state: derived.state,
    reasons: derived.reasons,
    // The FULL capability contract, not just the boolean. `populationReliable` is true
    // iff `populationState === 'HEALTHY'`, so the boolean alone cannot tell a starting
    // scanner from a failed one — see app-health.js and ai-mistakes #29. The renderer
    // gates "population unknown" on `populationState`, never on `state === 'FAILED'`,
    // which also has the defensive zero-coverage route.
    populationState: capabilities.populationState,
    populationReliable: capabilities.populationReliable,
    populationAsOf: capabilities.populationAsOf,
    identityQuality: capabilities.identityQuality,
    identityDegraded,
    sensors: {
      // RAW records, untouched: an accepted birth-time fallback still reads DEGRADED
      // here and in `raw`, and only `effective` reflects the projection.
      byId: Object.fromEntries(records.map((r) => [r.sensorId, r])),
      raw: derived.raw,
      effective: derived.effective,
      projections: derived.projections,
    },
    watchPlan: {
      state: watchPlan.state,
      liveWatcherCount: watchPlan.liveWatcherCount,
      unavailableGroups: watchPlan.unavailableGroups,
    },
  };
}

/** @returns {Object} Process memory and CPU usage @since v0.1.0 */
function getResourceUsage() {
  const mem = process.memoryUsage(),
    cpu = process.cpuUsage();
  return {
    memMB: Math.round(mem.rss / 1024 / 1024),
    heapMB: Math.round(mem.heapUsed / 1024 / 1024),
    cpuUser: cpu.user,
    cpuSystem: cpu.system,
  };
}

/**
 * Per-channel IPC delivery accounting, for the DISPLAY lane only.
 *
 * A SIBLING of `appHealth`, never a field inside it, and the reason is the same
 * boundary the ipc-batcher module header draws: an eviction or a merge here is a frame
 * the renderer never painted. It is not a sensor `lossCount` — nothing went unobserved —
 * and it is not an audit drop — nothing went unrecorded. The activityLog ring and the
 * audit-logger JSONL account for their own loss on their own lane. Filing these counters
 * under app health would let a UI-throughput number read as an observation failure.
 *
 * Total by construction: the batcher exists from module load, so this answers with real
 * values on BOTH `getStats` branches — the scanner-absent branch is not a shaped stub.
 * @returns {{fileAccess: import('./ipc-batcher').BatcherStats}}
 * @since v0.13.0
 */
function getIpcStats() {
  return { fileAccess: fileAccessBatcher.getStats() };
}

/**
 * Monitoring statistics.
 *
 * `appHealth` and `monitoringPaused` are SIBLINGS and must stay that way: one answers
 * "what can we still observe", the other "did the operator stop us". Folding the pause
 * into the health enum would make a deliberate silence indistinguishable from a broken
 * sensor, which is the false-clean this whole model exists to kill. `ipc` is a third
 * sibling on the same principle — see {@link getIpcStats}.
 * @returns {Object} Monitoring statistics @since v0.1.0
 */
function getStats() {
  if (!scanner) {
    return {
      totalFiles: 0,
      totalSensitive: 0,
      aiSensitive: 0,
      uptimeMs: 0,
      monitoringStarted: Date.now(),
      peakAgents: 0,
      currentAgents: 0,
      aiAgentCount: 0,
      otherAgentCount: 0,
      uniqueAgents: [],
      permissionDeniedScans: 0,
      attribution: { confirmed: 0, inferred: 0, unattributed: 0, unattributedSensitive: 0 },
      appHealth: getAppHealth(),
      // Same expression as the loaded branch, not a zeroed lookalike: the batcher is a
      // module-scope const, so it has been counting since before this branch was
      // reachable and its numbers are real here too.
      ipc: getIpcStats(),
      monitoringPaused,
    };
  }
  const log = scanner.activityLog;
  return {
    totalFiles: log.length,
    totalSensitive,
    aiSensitive,
    uptimeMs: Date.now() - scanner.monitoringStarted,
    monitoringStarted: scanner.monitoringStarted,
    peakAgents: scanner.peakAgents,
    currentAgents: latestAgents.length,
    aiAgentCount: new Set(latestAiAgents.map((a) => a.agent)).size,
    otherAgentCount: new Set(latestOtherAgents.map((a) => a.agent)).size,
    uniqueAgents: Array.from(scanner.uniqueAgentNames),
    permissionDeniedScans: scanner.permissionDeniedScans,
    attribution: {
      confirmed: attrConfirmed,
      inferred: attrInferred,
      unattributed: attrUnattributed,
      unattributedSensitive: attrUnattributedSensitive,
    },
    appHealth: getAppHealth(),
    ipc: getIpcStats(),
    monitoringPaused,
  };
}

function sendToRenderer(channel, data) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  } catch (err) {
    logger.warn('main', 'sendToRenderer failed', { channel, error: err.message });
  }
}

// Options passed VERBATIM from file-access-batching.js — the flush window, the capacity
// bound and the coalesce key live there as one frozen object so a test can drive the
// production configuration itself rather than a re-assembled lookalike.
const fileAccessBatcher = createBatcher('file-access', sendToRenderer, FILE_ACCESS_BATCHER_OPTIONS);
const statsUpdateBatcher = createBatcher('stats-update', sendToRenderer, {
  intervalMs: 1000,
  mode: 'latest',
});

// ═══ WINDOW ═══

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Aegis',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    backgroundColor: '#050507',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      plugins: false,
    },
  });
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        ],
      },
    });
  });
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html'));
  }
  mainWindow.setMenuBarVisibility(false);

  // ═══ NAVIGATION LOCK — prevent renderer from leaving the app ═══
  const appOrigin = devServerUrl ? new URL(devServerUrl).origin : 'file://';
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(appOrigin)) {
      e.preventDefault();
      logger.warn('main', 'Blocked navigation attempt', { url });
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// ═══ SINGLE INSTANCE ═══

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ═══ LIFECYCLE ═══

/**
 * One-shot guard for {@link startWatchers}. The watcher set is created exactly
 * once per app run: whichever branch of {@link startWatchersWhenLoaded} wins the
 * load race, the other one is a no-op.
 * @type {boolean}
 */
let watchersStarted = false;

/**
 * Create the watcher set exactly once: the chokidar file watchers (credential
 * dirs, agent-config dirs, the app directory, `~/.env*`) plus the rules
 * hot-reload watcher.
 *
 * `setupFileWatchers` is async — it stats every candidate directory before
 * deciding what to watch — so the registered count is only meaningful after it
 * resolves, and a rejection is invisible unless it is awaited. The guard flips
 * BEFORE the await so a second call landing mid-setup cannot create a duplicate
 * set.
 * @returns {Promise<void>}
 * @since v0.11.0-alpha
 */
async function startWatchers() {
  if (watchersStarted) return;
  watchersStarted = true;
  try {
    await watcher.setupFileWatchers();
    watcher.setupRulesWatcher(sendToRenderer);
    // One entry per watch-root GROUP (credential dirs / agent-config dirs / app
    // dir / ~/.env*), so a group may cover several directories. This line is the
    // discriminator for a silently dead file feed: absent means startup never
    // reached here, zero means nothing at all is being observed.
    logger.info('main', 'File watchers created', { watchRoots: fileWatchers.length });
  } catch (err) {
    logger.error('main', 'File watcher setup failed', { error: err.message });
  }
}

/**
 * Start the watchers as soon as the renderer has finished loading, WITHOUT
 * depending on `did-finish-load` still being pending.
 *
 * The previous form registered `once('did-finish-load')` from inside the
 * deferred init, which itself runs off `ready-to-show` → `setImmediate`. For a
 * local `loadFile` the load completes first, so the listener was attached to an
 * event that had already fired and never ran — file monitoring was silently dead
 * from that point on. Reading `isLoading()` turns the race into an explicit
 * branch; {@link watchersStarted} keeps both branches to a single watcher set.
 * @param {Electron.WebContents} webContents - The main window's web contents.
 * @returns {void}
 * @since v0.11.0-alpha
 */
function startWatchersWhenLoaded(webContents) {
  if (webContents.isLoading()) {
    webContents.once('did-finish-load', () => startWatchers());
  } else {
    startWatchers();
  }
}

/**
 * The chokidar file-event handler `file-watcher.js` calls once per event that survived
 * its own filters: dedup, the display batch, the tray, the audit record — and tap 1 of
 * docs/roadmap/sequence-rules.md §5. Module-level rather than a closure inside
 * {@link initDeferredSubsystems} so the tap is reachable by a test with the two
 * collaborators injected (`_setScanLoopForTest`, `_setSequenceEngineForTest`).
 *
 * The record handed to the engine is the SAME object `logAuditForFile` received —
 * deduped, `repeatCount` stamped — and it is not pre-filtered on `instanceId`: the
 * engine's null policy skips and counts a keyless record itself (roadmap §4). `ingest`
 * carries its own error boundary (sequence-engine.js), so nothing here wraps it.
 * @param {Object} ev - the FileEvent as the watcher built it.
 * @returns {void}
 * @since v0.14.0
 */
function onFileEvent(ev) {
  const deduped = scanLoop.dedupFileEvent(ev);
  if (!deduped) return;
  fileAccessBatcher.push(deduped);
  // An unattributed hit carries category 'other' (no agent to take it from),
  // so the ai-only gate would silence exactly the crown-jewel case: a secret
  // touched with no known owner. A vague alert beats no alert.
  if (
    deduped.sensitive &&
    (deduped.category === 'ai' || deduped.attribution?.status === 'unattributed')
  ) {
    tray.notifySensitive([deduped]);
  }
  // Lazy on purpose: this fires per file event, and the batcher is 'latest' with a
  // 1000 ms window — every payload but the last is discarded. Passing the producer
  // builds exactly one, at flush.
  statsUpdateBatcher.pushLazy(getStats);
  tray.updateTrayIcon();
  scanLoop.logAuditForFile(deduped);
  // Tap 1 (roadmap §5): after the audit record, the same deduped object.
  sequenceEngine.ingest(deduped);
}

/** Wires deferred modules and starts scanning. Called after ready-to-show. */
function initDeferredSubsystems(userData) {
  loadDeferredModules();
  // One-time read-detection capability probe (win32 only — darwin/linux don't
  // define it, so optional chaining no-ops). Fire-and-forget: it sets the
  // platform's degraded flag before the first staggered file-scan tick.
  require('./platform').probeReadDetection?.();
  const network = require('./network-monitor');
  const analysis = require('./ai-analysis');
  const sequenceLoader = require('./sequence-rule-loader');

  // Sequence rules (docs/roadmap/sequence-rules.md §5): `rules/sequences/` is read ONCE
  // here and the engine takes the compiled rules. The loader has already written one
  // `sequence-loader` warn line per warning and per load error; this is the one-line
  // summary a reader of the log finds first, on the warn level only when there is
  // something to warn about.
  const sequences = sequenceLoader.loadDir();
  const sequenceSummary = {
    rules: sequences.rules.map((r) => r.id),
    warnings: sequences.warnings.length,
    loadErrors: sequences.loadErrors,
  };
  if (sequences.warnings.length > 0 || sequences.loadErrors > 0) {
    logger.warn('sequence-loader', 'Sequence rules loaded with notices', {
      ...sequenceSummary,
      reasons: sequences.warnings.map((w) => w.reason),
    });
  } else {
    logger.info('sequence-loader', 'Sequence rules loaded', sequenceSummary);
  }
  sequenceEngine.init({
    rules: sequences.rules,
    // Block 3 prompt 1: the detection is LOGGED and nothing else. The audit record
    // (`sequence-detection`), the score merge and the `sequences` stats block are the
    // next prompt (roadmap §5 "Emission").
    onDetection: (detection) =>
      logger.info('sequence-engine', `Sequence ${detection.ruleId} detected`, detection),
  });

  scanLoop.init({
    scanner,
    procUtil,
    watcher,
    network,
    baselines,
    anomaly,
    audit,
    tray,
    logger,
    sequenceEngine,
    sendToRenderer,
    fileAccessBatcher,
    statsUpdateBatcher,
    getStats,
    getResourceUsage,
    getLatestAgents: () => latestAgents,
    setAgents: (agents) => {
      latestAgents = agents;
      latestAiAgents = agents.filter((a) => a.category === 'ai');
      latestOtherAgents = agents.filter((a) => a.category === 'other');
    },
    setLatestNetConnections: (c) => {
      latestNetConnections = c;
    },
  });
  config.init({
    knownAgentNames: scanner.AI_AGENTS.map((a) => a.name),
    applyCallback: () => {
      scanLoop.stopScanIntervals();
      if (!monitoringPaused) {
        const ms = (config.getSettings().scanIntervalSec || 10) * 1000;
        scanLoop.startScanIntervals(ms);
      }
    },
  });
  scanner.init({ trackSeenAgent: config.trackSeenAgent });
  watcher.init({
    getCustomRules: config.getCustomSensitiveRules,
    getLatestAgents: () => latestAgents,
    getLatestAiAgents: () => latestAiAgents,
    isMonitoringPaused: () => monitoringPaused,
    activityLog: scanner.activityLog,
    knownHandles: scanner.knownHandles,
    watchers: fileWatchers,
    recordFileAccess: baselines.recordFileAccess,
    onActivityPush,
    onActivityEvict,
    onFileEvent,
    isOtherPanelExpanded: () => otherPanelExpanded,
  });
  exporter.init({
    activityLog: scanner.activityLog,
    getLatestNetConnections: () => latestNetConnections,
    monitoringStarted: scanner.monitoringStarted,
    getMainWindow: () => mainWindow,
    getStats,
  });
  analysis.init({
    getSettings: config.getSettings,
    activityLog: scanner.activityLog,
    getLatestAgents: () => latestAgents,
    getLatestNetConnections: () => latestNetConnections,
    getAnomalyScores: () => {
      const scores = {};
      // Same name-keyed roll-up as the scan batch (scan-loop.js): the score is computed
      // per instance, and this prompt section is written per agent NAME, so the
      // highest-risk instance stands for its name. Keyless agents score 0, as before.
      for (const a of latestAgents) {
        const score = a.instanceId ? anomaly.calculateAnomalyScore(a.instanceId).score : 0;
        scores[a.agent] = Math.max(scores[a.agent] || 0, score);
      }
      return scores;
    },
  });
  audit.init({
    userDataPath: userData,
    onFlushError: (err) => logger.error('audit-logger', 'Flush failed', { error: err.message }),
  });
  baselines.loadBaselines();
  startWatchersWhenLoaded(mainWindow.webContents);
  const ms = (config.getSettings().scanIntervalSec || 10) * 1000;
  scanLoop.staggeredStartup(ms, monitoringPaused);

  // ── OOM protection: trim old data when heap > 512 MB ──
  oomIntervalId = setInterval(() => {
    const heap = process.memoryUsage().heapUsed;
    if (heap > 512 * 1024 * 1024) {
      logger.warn('main', 'Memory threshold reached, trimming old data', {
        heapMB: Math.round(heap / 1024 / 1024),
      });
      const log = scanner.activityLog;
      if (log.length > 1000) {
        const removed = log.splice(0, log.length - 1000);
        for (const ev of removed) onActivityEvict(ev);
      }
    }
  }, 60_000);
}

app.whenReady().then(() => {
  if (!gotLock) return;

  // ── Critical startup: logger, config, window — fast path to visible UI ──
  const userData = app.getPath('userData');
  logger.init({ userDataPath: userData, isDev: !app.isPackaged });
  logger.info('main', 'App starting', { version: app.getVersion(), platform: process.platform });
  config.loadSettings();
  tray.init({
    tray: null,
    currentTrayColor: 'green',
    lastNotificationTime: 0,
    getActivityLog: () => (scanner ? scanner.activityLog : []),
    getSettings: config.getSettings,
    isMonitoringPaused: () => monitoringPaused,
    setMonitoringPaused: (v) => {
      monitoringPaused = v;
    },
    stopScanIntervals: () => {
      if (scanLoop) scanLoop.stopScanIntervals();
    },
    startScanIntervals: () => {
      if (scanLoop) {
        const ms = (config.getSettings().scanIntervalSec || 10) * 1000;
        scanLoop.startScanIntervals(ms);
      }
    },
    getMainWindow: () => mainWindow,
    setIsQuitting: (v) => {
      isQuitting = v;
    },
    appQuit: () => app.quit(),
    getAgentCount: () => latestAgents.length,
  });
  createWindow();
  ipc.init({
    getWindow: () => mainWindow,
    getStats,
    getResourceUsage,
    getLatestAgents: () => latestAgents,
    setOtherPanelExpanded: (v) => {
      otherPanelExpanded = v;
    },
  });
  ipc.register();
  const settings = config.getSettings();
  mainWindow.once('ready-to-show', () => {
    if (!settings.startMinimized) mainWindow.show();
    tray.createTray();
    // Load heavy modules AFTER window is visible
    setImmediate(() => initDeferredSubsystems(userData));
  });
  globalShortcut.register('CommandOrControl+Shift+T', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('toggle-theme');
    }
  });
});

app.on('before-quit', () => {
  if (oomIntervalId) {
    clearInterval(oomIntervalId);
    oomIntervalId = null;
  }
  globalShortcut.unregisterAll();
  logger.info('main', 'App quitting');
  if (audit) audit.shutdown();
  if (baselines) baselines.finalizeSession();
  logger.shutdown();
  isQuitting = true;
  if (tray._state && tray._state.tray) {
    tray._state.tray.destroy();
    tray._state.tray = null;
  }
});
app.on('window-all-closed', () => {});
app.on('quit', () => {
  fileAccessBatcher.destroy();
  statsUpdateBatcher.destroy();
  if (scanLoop) scanLoop.stopScanIntervals();
  fileWatchers.forEach((w) => w.close());
});

/** @internal Inject the file-watcher module, normally set by loadDeferredModules (for tests). */
function _setWatcherForTest(mod) {
  watcher = mod;
}

/**
 * @internal Inject the process-scanner module, normally set by loadDeferredModules
 * (for tests).
 *
 * `getStats` branches on `scanner` alone while {@link getAppHealth} branches on
 * `scanner || watcher`, so injecting a scanner and leaving `watcher` undefined reaches
 * the LOADED stats branch with app health still on its own booting path. That is what
 * makes both stats branches executable in a test instead of merely readable: a payload
 * contract proven by running the code, not by matching the source (ai-mistakes #21).
 * @param {Object|undefined} mod
 */
function _setScannerForTest(mod) {
  scanner = mod;
}

/**
 * @internal Inject the scan-loop module, normally set by loadDeferredModules (for tests).
 * {@link onFileEvent} reads its dedup and audit entry points off this reference.
 * @param {Object|undefined} mod
 */
function _setScanLoopForTest(mod) {
  scanLoop = mod;
}

/**
 * @internal Inject the sequence engine, normally set by loadDeferredModules (for tests).
 * A fake with `ingest` is enough to prove tap 1 hands over the deduped record.
 * @param {Object|undefined} mod
 */
function _setSequenceEngineForTest(mod) {
  sequenceEngine = mod;
}

/** @internal Clear the one-shot guard and the registered watcher list (for tests). */
function _resetWatchersForTest() {
  watchersStarted = false;
  fileWatchers.length = 0;
}

/** @internal The live array setupFileWatchers appends to — what startWatchers counts (for tests). */
function _getWatchersForTest() {
  return fileWatchers;
}

// Exported for the startup-ordering and stats-shape regression tests only — nothing in
// the app requires main.js. Electron runs it as the entry point.
module.exports = {
  startWatchers,
  startWatchersWhenLoaded,
  // The watcher's per-event handler, exposed so the sequence-engine tap inside it can
  // be driven with a real dedup and a fake engine (tests/main/main-file-event-tap.test.js).
  onFileEvent,
  // Read-only. Exposed so a test can assert the payload SHAPE — that `appHealth`,
  // `ipc` and `monitoringPaused` are siblings, and that the pre-`loadDeferredModules`
  // branch answers BOOTING instead of throwing.
  getStats,
  getAppHealth,
  _setWatcherForTest,
  _setScannerForTest,
  _setScanLoopForTest,
  _setSequenceEngineForTest,
  _resetWatchersForTest,
  _getWatchersForTest,
};
