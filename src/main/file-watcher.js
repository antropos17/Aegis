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
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.1.0
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const chokidar = require('chokidar');
const { execFile } = require('child_process');
const {
  SENSITIVE_RULES,
  IGNORE_PATTERNS,
  AGENT_CONFIG_PATHS,
  AGENT_SELF_CONFIG,
} = require('../shared/constants');

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
  for (const rule of SENSITIVE_RULES) {
    if (rule.pattern.test(filePath)) return rule.reason;
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
  return IGNORE_PATTERNS.some((p) => p.test(filePath));
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
  }
  const reason = classifySensitive(filePath);
  const aiAgents = _state.getLatestAiAgents();
  const agent = aiAgents.length > 0 ? aiAgents[0] : agents[0];
  const selfAccess = reason !== null && isSelfAccess(agent.agent, filePath);
  const event = {
    agent: agent.agent,
    pid: agent.pid,
    file: filePath,
    sensitive: reason !== null && !selfAccess,
    selfAccess,
    reason: reason || '',
    action,
    timestamp: now,
    category: agent.category || 'other',
  };
  _state.activityLog.push(event);
  _state.recordFileAccess(event.agent, filePath, event.sensitive, event.reason);
  if (_state.onFileEvent) _state.onFileEvent(event);
}

/** @returns {void} @since v0.1.0 */
function setupFileWatchers() {
  const homeDir = os.homedir();
  const sensitiveDirs = ['.ssh', '.aws', '.gnupg', '.kube', '.docker', '.azure']
    .map((d) => path.join(homeDir, d))
    .filter((d) => fs.existsSync(d));
  const projectDir = path.join(__dirname, '..', '..');
  if (sensitiveDirs.length > 0) {
    const w = chokidar.watch(sensitiveDirs, {
      persistent: true,
      ignoreInitial: true,
      usePolling: false,
    });
    bindWatcherEvents(w);
    _state.watchers.push(w);
  }
  // AI agent config directories (Hudson Rock threat vector — critical)
  const sensitiveDirNames = new Set(['.ssh', '.aws', '.gnupg', '.kube', '.docker', '.azure']);
  const agentConfigDirs = AGENT_CONFIG_PATHS.filter((d) => !sensitiveDirNames.has(d))
    .map((d) => path.join(homeDir, d))
    .filter((d) => fs.existsSync(d));
  if (agentConfigDirs.length > 0) {
    const cw = chokidar.watch(agentConfigDirs, {
      persistent: true,
      ignoreInitial: true,
      usePolling: false,
    });
    bindWatcherEvents(cw);
    _state.watchers.push(cw);
  }
  const pw = chokidar.watch(projectDir, {
    persistent: true,
    ignoreInitial: true,
    ignored: [/(node_modules|\.git|dist|out)[\\\/]/, /package-lock\.json$/],
    usePolling: false,
  });
  bindWatcherEvents(pw);
  _state.watchers.push(pw);
  const ew = chokidar.watch(path.join(homeDir, '.env*'), {
    persistent: true,
    ignoreInitial: true,
    depth: 0,
    usePolling: false,
  });
  bindWatcherEvents(ew);
  _state.watchers.push(ew);
}

/**
 * @param {Object} agent
 * @returns {Promise<Array>}
 * @since v0.1.0
 */
function scanFileHandles(agent) {
  return new Promise((resolve) => {
    const pid = agent.pid;
    const psScript = [
      '$ErrorActionPreference="SilentlyContinue"',
      '$files=[System.Collections.ArrayList]@()',
      '$h=Get-Command handle64.exe -EA SilentlyContinue',
      'if(!$h){$h=Get-Command handle.exe -EA SilentlyContinue}',
      'if($h){',
      `  $out=& $h.Source -p ${pid} -nobanner -accepteula 2>$null`,
      '  foreach($l in $out){',
      '    if($l -match "File\\s+.*?\\s+([A-Z]:\\\\.+)$"){',
      '      [void]$files.Add($Matches[1].Trim())',
      '    }',
      '  }',
      '}else{',
      `  $p=Get-Process -Id ${pid} -EA SilentlyContinue`,
      '  if($p -and $p.Modules){',
      '    foreach($m in $p.Modules){',
      '      if($m.FileName){[void]$files.Add($m.FileName)}',
      '    }',
      '  }',
      '}',
      'if($files.Count -gt 0){$files|ConvertTo-Json -Compress}else{"[]"}',
    ].join('\n');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      { timeout: 15000 },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }
        try {
          const raw = stdout.trim();
          if (!raw || raw === '[]') {
            resolve([]);
            return;
          }
          let files = JSON.parse(raw);
          if (typeof files === 'string') files = [files];
          if (!Array.isArray(files)) {
            resolve([]);
            return;
          }
          const kh = _state.knownHandles;
          if (!kh.has(pid)) kh.set(pid, new Set());
          const known = kh.get(pid);
          const newAccess = [];
          for (const f of files) {
            if (shouldIgnore(f) || known.has(f)) continue;
            known.add(f);
            const reason = classifySensitive(f);
            const selfAccess = reason !== null && isSelfAccess(agent.agent, f);
            const event = {
              agent: agent.agent,
              pid,
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
            _state.recordFileAccess(agent.agent, f, event.sensitive, event.reason);
          }
          resolve(newAccess);
        } catch (_) {
          resolve([]);
        }
      },
    );
  });
}

/**
 * @param {Array} agents
 * @returns {Promise<Array>}
 * @since v0.1.0
 */
async function scanAllFileHandles(agents) {
  const toScan =
    _state && _state.isOtherPanelExpanded() ? agents : agents.filter((a) => a.category === 'ai');
  const allNew = [];
  for (const agent of toScan) {
    const events = await scanFileHandles(agent);
    allNew.push(...events);
  }
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

module.exports = {
  init,
  setupFileWatchers,
  scanAllFileHandles,
  pruneKnownHandles,
  classifySensitive,
  shouldIgnore,
};
