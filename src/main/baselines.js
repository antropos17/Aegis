/**
 * @file baselines.js
 * @module main/baselines
 * @description Behaviour-baseline engine: per-agent session tracking, rolling
 *   averages, and disk persistence. Anomaly detection is in anomaly-detector.js.
 * @requires fs
 * @requires path
 * @requires electron
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.2.0
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const logger = require('./logger');

// ── Lazy path — resolved on first use (after app.whenReady) ──
let _baselinesPath = null;
function baselinesPath() {
  if (!_baselinesPath) _baselinesPath = path.join(app.getPath('userData'), 'baselines.json');
  return _baselinesPath;
}
/** @internal Override baselines path (for tests). */
function _setBaselinesPathForTest(p) {
  _baselinesPath = p;
}
const MAX_BASELINE_SESSIONS = 10;
let baselines = { agents: {} };
const sessionData = {};

/** @returns {void} @since v0.1.0 */
function loadBaselines() {
  try {
    if (fs.existsSync(baselinesPath())) {
      const raw = JSON.parse(fs.readFileSync(baselinesPath(), 'utf-8'));
      if (raw && raw.agents) baselines = raw;
    }
  } catch (err) {
    logger.warn('baselines', 'Failed to load baselines — starting fresh', { error: err.message });
    baselines = { agents: {} };
  }
}

/** @returns {void} @since v0.1.0 */
function saveBaselines() {
  try {
    fs.writeFileSync(baselinesPath(), JSON.stringify(baselines, null, 2));
  } catch (err) {
    logger.error('baselines', 'Failed to save baselines', {
      path: baselinesPath(),
      error: err.message,
    });
  }
}

/**
 * @param {string} agentName
 * @returns {Object} session data record
 * @since v0.1.0
 */
function ensureSessionData(agentName) {
  if (!sessionData[agentName]) {
    sessionData[agentName] = {
      files: new Set(),
      sensitiveCount: 0,
      directories: new Set(),
      endpoints: new Set(),
      sensitiveReasons: new Set(),
      activeHours: new Set(),
      startTime: Date.now(),
    };
  }
  return sessionData[agentName];
}

/**
 * @param {string} agentName @param {string} filePath @param {boolean} isSensitive @param {string} [reason]
 * @returns {void} @since v0.1.0
 */
function recordFileAccess(agentName, filePath, isSensitive, reason) {
  const sd = ensureSessionData(agentName);
  sd.files.add(filePath);
  if (isSensitive) {
    sd.sensitiveCount++;
    if (reason) sd.sensitiveReasons.add(reason);
  }
  sd.directories.add(path.dirname(filePath));
  sd.activeHours.add(new Date().getHours());
}

/**
 * @param {string} agentName @param {string} ip @param {number} port
 * @returns {void} @since v0.1.0
 */
function recordNetworkEndpoint(agentName, ip, port) {
  ensureSessionData(agentName).endpoints.add(`${ip}:${port}`);
}

/**
 * Recompute rolling averages from session history.
 * @param {Object} agentBaseline
 * @returns {void} @since v0.1.0
 */
function recomputeAverages(agentBaseline) {
  const sessions = agentBaseline.sessions;
  if (sessions.length === 0) return;
  agentBaseline.averages.filesPerSession =
    sessions.reduce((s, x) => s + x.totalFiles, 0) / sessions.length;
  agentBaseline.averages.sensitivePerSession =
    sessions.reduce((s, x) => s + x.sensitiveFiles, 0) / sessions.length;
  const dirCount = {};
  for (const sess of sessions)
    for (const d of sess.directories) dirCount[d] = (dirCount[d] || 0) + 1;
  agentBaseline.averages.typicalDirectories = Object.keys(dirCount).filter((d) => dirCount[d] >= 2);
  const allEp = new Set();
  for (const sess of sessions) for (const ep of sess.networkEndpoints) allEp.add(ep);
  agentBaseline.averages.knownEndpoints = [...allEp];
  const allReasons = new Set();
  for (const sess of sessions) for (const r of sess.sensitiveReasons || []) allReasons.add(r);
  agentBaseline.averages.knownSensitiveReasons = [...allReasons];
  const hourHist = new Array(24).fill(0);
  for (const sess of sessions) for (const h of sess.activeHours || []) hourHist[h]++;
  agentBaseline.averages.hourHistogram = hourHist;
}

/** @returns {void} @since v0.1.0 */
function finalizeSession() {
  for (const [agentName, sd] of Object.entries(sessionData)) {
    if (sd.files.size === 0 && sd.sensitiveCount === 0 && sd.endpoints.size === 0) continue;
    if (!baselines.agents[agentName]) {
      baselines.agents[agentName] = {
        sessionCount: 0,
        sessions: [],
        averages: {
          filesPerSession: 0,
          sensitivePerSession: 0,
          typicalDirectories: [],
          knownEndpoints: [],
          knownSensitiveReasons: [],
          hourHistogram: new Array(24).fill(0),
        },
      };
    }
    const ab = baselines.agents[agentName];
    ab.sessionCount++;
    ab.sessions.push({
      startTime: sd.startTime,
      endTime: Date.now(),
      totalFiles: sd.files.size,
      sensitiveFiles: sd.sensitiveCount,
      directories: [...sd.directories],
      networkEndpoints: [...sd.endpoints],
      sensitiveReasons: [...sd.sensitiveReasons],
      activeHours: [...sd.activeHours],
    });
    if (ab.sessions.length > MAX_BASELINE_SESSIONS)
      ab.sessions = ab.sessions.slice(-MAX_BASELINE_SESSIONS);
    recomputeAverages(ab);
  }
  saveBaselines();
}

/** @returns {Object} @since v0.1.0 */ function getBaselines() {
  return baselines;
}
/** @returns {Object} @since v0.1.0 */ function getSessionData() {
  return sessionData;
}

module.exports = {
  loadBaselines,
  saveBaselines,
  ensureSessionData,
  recordFileAccess,
  recordNetworkEndpoint,
  recomputeAverages,
  finalizeSession,
  getBaselines,
  getSessionData,
  _setBaselinesPathForTest,
};
