/**
 * @file anomaly-detector.js
 * @module main/anomaly-detector
 * @description Multi-dimensional anomaly scoring (0-100) and behavioural deviation
 *   detection. Uses session data and baselines from baselines.js, with 4-dimensional
 *   breakdown (network, filesystem, process, baseline).
 * @requires ./baselines
 * @requires ./scoring-utils
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.3.0
 */
'use strict';

const bl = require('./baselines');
const { scoreNetwork, scoreFilesystem, scoreProcess, scoreBaseline } = require('./scoring-utils');

const deviationWarningsSent = {};

/** @type {{network: number, filesystem: number, process: number, baseline: number}} */
const WEIGHTS = { network: 0.3, filesystem: 0.25, process: 0.25, baseline: 0.2 };

/**
 * @typedef {Object} DimensionScore
 * @property {number} score - 0-100 score for this dimension
 * @property {number} weight - Weight used in composite calculation
 * @property {string[]} factors - Human-readable descriptions of contributing factors
 */

/**
 * @typedef {Object} AnomalyResult
 * @property {number} score - Composite anomaly score 0-100
 * @property {Object} dimensions - Per-dimension breakdown
 * @property {DimensionScore} dimensions.network
 * @property {DimensionScore} dimensions.filesystem
 * @property {DimensionScore} dimensions.process
 * @property {DimensionScore} dimensions.baseline
 */

/**
 * Calculate multi-dimensional anomaly score for an agent.
 * Returns composite 0-100 plus per-dimension breakdown.
 * composite = sum(dimension.score * dimension.weight)
 * @param {string} agentName
 * @returns {AnomalyResult}
 * @since v0.3.0
 */
function calculateAnomalyScore(agentName) {
  const zeroDim = (w) => ({ score: 0, weight: w, factors: [] });
  const zeroDims = {
    network: zeroDim(WEIGHTS.network),
    filesystem: zeroDim(WEIGHTS.filesystem),
    process: zeroDim(WEIGHTS.process),
    baseline: zeroDim(WEIGHTS.baseline),
  };

  const sd = bl.getSessionData()[agentName];
  const ab = bl.getBaselines().agents[agentName];
  if (!sd || !ab || ab.sessionCount < 3) return { score: 0, dimensions: zeroDims };

  const net = scoreNetwork(sd, ab);
  const fs = scoreFilesystem(sd, ab);
  const proc = scoreProcess(sd, ab);
  const base = scoreBaseline(sd, ab);

  const dimensions = {
    network: { ...net, weight: WEIGHTS.network },
    filesystem: { ...fs, weight: WEIGHTS.filesystem },
    process: { ...proc, weight: WEIGHTS.process },
    baseline: { ...base, weight: WEIGHTS.baseline },
  };

  const composite = Math.min(
    100,
    Math.round(
      net.score * WEIGHTS.network +
        fs.score * WEIGHTS.filesystem +
        proc.score * WEIGHTS.process +
        base.score * WEIGHTS.baseline,
    ),
  );

  return { score: composite, dimensions };
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
    const { score: anomalyScore } = calculateAnomalyScore(agentName);

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
