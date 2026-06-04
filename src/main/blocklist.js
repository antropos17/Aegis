/**
 * @file blocklist.js
 * @module main/blocklist
 * @description Alert-only agent **watchlist** ("quarantine = alert"). Lets the
 *   user flag specific AI-agent instances so a scan can raise an alert when they
 *   reappear. This module is purely advisory: a flag sets an alert only.
 *
 *   IMPORTANT — alert-only. It raises an alert and nothing more: it never acts
 *   at the operating-system level, never stops, restricts, sandboxes, or
 *   otherwise interferes with any process. It only records a flag and answers
 *   `isFlagged()`. Monitoring is unchanged by an agent being on the watchlist —
 *   callers decide whether to surface an alert.
 *
 *   Persistence reuses the existing config-manager settings store (a `watchlist`
 *   array inside settings.json) — no new file, no new format. The module is
 *   stateless: every call reads the current settings fresh, so there is no
 *   in-memory copy to drift out of sync.
 *
 * @requires ./config-manager
 * @requires ../shared/agent-database.json
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.1.0
 */

'use strict';

const config = require('./config-manager');
const agentDb = require('../shared/agent-database.json');

/**
 * @typedef {Object} WatchEntry
 * @property {string} signature   Canonical agent id (or normalized raw name if unknown).
 * @property {number|null} pid    Specific PID to flag, or null for any PID of this signature.
 * @property {string} reason      Free-text note explaining why it was flagged.
 * @property {boolean} known      True if the signature resolved to an agent-database id.
 * @property {number} addedAt     Epoch ms when the entry was added/updated.
 */

// ── Signature canonicalization (C-01: identity comes from the agent-database) ──
// Build alias → canonical-id once at load. Aliases: id, displayName, every name.
/** @type {Map<string, string>} */
const _aliasToId = new Map();
for (const agent of agentDb.agents) {
  const id = agent.id;
  const aliases = [id, agent.displayName, ...(agent.names || [])];
  for (const alias of aliases) {
    if (typeof alias === 'string' && alias.length > 0) {
      _aliasToId.set(alias.trim().toLowerCase(), id);
    }
  }
}

/**
 * Resolve a raw signature to its canonical agent-database id.
 * Falls back to the normalized input when the agent is unknown.
 * @param {string} input - Raw signature, display name, or process name.
 * @returns {{ signature: string, known: boolean }}
 * @since v0.1.0
 */
function _canonical(input) {
  const norm = String(input).trim().toLowerCase();
  const id = _aliasToId.get(norm);
  if (id) return { signature: id, known: true };
  return { signature: norm, known: false };
}

/**
 * Normalize a PID into a positive integer or null (any-PID).
 * @param {number|null|undefined} pid
 * @returns {number|null}
 * @throws {TypeError} If pid is present but not a positive integer.
 * @since v0.1.0
 */
function _normalizePid(pid) {
  if (pid === null || pid === undefined) return null;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    throw new TypeError('pid must be a positive integer or null');
  }
  return pid;
}

/**
 * Read the current watchlist array from settings (defensive — never shared ref).
 * @returns {WatchEntry[]}
 * @since v0.1.0
 */
function _readList() {
  const list = config.getSettings().watchlist;
  return Array.isArray(list) ? list : [];
}

/**
 * Persist a watchlist array through the existing config-manager API.
 * Spreads current settings so unrelated keys are never dropped.
 * @param {WatchEntry[]} list
 * @returns {void}
 * @since v0.1.0
 */
function _persist(list) {
  config.saveSettings({ ...config.getSettings(), watchlist: list });
}

/**
 * Add (or update) an agent on the alert-only watchlist.
 * Re-adding the same (signature, pid) pair updates its reason/timestamp rather
 * than creating a duplicate. This sets a flag only — it does not affect the
 * agent or monitoring in any way.
 * @param {{ signature: string, pid?: number|null, reason?: string }} input
 * @returns {WatchEntry} A copy of the stored entry.
 * @throws {TypeError} On an empty/non-string signature or an invalid pid.
 * @since v0.1.0
 */
function add(input) {
  if (!input || typeof input.signature !== 'string' || input.signature.trim() === '') {
    throw new TypeError('signature must be a non-empty string');
  }
  const { signature, known } = _canonical(input.signature);
  const pid = _normalizePid(input.pid);
  const reason = typeof input.reason === 'string' ? input.reason : '';
  const addedAt = Date.now();

  const list = _readList();
  const existing = list.find((e) => e.signature === signature && e.pid === pid);
  if (existing) {
    existing.reason = reason;
    existing.addedAt = addedAt;
    existing.known = known;
    _persist(list);
    return { ...existing };
  }

  /** @type {WatchEntry} */
  const entry = { signature, pid, reason, known, addedAt };
  list.push(entry);
  _persist(list);
  return { ...entry };
}

/**
 * Remove an entry from the watchlist. A null/omitted pid removes only the
 * any-PID entry for that signature, not the per-PID ones.
 * @param {{ signature: string, pid?: number|null }} input
 * @returns {boolean} True if an entry was removed.
 * @throws {TypeError} On an empty/non-string signature or an invalid pid.
 * @since v0.1.0
 */
function remove(input) {
  if (!input || typeof input.signature !== 'string' || input.signature.trim() === '') {
    throw new TypeError('signature must be a non-empty string');
  }
  const { signature } = _canonical(input.signature);
  const pid = _normalizePid(input.pid);

  const list = _readList();
  const next = list.filter((e) => !(e.signature === signature && e.pid === pid));
  if (next.length === list.length) return false;
  _persist(next);
  return true;
}

/**
 * List all watchlist entries (defensive copies — safe to mutate by the caller).
 * @returns {WatchEntry[]}
 * @since v0.1.0
 */
function list() {
  return _readList().map((e) => ({ ...e }));
}

/**
 * Check whether a scanned agent is flagged on the watchlist.
 *
 * Pure read — never mutates state, never persists, and has no effect on
 * monitoring. Matching is **per-PID + signature** and C-01 safe: identity comes
 * from the scanned agent's OWN resolved signature, so a bare-PID coincidence
 * (a different agent that happens to share a PID number) returns false.
 *
 * @param {{ agent?: string, signature?: string, pid?: number|null }} scanned
 *   A scanned-agent object (process-scanner emits `{ agent, pid, ... }`).
 * @returns {boolean} True if an entry matches signature AND (entry.pid is
 *   any-PID or equals the scanned pid).
 * @since v0.1.0
 */
function isFlagged(scanned) {
  if (!scanned) return false;
  const rawSig = scanned.agent ?? scanned.signature;
  if (typeof rawSig !== 'string' || rawSig.trim() === '') return false;
  const { signature } = _canonical(rawSig);
  const pid = typeof scanned.pid === 'number' ? scanned.pid : null;

  for (const entry of _readList()) {
    const entrySig = _canonical(entry.signature).signature;
    if (entrySig !== signature) continue;
    if (entry.pid === null || entry.pid === pid) return true;
  }
  return false;
}

module.exports = { add, remove, list, isFlagged };
