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

const { getParentProcessMap } = require('./platform');

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

  const procMap = await getParentProcessMap();
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

/** Map editor host exe names to human-readable labels */
const EDITOR_LABELS = {
  'code.exe': 'VS Code',
  code: 'VS Code',
  'code - insiders.exe': 'VS Code Insiders',
  'idea64.exe': 'IntelliJ IDEA',
  idea: 'IntelliJ IDEA',
  'webstorm64.exe': 'WebStorm',
  webstorm: 'WebStorm',
  'pycharm64.exe': 'PyCharm',
  pycharm: 'PyCharm',
  'goland64.exe': 'GoLand',
  goland: 'GoLand',
  'rider64.exe': 'Rider',
  rider: 'Rider',
  'phpstorm64.exe': 'PhpStorm',
  phpstorm: 'PhpStorm',
  'rubymine64.exe': 'RubyMine',
  rubymine: 'RubyMine',
  'clion64.exe': 'CLion',
  clion: 'CLion',
  'datagrip64.exe': 'DataGrip',
  datagrip: 'DataGrip',
};

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

module.exports = { getParentChains, enrichWithParentChains, annotateHostApps };
