/**
 * @file file-watcher.js
 * @module main/file-watcher
 * @description Real-time chokidar file watchers, handle-based scanning via
 *   PowerShell, sensitive-file classification, and system-noise filtering.
 * @requires fs
 * @requires path
 * @requires os
 * @requires chokidar
 * @requires child_process
 * @requires ../shared/constants
 * @requires ./rule-loader
 * @requires ./watch-root-registry
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.3.0-alpha
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const chokidar = require('chokidar');
const {
  IGNORE_PATTERNS,
  AGENT_CONFIG_PATHS,
  SENSITIVE_AGENT_DIRS,
  AGENT_SELF_CONFIG,
} = require('../shared/constants');
const { getAllRules, reloadRules } = require('./rule-loader');
const { EVIDENCE, makeAttribution } = require('./attribution');
const { readInstanceId } = require('./process-identity');
const sensorHealth = require('./sensor-health');
// Watch-root registry (design §1) — the plan, its per-root state transitions, and the
// W derived from it. Pure state: this module keeps ownership of the `fs-chokidar`
// health record and is the only place a sensorHealth.mark* call may happen.
const {
  WATCH_GROUP,
  WATCH_ROOT_STATE,
  resetWatchPlan,
  buildWatchPlan,
  hasPlannedRoot,
  markRootRegistered,
  markRootRegistrationFailed,
  markUnreachedRootsNotAttempted,
  markRootReady,
  markRootErrored,
  noteRootDelivery,
  deriveWatchPlaneState,
  unavailableRootSummary,
  getWatchPlan,
} = require('./watch-root-registry');
const _platform = require('./platform');
const { IGNORE_FILE_PATTERNS } = _platform;

/** Stable filesystem sensor IDs (B2). Generic string ids — not a frozen registry. */
const FS_SENSOR = Object.freeze({
  CHOKIDAR: 'fs-chokidar',
  HANDLE: 'fs-handle',
  RM: 'fs-rm',
});

/** Reason recorded by every surface that refuses to observe an untrusted population. */
const SCOPE_UNAVAILABLE_REASON = 'process-observation-unavailable';

/**
 * Reader for the ProcessCapabilities contract (design §3), resolved lazily.
 *
 * Required directly rather than injected through `_state`: that object is built in
 * main.js and does not carry the contract, and §3 is explicit that a dependant must
 * consume the capability struct — never a plane roll-up — to decide whether an
 * agent-scoped observation may run. process-scanner requires nothing from here, so
 * there is no cycle.
 * @type {(() => {populationReliable: boolean}) | null}
 */
let _getProcessCapabilities = null;

/**
 * Whether the agent population may be used as an observation scope right now.
 * @returns {boolean}
 */
function populationReliable() {
  if (!_getProcessCapabilities) {
    _getProcessCapabilities = require('./process-scanner').getProcessCapabilities;
  }
  return _getProcessCapabilities().populationReliable === true;
}

/**
 * Default directories to ignore in file watchers.
 * @type {string[]}
 */
const DEFAULT_IGNORED_DIRS = [
  '.git',
  'node_modules',
  '__pycache__',
  '.svn',
  '.hg',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.cache',
  '.tmp',
  '.venv',
  '.vite',
  '.svelte-kit',
  '.turbo',
];

/**
 * Max concurrent per-PID handle scans in scanAllFileHandles. Each scan spawns
 * one powershell.exe + handle.exe (~500ms cold) on win32 — an uncapped fan-out
 * over ~12 agents would saturate CPU and spike resources. Fixed at 5 (the
 * bottleneck is per-PID I/O, not core count) so the cap stays deterministic.
 * @type {number}
 */
const FILE_SCAN_CONCURRENCY = 5;

let _getFileHandles = _platform.getFileHandles;
// win32 exposes these (Restart Manager); darwin/linux do not → undefined, so the
// RM branch is skipped and the legacy getFileHandles pool path runs unchanged.
let _getSensitiveHolders = _platform.getSensitiveHolders;
// Fast hot-cycle holder source (HOT_DIRS only); win32 only, undefined elsewhere.
let _getHotSensitiveHolders = _platform.getHotSensitiveHolders;
const _isRmAvailable = _platform.isRestartManagerAvailable;
// Cost guard: ensure only ONE RM powershell spawn is in flight at a time across
// the full (30s) and hot (~10s) cycles. NOT a correctness guard — the shared
// knownHandles dedup already prevents double-emit (JS is single-threaded); this
// only avoids a redundant concurrent spawn when both ticks coincide.
let _rmScanInFlight = false;
/** Optional test override for platform read-detection capability. */
let _isReadDetectionAvailableOverride = undefined;

/**
 * Authoritative filesystem sensor-health records (B2). Lifetime = module process /
 * until explicit reinit (setupFileWatchers for chokidar; _resetFsHealth for tests).
 * @type {Record<string, import('./sensor-health').SensorHealth>}
 */
let _fsHealth = createInitialFsHealth();

/**
 * @returns {Record<string, object>}
 */
function createInitialFsHealth() {
  const now = Date.now();
  // Platform permanently without RM (darwin/linux) → UNSUPPORTED. Test overrides
  // inject getSensitiveHolders later and re-create STARTING via _setDepsForTest.
  const platformHasRm = typeof _platform.getSensitiveHolders === 'function';
  const rm = platformHasRm
    ? sensorHealth.createSensorHealth(FS_SENSOR.RM)
    : sensorHealth.createUnsupported(FS_SENSOR.RM, {
        detail: 'platform-no-rm',
        now,
      });
  return {
    [FS_SENSOR.CHOKIDAR]: sensorHealth.createSensorHealth(FS_SENSOR.CHOKIDAR),
    [FS_SENSOR.HANDLE]: sensorHealth.createSensorHealth(FS_SENSOR.HANDLE),
    [FS_SENSOR.RM]: rm,
  };
}

/**
 * Reset FS health records (tests / intentional reinit). Does not clear residual
 * production loss mid-lifetime except by creating new records.
 *
 * Drops the watch plan with them: the plan is what writes the chokidar record, so a
 * plan that outlived its record would recompute W from roots the new record never
 * saw registered.
 * @returns {void}
 */
