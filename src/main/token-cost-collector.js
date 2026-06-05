/**
 * @file token-cost-collector.js
 * @module main/token-cost-collector
 * @description Per-tick bridge between the live scan loop and the token-feed /
 *   token-tracker pair. Given the scan's current agent list it:
 *     1. keeps only agents carrying a real OS birth-time (`startTime` is a
 *        number) — the feed's PID-reuse guard needs an epoch-ms to trust a pid;
 *     2. makes exactly ONE {@link module:main/token-feed} read for that batch;
 *     3. folds every returned measured delta into {@link module:main/token-tracker}
 *        under the delta's OWN pid (C-01 — never an index, never the loop var).
 *
 *   HONESTY (empirical-gap #1). If a live Claude Code agent is present on the
 *   tick but had to be dropped because its birth-time was unreadable, its tokens
 *   go unattributed and the readout silently undercounts. We refuse to be silent
 *   about that: one `logger.warn` is emitted (once per process). It is gated to
 *   win32 — on darwin/linux `startTime` is `null` for EVERY agent (an expected
 *   platform limit, not an anomaly), so warning there would be pure noise. The
 *   warn is emitted BEFORE the empty-procs early return, because the dropped
 *   agent IS exactly the case that leaves `procs` empty.
 *
 *   RELIABILITY (C-02). The feed read is wrapped in try/catch so a corrupt or
 *   locked transcript can never throw out of here, drop the scan tick, or block
 *   the caller's reentrancy-guard release. On error we warn once and return the
 *   nothing we have — the tick continues.
 *
 *   This module holds NO token knowledge of its own: it fabricates no counts,
 *   reads no disk, and adds no agent-specific logic. All of that lives in the
 *   feed's adapters and the tracker's accounting.
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.1.0
 */
'use strict';

const logger = require('./logger');
const tokenFeed = require('./token-feed');
const tokenTracker = require('./token-tracker');

/**
 * Display name (agent-database `displayName`) of the only agent family with a
 * token-feed adapter today. Matched exactly — a substring like 'claude' would
 * false-warn on other Claude-branded entries in the agent DB.
 * @type {string}
 */
const CLAUDE_CODE_AGENT = 'Claude Code';

/** One-time guards so the two honesty warnings below fire once, never per-tick. */
let _warnedBirthtime = false;
let _warnedReadError = false;

/**
 * Read any new measured per-PID token deltas for the live agents and accumulate
 * them in the token-tracker. Pure orchestration — see the file header for the
 * honesty and reliability contracts.
 *
 * @param {Array<{ agent?: string, pid?: number, startTime?: number }>} agents -
 *   the scan tick's current agent list.
 * @returns {Promise<Array>} the measured deltas applied this tick (possibly
 *   empty — never throws).
 * @since v0.11.0-alpha
 */
async function collectTokenCosts(agents) {
  const list = Array.isArray(agents) ? agents : [];

  // C-01: build the procs batch ONLY from agents whose OS birth-time is a real
  // epoch-ms number. The typeof check rejects both null (darwin/linux: not
  // surfaced) and undefined (not yet enriched) in a single predicate.
  const procs = [];
  let droppedClaude = false;
  for (const a of list) {
    if (a && typeof a.startTime === 'number') {
      procs.push({ pid: a.pid, startTime: a.startTime });
    } else if (a && a.agent === CLAUDE_CODE_AGENT) {
      droppedClaude = true;
    }
  }

  // Honesty: surface a live-but-unattributable Claude Code agent once (win32
  // only). Emitted before the early return — the dropped agent is the empty case.
  if (droppedClaude && !_warnedBirthtime && process.platform === 'win32') {
    _warnedBirthtime = true;
    logger.warn(
      'token',
      'Live Claude Code agent skipped: OS birth-time unread, its token usage is unattributed',
    );
  }

  if (procs.length === 0) return [];

  let deltas;
  try {
    deltas = await tokenFeed.readUsageByPid(procs);
  } catch (err) {
    // A corrupt/locked transcript must never drop the tick or block the caller's
    // C-02 finally. Warn once, then carry on with nothing this cycle.
    if (!_warnedReadError) {
      _warnedReadError = true;
      logger.warn('token', 'token-feed read failed; skipping token costs this tick', {
        error: err.message,
      });
    }
    return [];
  }

  // C-01: attribute each delta under the pid the SOURCE stamped on it.
  for (const d of deltas) tokenTracker.trackTokens(d.pid, d);
  return deltas;
}

module.exports = { collectTokenCosts };
