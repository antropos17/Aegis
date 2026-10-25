'use strict';

const LIMITS = Object.freeze({
  bytes: 8192,
  candidates: 8,
  totalCandidates: 256,
  reasons: 64,
  epoch: 8640000000000000,
});
const REASONS = Object.freeze([
  'ambiguous-tool-calls',
  'argument-limit',
  'binding-limit',
  'binding-unavailable-or-outside-lifetime',
  'call-limit',
  'candidate-limit',
  'clock-skew-unavailable',
  'clock-skew-assumed-local',
  'duplicate-call-id',
  'duplicate-tool-end',
  'end-time-unavailable',
  'exact-binding-object-and-interval',
  'exact-session-binding',
  'invalid-encoding-or-json',
  'invalid-event-or-bindings',
  'invalid-input',
  'invalid-json-record',
  'invalid-record',
  'invalid-selection',
  'invalid-session-metadata',
  'invalid-time-tolerance',
  'invalid-tool-arguments',
  'invalid-tool-end',
  'invalid-tool-record',
  'no-qualifying-tool-call',
  'object-unavailable',
  'oversize-input',
  'oversize-record',
  'partial-source',
  'process-binding-mismatch',
  'process-identity-unavailable',
  'record-limit',
  'session-binding-inferred',
  'session-binding-mismatch',
  'session-metadata-unavailable',
  'session-mismatch',
  'source-unavailable',
  'time-overlap-without-object-match',
  'timestamp-unavailable',
  'truncated-input',
  'unsupported-format',
  'unsupported-history-edit',
  'unsupported-source',
  'unsupported-tool-record',
  'context-invalid',
  'context-unavailable',
  'context-truncated',
]);
const TOOLS = Object.freeze({
  'claude-code': {
    Read: ['read', 'path'],
    Write: ['write', 'path'],
    Edit: ['write', 'path'],
    Bash: ['shell', 'none'],
    WebFetch: ['fetch', 'endpoint'],
    other: ['other', 'none'],
  },
  codex: {
    exec_command: ['shell', 'none'],
    shell_command: ['shell', 'none'],
    shell: ['shell', 'none'],
    other: ['other', 'none'],
  },
  'gemini-cli': {
    read_file: ['read', 'path'],
    write_file: ['write', 'path'],
    replace: ['write', 'path'],
    run_shell_command: ['shell', 'none'],
    web_fetch: ['fetch', 'none'],
    other: ['other', 'none'],
  },
});
const CANDIDATE_KEYS = [
  'source',
  'sessionRef',
  'callRef',
  'toolName',
  'argsDigest',
  'argsShape',
  'objectDigest',
  'startMs',
  'endMs',
  'deltaMs',
  'strength',
  'reasons',
];
const CAPSULE_KEYS = [
  'schemaVersion',
  'relation',
  'strength',
  'reasons',
  'candidateCount',
  'candidatesTruncated',
  'ambiguous',
  'objectMatch',
  'sessionBinding',
  'candidates',
];
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Check a closed record shape. @param {*} v Value. @param {string[]} list Allowed keys. @returns {boolean} Exact shape. @since v0.19.2 */
const keys = (v, list) =>
  object(v) && Object.keys(v).length === list.length && list.every((k) => Object.hasOwn(v, k));
/** Check bounded safe integers. @param {*} v Value. @param {number} [max] Maximum. @returns {boolean} Valid bound. @since v0.19.2 */
const integer = (v, max = LIMITS.epoch) => Number.isSafeInteger(v) && v >= 0 && v <= max;
const digest = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
/** Check association labels. @param {*} v Value. @returns {boolean} Closed label. @since v0.19.2 */
const strength = (v) => ['confirmed', 'inferred', 'unattributed'].includes(v);

/** Check finite dense input arrays before projecting. @param {*} value Input. @param {number} max Capacity. @returns {boolean} Dense bounded array. @since v0.19.2 */
function dense(value, max) {
  if (!Array.isArray(value) || value.length > max || Object.keys(value).length !== value.length)
    return false;
  for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i)) return false;
  return true;
}
/** Validate a closed bounded diagnostic set without retaining unknown values.
 * @param {*} value Candidate reason list. @returns {string[]} Sorted unique codes. @since v0.19.2 */
function reasons(value) {
  if (!dense(value, LIMITS.reasons) || value.some((r) => !REASONS.includes(r)))
    throw Error('context-invalid');
  return [...new Set(value)].sort();
}

/** Project only one existing correlation candidate; this verifies shape, not OS authority.
 * @param {*} v Metadata from the local adapter. @returns {object} Detached closed candidate. @since v0.19.2 */
function candidate(v) {
  if (!keys(v, CANDIDATE_KEYS)) throw Error('context-invalid');
  const sourceValue = v.source;
  const toolValue = v.toolName;
  if (
    typeof sourceValue !== 'string' ||
    typeof toolValue !== 'string' ||
    !Object.hasOwn(TOOLS, sourceValue) ||
    !Object.hasOwn(TOOLS[sourceValue], toolValue) ||
    !['confirmed', 'inferred'].includes(v.strength)
  )
    throw Error('context-invalid');
  // Copy primitive canonical enum values; never retain objects or invoke their coercion hooks.
  const source = Object.keys(TOOLS).find((name) => name === sourceValue);
  const toolName = Object.keys(TOOLS[source]).find((name) => name === toolValue);
  const spec = TOOLS[source][toolName];
  if (spec[1] === 'none') throw Error('context-invalid');
  if (
    !keys(v.argsShape, ['operation', 'objectKind']) ||
    v.argsShape.operation !== spec[0] ||
    v.argsShape.objectKind !== spec[1]
  )
    throw Error('context-invalid');
  // Only matched objects with known start times can be correlation candidates.
  if (
    ![v.sessionRef, v.callRef, v.argsDigest, v.objectDigest].every(digest) ||
    !integer(v.startMs) ||
    !integer(v.deltaMs) ||
    (v.endMs !== null && (!integer(v.endMs) || v.endMs < v.startMs))
  )
    throw Error('context-invalid');
  if (v.deltaMs > (v.endMs === null ? 5000 : v.endMs - v.startMs)) throw Error('context-invalid');
  const codes = reasons(v.reasons);
  if (codes.some((r) => !['end-time-unavailable'].includes(r))) throw Error('context-invalid');
  return {
    source,
    sessionRef: v.sessionRef,
    callRef: v.callRef,
    toolName,
    argsDigest: v.argsDigest,
    argsShape: { operation: spec[0], objectKind: spec[1] },
    objectDigest: v.objectDigest,
    startMs: v.startMs,
    endMs: v.endMs,
    deltaMs: v.deltaMs,
    strength: v.strength,
    reasons: codes,
  };
}

module.exports = {
  LIMITS,
  REASONS,
  CAPSULE_KEYS,
  keys,
  integer,
  strength,
  dense,
  reasons,
  candidate,
};
