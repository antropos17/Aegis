/**
 * @file baselines.js
 * @module main/baselines
 * @description Behaviour-baseline engine: per-agent session tracking, rolling
 *   averages, deviation detection, and disk persistence.
 * @requires fs
 * @requires path
 * @requires electron
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.1.0
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const BASELINES_PATH = path.join(app.getPath('userData'), 'baselines.json');
const MAX_BASELINE_SESSIONS = 10;
let baselines = { agents: {} };
const sessionData = {};
const deviationWarningsSent = {};

/** @returns {void} @since v0.1.0 */
function loadBaselines() {
  try {
    if (fs.existsSync(BASELINES_PATH)) {
      const raw = JSON.parse(fs.readFileSync(BASELINES_PATH, 'utf-8'));
      if (raw && raw.agents) baselines = raw;
    }
  } catch (_) { baselines = { agents: {} }; }
}

/** @returns {void} @since v0.1.0 */
function saveBaselines() {
  try { fs.writeFileSync(BASELINES_PATH, JSON.stringify(baselines, null, 2)); } catch (_) {}
}

/**
 * @param {string} agentName
 * @returns {Object} session data record
 * @since v0.1.0
 */
function ensureSessionData(agentName) {
  if (!sessionData[agentName]) {
    sessionData[agentName] = { files: new Set(), sensitiveCount: 0, directories: new Set(), endpoints: new Set(), startTime: Date.now() };
  }
  return sessionData[agentName];
}

/**
 * @param {string} agentName @param {string} filePath @param {boolean} isSensitive
 * @returns {void} @since v0.1.0
 */
function recordFileAccess(agentName, filePath, isSensitive) {
  const sd = ensureSessionData(agentName);
  sd.files.add(filePath);
  if (isSensitive) sd.sensitiveCount++;
  sd.directories.add(path.dirname(filePath));
}

/**
 * @param {string} agentName @param {string} ip @param {number} port
 * @returns {void} @since v0.1.0
 */
function recordNetworkEndpoint(agentName, ip, port) {
  ensureSessionData(agentName).endpoints.add(`${ip}:${port}`);
}

/**
 * @param {Object} agentBaseline
 * @returns {void} @since v0.1.0
 */
function recomputeAverages(agentBaseline) {
  const sessions = agentBaseline.sessions;
  if (sessions.length === 0) return;
  agentBaseline.averages.filesPerSession = sessions.reduce((s, x) => s + x.totalFiles, 0) / sessions.length;
  agentBaseline.averages.sensitivePerSession = sessions.reduce((s, x) => s + x.sensitiveFiles, 0) / sessions.length;
  const dirCount = {};
  for (const sess of sessions) for (const d of sess.directories) dirCount[d] = (dirCount[d] || 0) + 1;
  agentBaseline.averages.typicalDirectories = Object.keys(dirCount).filter(d => dirCount[d] >= 2);
  const allEp = new Set();
  for (const sess of sessions) for (const ep of sess.networkEndpoints) allEp.add(ep);
  agentBaseline.averages.knownEndpoints = [...allEp];
}

/** @returns {void} @since v0.1.0 */
function finalizeSession() {
  for (const [agentName, sd] of Object.entries(sessionData)) {
    if (sd.files.size === 0 && sd.sensitiveCount === 0 && sd.endpoints.size === 0) continue;
    if (!baselines.agents[agentName]) {
      baselines.agents[agentName] = { sessionCount: 0, sessions: [], averages: { filesPerSession: 0, sensitivePerSession: 0, typicalDirectories: [], knownEndpoints: [] } };
    }
    const ab = baselines.agents[agentName];
    ab.sessionCount++;
    ab.sessions.push({ startTime: sd.startTime, endTime: Date.now(), totalFiles: sd.files.size, sensitiveFiles: sd.sensitiveCount, directories: [...sd.directories], networkEndpoints: [...sd.endpoints] });
    if (ab.sessions.length > MAX_BASELINE_SESSIONS) ab.sessions = ab.sessions.slice(-MAX_BASELINE_SESSIONS);
    recomputeAverages(ab);
  }
  saveBaselines();
}

/**
 * @returns {Array<{agent:string, type:string, message:string}>}
 * @since v0.1.0
 */
function checkDeviations() {
  const warnings = [];
  for (const [agentName, sd] of Object.entries(sessionData)) {
    const ab = baselines.agents[agentName];
    if (!ab || ab.sessionCount < 3) continue;
    if (!deviationWarningsSent[agentName]) deviationWarningsSent[agentName] = new Set();
    const sent = deviationWarningsSent[agentName];
    const avg = ab.averages;
    if (avg.filesPerSession > 0 && sd.files.size > avg.filesPerSession * 3) {
      const key = 'files-3x';
      if (!sent.has(key)) { sent.add(key); warnings.push({ agent: agentName, type: 'files', message: `${agentName}: file access volume (${sd.files.size}) is ${Math.round(sd.files.size / avg.filesPerSession)}x above average (${Math.round(avg.filesPerSession)})` }); }
    }
    if (avg.sensitivePerSession > 0 && sd.sensitiveCount > avg.sensitivePerSession * 3) {
      const key = 'sensitive-3x';
      if (!sent.has(key)) { sent.add(key); warnings.push({ agent: agentName, type: 'sensitive', message: `${agentName}: sensitive file access (${sd.sensitiveCount}) is ${Math.round(sd.sensitiveCount / avg.sensitivePerSession)}x above average (${Math.round(avg.sensitivePerSession)})` }); }
    }
    const knownEps = new Set(avg.knownEndpoints);
    for (const ep of sd.endpoints) {
      if (!knownEps.has(ep)) { const key = `new-ep:${ep}`; if (!sent.has(key)) { sent.add(key); warnings.push({ agent: agentName, type: 'network', message: `${agentName}: connecting to new endpoint ${ep}` }); } }
    }
    const typicalDirs = new Set(avg.typicalDirectories);
    const newDirs = [...sd.directories].filter(d => !typicalDirs.has(d));
    if (newDirs.length >= 4) { const key = 'new-dirs-4+'; if (!sent.has(key)) { sent.add(key); warnings.push({ agent: agentName, type: 'directories', message: `${agentName}: accessing ${newDirs.length} new directories not seen in previous sessions` }); } }
  }
  return warnings;
}

/** @returns {Object} @since v0.1.0 */ function getBaselines() { return baselines; }
/** @returns {Object} @since v0.1.0 */ function getSessionData() { return sessionData; }

module.exports = { loadBaselines, saveBaselines, ensureSessionData, recordFileAccess, recordNetworkEndpoint, recomputeAverages, finalizeSession, checkDeviations, getBaselines, getSessionData };