function _resetFsHealth() {
  _fsHealth = createInitialFsHealth();
  resetWatchPlan();
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function healthErrorMessage(err) {
  if (err == null) return 'unknown-error';
  if (typeof err === 'string') return err.slice(0, 200);
  const msg = err && err.message != null ? String(err.message) : String(err);
  return msg.slice(0, 200);
}

/**
 * @returns {boolean}
 */
function handleCapabilityOk() {
  if (typeof _isReadDetectionAvailableOverride === 'boolean') {
    return _isReadDetectionAvailableOverride;
  }
  if (typeof _platform.isReadDetectionAvailable === 'function') {
    return _platform.isReadDetectionAvailable();
  }
  // darwin/linux: lsof//proc always available — no probe.
  return true;
}

/**
 * Plain serializable snapshots for future B6 — callers must not mutate.
 * @returns {Record<string, object>}
 * @since 0.11.0
 */
function getFileSensorHealth() {
  /** @type {Record<string, object>} */
  const out = {};
  for (const id of Object.values(FS_SENSOR)) {
    out[id] = sensorHealth.toPlain(_fsHealth[id]);
  }
  return out;
}

/**
 * Orchestration-only skip: the read mechanisms were NOT run this tick because the
 * agent population could not be trusted as an observation scope (design §2.4).
 *
 * Marks the ACTIVE read mechanism — RM when the RM path owns observation, the handle
 * pool otherwise — because that is the sensor whose observation was actually lost.
 * DEGRADED, never FAILED: no provider failed. Never HEALTHY: no read happened, so
 * there is no scoped success to claim, and `lastSuccessAt` must not advance.
 *
 * The scoped-HEALTHY `confirmed-zero-in-scope` case is the effective-read-scope step
 * and is deliberately NOT implemented here — it needs the mechanism's own filtered
 * list, which this function never sees.
 * @param {'process-observation-unavailable'|string} reason
 * @returns {void}
 * @since 0.12.0
 */
function noteFileScanSkip(reason) {
  const now = Date.now();
  const id = rmEnabled() ? FS_SENSOR.RM : FS_SENSOR.HANDLE;
  const rec = _fsHealth[id];
  // markDegraded throws from both states, and RM is UNSUPPORTED on every platform
  // that has no Restart Manager — a skip must not turn that into an error.
  if (
    rec.state === sensorHealth.SENSOR_HEALTH_STATE.UNSUPPORTED ||
    rec.state === sensorHealth.SENSOR_HEALTH_STATE.DISABLED
  ) {
    return;
  }
  const scoped = reason === SCOPE_UNAVAILABLE_REASON;
  _fsHealth[id] = sensorHealth.markDegraded(rec, now, {
    error: scoped ? SCOPE_UNAVAILABLE_REASON : healthErrorMessage(reason),
    detail: scoped ? SCOPE_UNAVAILABLE_REASON : 'file-scan-skip',
  });
}

/** @internal Override dependencies (for tests). */
function _setDepsForTest(overrides) {
  if (overrides.getFileHandles) _getFileHandles = overrides.getFileHandles;
  if (overrides.getSensitiveHolders) {
    _getSensitiveHolders = overrides.getSensitiveHolders;
    // Tests inject RM on platforms where it is UNSUPPORTED by default.
    if (
      _fsHealth[FS_SENSOR.RM] &&
      _fsHealth[FS_SENSOR.RM].state === sensorHealth.SENSOR_HEALTH_STATE.UNSUPPORTED
    ) {
      _fsHealth[FS_SENSOR.RM] = sensorHealth.createSensorHealth(FS_SENSOR.RM);
    }
  }
  if (overrides.getHotSensitiveHolders) _getHotSensitiveHolders = overrides.getHotSensitiveHolders;
  if (overrides.getProcessCapabilities) _getProcessCapabilities = overrides.getProcessCapabilities;
  if (Object.prototype.hasOwnProperty.call(overrides, 'isReadDetectionAvailable')) {
    _isReadDetectionAvailableOverride = overrides.isReadDetectionAvailable;
  }
}
/** @internal Reset debounce state + opt out of the RM path (for tests). */
function _resetForTest() {
  watcherDebounce.clear();
  _getSensitiveHolders = undefined; // tests opt into RM explicitly via _setDepsForTest
  _getHotSensitiveHolders = undefined;
  _rmScanInFlight = false;
  _isReadDetectionAvailableOverride = undefined;
  // Same contract as the RM dep above: a test opts INTO the population gate via
  // _setDepsForTest. The real process-scanner sits at STARTING until something drives
  // a scan, which is honestly "cannot vouch" — but a test asserting attribution logic
  // is not asserting population health, and making every one of them drive a process
  // scan first would couple two unrelated sensors. Production never calls this.
  _getProcessCapabilities = () => ({
    populationState: 'HEALTHY',
    populationReliable: true,
    populationAsOf: null,
    identityQuality: 'unknown',
  });
  _resetFsHealth();
}

const watcherDebounce = new Map();
let _state = null;

/**
 * @param {Object} state - shared state refs (getCustomRules, getLatestAgents, getLatestAiAgents, isMonitoringPaused, activityLog, knownHandles, watchers, recordFileAccess, onFileEvent, isOtherPanelExpanded)
 * @returns {void} @since v0.1.0
 */
function init(state) {
  _state = state;
}

/**
 * @param {string} filePath
 * @returns {string|null} reason or null
 * @since v0.1.0
 */
function classifySensitive(filePath) {
  for (const rule of getAllRules().values()) {
    if (rule.enabled !== false && rule.pattern.test(filePath)) return rule.reason;
  }
  if (_state) {
    for (const rule of _state.getCustomRules()) {
      if (rule.pattern.test(filePath)) return rule.reason;
    }
  }
  return null;
}

/** @param {string} filePath @returns {boolean} @since v0.1.0 */
function shouldIgnore(filePath) {
  return (
    IGNORE_PATTERNS.some((p) => p.test(filePath)) ||
    IGNORE_FILE_PATTERNS.some((p) => p.test(filePath))
  );
}

/**
 * Check if a file access is an agent accessing its OWN config directory (expected, not a threat).
 * @param {string} agentName - Agent display name (e.g. "Claude Code").
 * @param {string} filePath - File path being accessed.
 * @returns {boolean} True if this is a self-access.
 * @since v0.3.0
 */
function isSelfAccess(agentName, filePath) {
  const agentLower = agentName.toLowerCase();
  for (const [keyword, pattern] of Object.entries(AGENT_SELF_CONFIG)) {
    if (agentLower.includes(keyword) && pattern.test(filePath)) return true;
  }
  return false;
}

/**
 * Find the AI agent that owns a file path so the event is attributed to it
 * (and the self-access exemption is checked against the right agent). An
 * agent's OWN config dir wins first — a cwd may contain another agent's config
 * dir, so self-config must outrank cwd containment.
 *
 * Returns the owner TOGETHER WITH the evidence code that resolved it, so the
 * caller never has to re-derive "why" (and never re-runs isSelfAccess against a
 * different agent). Returns null when nothing matches — the caller must then emit
 * an UNATTRIBUTED event rather than blame a substitute (C-01).
 * @param {string} filePath - Resolved file path from the watcher event.
 * @param {Array<{agent:string,cwd?:string}>} aiAgents - Candidate AI agents.
 * @returns {{agent: Object, evidence: string[]}|null} Owner plus why, or null.
 * @since v0.10.0
 */
function findOwningAgent(filePath, aiAgents) {
  for (const a of aiAgents) {
    if (isSelfAccess(a.agent, filePath)) {
      return { agent: a, evidence: [EVIDENCE.SELF_CONFIG_PATH] };
    }
  }
  const target = process.platform === 'win32' ? filePath.toLowerCase() : filePath;
  for (const a of aiAgents) {
    if (!a.cwd) continue;
    let base = path.resolve(a.cwd);
    if (process.platform === 'win32') base = base.toLowerCase();
    if (target === base || target.startsWith(base + path.sep)) {
      return { agent: a, evidence: [EVIDENCE.CWD_CONTAINMENT] };
    }
  }
  return null;
}

/**
 * Build an ignore-filter function for chokidar's `ignored` option.
 * Uses function form (not glob) to avoid chokidar issue #773.
 * Handles both `/` and `\` separators for Windows compatibility.
 * @param {Object} [config] - Config object with ignoredDirectories and ignoreCommonBuildDirs
 * @returns {(filePath: string) => boolean}
 */
function getIgnoredDirFilter(config) {
  const useDefaults = config?.ignoreCommonBuildDirs !== false;
  const custom = Array.isArray(config?.ignoredDirectories) ? config.ignoredDirectories : [];
  const dirs = useDefaults ? [...DEFAULT_IGNORED_DIRS, ...custom] : custom;
  if (dirs.length === 0) return () => false;
  return (filePath) =>
    dirs.some(
      (dir) =>
        filePath.includes('/' + dir + '/') ||
        filePath.includes('\\' + dir + '\\') ||
        filePath.endsWith('/' + dir) ||
        filePath.endsWith('\\' + dir),
    );
}

/**
 * Write the derived W into the existing `fs-chokidar` record. The record is the
 * mechanism's health; the plan is where its state now comes from.
 *
 * STARTING is not written: `createSensorHealth` already starts the record there,
 * sensor-health has no markStarting, and a plan only ever leaves STARTING forward —
 * roots never return to `planned`/`registered`, and every unavailable state is
 * terminal. Consequence worth naming: `lastSuccessAt` now advances only when EVERY
 * planned root is ready, where before one `ready` advanced it for all of them.
 * @param {number} now
 * @returns {void}
 */
function applyWatchPlaneHealth(now) {
  const state = deriveWatchPlaneState();
  const rec = _fsHealth[FS_SENSOR.CHOKIDAR];
  if (state === sensorHealth.SENSOR_HEALTH_STATE.FAILED) {
    _fsHealth[FS_SENSOR.CHOKIDAR] = sensorHealth.markFailed(rec, now, {
      error: unavailableRootSummary() || 'no-live-watcher',
      detail: 'no-live-watcher',
    });
  } else if (state === sensorHealth.SENSOR_HEALTH_STATE.DEGRADED) {
    // No lossCount: chokidar exposes no quantitative lost-event counter.
    _fsHealth[FS_SENSOR.CHOKIDAR] = sensorHealth.markDegraded(rec, now, {
      error: unavailableRootSummary(),
      detail: 'watch-roots-unavailable',
    });
  } else if (state === sensorHealth.SENSOR_HEALTH_STATE.HEALTHY) {
    _fsHealth[FS_SENSOR.CHOKIDAR] = sensorHealth.markHealthy(rec, now);
  }
}

/**
 * @param {object} watcher - the FSWatcher this binding belongs to
 * @param {string} rootId - the watch group it was registered for
 * @returns {void}
 */
function bindWatcherEvents(watcher, rootId) {
  // noteRootDelivery lives HERE, not in handleWatcherEvent: the handler is exported
  // and called directly with no root context by the attribution/ignore suites.
  watcher.on('add', (p) => {
    noteRootDelivery(rootId);
    handleWatcherEvent('created', p);
  });
  watcher.on('change', (p) => {
    noteRootDelivery(rootId);
    handleWatcherEvent('modified', p);
  });
  watcher.on('unlink', (p) => {
    noteRootDelivery(rootId);
    handleWatcherEvent('deleted', p);
  });
  // B2: chokidar may keep running after some errors — DEGRADED not FAILED, and the
  // scope of the degradation is this ROOT, not the mechanism. The registry moves the
  // root and answers whether anything changed; writing the record is this module's job,
  // and only on a real transition — W is derived over the plan, so re-deriving it for
  // an event that named no planned root would read an empty plan and throw.
  watcher.on('error', (err) => {
    if (markRootErrored(rootId, healthErrorMessage(err))) applyWatchPlaneHealth(Date.now());
  });
  // ready = successful initialization of this FSWatcher instance — that one root. A
  // `ready` on a root already `errored` moves nothing (§1.4 — terminal), so it writes
  // no record either.
  watcher.on('ready', () => {
    if (markRootReady(rootId)) applyWatchPlaneHealth(Date.now());
  });
}

function handleWatcherEvent(action, filePath) {
  if (!_state || _state.isMonitoringPaused()) return;
  filePath = path.resolve(filePath);
  // F-E02: ignore rules still drop noise; empty latestAgents must NOT drop evidence.
  // No agents → honest unattributed (NO_AI_AGENTS_ONLINE), not "no event happened".
  if (shouldIgnore(filePath)) return;
  const now = Date.now();
  const prev = watcherDebounce.get(filePath);
  if (prev && now - prev < 2000) return;
  watcherDebounce.set(filePath, now);
  if (watcherDebounce.size > 500) {
    for (const [k, t] of watcherDebounce) {
      if (now - t > 10000) watcherDebounce.delete(k);
    }
    if (watcherDebounce.size > 500) watcherDebounce.clear();
  }
  const reason = classifySensitive(filePath);
  // G′: chokidar KEEPS OBSERVING under an untrusted population — a path event is
  // valid evidence regardless of who owns it, and dropping it would lose real
  // filesystem activity to a process-sensor problem. What is unavailable is the list
  // of candidate owners, so owner inference is what gets skipped: `latestAiAgents` is
  // not read, `findOwningAgent` is not run, and the event carries no owner. `W` is
  // unaffected — no health record is written here.
  const scopeUsable = populationReliable();
  const aiAgents = scopeUsable ? _state.getLatestAiAgents() : [];
  const owner = aiAgents.length > 0 ? findOwningAgent(filePath, aiAgents) : null;
  // C-01: chokidar hands us a PATH, never a PID — so this path can be `inferred`
  // at best, and MUST be `unattributed` when no owner matches. Substituting the
  // first AI agent (or the first agent of any kind) poisoned that agent's
  // baselines, risk score, tray alert and audit trail. `pid: null`, not 0 — pid 0
  // is taken by synthetic WSL / local-runtime agents, so 0 would collide with a
  // real agent card.
  let evidence;
  if (owner) {
    evidence = owner.evidence;
  } else if (!scopeUsable) {
    // Says WHY there is no owner, and says it exactly: not "nobody was online"
    // (which would assert a fact about a population we cannot read) and not "no
    // owner matched" (which would assert a match was attempted).
    evidence = [EVIDENCE.POPULATION_UNAVAILABLE];
  } else {
    evidence = [aiAgents.length > 0 ? EVIDENCE.NO_OWNER_MATCH : EVIDENCE.NO_AI_AGENTS_ONLINE];
  }
  const attribution = makeAttribution(evidence);
  const agent = owner ? owner.agent : null;
  // D2: the self-access exemption belongs to the agent that OWNS the path, and is
  // implied by the evidence — findOwningAgent's first loop already ran
  // isSelfAccess over every AI agent, so reaching the cwd branch (or no branch at
  // all) proves no agent self-matched. Re-running it against a substituted agent
  // is what let a foreign agent's exemption silently clear `sensitive`.
  const selfAccess = reason !== null && evidence.includes(EVIDENCE.SELF_CONFIG_PATH);
  const event = {
    agent: agent ? agent.agent : '',
    pid: agent ? agent.pid : null,
    // Follows attribution, never leads it: `agent` is exactly the object
    // findOwningAgent resolved above, so the key comes from the same decision — and
    // from the same tick. That includes the `inferred` branch (self-config / cwd
    // containment): its owner is a real agent from this tick, so it gets its real
    // key. Only a null owner yields a null key — never aiAgents[0], never a
    // name match.
    instanceId: readInstanceId(agent),
    parentEditor: (agent && agent.parentEditor) || null,
    cwd: (agent && agent.cwd) || null,
    file: filePath,
    sensitive: reason !== null && !selfAccess,
    selfAccess,
    reason: reason || '',
    action,
    timestamp: now,
    category: agent ? agent.category || 'other' : 'other',
    attribution,
  };
  _state.activityLog.push(event);
  if (_state.onActivityPush) _state.onActivityPush(event);
  if (_state.activityLog.length > 10000) {
    const evicted = _state.activityLog.shift();
    if (_state.onActivityEvict) _state.onActivityEvict(evicted);
  }
  // An unattributed event enters NO agent's behaviour baseline: recording it under
  // an empty name would create a phantom agent in sessionData, which
  // checkDeviations() then iterates and warns about.
  // The baseline bucket is keyed on the instance, so the key travels with the name —
  // both taken from the event just built, never re-resolved. An owner that carries no
  // key is not recorded at all (baselines.js `ensureSessionData`).
  if (attribution.status !== 'unattributed') {
    _state.recordFileAccess(event.instanceId, event.agent, filePath, event.sensitive, event.reason);
  }
  if (_state.onFileEvent) _state.onFileEvent(event);
}

/**
 * Register the production watch roots and record what each one actually did.
 *
 * The rejection is deliberately re-thrown after the plan is written: main.js already
 * reports it (`File watcher setup failed`), and this module owns the plan (§10 step B).
 * @returns {Promise<void>}
 * @throws {Error} whatever `chokidar.watch` threw, after the plan records the abort.
 * @since v0.1.0
 */
async function setupFileWatchers() {
  const homeDir = os.homedir();
  const projectDir = path.join(__dirname, '..', '..');
  // BOTH preflights complete before ANY registration (§1.2). The plan separates
  // intent from outcome: a group may leave it only because a completed probe proved
  // there is nothing to watch — never because a registration threw. Under the old
  // order the second probe ran after the first `chokidar.watch`, so an abort in
  // between produced a plan that had never heard of the agent-config group, and one
  // ready root was enough to call the whole mechanism HEALTHY.
  const sensitiveDirs = await filterExistingDirs(
    SENSITIVE_AGENT_DIRS.map((d) => path.join(homeDir, d)),
  );
  // AI agent config directories (Hudson Rock threat vector — critical)
  const sensitiveDirNames = new Set(SENSITIVE_AGENT_DIRS);
  const agentConfigDirs = await filterExistingDirs(
    AGENT_CONFIG_PATHS.filter((d) => !sensitiveDirNames.has(d)).map((d) => path.join(homeDir, d)),
  );
  // Reinit chokidar health lifetime when production recreates the watcher set — and
  // the plan with it, since the plan is what writes into that record.
  _fsHealth[FS_SENSOR.CHOKIDAR] = sensorHealth.createSensorHealth(FS_SENSOR.CHOKIDAR);
  buildWatchPlan([
    { id: WATCH_GROUP.CREDENTIAL_DIRS, applicable: sensitiveDirs.length > 0 },
    { id: WATCH_GROUP.AGENT_CONFIG_DIRS, applicable: agentConfigDirs.length > 0 },
    // Unconditional: no preflight can exclude them, so the plan is never empty.
    { id: WATCH_GROUP.PROJECT_DIR, applicable: true },
    { id: WATCH_GROUP.ENV_FILES, applicable: true },
  ]);
  /** @type {string|null} The group whose registration is in flight. */
  let attempted = null;
  try {
    const config = _state.getSettings ? _state.getSettings() : {};
    const dirFilter = getIgnoredDirFilter(config);
    /** Registration order IS plan order — `not-attempted` is read off plan position. */
    const registrations = [
      [
        WATCH_GROUP.CREDENTIAL_DIRS,
        () =>
          chokidar.watch(sensitiveDirs, {
            persistent: true,
            ignoreInitial: true,
            usePolling: false,
            followSymlinks: false,
            depth: 1,
          }),
      ],
      [
        WATCH_GROUP.AGENT_CONFIG_DIRS,
        () =>
          chokidar.watch(agentConfigDirs, {
            persistent: true,
            ignoreInitial: true,
            usePolling: false,
            followSymlinks: false,
            depth: 2,
          }),
      ],
      [
        WATCH_GROUP.PROJECT_DIR,
        () =>
          chokidar.watch(projectDir, {
            persistent: true,
            ignoreInitial: true,
            ignored: (filePath) => dirFilter(filePath) || /package-lock\.json$/.test(filePath),
            usePolling: false,
            followSymlinks: false,
            depth: 5,
          }),
      ],
      [
        WATCH_GROUP.ENV_FILES,
        () =>
          chokidar.watch(path.join(homeDir, '.env*'), {
            persistent: true,
            ignoreInitial: true,
            depth: 0,
            usePolling: false,
            followSymlinks: false,
          }),
      ],
    ];
    for (const [id, register] of registrations) {
      if (!hasPlannedRoot(id)) continue; // not-applicable — proven absent by preflight
      attempted = id;
      const w = register();
      markRootRegistered(id, w);
      bindWatcherEvents(w, id);
      _state.watchers.push(w);
    }
  } catch (err) {
    // §1.3: the group that threw is `registration-failed`; every planned group the
    // loop never reached is `not-attempted`, read off plan position. Both are recorded
    // before the rejection leaves this function.
    if (attempted) markRootRegistrationFailed(attempted, healthErrorMessage(err));
    markUnreachedRootsNotAttempted();
    applyWatchPlaneHealth(Date.now());
    throw err;
  }
  applyWatchPlaneHealth(Date.now());
}

/**
 * Check which directories exist using async fs, in parallel.
 * @param {string[]} dirs @returns {Promise<string[]>} @since v0.5.0
 */
async function filterExistingDirs(dirs) {
  const results = await Promise.all(
    dirs.map((d) =>
      fs.promises
        .access(d)
        .then(() => d)
        .catch(() => null),
    ),
  );
  return results.filter(Boolean);
}

/**
 * Dedup key for _state.knownHandles: the agent's stamped process INSTANCE, never
 * its bare pid and never a second local derivation. Windows recycles PIDs, so a
 * pid-keyed store lets a new process inherit a dead one's seen-set. Reconstructing
 * via buildInstanceId from partial fields can disagree with the scan-batch stamp
 * (ai-mistakes.md #19) — so unstamped agents get no handle-dedup entry this tick.
 * @param {{instanceId?: string}} agent
 * @returns {string|null}
 */
function handleKey(agent) {
  return readInstanceId(agent);
}

/**
 * Per-agent handle observation.
 * @param {Object} agent
 * @returns {Promise<{ok: boolean, events: Array, error?: string}>}
 * @since v0.1.0
 */
async function scanFileHandles(agent) {
  const pid = agent.pid;
  let files;
  try {
    files = await _getFileHandles(pid);
  } catch (err) {
    // B-S03: empty events are compatibility only — ok:false means not a clean empty.
    return { ok: false, events: [], error: healthErrorMessage(err) };
  }
  if (!Array.isArray(files) || files.length === 0) {
    return { ok: true, events: [] };
  }

  const kh = _state.knownHandles;
  const key = handleKey(agent);
  // Stamped key → durable seen-set. Unstamped → still emit events (no silent drop)
  // but do not invent a knownHandles key (no second identity resolution).
  let known = null;
  if (key) {
    if (!kh.has(key)) kh.set(key, new Set());
    known = kh.get(key);
  }
  const newAccess = [];
  // Event loop is outside getFileHandles try/catch so unexpected throws (e.g.
  // recordFileAccess) propagate to the worker pool, which drops only this agent.
  for (const f of files) {
    if (shouldIgnore(f)) continue;
    if (known && known.has(f)) continue;
    if (known) {
      known.add(f);
      // Cap per-instance set at 500 — evict oldest entries
      if (known.size > 500) {
        const iter = known.values();
        for (let i = 0; i < known.size - 500; i++) {
          known.delete(iter.next().value);
        }
      }
    }
    const reason = classifySensitive(f);
    const selfAccess = reason !== null && isSelfAccess(agent.agent, f);
    // Confirmed: this scan was run FOR agent.pid, so the owner IS the pid.
    const evidence = [EVIDENCE.HANDLE_SCAN_PID];
    if (selfAccess) evidence.push(EVIDENCE.SELF_CONFIG_PATH);
    const event = {
      agent: agent.agent,
      pid,
      // The scan was run FOR this agent object, so the key is that object's own —
      // no lookup, no tick boundary crossed. Unstamped → null (honest).
      instanceId: readInstanceId(agent),
      parentEditor: agent.parentEditor || null,
      cwd: agent.cwd || null,
      file: f,
      sensitive: reason !== null && !selfAccess,
      selfAccess,
      reason: reason || '',
      action: 'accessed',
      timestamp: Date.now(),
      category: agent.category || 'other',
      attribution: makeAttribution(evidence),
    };
    newAccess.push(event);
    _state.activityLog.push(event);
    if (_state.onActivityPush) _state.onActivityPush(event);
    if (_state.activityLog.length > 10000) {
      const evicted = _state.activityLog.shift();
      if (_state.onActivityEvict) _state.onActivityEvict(evicted);
    }
    _state.recordFileAccess(event.instanceId, agent.agent, f, event.sensitive, event.reason);
  }
  return { ok: true, events: newAccess };
}

/**
 * Whether the Restart Manager read-detect path is usable: the platform exposes
 * getSensitiveHolders (win32 only) AND, if it reports availability, RM is up. When
 * RM is unavailable the caller falls back to the legacy getFileHandles pool path,
 * preserving the PR-A handle.exe fallback.
 * @returns {boolean}
 */
function rmEnabled() {
  if (typeof _getSensitiveHolders !== 'function') return false;
  if (typeof _isRmAvailable === 'function' && !_isRmAvailable()) return false;
  return true;
}

/**
 * Restart Manager scan path (win32 primary): ONE powershell spawn returns every
 * process holding a handle to a registered sensitive directory group. Each holder
 * PID is mapped to its OWNING agent (C-01 — resolved from the PID, never
 * cross-wired); AEGIS's own PID and non-agent holders are dropped. Emits an
 * `action:'holding'` event — a point-in-time handle HOLD at the scan tick, NOT a
 * read/access. Dedups per-instance by group via knownHandles so a sustained hold
 * fires once, not once-per-scan.
 *
 * Used by BOTH the full (30s) and the hot (~10s) cycles via `fetchHolders`; both
 * share `_state.knownHandles`, so a hold caught by one cycle is deduped against
 * the other (cross-cycle dedup). A single-flight guard keeps the two cycles from
 * spawning two powershells at once (cost only — the shared dedup already prevents
 * any double-emit since JS is single-threaded).
 * @param {Array} agents
 * @param {Function} [fetchHolders] - Holder source (full or hot); defaults to full.
 * @returns {Promise<Array>}
 * @since v0.10.0
 */
async function scanViaRestartManager(agents, fetchHolders = _getSensitiveHolders) {
  // G′ invariant, not a scheduling decision: _scanRmHolders maps a live holder pid
  // onto an agent record and stamps RM_HOLDER_PID — `confirmed` — into the audit log.
  // That stamp must be impossible against a population the process sensor cannot
  // vouch for, whoever called us. scan-loop refuses earlier and logs the skip; this
  // guard is what makes the invariant hold rather than the schedule.
  if (!populationReliable()) {
    noteFileScanSkip(SCOPE_UNAVAILABLE_REASON);
    return [];
  }
  // B-S09: legitimate single-flight skip — not FAILED, not a success tick.
  if (_rmScanInFlight) return [];
  _rmScanInFlight = true;
  const now = Date.now();
  try {
    const events = await _scanRmHolders(agents, fetchHolders);
    _fsHealth[FS_SENSOR.RM] = sensorHealth.markHealthy(_fsHealth[FS_SENSOR.RM], now);
    return events;
  } catch (err) {
    _fsHealth[FS_SENSOR.RM] = sensorHealth.markFailed(_fsHealth[FS_SENSOR.RM], now, {
      error: healthErrorMessage(err),
      detail: 'rm-fetch-failed',
    });
    // Compatibility empty array — health carries FAILED (B-S05 / B-S03 class).
    return [];
  } finally {
    _rmScanInFlight = false;
  }
}

/**
 * Core RM holder→agent mapping + holding-event emission (C-01: agent resolved from
 * the holder PID, never cross-wired). Split out so scanViaRestartManager can wrap
 * it with the single-flight guard.
 * @param {Array} agents
 * @param {Function} fetchHolders - Holder source (full or hot).
 * @returns {Promise<Array>}
 */
async function _scanRmHolders(agents, fetchHolders) {
  // Let fetch failures propagate so scanViaRestartManager can mark FAILED.
  const holders = await fetchHolders();
  if (!Array.isArray(holders) || holders.length === 0) return [];
  const toScan =
    _state && _state.isOtherPanelExpanded() ? agents : agents.filter((a) => a.category === 'ai');
  const pidToAgent = new Map();
  for (const a of toScan) pidToAgent.set(a.pid, a);
  const kh = _state.knownHandles;
  const newAccess = [];
  for (const h of holders) {
    if (h.pid === process.pid) continue; // own-PID guard — never blame AEGIS itself
    const agent = pidToAgent.get(h.pid);
    if (!agent) continue; // holder is not a tracked (in-scope) agent — drop
    const group = h.group;
    const key = handleKey(agent);
    const dedupKey = 'holding|' + group;
    if (key) {
      if (!kh.has(key)) kh.set(key, new Set());
      const known = kh.get(key);
      if (known.has(dedupKey)) continue;
      known.add(dedupKey);
      if (known.size > 500) {
        const iter = known.values();
        for (let i = 0; i < known.size - 500; i++) known.delete(iter.next().value);
      }
    }
    // Rule/self-config patterns anchor on a separator AFTER the dir name (e.g.
    // `\.claude[\\/]`), but a group is a bare DIR path with no trailing separator.
    // Match against a separator-normalized variant so dir groups resolve, while
    // keeping event.file the clean dir. Single-file (env) groups still match
    // as-is via the basename-anchored ($) patterns.
    const groupSep = group.endsWith('/') || group.endsWith('\\') ? group : group + '/';
    const reason = h.reason || classifySensitive(groupSep) || classifySensitive(group) || '';
    const selfAccess =
      reason !== '' && (isSelfAccess(agent.agent, groupSep) || isSelfAccess(agent.agent, group));
    // Confirmed: the agent was resolved from the holder PID (never cross-wired).
    const evidence = [EVIDENCE.RM_HOLDER_PID];
    if (selfAccess) evidence.push(EVIDENCE.SELF_CONFIG_PATH);
    const event = {
      agent: agent.agent,
      pid: h.pid,
      // From the agent `pidToAgent` matched for THIS holder, built from the agents
      // passed into this very call. Two instances sharing a name but not a pid
      // therefore stamp two different keys — which is the whole point.
      instanceId: readInstanceId(agent),
      parentEditor: agent.parentEditor || null,
      cwd: agent.cwd || null,
      file: group,
      sensitive: reason !== '' && !selfAccess,
      selfAccess,
      reason,
      action: 'holding',
      timestamp: Date.now(),
      category: agent.category || 'other',
      attribution: makeAttribution(evidence),
    };
    newAccess.push(event);
    _state.activityLog.push(event);
    if (_state.onActivityPush) _state.onActivityPush(event);
    if (_state.activityLog.length > 10000) {
      const evicted = _state.activityLog.shift();
      if (_state.onActivityEvict) _state.onActivityEvict(evicted);
    }
    _state.recordFileAccess(event.instanceId, agent.agent, group, event.sensitive, event.reason);
  }
  return newAccess;
}

/**
 * Whether the fast hot read-detect cycle is usable: the platform exposes
 * getHotSensitiveHolders (win32 only) AND, if it reports availability, RM is up.
 * scan-loop checks this to avoid creating the hot timer on darwin/linux (no RM).
 * @returns {boolean}
 */
function isHotReadScanActive() {
  if (typeof _getHotSensitiveHolders !== 'function') return false;
  if (typeof _isRmAvailable === 'function' && !_isRmAvailable()) return false;
  return true;
}

/**
 * Fast hot read-detect scan (win32 only): the same RM holder→agent path as the
 * full scan but sourced from getHotSensitiveHolders (HOT_DIRS + ~/.env* only),
 * driven at ~10s to shrink the 30s read-blind window on the crown-jewel secret
 * dirs. Shares _state.knownHandles with the full scan → cross-cycle dedup (a hold
 * caught here will NOT re-fire from the 30s scan, and vice versa). Emits
 * `action:'holding'` — a HOLD at the tick, NEVER a transient open→read→close.
 * @param {Array} agents
 * @returns {Promise<Array>}
 * @since v0.11.0-alpha
 */
async function scanHotFileHolders(agents) {
  if (!isHotReadScanActive()) return [];
  return scanViaRestartManager(agents, _getHotSensitiveHolders);
}

/**
 * @param {Array} agents
 * @returns {Promise<Array>}
 * @since v0.1.0
 */
async function scanAllFileHandles(agents) {
  const now = Date.now();
  // G′ invariant: the handle pool stamps HANDLE_SCAN_PID — `confirmed`, same strength
  // as the RM holder pid — so it is gated by the same rule and for the same reason.
  // Placed ahead of the RM delegation so both mechanisms are covered from one site.
  if (!populationReliable()) {
    noteFileScanSkip(SCOPE_UNAVAILABLE_REASON);
    return [];
  }
  // win32 primary: honest read-detect via Restart Manager (no handle.exe needed).
  // Falls through to the legacy per-PID handle pool on darwin/linux, or on win32
  // when RM is unavailable (the PR-A getFileHandles→[] fallback still applies).
  if (rmEnabled()) {
    // RM path owns observation this tick; handle sensor not sampled.
    return scanViaRestartManager(agents);
  }

  // B-S04: capability blind — empty results are not HEALTHY clean observation.
  if (!handleCapabilityOk()) {
    _fsHealth[FS_SENSOR.HANDLE] = sensorHealth.markDegraded(_fsHealth[FS_SENSOR.HANDLE], now, {
      error: 'read-detection-unavailable',
      detail: 'no-handle-binary-and-no-rm',
    });
    // Only degrade RM when it is an expected sensor (not platform-UNSUPPORTED).
    if (
      _fsHealth[FS_SENSOR.RM].state !== sensorHealth.SENSOR_HEALTH_STATE.UNSUPPORTED &&
      !rmEnabled()
    ) {
      _fsHealth[FS_SENSOR.RM] = sensorHealth.markDegraded(_fsHealth[FS_SENSOR.RM], now, {
        error: 'rm-unavailable',
        detail: 'read-detection-unavailable',
      });
    }
    return [];
  }

  const toScan =
    _state && _state.isOtherPanelExpanded() ? agents : agents.filter((a) => a.category === 'ai');
  if (toScan.length === 0) {
    // No agents to probe — not a sensor failure (scan-loop skips earlier too).
    return [];
  }
  // Bounded-concurrency worker pool: at most FILE_SCAN_CONCURRENCY scanFileHandles()
  // run at once (each spawns one powershell/handle.exe). Results are stored by
  // original index, so the returned array stays in agent order — per-event agent
  // attribution (C-01) is stamped inside scanFileHandles and never cross-wired.
  /** @type {Array<{ok: boolean, events: Array, error?: string}>} */
  const results = new Array(toScan.length);
  let next = 0;
  async function worker() {
    while (next < toScan.length) {
      const i = next++;
      try {
        results[i] = await scanFileHandles(toScan[i]);
      } catch (err) {
        // Unexpected throw outside scanFileHandles control — count as agent failure.
        results[i] = { ok: false, events: [], error: healthErrorMessage(err) };
      }
    }
  }
  const poolSize = Math.min(FILE_SCAN_CONCURRENCY, toScan.length);
  await Promise.all(Array.from({ length: poolSize }, worker));
  const allNew = [];
  let failCount = 0;
  let lastErr = null;
  for (const r of results) {
    if (!r) continue;
    if (!r.ok) {
      failCount += 1;
      lastErr = r.error || lastErr;
    }
    allNew.push(...(r.events || []));
  }
  const t = Date.now();
  if (failCount === toScan.length) {
    _fsHealth[FS_SENSOR.HANDLE] = sensorHealth.markFailed(_fsHealth[FS_SENSOR.HANDLE], t, {
      error: lastErr || 'handle-scan-failed',
      detail: 'all-agents-failed',
    });
  } else if (failCount > 0) {
    // Partial: keep successful events; health is DEGRADED (B2).
    _fsHealth[FS_SENSOR.HANDLE] = sensorHealth.markDegraded(_fsHealth[FS_SENSOR.HANDLE], t, {
      error: lastErr || 'partial-handle-scan',
      detail: `failed-${failCount}-of-${toScan.length}`,
    });
  } else {
    _fsHealth[FS_SENSOR.HANDLE] = sensorHealth.markHealthy(_fsHealth[FS_SENSOR.HANDLE], t);
  }
  return allNew;
}

/**
 * Drop knownHandles entries whose process INSTANCE is gone. Keyed by instanceId,
 * so a recycled pid counts as gone: the dead instance's entry is removed even
 * while a NEW process occupies the same pid — that new instance starts with a
 * clean seen-set and its first sensitive access fires.
 * @param {Array} activeAgents
 * @returns {void} @since v0.1.0
 */
function pruneKnownHandles(activeAgents) {
  const activeKeys = new Set();
  for (const a of activeAgents) {
    const k = handleKey(a);
    if (k) activeKeys.add(k);
  }
  for (const key of _state.knownHandles.keys()) {
    if (!activeKeys.has(key)) _state.knownHandles.delete(key);
  }
}

/**
 * One chokidar watcher over ONE rule directory, no recursion, `_`-prefixed entries ignored
 * (function-form `ignored`, not a glob — chokidar issue #773). Shared by the two rule
 * watchers below so they cannot drift apart on their options.
 * @param {string} dir
 * @returns {import('chokidar').FSWatcher}
 */
function _watchRuleDir(dir) {
  return chokidar.watch(dir, {
    ignored: (filePath) => path.basename(filePath).startsWith('_'),
    persistent: false,
    ignoreInitial: true,
    followSymlinks: false,
    depth: 0,
  });
}

/**
 * @param {string} basename
 * @returns {boolean} whether the changed entry is a rule file at all.
 */
function _isRuleFile(basename) {
  return basename.endsWith('.yaml') || basename.endsWith('.yml');
}

/**
 * Watch the rules/ directory for YAML changes and hot-reload the FLAT rules. `depth: 0`, so
 * `rules/sequences/` is not this watcher's — {@link setupSequenceRulesWatcher} owns it — and
 * an edit here never resets the sequence engine (docs/roadmap/sequence-rules.md §5
 * "Hot-reload"). The push carries both figures: `count` from the reloaded flat set and
 * `sequenceCount` read off `deps.sequenceCount` at the time of the change, so the renderer
 * is never handed a flat count with no sequence figure beside it.
 * @param {(channel: string, data: object) => void} sendFn - Function to push events to renderer
 * @param {{sequenceCount: () => number}} deps - `sequenceCount` answers how many sequence
 *   rules the engine currently holds (main.js owns that figure).
 * @returns {import('chokidar').FSWatcher}
 * @since v0.6.0
 */
function setupRulesWatcher(sendFn, { sequenceCount }) {
  const rulesDir = path.join(__dirname, '..', '..', 'rules');
  const rw = _watchRuleDir(rulesDir);
  rw.on('change', (filePath) => {
    const basename = path.basename(filePath);
    if (!_isRuleFile(basename)) return;
    reloadRules();
    sendFn('rules:reloaded', {
      count: getAllRules().size,
      file: basename,
      sequenceCount: sequenceCount(),
    });
  });
  return rw;
}

/**
 * Watch rules/sequences/ for YAML changes and hot-reload the SEQUENCE rules — the second
 * watcher of docs/roadmap/sequence-rules.md §5 "Hot-reload", same options as
 * {@link setupRulesWatcher}. Only this one calls `deps.reload`, which main.js supplies as:
 * load the directory again, reset the engine, re-init it with the new rules. The flat rules
 * are NOT reloaded from here, and the push is the same `rules:reloaded` channel with the same
 * three fields — `count` from the flat set as it stands, `sequenceCount` as `reload` returned it.
 * @param {(channel: string, data: object) => void} sendFn - Function to push events to renderer
 * @param {{reload: () => number}} deps - `reload` re-reads the sequence rules into the engine
 *   and returns how many are loaded now.
 * @returns {import('chokidar').FSWatcher}
 * @since v0.14.0
 */
function setupSequenceRulesWatcher(sendFn, { reload }) {
  const sequencesDir = path.join(__dirname, '..', '..', 'rules', 'sequences');
  const rw = _watchRuleDir(sequencesDir);
  rw.on('change', (filePath) => {
    const basename = path.basename(filePath);
    if (!_isRuleFile(basename)) return;
    const sequenceCount = reload();
    sendFn('rules:reloaded', { count: getAllRules().size, file: basename, sequenceCount });
  });
  return rw;
}

module.exports = {
  init,
  setupFileWatchers,
  setupRulesWatcher,
  setupSequenceRulesWatcher,
  scanAllFileHandles,
  scanHotFileHolders,
  isHotReadScanActive,
  pruneKnownHandles,
  classifySensitive,
  shouldIgnore,
  isSelfAccess,
  handleWatcherEvent,
  getIgnoredDirFilter,
  getFileSensorHealth,
  getWatchPlan,
  noteFileScanSkip,
  FS_SENSOR,
  WATCH_GROUP,
  WATCH_ROOT_STATE,
  DEFAULT_IGNORED_DIRS,
  FILE_SCAN_CONCURRENCY,
  _setDepsForTest,
  _resetForTest,
  _resetFsHealth,
};
