/**
 * @file process-scanner.js
 * @module main/process-scanner
 * @description AI-agent process detection via tasklist, parent-chain
 *   resolution via PowerShell, and process-set change detection.
 * @requires fs
 * @requires path
 * @requires child_process
 * @requires ../shared/constants
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.1.0
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { IGNORE_PROCESS_PATTERNS } = require('../shared/constants');

const agentDb = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'shared', 'agent-database.json'), 'utf-8')
);
const AI_AGENTS = agentDb.agents.map(a => ({ name: a.displayName, patterns: a.names }));

let lastProcessPidSet = '';
const parentChainCache = new Map();
const PARENT_CHAIN_TTL = 60000;

const knownHandles = new Map();
const activityLog = [];
const monitoringStarted = Date.now();
let peakAgents = 0;
const uniqueAgentNames = new Set();

let _trackSeenAgent = null;

/**
 * Initialise with external dependencies.
 * @param {{ trackSeenAgent: Function }} deps
 * @returns {void}
 * @since v0.1.0
 */
function init(deps) {
  _trackSeenAgent = deps.trackSeenAgent;
}

/**
 * Resolve parent process chains for a list of PIDs via a single PowerShell call.
 * @param {number[]} pids
 * @returns {Promise<Map<number, string[]>>} pid to parent-name chain
 * @since v0.1.0
 */
function getParentChains(pids) {
  return new Promise((resolve) => {
    if (pids.length === 0) { resolve(new Map()); return; }
    const now = Date.now();
    const needLookup = pids.filter(pid => {
      const cached = parentChainCache.get(pid);
      return !cached || now - cached.timestamp > PARENT_CHAIN_TTL;
    });
    if (needLookup.length === 0) {
      const result = new Map();
      for (const pid of pids) {
        const cached = parentChainCache.get(pid);
        if (cached) result.set(pid, cached.chain);
      }
      resolve(result);
      return;
    }
    const psScript = [
      '$ErrorActionPreference="SilentlyContinue"',
      '$procs=@{}',
      'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name|ForEach-Object{$procs[[int]$_.ProcessId]=@{n=$_.Name;p=[int]$_.ParentProcessId}}',
      '$r=@{}',
      `$pids=@(${needLookup.join(',')})`,
      'foreach($pid in $pids){',
      '  $chain=@()',
      '  $cur=$pid',
      '  $seen=@{}',
      '  for($i=0;$i -lt 6;$i++){',
      '    if(-not $procs.ContainsKey($cur)){break}',
      '    $pp=$procs[$cur].p',
      '    if($pp -le 0 -or $pp -eq $cur -or $seen.ContainsKey($pp)){break}',
      '    $seen[$pp]=$true',
      '    if($procs.ContainsKey($pp)){$chain+=$procs[$pp].n}else{break}',
      '    $cur=$pp',
      '  }',
      '  $r["$pid"]=$chain',
      '}',
      '$r|ConvertTo-Json -Compress',
    ].join('\n');
    execFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', psScript,
    ], { timeout: 8000 }, (err, stdout) => {
      const result = new Map();
      for (const pid of pids) {
        const cached = parentChainCache.get(pid);
        if (cached) result.set(pid, cached.chain);
      }
      if (!err && stdout.trim()) {
        try {
          const parsed = JSON.parse(stdout.trim());
          for (const pid of needLookup) {
            let chain = parsed[String(pid)];
            if (typeof chain === 'string') chain = [chain];
            if (!Array.isArray(chain)) chain = [];
            parentChainCache.set(pid, { chain, timestamp: now });
            result.set(pid, chain);
          }
        } catch (_) {}
      }
      resolve(result);
    });
  });
}

/**
 * Scan running processes via tasklist and match against AI_AGENTS.
 * @returns {Promise<{agents: Array, changed: boolean}>}
 * @since v0.1.0
 */
function scanProcesses() {
  return new Promise((resolve, reject) => {
    execFile('tasklist', ['/FO', 'CSV', '/NH'], (err, stdout) => {
      if (err) { reject(err); return; }
      const detected = [];
      const lines = stdout.trim().split('\n');
      for (const line of lines) {
        const match = line.match(/"([^"]+)","(\d+)"/);
        if (!match) continue;
        const procName = match[1].toLowerCase();
        const pid = parseInt(match[2], 10);
        let matched = false;
        for (const agent of AI_AGENTS) {
          if (agent.patterns.some(p => procName.includes(p))) {
            detected.push({ agent: agent.name, process: match[1], pid, status: 'running', category: 'ai' });
            matched = true;
            break;
          }
        }
        if (!matched && IGNORE_PROCESS_PATTERNS.some(p => procName.includes(p))) {
          continue;
        }
      }
      const seen = new Set();
      const unique = detected.filter(d => {
        if (seen.has(d.pid)) return false;
        seen.add(d.pid);
        return true;
      });
      if (unique.length > peakAgents) peakAgents = unique.length;
      unique.forEach(a => {
        uniqueAgentNames.add(a.agent);
        if (_trackSeenAgent) _trackSeenAgent(a.agent);
      });
      const pidSetKey = unique.map(u => u.pid).sort().join(',');
      const changed = pidSetKey !== lastProcessPidSet;
      lastProcessPidSet = pidSetKey;
      resolve({ agents: unique, changed });
    });
  });
}

/**
 * Attach parent-chain arrays to each agent object.
 * @param {Array} agents
 * @returns {Promise<void>}
 * @since v0.1.0
 */
async function enrichWithParentChains(agents) {
  if (agents.length === 0) return;
  const pids = agents.map(a => a.pid);
  const chains = await getParentChains(pids);
  for (const a of agents) {
    a.parentChain = chains.get(a.pid) || [];
  }
}

module.exports = {
  AI_AGENTS,
  agentDb,
  init,
  scanProcesses,
  getParentChains,
  enrichWithParentChains,
  knownHandles,
  activityLog,
  monitoringStarted,
  get peakAgents() { return peakAgents; },
  set peakAgents(v) { peakAgents = v; },
  uniqueAgentNames,
};
