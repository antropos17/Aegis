/**
 * @file audit-normalize.js
 * @module main/audit-normalize
 * @description Read-side normalizer that presents a pre-v1 audit record in the v1 shape.
 *
 *   Event Schema v1 moved `pid`, `instanceId` and `attribution` to top-level fields. Records
 *   written before that carry them — when they carry them at all — inside `details`. This
 *   module gives a reader ONE shape to code against without rewriting a single byte on disk:
 *   the daily files are append-only and hash-chained, so they are never modified.
 *
 *   The rule that matters here is what it REFUSES to do. It never invents a value for
 *   something a v0 record did not record:
 *
 *   - A v0 file event stored only the derived status string (`'confirmed'`), so the evidence
 *     array is genuinely unknown and comes back as `null` — NOT `[]`. Those are different
 *     claims: "never recorded" versus "recorded as empty". The return type
 *     `NormalizedAttribution` is deliberately not assignable to `Attribution` for this
 *     reason, so mixing a normalized record into code expecting real evidence fails
 *     typecheck instead of silently reading `null` as "no evidence found".
 *   - A record with no attribution information at all gets `attribution: null`, meaning the
 *     question is unanswered for it. Back-filling `{status: 'unattributed'}` would be
 *     asserting a determination nobody made — pre-v0.11.0 records predate attribution
 *     entirely, and loss markers never had an owner to begin with.
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.12.0
 */

'use strict';

/**
 * Present one parsed audit record in the v1 shape.
 *
 * A v1 record (`schemaVersion` present) is returned unchanged — it is already normalized,
 * and copying it would only risk drift. A v0 record gets the three v1 fields added, filled
 * from `details` where the information exists and `null` where it does not.
 *
 * `details` is left as it was found, including the keys that were promoted: the record on
 * disk still contains them, and silently deleting them here would make the normalized view
 * disagree with the file it came from.
 * @param {Object} entry - A record parsed from a daily audit file.
 * @returns {Object} The same record, or a v0 record widened to the v1 field set. Never
 *   mutates the input.
 * @since v0.12.0
 */
function normalizeAuditEntry(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  if (entry.schemaVersion !== undefined) return entry;

  const d = entry.details && typeof entry.details === 'object' ? entry.details : null;

  // v0 stored the STATUS STRING only. A non-string means the field was absent or held
  // something else, in which case there is no attribution to report.
  const attribution =
    d && typeof d.attribution === 'string' ? { status: d.attribution, evidence: null } : null;

  return {
    ...entry,
    pid: entry.pid ?? (d && typeof d.pid === 'number' ? d.pid : null),
    instanceId: entry.instanceId ?? (d && typeof d.instanceId === 'string' ? d.instanceId : null),
    attribution,
  };
}

module.exports = { normalizeAuditEntry };
