/**
 * @file process-scanner.js
 * @module main/process-scanner
 * @description AI-agent process detection via tasklist and process-set change
 *   detection. Parent-chain and editor annotation are in process-utils.js.
 * @requires fs
 * @requires path
 * @requires child_process
 * @requires ../shared/constants
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.2.0
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { IGNORE_PROCESS_PATTERNS, EDITOR_HOSTS } = require('../shared/constants');

const agentDb = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'shared', 'agent-database.json'), 'utf-8')
);
const AI_AGENTS = agentDb.agents.map(a => ({ name: a.displayName, patterns: a.names }));

/** Set of editor host process names (lowercased) for fast lookup */
const EDITOR_HOST_SET = new Set(EDITOR_HOSTS.map(h => h.toLowerCase()));

let lastProcessPidSet = '';

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
 * Scan running processes via tasklist and match against AI_AGENTS.
 * Editor hosts (VS Code etc.) are skipped themselves, but their child
 * processes are scanned — matched children get parentEditor set.
 * @returns {Promise<{agents: Array, changed: boolean}>}
 * @since v0.2.0
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
        if (IGNORE_PROCESS_PATTERNS.some(p => procName.includes(p))) continue;
        if (EDITOR_HOST_SET.has(procName)) continue;
        for (const agent of AI_AGENTS) {
          if (agent.patterns.some(p => procName === p.toLowerCase())) {
            detected.push({ agent: agent.name, process: match[1], pid, status: 'running', category: 'ai' });
            break;
          }
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

module.exports = {
  AI_AGENTS, agentDb, init, scanProcesses,
  knownHandles, activityLog, monitoringStarted,
  get peakAgents() { return peakAgents; },
  set peakAgents(v) { peakAgents = v; },
  uniqueAgentNames,
};
