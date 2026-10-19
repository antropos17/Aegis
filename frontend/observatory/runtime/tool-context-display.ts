import type { RecordData } from './host';

interface CandidateView {
  key: string;
  provider: string;
  tool: string;
  timing: string;
  deltaMs: number;
  association: string;
  relation: string;
  complete: boolean;
  incompleteTiming: boolean;
}
export interface ToolContextView {
  association: string;
  binding: string;
  object: string;
  count: number | null;
  truncated: boolean;
  ambiguous: boolean;
  reasons: string[];
  candidates: CandidateView[];
}
const providers: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  'gemini-cli': 'Gemini CLI',
};
const tools: Record<string, readonly string[]> = {
  'claude-code': ['Read', 'Write', 'Edit', 'Bash', 'WebFetch', 'other'],
  codex: ['exec_command', 'shell_command', 'shell', 'other'],
  'gemini-cli': ['read_file', 'write_file', 'replace', 'run_shell_command', 'web_fetch', 'other'],
};
const reasonLabels: Record<string, string> = {
  'ambiguous-tool-calls': 'Several tool calls qualify; a single call cannot be selected.',
  'clock-skew-unavailable': 'Clock alignment is unavailable.',
  'end-time-unavailable': 'A tool completion time was not recorded.',
  'exact-binding-object-and-interval': 'Session binding, object and time interval matched.',
  'exact-session-binding': 'The recorded session binding matched.',
  'no-qualifying-tool-call': 'No qualifying preceding tool call was recorded.',
  'object-unavailable': 'An object match is unavailable.',
  'process-binding-mismatch': 'The process binding did not match.',
  'process-identity-unavailable': 'The process identity needed for binding is unavailable.',
  'session-binding-inferred': 'The session binding is indirect.',
  'session-binding-mismatch': 'The session binding did not match.',
  'session-metadata-unavailable': 'Session metadata is unavailable.',
  'session-mismatch': 'The recorded sessions did not match.',
  'source-unavailable': 'The tool history source is unavailable.',
  'time-overlap-without-object-match': 'Timing overlapped without a matching object.',
  'timestamp-unavailable': 'The time needed for comparison is unavailable.',
  'binding-unavailable-or-outside-lifetime':
    'A session binding within the process lifetime is unavailable.',
  'partial-source': 'Only part of the tool history was available.',
  'unsupported-history-edit': 'The tool history was edited in an unsupported way.',
  'context-invalid': 'Recorded tool context could not be validated.',
  'context-unavailable': 'Tool context is unavailable for this observation.',
  'context-truncated': 'The retained tool context is incomplete.',
};
const limitedReasons = new Set([
  'argument-limit',
  'binding-limit',
  'call-limit',
  'candidate-limit',
  'oversize-input',
  'oversize-record',
  'record-limit',
  'truncated-input',
]);
const unsupportedReasons = new Set([
  'unsupported-format',
  'unsupported-source',
  'unsupported-tool-record',
]);
const invalidReasons = new Set([
  'duplicate-call-id',
  'duplicate-tool-end',
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
]);
const knownReason = (value: unknown): value is string =>
  typeof value === 'string' &&
  (Object.hasOwn(reasonLabels, value) ||
    limitedReasons.has(value) ||
    unsupportedReasons.has(value) ||
    invalidReasons.has(value));
const positiveReasons = new Set(['exact-binding-object-and-interval', 'exact-session-binding']);
const unavailableReasons = new Set([
  'context-invalid',
  'context-unavailable',
  'source-unavailable',
  'clock-skew-unavailable',
  'timestamp-unavailable',
  'no-qualifying-tool-call',
  'time-overlap-without-object-match',
]);
const oneOf = (value: unknown, choices: readonly string[]): value is string =>
  typeof value === 'string' && choices.includes(value);
const object = (value: unknown): value is RecordData =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= 8640000000000000;
const digest = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const association = (strength: unknown): string =>
  strength === 'confirmed'
    ? 'Matched preceding call'
    : strength === 'inferred'
      ? 'Possible preceding call'
      : 'Unavailable';
