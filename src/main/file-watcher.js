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
const { IGNORE_PATTERNS, AGENT_CONFIG_PATHS, AGENT_SELF_CONFIG } = require('../shared/constants');
const { getAllRules, reloadRules } = require('./rule-loader');
const _platform = require('./platform');
const { IGNORE_FILE_PATTERNS } = _platform;

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
const _isRmAvailable = _platform.isRestartManagerAvailable;
/** @internal Override dependencies (for tests). */
function _setDepsForTest(overrides) {
  if (overrides.getFileHandles) _getFileHandles = overrides.getFileHandles;
  if (overrides.getSensitiveHolders) _getSensitiveHolders = overrides.getSensitiveHolders;
}
/** @internal Reset debounce state + opt out of the RM path (for tests). */
function _resetForTest() {
  watcherDebounce.clear();
  _getSensitiveHolders = undefined; // tests opt into RM explicitly via _setDepsForTest
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
 * dir, so self-config must outrank cwd containment. Returns null if none match,
 * letting the caller fall back to its prior default.
 * @param {string} filePath - Resolved file path from the watcher event.
 * @param {Array<{agent:string,cwd?:string}>} aiAgents - Candidate AI agents.
 * @returns {Object|null} The owning agent, or null when no agent matches.
 * @since v0.10.0
 */
function findOwningAgent(filePath, aiAgents) {
  for (const a of aiAgents) {
    if (isSelfAccess(a.agent, filePath)) return a;
  }
  const target = process.platform === 'win32' ? filePath.toLowerCase() : filePath;
  for (const a of aiAgents) {
    if (!a.cwd) continue;
    let base = path.resolve(a.cwd);
    if (process.platform === 'win32') base = base.toLowerCase();
    if (target === base || target.startsWith(base + path.sep)) return a;
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
}

function handleWatcherEvent(action, filePath) {
  if (!_state || _state.isMonitoringPaused()) return;
  filePath = path.resolve(filePath);
  const agents = _state.getLatestAgents();
  if (agents.length === 0 || shouldIgnore(filePath)) return;
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
  const agent = owner || (aiAgents.length > 0 ? aiAgents[0] : agents[0]);
  const selfAccess = reason !== null && isSelfAccess(agent.agent, filePath);
  const event = {
    agent: agent.agent,
    pid: agent.pid,
    parentEditor: agent.parentEditor || null,
    cwd: agent.cwd || null,
    file: filePath,
    sensitive: reason !== null && !selfAccess,
    selfAccess,
    reason: reason || '',
    action,
    timestamp: now,
    category: agent.category || 'other',
  };
  _state.activityLog.push(event);
  if (_state.onActivityPush) _state.onActivityPush(event);
  if (_state.activityLog.length > 10000) {
    const evicted = _state.activityLog.shift();
    if (_state.onActivityEvict) _state.onActivityEvict(evicted);
  }
  _state.recordFileAccess(event.agent, filePath, event.sensitive, event.reason);
  if (_state.onFileEvent) _state.onFileEvent(event);
}

/** @returns {Promise<void>} @since v0.1.0 */
async function setupFileWatchers() {
  const homeDir = os.homedir();
  const sensitiveDirCandidates = ['.ssh', '.aws', '.gnupg', '.kube', '.docker', '.azure'].map((d) =>
    path.join(homeDir, d),
  );
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
  const sensitiveDirNames = new Set(['.ssh', '.aws', '.gnupg', '.kube', '.docker', '.azure']);
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
 * @param {Object} agent
 * @returns {Promise<Array>}
 * @since v0.1.0
 */
async function scanFileHandles(agent) {
  const pid = agent.pid;
  let files;
  try {
    files = await _getFileHandles(pid);
  } catch (_) {
    return [];
  }
  if (!Array.isArray(files) || files.length === 0) return [];

  const kh = _state.knownHandles;
  if (!kh.has(pid)) kh.set(pid, new Set());
  const known = kh.get(pid);
  const newAccess = [];
  for (const f of files) {
    if (shouldIgnore(f) || known.has(f)) continue;
    known.add(f);
    // Cap per-PID set at 500 — evict oldest entries
    if (known.size > 500) {
      const iter = known.values();
      for (let i = 0; i < known.size - 500; i++) {
        known.delete(iter.next().value);
      }
    }
    const reason = classifySensitive(f);
    const selfAccess = reason !== null && isSelfAccess(agent.agent, f);
    const event = {
      agent: agent.agent,
      pid,
      parentEditor: agent.parentEditor || null,
      cwd: agent.cwd || null,
      file: f,
      sensitive: reason !== null && !selfAccess,
      selfAccess,
      reason: reason || '',
      action: 'accessed',
      timestamp: Date.now(),
      category: agent.category || 'other',
    };
    newAccess.push(event);
    _state.activityLog.push(event);
    if (_state.onActivityPush) _state.onActivityPush(event);
    if (_state.activityLog.length > 10000) {
      const evicted = _state.activityLog.shift();
      if (_state.onActivityEvict) _state.onActivityEvict(evicted);
    }
    _state.recordFileAccess(agent.agent, f, event.sensitive, event.reason);
  }
  return newAccess;
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
 * read/access. Dedups per-PID by group via knownHandles so a sustained hold fires
 * once, not once-per-scan.
 * @param {Array} agents
 * @returns {Promise<Array>}
 * @since v0.10.0
 */
async function scanViaRestartManager(agents) {
  let holders;
  try {
    holders = await _getSensitiveHolders();
  } catch (_) {
    return [];
  }
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
    if (!kh.has(h.pid)) kh.set(h.pid, new Set());
    const known = kh.get(h.pid);
    const dedupKey = 'holding|' + group;
    if (known.has(dedupKey)) continue;
    known.add(dedupKey);
    if (known.size > 500) {
      const iter = known.values();
      for (let i = 0; i < known.size - 500; i++) known.delete(iter.next().value);
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
    const event = {
      agent: agent.agent,
      pid: h.pid,
      parentEditor: agent.parentEditor || null,
      cwd: agent.cwd || null,
      file: group,
      sensitive: reason !== '' && !selfAccess,
      selfAccess,
      reason,
      action: 'holding',
      timestamp: Date.now(),
      category: agent.category || 'other',
    };
    newAccess.push(event);
    _state.activityLog.push(event);
    if (_state.onActivityPush) _state.onActivityPush(event);
    if (_state.activityLog.length > 10000) {
      const evicted = _state.activityLog.shift();
      if (_state.onActivityEvict) _state.onActivityEvict(evicted);
    }
    _state.recordFileAccess(agent.agent, group, event.sensitive, event.reason);
  }
  return newAccess;
}

/**
 * @param {Array} agents
 * @returns {Promise<Array>}
 * @since v0.1.0
 */
async function scanAllFileHandles(agents) {
  // win32 primary: honest read-detect via Restart Manager (no handle.exe needed).
  // Falls through to the legacy per-PID handle pool on darwin/linux, or on win32
  // when RM is unavailable (the PR-A getFileHandles→[] fallback still applies).
  if (rmEnabled()) return scanViaRestartManager(agents);
  const toScan =
    _state && _state.isOtherPanelExpanded() ? agents : agents.filter((a) => a.category === 'ai');
  // Bounded-concurrency worker pool: at most FILE_SCAN_CONCURRENCY scanFileHandles()
  // run at once (each spawns one powershell/handle.exe). Results are stored by
  // original index, so the returned array stays in agent order — per-event agent
  // attribution (C-01) is stamped inside scanFileHandles and never cross-wired.
  const results = new Array(toScan.length);
  let next = 0;
  async function worker() {
    while (next < toScan.length) {
      const i = next++;
      try {
        results[i] = await scanFileHandles(toScan[i]);
      } catch (_) {
        // One agent's scan throwing (e.g. unguarded recordFileAccess) must not
        // abort the batch — drop just this agent's events and pull the next.
        results[i] = [];
      }
    }
  }
  const poolSize = Math.min(FILE_SCAN_CONCURRENCY, toScan.length);
  await Promise.all(Array.from({ length: poolSize }, worker));
  const allNew = [];
  for (const r of results) allNew.push(...r);
  return allNew;
}

/**
 * @param {Array} activeAgents
 * @returns {void} @since v0.1.0
 */
function pruneKnownHandles(activeAgents) {
  const activePids = new Set(activeAgents.map((a) => a.pid));
  for (const pid of _state.knownHandles.keys()) {
    if (!activePids.has(pid)) _state.knownHandles.delete(pid);
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
  pruneKnownHandles,
  classifySensitive,
  shouldIgnore,
  isSelfAccess,
  handleWatcherEvent,
  getIgnoredDirFilter,
  DEFAULT_IGNORED_DIRS,
  FILE_SCAN_CONCURRENCY,
  _setDepsForTest,
  _resetForTest,
};
