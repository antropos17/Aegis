/**
 * @file baselines.js
 * @module main/baselines
 * @description Behaviour-baseline engine: per-agent session tracking, rolling
 *   averages, anomaly detection, deviation scoring, and disk persistence.
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
    sessionData[agentName] = {
      files: new Set(), sensitiveCount: 0, directories: new Set(),
      endpoints: new Set(), sensitiveReasons: new Set(),
      activeHours: new Set(), startTime: Date.now(),
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
  if (isSensitive) { sd.sensitiveCount++; if (reason) sd.sensitiveReasons.add(reason); }
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
  agentBaseline.averages.filesPerSession = sessions.reduce((s, x) => s + x.totalFiles, 0) / sessions.length;
  agentBaseline.averages.sensitivePerSession = sessions.reduce((s, x) => s + x.sensitiveFiles, 0) / sessions.length;
  const dirCount = {};
  for (const sess of sessions) for (const d of sess.directories) dirCount[d] = (dirCount[d] || 0) + 1;
  agentBaseline.averages.typicalDirectories = Object.keys(dirCount).filter(d => dirCount[d] >= 2);
  const allEp = new Set();
  for (const sess of sessions) for (const ep of sess.networkEndpoints) allEp.add(ep);
  agentBaseline.averages.knownEndpoints = [...allEp];
  // Sensitive reason categories across all sessions
  const allReasons = new Set();
  for (const sess of sessions) for (const r of (sess.sensitiveReasons || [])) allReasons.add(r);
  agentBaseline.averages.knownSensitiveReasons = [...allReasons];
  // Hour-of-day activity histogram
  const hourHist = new Array(24).fill(0);
  for (const sess of sessions) for (const h of (sess.activeHours || [])) hourHist[h]++;
  agentBaseline.averages.hourHistogram = hourHist;
}

/** @returns {void} @since v0.1.0 */
function finalizeSession() {
  for (const [agentName, sd] of Object.entries(sessionData)) {
    if (sd.files.size === 0 && sd.sensitiveCount === 0 && sd.endpoints.size === 0) continue;
    if (!baselines.agents[agentName]) {
      baselines.agents[agentName] = {
        sessionCount: 0, sessions: [],
        averages: { filesPerSession: 0, sensitivePerSession: 0, typicalDirectories: [], knownEndpoints: [], knownSensitiveReasons: [], hourHistogram: new Array(24).fill(0) },
      };
    }
    const ab = baselines.agents[agentName];
    ab.sessionCount++;
    ab.sessions.push({
      startTime: sd.startTime, endTime: Date.now(),
      totalFiles: sd.files.size, sensitiveFiles: sd.sensitiveCount,
      directories: [...sd.directories], networkEndpoints: [...sd.endpoints],
      sensitiveReasons: [...sd.sensitiveReasons], activeHours: [...sd.activeHours],
    });
    if (ab.sessions.length > MAX_BASELINE_SESSIONS) ab.sessions = ab.sessions.slice(-MAX_BASELINE_SESSIONS);
    recomputeAverages(ab);
  }
  saveBaselines();
}

// ═══ ANOMALY DETECTION ═══

/**
 * Calculate anomaly score (0-100) for an agent based on deviation from baselines.
 * Weighted factors: file volume (30), sensitive spike (25), new sensitive
 * categories (20), new network endpoints (15), unusual timing (10).
 * @param {string} agentName
 * @returns {number} Score 0-100 (0=normal, 100=extreme anomaly)
 * @since v0.2.0
 */