const reasonLabel = (code: unknown, complete: boolean): string => {
  if (typeof code !== 'string') return 'Recorded tool context could not be validated.';
  if (!complete && positiveReasons.has(code))
    return 'A positive diagnostic was recorded; current evidence limits the association.';
  if (Object.hasOwn(reasonLabels, code)) return reasonLabels[code];
  if (limitedReasons.has(code)) return 'Tool history or candidate limits were reached.';
  if (unsupportedReasons.has(code)) return 'The tool history format or source is unsupported.';
  if (invalidReasons.has(code)) return 'Tool history metadata could not be validated.';
  return 'Recorded tool context could not be validated.';
};
const unavailable = (reason: string): ToolContextView => ({
  association: 'Unavailable',
  binding: 'Unavailable',
  object: 'Unavailable',
  count: null,
  truncated: false,
  ambiguous: false,
  reasons: [reason],
  candidates: [],
});
function candidateView(value: unknown, index: number): CandidateView | null {
  if (
    !object(value) ||
    typeof value.source !== 'string' ||
    !Object.hasOwn(tools, value.source) ||
    typeof value.toolName !== 'string' ||
    !tools[value.source].includes(value.toolName) ||
    !digest(value.callRef) ||
    !digest(value.sessionRef) ||
    !digest(value.argsDigest) ||
    !digest(value.objectDigest) ||
    !integer(value.startMs) ||
    !integer(value.deltaMs) ||
    (value.endMs !== null && (!integer(value.endMs) || value.endMs < value.startMs)) ||
    !oneOf(value.strength, ['confirmed', 'inferred']) ||
    !object(value.argsShape) ||
    !oneOf(value.argsShape.operation, ['read', 'write', 'shell', 'fetch', 'other']) ||
    !oneOf(value.argsShape.objectKind, ['path', 'endpoint', 'none']) ||
    !Array.isArray(value.reasons) ||
    value.reasons.length > 1 ||
    value.reasons.some((reason) => reason !== 'end-time-unavailable')
  )
    return null;
  if (
    value.argsShape.objectKind === 'none' ||
    value.argsShape.operation === 'shell' ||
    value.argsShape.operation === 'other' ||
    value.source === 'codex' ||
    (value.endMs !== null && value.deltaMs > value.endMs - value.startMs) ||
    (value.endMs === null && value.deltaMs > 5000)
  )
    return null;
  return {
    key: value.callRef + ':' + index,
    provider: providers[value.source],
    tool: value.toolName === 'other' ? 'Other tool' : value.toolName,
    timing:
      value.endMs === null || value.reasons.includes('end-time-unavailable')
        ? 'Observation {deltaMs} ms after reported tool start; completion time unavailable'
        : 'Observation {deltaMs} ms after reported tool start; within reported tool window',
    deltaMs: value.deltaMs,
    association: association(value.endMs === null ? 'inferred' : value.strength),
    relation: 'Recorded tool candidate',
    complete: value.strength === 'confirmed' && value.endMs !== null && value.reasons.length === 0,
    incompleteTiming: value.endMs === null || value.reasons.includes('end-time-unavailable'),
  };
}

/** Project bounded metadata into fixed UI labels; never display tool payloads or references.
 * @param row Live observation or retained audit row @returns Display state @since 0.19.2
 */
