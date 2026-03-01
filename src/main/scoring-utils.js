/**
 * @file scoring-utils.js
 * @module main/scoring-utils
 * @description Dimension-based anomaly scoring utilities. Each scorer
 *   evaluates a single dimension (0-100) with human-readable factors.
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.3.0
 */
'use strict';

/**
 * @typedef {Object} DimensionResult
 * @property {number} score - 0-100 score for this dimension
 * @property {string[]} factors - Human-readable descriptions of what triggered the score
 */

/**
 * Score network dimension: new endpoints not seen in recent sessions.
 * Each new endpoint adds 33 points (max 100).
 * @param {Object} sd - Session data for the agent
 * @param {Object} ab - Agent baseline data
 * @returns {DimensionResult}
 * @since v0.3.0
 */
function scoreNetwork(sd, ab) {
  const factors = [];
  const recentEndpoints = new Set();
  const recentSessions = ab.sessions.slice(-5);
  for (const sess of recentSessions)
    for (const ep of sess.networkEndpoints) recentEndpoints.add(ep);
  const newEndpoints = [...sd.endpoints].filter((ep) => !recentEndpoints.has(ep));
  for (const ep of newEndpoints) factors.push(`new endpoint ${ep}`);
  return { score: Math.min(100, newEndpoints.length * 33), factors };
}

/**
 * Score filesystem dimension: file volume + sensitive file spikes.
 * File volume and sensitive count each contribute up to 50 points.
 * @param {Object} sd - Session data for the agent
 * @param {Object} ab - Agent baseline data
 * @returns {DimensionResult}
 * @since v0.3.0
 */
function scoreFilesystem(sd, ab) {
  const factors = [];
  const avg = ab.averages;
  let fileVol = 0;
  if (avg.filesPerSession > 0) {
    const ratio = sd.files.size / avg.filesPerSession;
    if (ratio > 3) {
      fileVol = Math.min(50, Math.round((ratio - 1) * 8));
      factors.push(
        `file volume ${ratio.toFixed(1)}x above average (${sd.files.size} vs ~${Math.round(avg.filesPerSession)})`,
      );
    }
  }
  let sensVol = 0;
  if (avg.sensitivePerSession > 0) {
    const ratio = sd.sensitiveCount / avg.sensitivePerSession;
    if (ratio > 3) {
      sensVol = Math.min(50, Math.round((ratio - 1) * 8));
      factors.push(
        `sensitive access ${ratio.toFixed(1)}x above average (${sd.sensitiveCount} vs ~${Math.round(avg.sensitivePerSession)})`,
      );
    }
  }
  return { score: Math.min(100, fileVol + sensVol), factors };
}

/**
 * Score process dimension: new sensitive categories + new directories.
 * Categories contribute up to 60 points (20 each), directories up to 40.
 * @param {Object} sd - Session data for the agent
 * @param {Object} ab - Agent baseline data
 * @returns {DimensionResult}
 * @since v0.3.0
 */
function scoreProcess(sd, ab) {
  const factors = [];
  const avg = ab.averages;
  const knownReasons = new Set(avg.knownSensitiveReasons || []);
  const newReasons = [...sd.sensitiveReasons].filter((r) => !knownReasons.has(r));
  const catScore = Math.min(60, newReasons.length * 20);
  for (const r of newReasons) factors.push(`new sensitive category: ${r}`);
  const typicalDirs = new Set(avg.typicalDirectories || []);
  const newDirs = [...(sd.directories || new Set())].filter((d) => !typicalDirs.has(d));
  let dirScore = 0;
  if (newDirs.length >= 4) {
    dirScore = Math.min(40, (newDirs.length - 3) * 10);
    factors.push(`accessing ${newDirs.length} new directories`);
  }
  return { score: Math.min(100, catScore + dirScore), factors };
}

/**
 * Score baseline dimension: unusual timing patterns.
 * Each unseen hour adds 50 points (max 100).
 * @param {Object} sd - Session data for the agent
 * @param {Object} ab - Agent baseline data
 * @returns {DimensionResult}
 * @since v0.3.0
 */
function scoreBaseline(sd, ab) {
  const factors = [];
  const hourHist = ab.averages.hourHistogram || new Array(24).fill(0);
  for (const h of sd.activeHours) {
    if (hourHist[h] === 0) {
      factors.push(`activity at unusual hour ${String(h).padStart(2, '0')}:00`);
    }
  }
  const unseenCount = factors.length;
  return { score: Math.min(100, unseenCount * 50), factors };
}

module.exports = { scoreNetwork, scoreFilesystem, scoreProcess, scoreBaseline };
