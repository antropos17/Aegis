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
const _platform = require('./platform');
const { IGNORE_FILE_PATTERNS } = _platform;

/** Stable filesystem sensor IDs (B2). Generic string ids — not a frozen registry. */
const FS_SENSOR = Object.freeze({
  CHOKIDAR: 'fs-chokidar',
  HANDLE: 'fs-handle',
  RM: 'fs-rm',
});

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
 * @returns {void}
 */
function _resetFsHealth() {
  _fsHealth = createInitialFsHealth();
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

function bindWatcherEvents(watcher) {
  watcher.on('add', (p) => handleWatcherEvent('created', p));
  watcher.on('change', (p) => handleWatcherEvent('modified', p));
  watcher.on('unlink', (p) => handleWatcherEvent('deleted', p));
  // B2: chokidar may keep running after some errors — DEGRADED not FAILED.
  // No lossCount: chokidar does not expose a quantitative lost-event counter.
  watcher.on('error', (err) => {
    const now = Date.now();
    _fsHealth[FS_SENSOR.CHOKIDAR] = sensorHealth.markDegraded(_fsHealth[FS_SENSOR.CHOKIDAR], now, {
      error: healthErrorMessage(err),
      detail: 'chokidar-error',
    });
  });
  // ready = successful initialization of this FSWatcher instance.
  watcher.on('ready', () => {
    const now = Date.now();
    _fsHealth[FS_SENSOR.CHOKIDAR] = sensorHealth.markHealthy(_fsHealth[FS_SENSOR.CHOKIDAR], now);
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
  const aiAgents = _state.getLatestAiAgents();
  const owner = aiAgents.length > 0 ? findOwningAgent(filePath, aiAgents) : null;
  // C-01: chokidar hands us a PATH, never a PID — so this path can be `inferred`
  // at best, and MUST be `unattributed` when no owner matches. Substituting the
  // first AI agent (or the first agent of any kind) poisoned that agent's
  // baselines, risk score, tray alert and audit trail. `pid: null`, not 0 — pid 0
  // is taken by synthetic WSL / local-runtime agents, so 0 would collide with a
  // real agent card.
  const evidence = owner
    ? owner.evidence
    : [aiAgents.length > 0 ? EVIDENCE.NO_OWNER_MATCH : EVIDENCE.NO_AI_AGENTS_ONLINE];
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

/** @returns {Promise<void>} @since v0.1.0 */
async function setupFileWatchers() {
  // Reinit chokidar health lifetime when production recreates the watcher set.
  _fsHealth[FS_SENSOR.CHOKIDAR] = sensorHealth.createSensorHealth(FS_SENSOR.CHOKIDAR);
  const homeDir = os.homedir();
  const sensitiveDirCandidates = SENSITIVE_AGENT_DIRS.map((d) => path.join(homeDir, d));
  const sensitiveDirs = await filterExistingDirs(sensitiveDirCandidates);
  const projectDir = path.join(__dirname, '..', '..');
  if (sensitiveDirs.length > 0) {
    const w = chokidar.watch(sensitiveDirs, {
      persistent: true,
      ignoreInitial: true,
      usePolling: false,
      followSymlinks: false,
      depth: 1,
    });
    bindWatcherEvents(w);
    _state.watchers.push(w);
  }
  // AI agent config directories (Hudson Rock threat vector — critical)
  const sensitiveDirNames = new Set(SENSITIVE_AGENT_DIRS);
  const agentConfigCandidates = AGENT_CONFIG_PATHS.filter((d) => !sensitiveDirNames.has(d)).map(
    (d) => path.join(homeDir, d),
  );
  const agentConfigDirs = await filterExistingDirs(agentConfigCandidates);
  if (agentConfigDirs.length > 0) {
    const cw = chokidar.watch(agentConfigDirs, {
      persistent: true,
      ignoreInitial: true,
      usePolling: false,
      followSymlinks: false,
      depth: 2,
    });
    bindWatcherEvents(cw);
    _state.watchers.push(cw);
  }
  const config = _state.getSettings ? _state.getSettings() : {};
  const dirFilter = getIgnoredDirFilter(config);
  const pw = chokidar.watch(projectDir, {
    persistent: true,
    ignoreInitial: true,
    ignored: (filePath) => dirFilter(filePath) || /package-lock\.json$/.test(filePath),
    usePolling: false,
    followSymlinks: false,
    depth: 5,
  });
  bindWatcherEvents(pw);
  _state.watchers.push(pw);
  const ew = chokidar.watch(path.join(homeDir, '.env*'), {
    persistent: true,
    ignoreInitial: true,
    depth: 0,
    usePolling: false,
    followSymlinks: false,
  });
  bindWatcherEvents(ew);
  _state.watchers.push(ew);
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
 * Watch the rules/ directory for YAML changes and hot-reload.
 * @param {(channel: string, data: object) => void} sendFn - Function to push events to renderer
 * @returns {import('chokidar').FSWatcher}
 * @since v0.6.0
 */
function setupRulesWatcher(sendFn) {
  const rulesDir = path.join(__dirname, '..', '..', 'rules');
  const rw = chokidar.watch(rulesDir, {
    ignored: (filePath) => path.basename(filePath).startsWith('_'),
    persistent: false,
    ignoreInitial: true,
    followSymlinks: false,
    depth: 0,
  });
  rw.on('change', (filePath) => {
    const basename = path.basename(filePath);
    if (!basename.endsWith('.yaml') && !basename.endsWith('.yml')) return;
    reloadRules();
    sendFn('rules:reloaded', { count: getAllRules().size, file: basename });
  });
  return rw;
}

module.exports = {
  init,
  setupFileWatchers,
  setupRulesWatcher,
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
  FS_SENSOR,
  DEFAULT_IGNORED_DIRS,
  FILE_SCAN_CONCURRENCY,
  _setDepsForTest,
  _resetForTest,
  _resetFsHealth,
};