function calculateAnomalyScore(agentName) {
  const sd = sessionData[agentName];
  const ab = baselines.agents[agentName];
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
  const newReasons = [...sd.sensitiveReasons].filter(r => !knownReasons.has(r));
  score += Math.min(20, newReasons.length * 10);

  // New network endpoints not seen in last 5 sessions (0-15)
  const recentEndpoints = new Set();
  const recentSessions = ab.sessions.slice(-5);
  for (const sess of recentSessions) for (const ep of sess.networkEndpoints) recentEndpoints.add(ep);
  const newEndpoints = [...sd.endpoints].filter(ep => !recentEndpoints.has(ep));
  score += Math.min(15, newEndpoints.length * 5);

  // Unusual timing (0-10) — activity at hour never seen before
  const hourHist = avg.hourHistogram || new Array(24).fill(0);
  for (const h of sd.activeHours) {
    if (hourHist[h] === 0) { score += 10; break; }
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
  for (const [agentName, sd] of Object.entries(sessionData)) {
    const ab = baselines.agents[agentName];
    if (!ab || ab.sessionCount < 3) continue;
    if (!deviationWarningsSent[agentName]) deviationWarningsSent[agentName] = new Set();
    const sent = deviationWarningsSent[agentName];
    const avg = ab.averages;
    const anomalyScore = calculateAnomalyScore(agentName);

    // File volume 3x above average
    if (avg.filesPerSession > 0 && sd.files.size > avg.filesPerSession * 3) {
      const key = 'files-3x';
      if (!sent.has(key)) { sent.add(key); warnings.push({ agent: agentName, type: 'files', message: `${agentName} normally accesses ~${Math.round(avg.filesPerSession)} files, now ${sd.files.size}`, anomalyScore }); }
    }

    // Sensitive file access 3x above average
    if (avg.sensitivePerSession > 0 && sd.sensitiveCount > avg.sensitivePerSession * 3) {
      const key = 'sensitive-3x';
      if (!sent.has(key)) { sent.add(key); warnings.push({ agent: agentName, type: 'sensitive', message: `${agentName}: sensitive file access (${sd.sensitiveCount}) is ${Math.round(sd.sensitiveCount / avg.sensitivePerSession)}x above average (${Math.round(avg.sensitivePerSession)})`, anomalyScore }); }
    }

    // New sensitive category never seen before
    const knownReasons = new Set(avg.knownSensitiveReasons || []);
    for (const reason of sd.sensitiveReasons) {
      if (!knownReasons.has(reason)) {
        const key = `new-sens:${reason}`;
        if (!sent.has(key)) { sent.add(key); warnings.push({ agent: agentName, type: 'new-sensitive', message: `${agentName} never accessed "${reason}" before`, anomalyScore }); }
      }
    }

    // New network endpoint not seen in last 5 sessions
    const recentEndpoints = new Set();
    const recentSessions = ab.sessions.slice(-5);
    for (const sess of recentSessions) for (const ep of sess.networkEndpoints) recentEndpoints.add(ep);
    for (const ep of sd.endpoints) {
      if (!recentEndpoints.has(ep)) { const key = `new-ep:${ep}`; if (!sent.has(key)) { sent.add(key); warnings.push({ agent: agentName, type: 'network', message: `${agentName}: connecting to new endpoint ${ep}`, anomalyScore }); } }
    }

    // Accessing 4+ new directories
    const typicalDirs = new Set(avg.typicalDirectories);
    const newDirs = [...sd.directories].filter(d => !typicalDirs.has(d));
    if (newDirs.length >= 4) { const key = 'new-dirs-4+'; if (!sent.has(key)) { sent.add(key); warnings.push({ agent: agentName, type: 'directories', message: `${agentName}: accessing ${newDirs.length} new directories not seen in previous sessions`, anomalyScore }); } }

    // Activity at unusual hour
    const hourHist = avg.hourHistogram || new Array(24).fill(0);
    for (const h of sd.activeHours) {
      if (hourHist[h] === 0) {
        const key = `unusual-hour:${h}`;
        if (!sent.has(key)) { sent.add(key); warnings.push({ agent: agentName, type: 'timing', message: `${agentName}: activity at unusual hour (${String(h).padStart(2, '0')}:00) — not seen in previous sessions`, anomalyScore }); }
        break;
      }
    }
  }
  return warnings;
}

/** @returns {Object} @since v0.1.0 */ function getBaselines() { return baselines; }
/** @returns {Object} @since v0.1.0 */ function getSessionData() { return sessionData; }

module.exports = { loadBaselines, saveBaselines, ensureSessionData, recordFileAccess, recordNetworkEndpoint, recomputeAverages, finalizeSession, checkDeviations, calculateAnomalyScore, getBaselines, getSessionData };
