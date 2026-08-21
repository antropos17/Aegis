/**
 * @file session-tracker.js
 * @module main/session-tracker
 * @description Polling-gap-resistant agent session tracking. Reconciles each
 *   process scan against the set of currently-active sessions using an
 *   eager-enter / lazy-exit rule:
 *
 *   - An (instanceId + process name) seen for the FIRST time starts a session and
 *     is reported in `entered` immediately — that composite, built by
 *     {@link sessionKey} from the stamp the scan batch carries, is the active-session
 *     key; a bare pid never is. So an agent visible in even ONE scan is recorded
 *     before any dedup/grace logic can suppress it (single-tick safe).
 *   - A session not seen in a scan is only reported in `exited` after `grace`
 *     consecutive RELIABLE misses, so a one-tick disappearance (flicker, late
 *     `tasklist`, or a permission-denied scan) does NOT end it and reappearance
 *     does NOT create a duplicate session.
 *   - A scan that observed nothing usable is FROZEN: it starts, ends and ages
 *     nothing. Two things can be missing — the population (`reliable: false`, a
 *     permission-denied enumeration) or the identity (`identityDegraded: true`, a
 *     birth-time platform whose observation failed, so every key collapsed to
 *     `<pid>:u`). Both are absences of evidence, and an absence of evidence must not
 *     be written into the audit log as a fleet-wide exit.
 *
 *   Identity is `instanceId + process name`, where `instanceId` binds the pid to
 *   the OS process-creation time (process-identity.js). The snapshot scanner
 *   itself still returns only name+pid (`tasklist /FO CSV /NH`), so the birth time
 *   is attached upstream by `procUtil.enrichWithParentChains`, which scan-loop runs
 *   BEFORE reconcile. Consequences:
 *
 *   - Where the platform supplies a birth time (win32), a recycled PID yields a
 *     different `instanceId` ON TWO CONDITIONS, both of which the enrichment pass
 *     must actually meet: a usable birth time was freshly OBSERVED for that pid on
 *     that pass, and it differs from the previous one at the epoch-MILLISECOND
 *     resolution AEGIS stores. When they hold, the dead process gets its `exited`
 *     event and the new one a fresh session with its own `firstSeen`, EVEN WHEN both
 *     run the same executable — the same-name case that used to collapse into one
 *     never-ending session.
 *   - Withheld birth time (darwin/linux today, or an unreadable `CreationDate` on
 *     win32): `instanceId` degrades to `"<pid>:u"` and the process NAME in the
 *     composite key still separates a recycled pid belonging to a different agent —
 *     the pre-instanceId behaviour, unchanged.
 *   - Two instances colliding on BOTH pid and stored birth-time millisecond stay
 *     indistinguishable to this identity scheme, so they share one session key
 *     whenever the process name also matches. A different process name still gives
 *     name-level discrimination through the composite. See process-identity.js
 *     TIME RESOLUTION.
 *
 *   Each session also carries an AEGIS-observed `firstSeen` timestamp as its
 *   start-time field, distinct from the OS birth time inside `instanceId`.
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.2.0
 */
'use strict';

const { readInstanceId } = require('./process-identity');

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
 * Stable identity key for a detected agent: stamped `instanceId` + lowercased process.
 *
 * COMPOSITE on purpose. `instanceId` alone would lose the name-level discrimination
 * wherever it degrades to `"<pid>:u"` (no OS birth time); the name alone cannot
 * separate two runs of the same executable on a recycled pid.
 *
 * `instanceId` is READ only (process-identity.readInstanceId). Production always
 * stamps via `enrichWithParentChains` before reconcile. An unstamped agent is
 * skipped — a second local `buildInstanceId` here is a cross-tick identity resolution
 * that can disagree with the scan-batch stamp (ai-mistakes.md #19).
 *
 * NOT keyed on firstSeen — that would re-create sessions on every flicker.
 * @param {{pid: number, agent?: string, process?: string, instanceId?: string}} agent
 * @returns {string|null}
 */
function sessionKey(agent) {
  const id = readInstanceId(agent);
  if (!id) return null;
  const proc = String(agent.process || agent.agent || '').toLowerCase();
  return `${id}|${proc}`;
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
 * @param {boolean} [opts.identityDegraded=false] - true when the platform declares
 *   an OS birth time but this tick's observation of it failed, so every live agent's
 *   `instanceId` collapsed from `<pid>:<birthMs>` to `<pid>:u`
 *   (process-scanner.js `isIdentityDegraded`). Handled EXACTLY like an unreliable
 *   scan, and for the same reason: the keys moved, the processes did not.
 *
 *   GUARANTEE: across a degraded stretch and its recovery, no session is started,
 *   ended or aged, so a provider outage produces no `agent-enter` and no
 *   `agent-exit` — and every session resumes under the key it already had, because
 *   that key was never replaced.
 *
 *   WHAT STAYS OPEN, and it is not small: while frozen, a REAL start or stop is
 *   invisible too. An agent that exits during the outage is reported only once the
 *   observation returns and it is missed for `grace` more reliable ticks; one that
 *   starts during it enters late. That is the same trade the `reliable` flag already
 *   makes for a permission-denied scan — a late true event over a fleet of false
 *   ones — and it is bounded by the outage. It is NOT free: an outage that starts
 *   before the first tick means nothing is tracked at all, where the pre-flag
 *   behaviour would have tracked everything under `<pid>:u` keys.
 *
 *   Absent or false, reconcile behaves exactly as it always did — which is what
 *   keeps linux and darwin untouched, where `<pid>:u` is the steady state and no
 *   caller ever sets this.
 * @param {number} [opts.now] - injectable timestamp (ms) for tests.
 * @param {number} [opts.grace=DEFAULT_EXIT_GRACE] - consecutive reliable misses
 *   before a session is reported as exited.
 * @returns {{entered: Array<{pid: number, instanceId: string, agent: string, process: string, firstSeen: number}>,
 *            exited: Array<{pid: number, instanceId: string, agent: string, process: string, firstSeen: number, lastSeen: number}>}}
 * @since v0.10.0-alpha
 */
function reconcile(agents, opts = {}) {
  const reliable = opts.reliable !== false;
  const identityDegraded = opts.identityDegraded === true;
  const now = opts.now != null ? opts.now : Date.now();
  const grace = opts.grace != null ? opts.grace : DEFAULT_EXIT_GRACE;

  // Nothing observable happened: do not start, end, or age sessions.
  //
  // Two causes, one response, because the two are the same mistake seen from
  // opposite sides. An unreliable scan lost the POPULATION — this is what kills the
  // EPERM false-positive storm, where a transient access-denied aged out every live
  // session into a spurious exit + re-enter pair. A degraded identity lost the KEY:
  // the same processes come back under `<pid>:u`, which reads as the whole fleet
  // exiting and an identically-named fleet arriving. Neither says anything about
  // who left, so neither may be answered with an event.
  if (!reliable || identityDegraded) return { entered: [], exited: [] };

  const entered = [];
  const seenKeys = new Set();

  for (const a of agents) {
    const key = sessionKey(a);
    if (!key) continue; // unstamped — no fabricated session identity
    const instanceId = readInstanceId(a);
    seenKeys.add(key);
    const existing = activeSessions.get(key);
    if (existing) {
      existing.lastSeen = now;
      existing.missed = 0;
    } else {
      const session = {
        pid: a.pid,
        instanceId,
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
