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
let _getProcessCwds = _platform.getProcessCwds;
/** @internal Override platform functions (for tests). */
function _setPlatformForTest(overrides) {
  if (overrides.getParentProcessMap) _getParentProcessMap = overrides.getParentProcessMap;
  if (overrides.getProcessCwds) _getProcessCwds = overrides.getProcessCwds;
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
    // Capture the OS process birth time (epoch-ms) for the agent's OWN pid from
    // the same map fetch — zero extra spawn. Only win32 supplies it; darwin/linux
    // map entries omit startTime, so the typeof guard yields null (honest).
    // KNOWN BOUND: the 60s cache TTL means a pid REUSED within 60s serves the
    // prior process's startTime. Mostly fail-safe (stale time won't match a new
    // session's startedAt → the token-feed guard rejects it) and strictly better
    // than no startTime (on which the Windows guard never passes).
    const ownInfo = procMap.get(pid);
    const startTime = ownInfo && typeof ownInfo.startTime === 'number' ? ownInfo.startTime : null;
    parentChainCache.set(pid, { chain, startTime, timestamp: now });
    result.set(pid, chain);
  }

  return result;
}

/**
 * Attach parent-chain arrays AND the OS process start-time to each agent object.
 * `startTime` (epoch-ms, OS birth time) is distinct from `firstSeen`
 * (AEGIS-observed) and is read from the same cache `getParentChains` populates —
 * after the call every requested pid has an entry, so the read is safe. Used by
 * the token-feed PID-reuse guard; null on non-Windows or absent pid.
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
    const entry = parentChainCache.get(a.pid);
    a.startTime = entry && typeof entry.startTime === 'number' ? entry.startTime : null;
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
 * Uses batched platform call (single PowerShell spawn on Windows).
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

  // Separate cached vs uncached PIDs
  const uncachedPids = [];
  for (const a of agents) {
    const cached = cwdCache.get(a.pid);
    if (!cached || now - cached.timestamp > CWD_CACHE_TTL) {
      uncachedPids.push(a.pid);
    }
  }

  // Single batched call for all uncached PIDs
  if (uncachedPids.length > 0) {
    const batchResults = await _getProcessCwds(uncachedPids);
    for (const pid of uncachedPids) {
      const cwd = batchResults.get(pid) || null;
      cwdCache.set(pid, { cwd, timestamp: now });
    }
  }

  for (const a of agents) {
    const cached = cwdCache.get(a.pid);
    const cwd = cached ? cached.cwd : null;
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
