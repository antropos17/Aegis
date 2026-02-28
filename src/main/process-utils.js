/**
 * @file process-utils.js
 * @module main/process-utils
 * @description Parent-chain resolution via PowerShell and editor host app
 *   annotation for detected AI agent processes.
 * @requires child_process
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.2.0
 */
'use strict';

const path = require('path');
const _platform = require('./platform');
const { EDITORS } = require('../shared/constants');

let _getParentProcessMap = _platform.getParentProcessMap;
let _getProcessCwd = _platform.getProcessCwd;
/** @internal Override platform functions (for tests). */
function _setPlatformForTest(overrides) {
  if (overrides.getParentProcessMap) _getParentProcessMap = overrides.getParentProcessMap;
  if (overrides.getProcessCwd) _getProcessCwd = overrides.getProcessCwd;
}
/** @internal Clear caches (for tests). */
function _resetForTest() {
  parentChainCache.clear();
  cwdCache.clear();
}

const parentChainCache = new Map();
const PARENT_CHAIN_TTL = 60000;

/**
 * Resolve parent process chains for a list of PIDs via platform adapter.
 * @param {number[]} pids
 * @returns {Promise<Map<number, string[]>>} pid to parent-name chain
 * @since v0.1.0
 */
async function getParentChains(pids) {
  if (pids.length === 0) return new Map();

  const now = Date.now();
  // Prune stale entries when cache grows too large
  if (parentChainCache.size > 500) {
    for (const [key, entry] of parentChainCache) {
      if (now - entry.timestamp > PARENT_CHAIN_TTL) parentChainCache.delete(key);
    }
  }
  const needLookup = pids.filter((pid) => {
    const cached = parentChainCache.get(pid);
    return !cached || now - cached.timestamp > PARENT_CHAIN_TTL;
  });

  if (needLookup.length === 0) {
    const result = new Map();
    for (const pid of pids) {
      const cached = parentChainCache.get(pid);
      if (cached) result.set(pid, cached.chain);
    }
    return result;
  }

  const procMap = await _getParentProcessMap();
  const result = new Map();

  // Populate cached entries first
  for (const pid of pids) {
    const cached = parentChainCache.get(pid);
    if (cached && now - cached.timestamp <= PARENT_CHAIN_TTL) {
      result.set(pid, cached.chain);
    }
  }

  // Walk parent chains in JS for uncached PIDs
  for (const pid of needLookup) {
    const chain = [];
    let cur = pid;
    const seen = new Set();
    for (let i = 0; i < 6; i++) {
      const info = procMap.get(cur);
      if (!info) break;
      const pp = info.ppid;
      if (pp <= 0 || pp === cur || seen.has(pp)) break;
      seen.add(pp);
      const parentInfo = procMap.get(pp);
      if (parentInfo) {
        chain.push(parentInfo.name);
      } else {
        break;
      }
      cur = pp;
    }
    parentChainCache.set(pid, { chain, timestamp: now });
    result.set(pid, chain);
  }

  return result;
}

/**
 * Attach parent-chain arrays to each agent object.
 * @param {Array} agents
 * @returns {Promise<void>}
 * @since v0.1.0
 */
async function enrichWithParentChains(agents) {
  if (agents.length === 0) return;
  const pids = agents.map((a) => a.pid);
  const chains = await getParentChains(pids);
  for (const a of agents) {
    a.parentChain = chains.get(a.pid) || [];
  }
}

/** Map editor host exe names (lowercase) to human-readable labels, derived from EDITORS */
const EDITOR_LABELS = Object.fromEntries(
  EDITORS.flatMap((e) => e.names.map((n) => [n.toLowerCase(), e.label])),
);

/**
 * Annotate agents whose parentChain includes an editor host.
 * Sets displayLabel = "AgentName (via EditorName)" and parentEditor field.
 * @param {Array} agents
 * @returns {void}
 * @since v0.2.0
 */
function annotateHostApps(agents) {
  for (const a of agents) {
    if (!a.parentChain || a.parentChain.length === 0) continue;
    for (const p of a.parentChain) {
      const label = EDITOR_LABELS[p.toLowerCase()];
      if (label) {
        a.parentEditor = label;
        a.displayLabel = `${a.agent} (via ${label})`;
        break;
      }
    }
  }
}

const cwdCache = new Map();
const CWD_CACHE_TTL = 60000;

/**
 * Annotate agents with their working directories.
 * Sets `agent.cwd` (full path) and `agent.projectName` (basename).
 * @param {Array} agents
 * @returns {Promise<void>}
 * @since v0.5.0
 */
async function annotateWorkingDirs(agents) {
  if (agents.length === 0) return;

  const now = Date.now();
  // Prune stale entries
  if (cwdCache.size > 500) {
    for (const [key, entry] of cwdCache) {
      if (now - entry.timestamp > CWD_CACHE_TTL) cwdCache.delete(key);
    }
  }

  const results = await Promise.all(
    agents.map(async (a) => {
      const cached = cwdCache.get(a.pid);
      if (cached && now - cached.timestamp <= CWD_CACHE_TTL) {
        return { pid: a.pid, cwd: cached.cwd };
      }
      const cwd = await _getProcessCwd(a.pid);
      cwdCache.set(a.pid, { cwd, timestamp: now });
      return { pid: a.pid, cwd };
    }),
  );

  const cwdMap = new Map(results.map((r) => [r.pid, r.cwd]));
  for (const a of agents) {
    const cwd = cwdMap.get(a.pid) || null;
    a.cwd = cwd;
    a.projectName = cwd ? path.basename(cwd) : null;
  }
}

module.exports = {
  getParentChains,
  enrichWithParentChains,
  annotateHostApps,
  annotateWorkingDirs,
  _setPlatformForTest,
  _resetForTest,
};
