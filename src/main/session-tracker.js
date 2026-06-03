/**
 * @file session-tracker.js
 * @module main/session-tracker
 * @description Polling-gap-resistant agent session tracking. Reconciles each
 *   process scan against the set of currently-active sessions using an
 *   eager-enter / lazy-exit rule:
 *
 *   - A (pid + process) seen for the FIRST time starts a session and is reported
 *     in `entered` immediately — so an agent visible in even ONE scan is recorded
 *     before any dedup/grace logic can suppress it (single-tick safe).
 *   - A session not seen in a scan is only reported in `exited` after `grace`
 *     consecutive RELIABLE misses, so a one-tick disappearance (flicker, late
 *     `tasklist`, or a permission-denied scan) does NOT end it and reappearance
 *     does NOT create a duplicate session.
 *
 *   Identity is `pid + process name`. The OS process start-time is not available
 *   from the snapshot scanner (`tasklist /FO CSV /NH` returns only name+pid), so
 *   PID-reuse is disambiguated by the process name (a recycled PID belonging to a
 *   different agent yields a different key → a new session); each session also
 *   carries an AEGIS-observed `firstSeen` timestamp as its start-time field.
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.1.0
 */
'use strict';

/**
 * Consecutive RELIABLE scans an active session may go unseen before it is
 * considered ended. 2 tolerates a single dropped/late scan (flicker) without
 * ending the session — the minimum that absorbs one-tick gaps.
 * @type {number}
 */
const DEFAULT_EXIT_GRACE = 2;

/**
 * @typedef {Object} Session
 * @property {number} pid
 * @property {string} agent - display name (e.g. "Claude Code")
 * @property {string} process - OS process name (e.g. "claude")
 * @property {number} firstSeen - AEGIS-observed start time (ms epoch)
 * @property {number} lastSeen - last scan (ms epoch) this session was seen
 * @property {number} missed - consecutive reliable scans unseen
 */

/** @type {Map<string, Session>} Active sessions keyed by `pid|process`. */
const activeSessions = new Map();

/**
 * Stable identity key for a detected agent: pid + lowercased process name.
 * NOT keyed on firstSeen — keying on a timestamp would give every reappearance
 * a fresh identity and re-create the session on each flicker.
 * @param {{pid: number, agent?: string, process?: string}} agent
 * @returns {string}
 */
function sessionKey(agent) {
  const proc = String(agent.process || agent.agent || '').toLowerCase();
  return `${agent.pid}|${proc}`;
}

/**
 * Reconcile a process scan against the active-session set.
 *
 * @param {Array<{pid: number, agent: string, process?: string}>} agents
 *   Agents detected in THIS scan (deduped by pid upstream).
 * @param {Object} [opts]
 * @param {boolean} [opts.reliable=true] - false when the scan could not
 *   enumerate processes (e.g. permission-denied → empty list). An unreliable
 *   scan tells us nothing about who left, so it neither starts, ends, nor ages
 *   any session and returns no events.
 * @param {number} [opts.now] - injectable timestamp (ms) for tests.
 * @param {number} [opts.grace=DEFAULT_EXIT_GRACE] - consecutive reliable misses
 *   before a session is reported as exited.
 * @returns {{entered: Array<{pid: number, agent: string, process: string, firstSeen: number}>,
 *            exited: Array<{pid: number, agent: string, process: string, firstSeen: number, lastSeen: number}>}}
 * @since v0.10.0-alpha
 */
function reconcile(agents, opts = {}) {
  const reliable = opts.reliable !== false;
  const now = opts.now != null ? opts.now : Date.now();
  const grace = opts.grace != null ? opts.grace : DEFAULT_EXIT_GRACE;

  // Unreliable scan: do not start, end, or age sessions. This is what kills the
  // EPERM false-positive storm — a transient access-denied no longer ages out
  // every live session into a spurious exit + re-enter pair.
  if (!reliable) return { entered: [], exited: [] };

  const entered = [];
  const seenKeys = new Set();

  for (const a of agents) {
    const key = sessionKey(a);
    seenKeys.add(key);
    const existing = activeSessions.get(key);
    if (existing) {
      existing.lastSeen = now;
      existing.missed = 0;
    } else {
      const session = {
        pid: a.pid,
        agent: a.agent,
        process: a.process || '',
        firstSeen: now,
        lastSeen: now,
        missed: 0,
      };
      activeSessions.set(key, session);
      entered.push({
        pid: session.pid,
        agent: session.agent,
        process: session.process,
        firstSeen: session.firstSeen,
      });
    }
  }

  const exited = [];
  for (const [key, s] of activeSessions) {
    if (seenKeys.has(key)) continue;
    s.missed += 1;
    if (s.missed >= grace) {
      exited.push({
        pid: s.pid,
        agent: s.agent,
        process: s.process,
        firstSeen: s.firstSeen,
        lastSeen: s.lastSeen,
      });
      activeSessions.delete(key);
    }
  }

  return { entered, exited };
}

/**
 * @returns {number} Count of currently-active sessions.
 * @since v0.10.0-alpha
 */
function activeCount() {
  return activeSessions.size;
}

/** @internal Reset module state (for tests). @returns {void} */
function _resetForTest() {
  activeSessions.clear();
}

module.exports = {
  reconcile,
  activeCount,
  sessionKey,
  DEFAULT_EXIT_GRACE,
  _resetForTest,
};
