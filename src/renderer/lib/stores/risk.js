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
export const enrichedAgents = derived(
  [agents, events, anomalies, network, falsePositives],
  ([$agents, $events, $anomalies, $network, $fp]) => {
    const allEvents = $events.flat();

    return $agents.map((raw) => {
      const name = raw.agent;
      const parentEditor = raw.parentEditor || null;
      const cwd = raw.cwd || null;
      const projectName = raw.projectName || null;
      const iKey = instanceKey(name, parentEditor, cwd);
      const hasCwd = !!cwd;

      let sensitiveFiles = 0;
      let configFiles = 0;
      let sshAwsFiles = 0;
      let fileCount = 0;
      const seen = new Map();

      for (const ev of allEvents) {
        if (!eventMatchesInstance(ev, name, parentEditor, raw.pid, hasCwd)) continue;
        if (ev.selfAccess) continue;
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

      let unknownDomains = 0;
      let networkCount = 0;
      let httpUnencryptedCount = 0;
      let hasApiCalls = false;
      for (const conn of $network) {
        if (!eventMatchesInstance(conn, name, parentEditor, raw.pid, hasCwd)) continue;
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
      const hasFp = $fp.some((fp) => fp.agentName === name);
      if (hasFp) riskScore = Math.max(0, riskScore - 20);
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
  },
);
