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
 *   Identity is `instanceId + process name`, where `instanceId` binds the pid to
 *   the OS process-creation time (process-identity.js). The snapshot scanner
 *   itself still returns only name+pid (`tasklist /FO CSV /NH`), so the birth time
 *   is attached upstream by `procUtil.enrichWithParentChains`, which scan-loop runs
 *   BEFORE reconcile. Consequences:
 *
 *   - Where the platform supplies a birth time (win32), a recycled PID yields a
 *     different `instanceId` → the dead process gets its `exited` event and the new
 *     one a fresh session with its own `firstSeen`, EVEN WHEN both run the same
 *     executable. That same-name case used to collapse into one never-ending session.
 *   - Where it does not (darwin/linux today, or an unreadable birth time),
 *     `instanceId` degrades to `"<pid>:u"` and the process NAME in the composite key
 *     still separates a recycled pid belonging to a different agent — the
 *     pre-instanceId behaviour, unchanged.
 *
 *   Each session also carries an AEGIS-observed `firstSeen` timestamp as its
 *   start-time field, distinct from the OS birth time inside `instanceId`.
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.2.0
 */
'use strict';

const { buildInstanceId } = require('./process-identity');

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
 * @property {string} instanceId - process instance key (see process-identity.js)
 * @property {string} agent - display name (e.g. "Claude Code")
 * @property {string} process - OS process name (e.g. "claude")
 * @property {number} firstSeen - AEGIS-observed start time (ms epoch)
 * @property {number} lastSeen - last scan (ms epoch) this session was seen
 * @property {number} missed - consecutive reliable scans unseen
 */

/** @type {Map<string, Session>} Active sessions keyed by `instanceId|process`. */
const activeSessions = new Map();

/**
 * Stable identity key for a detected agent: `instanceId` + lowercased process name.
 *
 * COMPOSITE on purpose. `instanceId` alone would lose the name-level
 * discrimination wherever it degrades to `"<pid>:u"` (no OS birth time); the name
 * alone cannot separate two runs of the same executable on a recycled pid. Each
 * segment covers the other's blind spot.
 *
 * `instanceId` is normally stamped upstream by `procUtil.enrichWithParentChains`;
 * it is derived here when absent so this module stays usable standalone (and its
 * key format has exactly one definition).
 *
 * NOT keyed on firstSeen — keying on an AEGIS-observed timestamp would give every
 * reappearance a fresh identity and re-create the session on each flicker.
 * @param {{pid: number, agent?: string, process?: string, startTime?: number|null,
 *          instanceId?: string}} agent
 * @returns {string}
 */
function sessionKey(agent) {
  const proc = String(agent.process || agent.agent || '').toLowerCase();
  return `${_instanceIdOf(agent)}|${proc}`;
}

/**
 * The agent's stamped `instanceId`, or a freshly derived one when the upstream
 * enrichment did not run (standalone use, tests). One definition, two callers —
 * `sessionKey` and the session record built in `reconcile` must never disagree.
 * @param {{pid: number, agent?: string, process?: string, startTime?: number|null,
 *          instanceId?: string}} agent
 * @returns {string}
 */
function _instanceIdOf(agent) {
  return typeof agent.instanceId === 'string' && agent.instanceId
    ? agent.instanceId
    : buildInstanceId(agent);
}

/**
 * Reconcile a process scan against the active-session set.
 *
 * @param {Array<{pid: number, agent: string, process?: string, startTime?: number|null,
 *                instanceId?: string}>} agents
 *   Agents detected in THIS scan (deduped by pid upstream), already carrying
 *   `instanceId` from `procUtil.enrichWithParentChains`.
 * @param {Object} [opts]
 * @param {boolean} [opts.reliable=true] - false when the scan could not
 *   enumerate processes (e.g. permission-denied → empty list). An unreliable
 *   scan tells us nothing about who left, so it neither starts, ends, nor ages
 *   any session and returns no events.
 * @param {number} [opts.now] - injectable timestamp (ms) for tests.
 * @param {number} [opts.grace=DEFAULT_EXIT_GRACE] - consecutive reliable misses
 *   before a session is reported as exited.
 * @returns {{entered: Array<{pid: number, instanceId: string, agent: string, process: string, firstSeen: number}>,
 *            exited: Array<{pid: number, instanceId: string, agent: string, process: string, firstSeen: number, lastSeen: number}>}}
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
        instanceId: _instanceIdOf(a),
        agent: a.agent,
        process: a.process || '',
        firstSeen: now,
        lastSeen: now,
        missed: 0,
      };
      activeSessions.set(key, session);
      entered.push({
        pid: session.pid,
        instanceId: session.instanceId,
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
        instanceId: s.instanceId,
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
