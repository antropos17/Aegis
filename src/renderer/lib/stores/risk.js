/**
 * @file risk.js — Derived store: agents enriched with risk scores + trust grades
 * @module renderer/stores/risk
 * @since 0.2.0
 */

import { derived } from 'svelte/store';
import { agents, events, anomalies, network, falsePositives } from './ipc.js';
import { calculateRiskScore, getTrustGrade, getTimeDecayWeight } from '../utils/risk-scoring.js';

/** Known API domain patterns for API-call indicator */
const API_DOMAIN_PATTERNS = [
  /^api\./i,
  /api\.openai\.com$/i,
  /api\.anthropic\.com$/i,
  /api\.github\.com$/i,
  /api\.groq\.com$/i,
  /api\.cohere\.ai$/i,
  /api\.mistral\.ai$/i,
  /generativelanguage\.googleapis\.com$/i,
  /api\.together\.xyz$/i,
  /api\.replicate\.com$/i,
];

/**
 * Check if a domain is a known API endpoint.
 * @param {string} domain
 * @returns {boolean}
 */
function isApiDomain(domain) {
  return API_DOMAIN_PATTERNS.some((p) => p.test(domain));
}

/**
 * Build an instance key for matching events/connections to a specific agent instance.
 * CWD takes priority as the most specific identifier.
 * @param {string} name - Agent name
 * @param {string|null} parentEditor - Parent editor name or null
 * @param {string|null} cwd - Working directory or null
 * @returns {string}
 */
function instanceKey(name, parentEditor, cwd) {
  if (cwd) return `${name}::${cwd}`;
  if (parentEditor) return `${name}::${parentEditor}`;
  return name;
}

/**
 * Check if an event matches a specific agent instance.
 * When the agent has a cwd, match by PID (most precise — each instance has a unique PID).
 * Otherwise fall back to name + parentEditor matching.
 */
function eventMatchesInstance(ev, name, parentEditor, pid, hasCwd) {
  if (hasCwd && pid) return ev.pid === pid;
  if (ev.agent !== name) return false;
  if (parentEditor) return ev.parentEditor === parentEditor;
  return true;
}

/**
 * Enriched agents store — derives from agents, events, anomalies, network.
 * Each agent object gets: name, instanceKey, sensitiveFiles, unknownDomains,
 * anomalyScore, riskScore, trustGrade, fileCount, networkCount.
 * Risk is calculated per-instance (using cwd/parentEditor), not per-name.
 */
/** @type {unknown} */ let _prevAgents = null;
/** @type {unknown} */ let _prevEvents = null;
/** @type {unknown} */ let _prevAnomalies = null;
/** @type {unknown} */ let _prevNetwork = null;
/** @type {unknown} */ let _prevFp = null;
/** @type {Array<Object>} */ let _cachedResult = [];

