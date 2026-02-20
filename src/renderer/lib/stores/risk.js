/**
 * @file risk.js — Derived store: agents enriched with risk scores + trust grades
 * @module renderer/stores/risk
 * @since 0.2.0
 */

import { derived } from 'svelte/store';
import { agents, events, anomalies, network } from './ipc.js';
import { calculateRiskScore, getTrustGrade, getTimeDecayWeight } from '../utils/risk-scoring.js';

/**
 * Enriched agents store — derives from agents, events, anomalies, network.
 * Each agent object gets: name, sensitiveFiles, unknownDomains, anomalyScore,
 * riskScore, trustGrade, fileCount, networkCount.
 */
export const enrichedAgents = derived(
  [agents, events, anomalies, network],
  ([$agents, $events, $anomalies, $network]) => {
    // Flatten event batches (events store holds arrays of arrays)
    const allEvents = $events.flat();

    return $agents.map((raw) => {
      const name = raw.agent;

      // ── Event counting: self-access exemption + 30s dedup ──
      let sensitiveFiles = 0;
      let configFiles = 0;
      let sshAwsFiles = 0;
      let fileCount = 0;
      const seen = new Map(); // file → last timestamp (dedup)

      for (const ev of allEvents) {
        if (ev.agent !== name) continue;
        if (ev.selfAccess) continue;
        // Dedup: same file within 30s counts once
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

      // ── Network counts ──
      let unknownDomains = 0;
      let networkCount = 0;
      for (const conn of $network) {
        if (conn.agent !== name) continue;
        networkCount++;
        if (conn.flagged) unknownDomains++;
      }

      const anomalyScore = $anomalies[name] || 0;
      const riskScore = calculateRiskScore({
        sensitiveFiles,
        configFiles,
        sshAwsFiles,
        networkCount,
        unknownDomains,
        fileCount,
      });
      const trustGrade = getTrustGrade(riskScore);

      return {
        ...raw,
        name,
        sensitiveFiles,
        unknownDomains,
        anomalyScore,
        riskScore,
        trustGrade,
        fileCount,
        networkCount,
      };
    });
  },
);
