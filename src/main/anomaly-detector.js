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
 * Calculate multi-dimensional anomaly score for ONE process instance.
 * Returns composite 0-100 plus per-dimension breakdown.
 * composite = sum(dimension.score * dimension.weight)
 *
 * Two keys meet here, and neither substitutes for the other: the live session
 * bucket is looked up by `instanceId` (two same-named instances score separately),
 * and the profile it is compared against is looked up by the NAME the bucket
 * carries (a cross-session baseline cannot key on a per-boot value). An instance
 * with no bucket scores 0 — never a namesake's bucket.
 * @param {string} instanceId - the agent's own `instanceId`, read never derived.
 * @returns {AnomalyResult}
 * @since v0.3.0
 */
function calculateAnomalyScore(instanceId) {
  const zeroDim = (w) => ({ score: 0, weight: w, factors: [] });
  const zeroDims = {
    network: zeroDim(WEIGHTS.network),
    filesystem: zeroDim(WEIGHTS.filesystem),
    process: zeroDim(WEIGHTS.process),
    baseline: zeroDim(WEIGHTS.baseline),
  };

  const sd = bl.getSessionData()[instanceId];
  const ab = sd ? bl.getBaselines().agents[sd.agentName] : undefined;
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
 *
 * Iterates the live buckets, which are per INSTANCE — so two same-named instances
 * are checked separately and each gets its own "already warned" set. Every warning
 * still reports the display NAME (that is what the audit log, the toast and the
 * renderer read), and carries the instance key beside it.
 * @returns {Array<{agent:string, instanceId:string, type:string, message:string, anomalyScore:number}>}
 * @since v0.1.0
 */
function checkDeviations() {
  const warnings = [];
  for (const [instanceId, sd] of Object.entries(bl.getSessionData())) {
    const agentName = sd.agentName;
    const ab = agentName ? bl.getBaselines().agents[agentName] : undefined;
    if (!ab || ab.sessionCount < 3) continue;
    // Per instance, not per name: a restarted instance carries a new key and is
    // entitled to its own warnings, and one instance's alert must not silence
    // another's.
    if (!deviationWarningsSent[instanceId]) deviationWarningsSent[instanceId] = new Set();
    const sent = deviationWarningsSent[instanceId];
    const avg = ab.averages;
    const { score: anomalyScore } = calculateAnomalyScore(instanceId);

    // File volume 3x above average
    if (avg.filesPerSession > 0 && sd.files.size > avg.filesPerSession * 3) {
      const key = 'files-3x';
      if (!sent.has(key)) {
        sent.add(key);
        warnings.push({
          agent: agentName,
          instanceId,
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
          instanceId,
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
            instanceId,
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
            instanceId,
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
          instanceId,
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
            instanceId,
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