export const enrichedAgents = derived(
  [agents, events, anomalies, network, falsePositives],
  ([$agents, $events, $anomalies, $network, $fp]) => {
    // Reference equality cache — skip recompute if all inputs unchanged
    if (
      $agents === _prevAgents &&
      $events === _prevEvents &&
      $anomalies === _prevAnomalies &&
      $network === _prevNetwork &&
      $fp === _prevFp
    ) {
      return _cachedResult;
    }
    _prevAgents = $agents;
    _prevEvents = $events;
    _prevAnomalies = $anomalies;
    _prevNetwork = $network;
    _prevFp = $fp;

    const allEvents = $events.flat();

    // Pre-build lookup maps for O(1) event matching
    /** @type {Map<number, Array<Object>>} */
    const eventsByPid = new Map();
    /** @type {Map<string, Array<Object>>} */
    const eventsByName = new Map();
    for (const ev of allEvents) {
      if (ev.selfAccess) continue;
      if (ev.pid) {
        let arr = eventsByPid.get(ev.pid);
        if (!arr) {
          arr = [];
          eventsByPid.set(ev.pid, arr);
        }
        arr.push(ev);
      }
      if (ev.agent) {
        let arr = eventsByName.get(ev.agent);
        if (!arr) {
          arr = [];
          eventsByName.set(ev.agent, arr);
        }
        arr.push(ev);
      }
    }

    /** @type {Map<number, Array<Object>>} */
    const connsByPid = new Map();
    /** @type {Map<string, Array<Object>>} */
    const connsByName = new Map();
    for (const conn of $network) {
      if (conn.pid) {
        let arr = connsByPid.get(conn.pid);
        if (!arr) {
          arr = [];
          connsByPid.set(conn.pid, arr);
        }
        arr.push(conn);
      }
      if (conn.agent) {
        let arr = connsByName.get(conn.agent);
        if (!arr) {
          arr = [];
          connsByName.set(conn.agent, arr);
        }
        arr.push(conn);
      }
    }

    // Pre-build false-positive name set
    const fpNames = new Set($fp.map((fp) => fp.agentName));

    _cachedResult = $agents.map((raw) => {
      const name = raw.agent;
      const parentEditor = raw.parentEditor || null;
      const cwd = raw.cwd || null;
      const projectName = raw.projectName || null;
      const iKey = instanceKey(name, parentEditor, cwd);
      const hasCwd = !!cwd;

      // Use pre-built lookup instead of scanning all events
      const candidateEvents =
        hasCwd && raw.pid ? eventsByPid.get(raw.pid) || [] : eventsByName.get(name) || [];

      let sensitiveFiles = 0;
      let configFiles = 0;
      let sshAwsFiles = 0;
      let fileCount = 0;
      const seen = new Map();

      for (const ev of candidateEvents) {
        if (ev.selfAccess) continue;
        // For name-based matches, verify parentEditor
        if (!hasCwd || !raw.pid) {
          if (parentEditor && ev.parentEditor !== parentEditor) continue;
        }
        if (ev.file) {
          const prev = seen.get(ev.file);
          if (prev && ev.timestamp - prev < 30000) continue;
          seen.set(ev.file, ev.timestamp);
        }
        const w = getTimeDecayWeight(ev.timestamp);
        fileCount += w;
        if (ev.sensitive) sensitiveFiles += w;
        if (ev.reason?.startsWith('AI agent config')) configFiles += w;
        if (/SSH|AWS/i.test(ev.reason)) sshAwsFiles += w;
      }

      // Use pre-built lookup for network connections
      const candidateConns =
        hasCwd && raw.pid ? connsByPid.get(raw.pid) || [] : connsByName.get(name) || [];

      let unknownDomains = 0;
      let networkCount = 0;
      let httpUnencryptedCount = 0;
      let hasApiCalls = false;
      for (const conn of candidateConns) {
        if (!hasCwd || !raw.pid) {
          if (parentEditor && conn.parentEditor !== parentEditor) continue;
        }
        networkCount++;
        if (conn.flagged) unknownDomains++;
        if (conn.httpUnencrypted) httpUnencryptedCount++;
        if (conn.domain && isApiDomain(conn.domain)) hasApiCalls = true;
      }

      const anomalyScore = $anomalies[name] || 0;
      let riskScore = calculateRiskScore({
        sensitiveFiles,
        configFiles,
        sshAwsFiles,
        networkCount,
        unknownDomains,
        fileCount,
        httpUnencryptedCount,
      });
      if (fpNames.has(name)) riskScore = Math.max(0, riskScore - 20);
      const trustGrade = getTrustGrade(riskScore);

      return {
        ...raw,
        name,
        parentEditor,
        cwd,
        projectName,
        instanceKey: iKey,
        sensitiveFiles,
        unknownDomains,
        anomalyScore,
        riskScore,
        trustGrade,
        fileCount,
        networkCount,
        hasApiCalls,
      };
    });
    return _cachedResult;
  },
);
