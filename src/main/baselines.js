/**
 * @file baselines.js
 * @module main/baselines
 * @description Behaviour-baseline engine: per-INSTANCE session tracking, rolling
 *   averages, and disk persistence. Anomaly detection is in anomaly-detector.js.
 *
 *   TWO KEYS, and they point in opposite directions on purpose:
 *     - `sessionData` — the LIVE bucket, keyed by `instanceId`. Per-boot, so it may
 *       key on a value that is a new string after every restart, and it must: two
 *       instances of the same agent are two processes and score separately
 *       (IDENTITY-RECON C2).
 *     - `baselines.agents` — the CROSS-SESSION profile, keyed by the agent NAME and
 *       written to disk. A profile keyed on `instanceId` would reset on every boot,
 *       which is not a baseline. The on-disk format is unchanged by the instance
 *       migration; files written before it keep loading and keep matching by name.
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
/** @type {Object<string, Object>} Live session buckets, keyed by `instanceId`. */
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
 * Get (or create) the live session bucket for ONE process instance.
 *
 * THE BUCKET IS KEYED ON `instanceId`, NEVER ON THE NAME. Two Claude Code
 * instances share a display name but are two processes, and a shared bucket gave
 * them one anomaly score, one set of "new" directories and one endpoint history —
 * so one project's `.ssh` read raised the other project's card (IDENTITY-RECON
 * C2). `agentName` rides inside the bucket because the cross-session profile it
 * finalizes into (`baselines.agents`) stays keyed on the name.
 *
 * NULL-KEY POLICY — an agent with no `instanceId` gets NO bucket and is not
 * recorded at all. Deliberately not the two alternatives: falling back to the name
 * would re-create the exact collision this key removes, and deriving a key here
 * (`buildInstanceId`) would be a SECOND identity resolution one tick removed from
 * the first, which is how a recycled pid inherits a dead process's history
 * (ai-mistakes.md #19). The key is READ from the agent object the same tick
 * produced, or the observation is dropped — the same choice the renderer makes for
 * a keyless event (stores/risk.ts quarantine). Reachable today for the
 * `attachModels` pid-0 synthetics, which no stamp site reaches (scan-loop.js), and
 * for a network connection that matched no agent.
 * @param {string} instanceId - the agent's own `instanceId`, read never derived.
 * @param {string} agentName - display name, stored for the finalize step.
 * @returns {Object|null} session bucket, or null when there is no key to file it under
 * @since v0.1.0
 */
function ensureSessionData(instanceId, agentName) {
  if (!instanceId) return null;
  if (!sessionData[instanceId]) {
    sessionData[instanceId] = {
      agentName,
      files: new Set(),
      sensitiveCount: 0,
      directories: new Set(),
      endpoints: new Set(),
      sensitiveReasons: new Set(),
      activeHours: new Set(),
      startTime: Date.now(),
    };
  }
  return sessionData[instanceId];
}

/**
 * @param {string} instanceId @param {string} agentName @param {string} filePath
 * @param {boolean} isSensitive @param {string} [reason]
 * @returns {void} @since v0.1.0
 */
function recordFileAccess(instanceId, agentName, filePath, isSensitive, reason) {
  const sd = ensureSessionData(instanceId, agentName);
  if (!sd) return;
  sd.files.add(filePath);
  if (isSensitive) {
    sd.sensitiveCount++;
    if (reason) sd.sensitiveReasons.add(reason);
  }
  sd.directories.add(path.dirname(filePath));
  sd.activeHours.add(new Date().getHours());
}

/**
 * @param {string} instanceId @param {string} agentName @param {string} ip @param {number} port
 * @returns {void} @since v0.1.0
 */
function recordNetworkEndpoint(instanceId, agentName, ip, port) {
  const sd = ensureSessionData(instanceId, agentName);
  if (!sd) return;
  sd.endpoints.add(`${ip}:${port}`);
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

/**
 * Persist every live bucket into its agent's cross-session profile.
 *
 * ONE RECORD PER INSTANCE, not per launch. The unit of a persisted session must be
 * the unit of the live bucket it is compared against: `scoring-utils.js` divides
 * `sd.files.size` (now one instance's activity) by `averages.filesPerSession` (the
 * mean of `sessions[].totalFiles`), and `anomaly-detector.js` fires at 3x that
 * ratio. Merging the buckets back by name here would leave per-instance activity
 * measured against launch-sized averages, and every instance would read as
 * permanently quiet. `sessionCount` therefore now grows by N per launch, where N is
 * the number of same-named instances that were active.
 *
 * TRANSITION, and it is not a bug: records written before this change are
 * launch-sized (all same-named instances merged into one). While they are still in
 * the window, `averages` is inflated and the deviation detector UNDER-fires. With k
 * old records left of MAX_BASELINE_SESSIONS (10), the effective trigger is
 * 3 * (k*N + (10-k)) / 10 times an instance's own typical volume instead of 3x — for
 * N=2 that is 6x immediately after the migration, decaying linearly to 3x. The last
 * old record leaves after 10 new ones, i.e. ceil(10/N) launches: 10 launches at
 * N=1, 5 at N=2, 4 at N=3. Self-correcting; no migration of the file is needed and
 * none is done.
 * @returns {void} @since v0.1.0
 */
function finalizeSession() {
  for (const sd of Object.values(sessionData)) {
    if (sd.files.size === 0 && sd.sensitiveCount === 0 && sd.endpoints.size === 0) continue;
    // The bucket is instance-keyed; the profile is name-keyed. A bucket with no
    // name has nowhere to land — it is dropped rather than filed under a guess.
    const agentName = sd.agentName;
    if (!agentName) continue;
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
  ensureSessionData,
  recordFileAccess,
  recordNetworkEndpoint,
  recomputeAverages,
  finalizeSession,
  getBaselines,
  getSessionData,
  _setBaselinesPathForTest,
};
