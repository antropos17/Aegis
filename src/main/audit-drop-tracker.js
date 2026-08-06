/**
 * @file audit-drop-tracker.js
 * @module main/audit-drop-tracker
 * @description Bookkeeping for audit entries evicted from the write buffer, and the
 *   marker record that makes the loss visible on disk.
 *
 *   Why a marker record exists at all: the hash chain in audit-hashchain.js proves that
 *   no surviving record was EDITED. It cannot prove that none was LOST, because an entry
 *   dropped before it was ever written leaves no gap — seq numbers are assigned at flush
 *   time, so the file that remains is a perfectly valid chain that is simply missing
 *   events. Without a marker, an operator reading the JSONL cannot tell a complete file
 *   from a silently truncated one. The marker is the minimum signal that lets the file
 *   describe its own incompleteness.
 *
 *   Two counters, deliberately distinct:
 *   - `pending` — drops since the last SUCCESSFUL flush. This is what the next marker
 *     reports, and it survives a failed flush so the marker written on recovery covers
 *     every drop across all failed attempts rather than only the last batch.
 *   - `total` — every drop in this process lifetime. Surfaced via getStats() and reset
 *     on restart; the durable cross-restart record is the marker on disk, not this
 *     number.
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.11.0
 */

'use strict';

/**
 * Record `type` for the loss marker. A reader filters on this to separate
 * internally-generated bookkeeping from real agent activity.
 * @type {string}
 * @since v0.11.0
 */
const MARKER_TYPE = 'buffer-overflow-drop';

/** @type {number} Cumulative evictions this process lifetime. */
let _total = 0;
/** @type {number} Evictions since the last successful flush — what the next marker reports. */
let _pending = 0;
/** @type {string|null} Timestamp of the first entry evicted in the pending window. */
let _firstTs = null;
/** @type {string|null} Timestamp of the most recent entry evicted in the pending window. */
let _lastTs = null;

/**
 * Clear all drop state. Called from audit-logger's `init()` so a new session starts at
 * zero — drop counts describe the current process, never a previous one.
 * @returns {void}
 * @since v0.11.0
 */
function reset() {
  _total = 0;
  _pending = 0;
  _firstTs = null;
  _lastTs = null;
}

/**
 * Record one evicted entry.
 * @param {string} timestamp - The evicted entry's own ISO timestamp, so the reported
 *   loss window describes when the events HAPPENED, not when they were dropped.
 * @returns {void}
 * @since v0.11.0
 */
function record(timestamp) {
  _total += 1;
  _pending += 1;
  if (_firstTs === null) _firstTs = timestamp;
  _lastTs = timestamp;
}

/**
 * Drops awaiting a marker. `flush()` gates on this in addition to buffer emptiness, so a
 * pending marker is never swallowed by an early return.
 * @returns {number}
 * @since v0.11.0
 */
function pendingCount() {
  return _pending;
}

/**
 * Cumulative evictions this process lifetime.
 * @returns {number}
 * @since v0.11.0
 */
function totalDropped() {
  return _total;
}

/**
 * Build the marker record for the pending window. Field set is IDENTICAL to a normal
 * audit entry so the canonical hash and every reader see one consistent shape.
 *
 * `agent` is `''`, `pid`/`instanceId` are `null`, and `attribution` is `null`: no agent owns
 * this record, so there is nothing to attribute and substituting an owner would credit a
 * bookkeeping event to real software (C-01). `attribution: null` here means the question does
 * not apply — not that the owner is unknown.
 * @param {string} nowIso - ISO timestamp for the marker itself.
 * @param {number} schemaVersion - Event Schema version, supplied by the writer that owns the
 *   record format (audit-logger) so the version lives in exactly one place.
 * @returns {Object} Marker record WITHOUT seq/hash — the caller chains it like any entry.
 * @since v0.11.0
 */
function buildMarker(nowIso, schemaVersion) {
  return {
    schemaVersion,
    timestamp: nowIso,
    type: MARKER_TYPE,
    agent: '',
    pid: null,
    instanceId: null,
    action: '',
    path: '',
    severity: 'high',
    riskScore: 0,
    attribution: null,
    details: {
      droppedCount: _pending,
      firstDropTs: _firstTs,
      lastDropTs: _lastTs,
      reason: 'buffer-cap-exceeded',
    },
  };
}

/**
 * Clear the pending window after a marker has been durably written. `total` is NOT
 * cleared — it counts the whole session. Call this ONLY after a successful write, or the
 * loss it describes becomes invisible.
 * @returns {void}
 * @since v0.11.0
 */
function clearPending() {
  _pending = 0;
  _firstTs = null;
  _lastTs = null;
}

module.exports = {
  MARKER_TYPE,
  reset,
  record,
  pendingCount,
  totalDropped,
  buildMarker,
  clearPending,
};
