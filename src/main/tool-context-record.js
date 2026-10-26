'use strict';

const { createHash } = require('node:crypto');
const {
  LIMITS,
  REASONS,
  CAPSULE_KEYS,
  keys,
  integer,
  strength,
  dense,
  reasons,
  candidate,
} = require('./tool-context-schema');

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function unavailable(reason) {
  return freeze({
    schemaVersion: 1,
    relation: 'preceded-by',
    strength: 'unattributed',
    reasons: [reason],
    candidateCount: 0,
    candidatesTruncated: false,
    ambiguous: false,
    objectMatch: 'unavailable',
    sessionBinding: 'unavailable',
    candidates: [],
  });
}
function normalize(status, codes, count, selected) {
  const candidateIncomplete = selected.some((c) => c.endMs === null || c.reasons.length > 0);
  if (candidateIncomplete) codes = [...new Set([...codes, 'end-time-unavailable'])].sort();
  const truncated = count > selected.length;
  const ambiguous = count > 1 || codes.includes('ambiguous-tool-calls');
  if (ambiguous)
    codes = [
      ...new Set([
        ...codes.filter((r) => r !== 'exact-binding-object-and-interval'),
        'ambiguous-tool-calls',
      ]),
    ].sort();
  if (truncated) codes = [...new Set([...codes, 'context-truncated'])].sort();
  const complete =
    !candidateIncomplete &&
    !truncated &&
    !ambiguous &&
    codes.length === 1 &&
    codes[0] === 'exact-binding-object-and-interval';
  const confirmed =
    status === 'confirmed' && complete && count === 1 && selected[0]?.strength === 'confirmed';
  const resultStrength =
    count === 0 || status === 'unattributed'
      ? 'unattributed'
      : confirmed
        ? 'confirmed'
        : 'inferred';
  const capsule = {
    schemaVersion: 1,
    relation: 'preceded-by',
    strength: resultStrength,
    reasons: codes,
    candidateCount: count,
    candidatesTruncated: truncated,
    ambiguous,
    objectMatch: count > 0 ? 'matched' : 'unavailable',
    sessionBinding:
      confirmed ||
      (resultStrength === 'inferred' &&
        !candidateIncomplete &&
        !truncated &&
        !ambiguous &&
        count === 1 &&
        codes.length === 2 &&
        codes.includes('exact-session-binding') &&
        codes.includes('clock-skew-assumed-local'))
        ? 'confirmed'
        : 'unavailable',
    candidates: selected.map((c) => ({ ...c, strength: confirmed ? 'confirmed' : 'inferred' })),
  };
  if (Buffer.byteLength(JSON.stringify(capsule), 'utf8') > LIMITS.bytes)
    return unavailable('context-invalid');
  return freeze(capsule);
}

/** Bound and project an existing adapter correlation result; never selects or verifies sessions.
 * Prompt/arguments/environment/response values and unsupported properties reject the capsule.
 * @param {*} result Existing createSessionContext.correlate result.
 * @returns {object} Immutable metadata capsule; malformed input becomes fixed unavailable metadata.
 * @since v0.19.2 */
function createToolContext(result) {
  try {
    if (
      !keys(result, ['strength', 'reasons', 'candidates']) ||
      !strength(result.strength) ||
      !dense(result.candidates, LIMITS.totalCandidates)
    )
      return unavailable('context-invalid');
    const codes = reasons(result.reasons);
    const candidates = result.candidates.map(candidate);
    return normalize(
      result.strength,
      codes,
      candidates.length,
      candidates.slice(0, LIMITS.candidates),
    );
  } catch (_) {
    return unavailable('context-invalid');
  }
}

/** Re-project optional custody metadata. Invalid capsules cannot erase the underlying OS event.
 * @param {*} value Optional toolContext capsule. Undefined is absence; other unsupported data is rejected.
 * @returns {object|undefined} Detached closed metadata, or undefined for historical absence.
 * @since v0.19.2 */
function projectToolContext(value) {
  if (value === undefined) return undefined;
  try {
    if (
      !keys(value, CAPSULE_KEYS) ||
      value.schemaVersion !== 1 ||
      value.relation !== 'preceded-by' ||
      !strength(value.strength) ||
      !integer(value.candidateCount, LIMITS.totalCandidates) ||
      !dense(value.candidates, LIMITS.candidates) ||
      value.candidates.length > Math.min(value.candidateCount, LIMITS.candidates) ||
      typeof value.candidatesTruncated !== 'boolean' ||
      typeof value.ambiguous !== 'boolean' ||
      !['matched', 'unavailable'].includes(value.objectMatch) ||
      !['confirmed', 'unavailable'].includes(value.sessionBinding)
    )
      return unavailable('context-invalid');
    if (
      value.candidatesTruncated !== value.candidateCount > value.candidates.length ||
      value.ambiguous !==
        (value.candidateCount > 1 || value.reasons?.includes('ambiguous-tool-calls'))
    )
      return unavailable('context-invalid');
    if (
      value.candidates.length < Math.min(value.candidateCount, LIMITS.candidates) &&
      (value.strength !== 'unattributed' || !value.reasons?.includes('context-unavailable'))
    )
      return unavailable('context-invalid');
    const projected = normalize(
      value.strength,
      reasons(value.reasons),
      value.candidateCount,
      value.candidates.map(candidate),
    );
    if (
      value.objectMatch !== projected.objectMatch ||
      value.sessionBinding !== projected.sessionBinding
    )
      return unavailable('context-invalid');
    return projected;
  } catch (_) {
    return unavailable('context-invalid');
  }
}

/** Compact optional metadata that cannot fit alongside the underlying OS evidence.
 * @param {*} [value] Prior closed capsule, when its summary is known.
 * @returns {object} Immutable unavailable metadata retaining known total/ambiguity.
 * @since v0.19.2 */
function unavailableToolContext(value) {
  if (value === undefined) return unavailable('context-unavailable');
  const current = projectToolContext(value);
  const codes = ['context-unavailable'];
  if (current.ambiguous) codes.push('ambiguous-tool-calls');
  return normalize('unattributed', codes, current.candidateCount, []);
}
/** Stable material association identity for live dedup/display coalescing.
 * @param {*} value Optional capsule. @returns {string|null} Empty for absence, null when truncated, fixed-size digest otherwise.
 * @since v0.19.2 */
function toolContextKey(value) {
  const projected = projectToolContext(value);
  if (projected === undefined) return '';
  if (projected.candidatesTruncated) return null;
  const ordered = {
    ...projected,
    candidates: [...projected.candidates].sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    ),
  };
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

module.exports = {
  createToolContext,
  projectToolContext,
  unavailableToolContext,
  toolContextKey,
  LIMITS,
  REASONS,
};
