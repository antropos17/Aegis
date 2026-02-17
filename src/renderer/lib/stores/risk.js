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

    return $agents.map(raw => {
      const name = raw.agent;

      // ── Sensitive file count with time decay ──
      let sensitiveFiles = 0;
      let fileCount = 0;
      for (const ev of allEvents) {
        if (ev.agent !== name) continue;
        fileCount++;
        if (ev.sensitive) {
          sensitiveFiles += getTimeDecayWeight(ev.timestamp);
        }
      }

      // ── Flagged (unknown) domains for this agent ──
      let unknownDomains = 0;
      let networkCount = 0;
      for (const conn of $network) {
        if (conn.agent !== name) continue;
        networkCount++;
        if (conn.flagged) unknownDomains++;
      }

      const anomalyScore = $anomalies[name] || 0;
      const riskScore = calculateRiskScore({ sensitiveFiles, unknownDomains, anomalyScore });
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
  }
);
