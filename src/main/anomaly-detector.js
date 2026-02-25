/**
 * @file anomaly-detector.js
 * @module main/anomaly-detector
 * @description Anomaly scoring (0-100) and behavioural deviation detection.
 *   Uses session data and baselines from baselines.js.
 * @requires ./baselines
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.2.0
 */
'use strict';

const bl = require('./baselines');

const deviationWarningsSent = {};

/**
 * Calculate anomaly score (0-100) for an agent based on deviation from baselines.
 * Weighted factors: file volume (30), sensitive spike (25), new sensitive
 * categories (20), new network endpoints (15), unusual timing (10).
 * @param {string} agentName
 * @returns {number} Score 0-100 (0=normal, 100=extreme anomaly)
 * @since v0.2.0
 */
function calculateAnomalyScore(agentName) {
  const sd = bl.getSessionData()[agentName];
  const ab = bl.getBaselines().agents[agentName];
  if (!sd || !ab || ab.sessionCount < 3) return 0;
  const avg = ab.averages;
  let score = 0;

  // File volume deviation (0-30)
  if (avg.filesPerSession > 0) {
    const ratio = sd.files.size / avg.filesPerSession;
    if (ratio > 3) score += Math.min(30, Math.round((ratio - 1) * 5));
  }

  // Sensitive count deviation (0-25)
  if (avg.sensitivePerSession > 0) {
    const ratio = sd.sensitiveCount / avg.sensitivePerSession;
    if (ratio > 3) score += Math.min(25, Math.round((ratio - 1) * 5));
  }

  // New sensitive categories (0-20) — 10 points per new category
  const knownReasons = new Set(avg.knownSensitiveReasons || []);
  const newReasons = [...sd.sensitiveReasons].filter((r) => !knownReasons.has(r));
  score += Math.min(20, newReasons.length * 10);

  // New network endpoints not seen in last 5 sessions (0-15)
  const recentEndpoints = new Set();
  const recentSessions = ab.sessions.slice(-5);
  for (const sess of recentSessions)
    for (const ep of sess.networkEndpoints) recentEndpoints.add(ep);
  const newEndpoints = [...sd.endpoints].filter((ep) => !recentEndpoints.has(ep));
  score += Math.min(15, newEndpoints.length * 5);

  // Unusual timing (0-10) — activity at hour never seen before
  const hourHist = avg.hourHistogram || new Array(24).fill(0);
  for (const h of sd.activeHours) {
    if (hourHist[h] === 0) {
      score += 10;
      break;
    }
  }

  return Math.min(100, score);
}

/**
 * Check for behavioural deviations and return warnings.
 * @returns {Array<{agent:string, type:string, message:string, anomalyScore:number}>}
 * @since v0.1.0
 */
function checkDeviations() {
  const warnings = [];
  for (const [agentName, sd] of Object.entries(bl.getSessionData())) {
    const ab = bl.getBaselines().agents[agentName];
    if (!ab || ab.sessionCount < 3) continue;
    if (!deviationWarningsSent[agentName]) deviationWarningsSent[agentName] = new Set();
    const sent = deviationWarningsSent[agentName];
    const avg = ab.averages;
    const anomalyScore = calculateAnomalyScore(agentName);

    // File volume 3x above average
    if (avg.filesPerSession > 0 && sd.files.size > avg.filesPerSession * 3) {
      const key = 'files-3x';
      if (!sent.has(key)) {
        sent.add(key);
        warnings.push({
          agent: agentName,
          type: 'files',
          message: `${agentName} normally accesses ~${Math.round(avg.filesPerSession)} files, now ${sd.files.size}`,
          anomalyScore,
        });
      }
    }

    // Sensitive file access 3x above average
    if (avg.sensitivePerSession > 0 && sd.sensitiveCount > avg.sensitivePerSession * 3) {
      const key = 'sensitive-3x';
      if (!sent.has(key)) {
        sent.add(key);
        warnings.push({
          agent: agentName,
          type: 'sensitive',
          message: `${agentName}: sensitive file access (${sd.sensitiveCount}) is ${Math.round(sd.sensitiveCount / avg.sensitivePerSession)}x above average (${Math.round(avg.sensitivePerSession)})`,
          anomalyScore,
        });
      }
    }

    // New sensitive category never seen before
    const knownReasons = new Set(avg.knownSensitiveReasons || []);
    for (const reason of sd.sensitiveReasons) {
      if (!knownReasons.has(reason)) {
        const key = `new-sens:${reason}`;
        if (!sent.has(key)) {
          sent.add(key);
          warnings.push({
            agent: agentName,
            type: 'new-sensitive',
            message: `${agentName} never accessed "${reason}" before`,
            anomalyScore,
          });
        }
      }
    }

    // New network endpoint not seen in last 5 sessions
    const recentEndpoints = new Set();
    const recentSessions = ab.sessions.slice(-5);
    for (const sess of recentSessions)
      for (const ep of sess.networkEndpoints) recentEndpoints.add(ep);
    for (const ep of sd.endpoints) {
      if (!recentEndpoints.has(ep)) {
        const key = `new-ep:${ep}`;
        if (!sent.has(key)) {
          sent.add(key);
          warnings.push({
            agent: agentName,
            type: 'network',
            message: `${agentName}: connecting to new endpoint ${ep}`,
            anomalyScore,
          });
        }
      }
    }

    // Accessing 4+ new directories
    const typicalDirs = new Set(avg.typicalDirectories);
    const newDirs = [...sd.directories].filter((d) => !typicalDirs.has(d));
    if (newDirs.length >= 4) {
      const key = 'new-dirs-4+';
      if (!sent.has(key)) {
        sent.add(key);
        warnings.push({
          agent: agentName,
          type: 'directories',
          message: `${agentName}: accessing ${newDirs.length} new directories not seen in previous sessions`,
          anomalyScore,
        });
      }
    }

    // Activity at unusual hour
    const hourHist = avg.hourHistogram || new Array(24).fill(0);
    for (const h of sd.activeHours) {
      if (hourHist[h] === 0) {
        const key = `unusual-hour:${h}`;
        if (!sent.has(key)) {
          sent.add(key);
          warnings.push({
            agent: agentName,
            type: 'timing',
            message: `${agentName}: activity at unusual hour (${String(h).padStart(2, '0')}:00) — not seen in previous sessions`,
            anomalyScore,
          });
        }
        break;
      }
    }
  }
  return warnings;
}

module.exports = { calculateAnomalyScore, checkDeviations };