export function toolContextView(row: RecordData): ToolContextView {
  const extra = object(row.extra) ? row.extra : {};
  const details = object(row.details) ? row.details : {};
  const value: unknown = Object.hasOwn(row, 'toolContext')
    ? row.toolContext
    : Object.hasOwn(extra, 'toolContext')
      ? extra.toolContext
      : details.toolContext;
  if (value === undefined)
    return unavailable('Tool context was not recorded for this observation.');
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    value.relation !== 'preceded-by' ||
    !oneOf(value.strength, ['confirmed', 'inferred', 'unattributed']) ||
    !integer(value.candidateCount) ||
    value.candidateCount > 256 ||
    typeof value.candidatesTruncated !== 'boolean' ||
    typeof value.ambiguous !== 'boolean' ||
    !oneOf(value.objectMatch, ['matched', 'unavailable']) ||
    !oneOf(value.sessionBinding, ['confirmed', 'unavailable']) ||
    !Array.isArray(value.reasons) ||
    value.reasons.length > 64 ||
    !value.reasons.every(knownReason) ||
    !Array.isArray(value.candidates) ||
    value.candidates.length > 8 ||
    value.candidateCount < value.candidates.length
  ) {
    return unavailable('Recorded tool context could not be validated.');
  }
  const projected = value.candidates.map(candidateView);
  if (projected.some((candidate) => candidate === null))
    return unavailable('Recorded tool context could not be validated.');
  const candidates = projected.filter(
    (candidate): candidate is CandidateView => candidate !== null,
  );
  const ambiguous = value.ambiguous || value.candidateCount > 1;
  const truncated = value.candidatesTruncated || value.candidateCount > candidates.length;
  const complete =
    !ambiguous &&
    !truncated &&
    value.strength === 'confirmed' &&
    value.reasons.every((reason) => positiveReasons.has(reason)) &&
    candidates.length === 1 &&
    candidates.every((candidate) => candidate.complete) &&
    value.objectMatch === 'matched' &&
    value.sessionBinding === 'confirmed';
  const blocked =
    value.strength === 'unattributed' ||
    !candidates.length ||
    value.reasons.some(
      (reason) =>
        unavailableReasons.has(reason) ||
        invalidReasons.has(reason) ||
        unsupportedReasons.has(reason),
    );
  const strength = blocked ? 'unattributed' : complete ? 'confirmed' : 'inferred';
  const reasons = [...value.reasons];
  if (candidates.some((candidate) => candidate.incompleteTiming))
    reasons.push('end-time-unavailable');
  return {
    association: association(strength),
    binding:
      value.sessionBinding !== 'confirmed'
        ? 'Unavailable'
        : complete
          ? 'Recorded session binding matched'
          : 'Recorded session binding; association limited',
    object:
      value.objectMatch !== 'matched'
        ? 'Unavailable'
        : complete
          ? 'Recorded object matched'
          : 'Recorded object comparison; association limited',
    count: value.candidateCount,
    truncated,
    ambiguous,
    reasons: [...new Set(reasons.map((reason) => reasonLabel(reason, complete)))],
    candidates: candidates.map((candidate) => ({
      ...candidate,
      association: association(strength),
      relation: complete
        ? 'Preceded this observation'
        : blocked
          ? 'Recorded tool candidate'
          : 'May have preceded this observation',
      timing: blocked ? 'Tool timing could not be related to this observation.' : candidate.timing,
    })),
  };
}

/** Detect an explicitly recorded capsule without interpreting unrelated metadata.
 * @param row Detail record @returns Whether a capsule is present @since 0.19.2
 */
export function hasToolContext(row: RecordData): boolean {
  return (
    Object.hasOwn(row, 'toolContext') ||
    (object(row.extra) && Object.hasOwn(row.extra, 'toolContext')) ||
    (object(row.details) && Object.hasOwn(row.details, 'toolContext'))
  );
}

/** Keep tool capsules out of generic attribute rendering, including historical wrappers.
 * @param row Detail attributes @param marker Fixed translated limit marker @returns Attributes without the capsule @since 0.19.2
 */
export function withoutToolContext(
  row: RecordData,
  marker = 'Additional metadata unavailable',
): RecordData {
  const seen = new WeakSet<object>();
  let items = 0;
  let bytes = 0;
  const size = (text: string): number =>
    text.length > 32768 ? 32769 : new TextEncoder().encode(text).length;
  const walk = (input: unknown, depth: number): unknown => {
    if (++items > 512 || depth > 6) return marker;
    if (typeof input === 'string') {
      bytes += size(input);
      return bytes > 32768 ? marker : input;
    }
    if (input === null || typeof input === 'boolean' || typeof input === 'number') return input;
    if (typeof input !== 'object') return marker;
    if (seen.has(input)) return marker;
    seen.add(input);
    const entries: [string, unknown][] = [];
    for (const key in input) {
      if (!Object.hasOwn(input, key) || key.toLowerCase() === 'toolcontext') continue;
      bytes += size(key);
      if (entries.length >= 128 || items >= 512 || bytes > 32768) {
        entries.push(['Additional metadata', marker]);
        break;
      }
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      entries.push([
        key,
        descriptor && Object.hasOwn(descriptor, 'value')
          ? walk(descriptor.value, depth + 1)
          : marker,
      ]);
    }
    seen.delete(input);
    return Array.isArray(input) ? entries.map(([, value]) => value) : Object.fromEntries(entries);
  };
  const safe = walk(row, 0);
  return object(safe) ? safe : {};
}
