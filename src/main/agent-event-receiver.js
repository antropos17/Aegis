'use strict';

const { randomUUID } = require('node:crypto');
const { TextDecoder } = require('node:util');

const LIMITS = Object.freeze({
  sources: 32,
  attempts: 10000,
  events: 2000,
  identities: 2000,
  lineBytes: 64 * 1024,
  identifierBytes: 256,
});
const KINDS = Object.freeze({ SubagentStart: 'subagent-start', SubagentStop: 'subagent-stop' });
const identifier = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  // eslint-disable-next-line no-control-regex -- Untrusted logical IDs must contain no controls or lone surrogates.
  !/[\x00-\x1f\x7f-\x9f\ud800-\udfff]/u.test(value) &&
  Buffer.byteLength(value, 'utf8') <= LIMITS.identifierBytes;

/**
 * Create an in-memory metadata receiver. Receiver-selected offline and loopback Claude
 * registrations are supported. Handles are object capabilities, not credentials or
 * OS bindings. No transport, persistence, scoring or execution is initialized.
 * @returns {object} Registration, intake, loss, snapshot and close operations.
 * @since v0.15.1
 */
function createAgentEventReceiver() {
  const sources = new Map();
  let attempts = 0;
  let events = 0;
  let identities = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

  /**
   * Register one source epoch using receiver-owned adapter selection.
   * @param {string} adapter claude-code-offline or claude-code-loopback.
   * @returns {object|null} Opaque handle, or null for unsupported/capacity failure.
   * @since v0.15.1
   */
  function register(adapter) {
    if (
      !['claude-code-offline', 'claude-code-loopback'].includes(adapter) ||
      sources.size >= LIMITS.sources
    )
      return null;
    const handle = Object.freeze({ sourceId: randomUUID() });
    sources.set(handle, {
      live: adapter === 'claude-code-loopback',
      closed: false,
      lastSequence: 0,
      missingSequences: 0,
      rejected: 0,
      replayed: 0,
      accepted: 0,
      lossDetected: false,
      identities: 0,
      sessions: new Map(),
      agents: new Map(),
    });
    return handle;
  }

  /**
   * Accept one bounded UTF-8 provider record at a receiver-selected input ordinal.
   * Sequence tracks selected input order only; producer fields cannot choose it.
   * @param {object} handle Exact registered object; serialized copies are invalid.
   * @param {number} sequence Positive safe ordinal, at most the attempt limit.
   * @param {Buffer|null} line Raw JSON bytes, or null for an oversized reader line.
   * @returns {object} Accepted event or fixed rejection code; stop marks a cap.
   * @since v0.15.1
   */
  function receive(handle, sequence, line) {
    const source = sources.get(handle);
    if (!source || source.closed) return { status: 'rejected', code: 'source-unavailable' };
    const reject = (code, status = 'rejected', stop = false) => {
      source.lossDetected = true;
      source.rejected++;
      return { status, code, stop };
    };
    if (attempts >= LIMITS.attempts) return reject('attempt-limit', 'rejected', true);
    attempts++;
    if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > LIMITS.attempts)
      return reject('invalid-sequence');
    if (sequence <= source.lastSequence) {
      source.replayed++;
      return reject('replayed-or-out-of-order');
    }
    const missing = sequence - source.lastSequence - 1;
    source.missingSequences += missing;
    if (missing) source.lossDetected = true;
    // Consume even rejected ordinals. A corrected payload cannot rewrite history.
    source.lastSequence = sequence;
    if (events >= LIMITS.events) return reject('event-limit', 'rejected', true);
    if (line === null || (Buffer.isBuffer(line) && line.length > LIMITS.lineBytes))
      return reject('line-size-limit');
    if (!Buffer.isBuffer(line)) return reject('invalid-event-record');
    let parsed;
    try {
      parsed = JSON.parse(decoder.decode(line));
    } catch (_) {
      return reject('invalid-json-record');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return reject('invalid-event-record');
    if (typeof parsed.hook_event_name !== 'string') return reject('missing-event-kind');
    if (!Object.hasOwn(KINDS, parsed.hook_event_name))
      return reject('unsupported-event', 'unsupported');
    if (!identifier(parsed.session_id) || !identifier(parsed.agent_id))
      return reject('invalid-identifier');
    const sessionKey = parsed.session_id;
    const agentKey = JSON.stringify([sessionKey, parsed.agent_id]);
    const needed = Number(!source.sessions.has(sessionKey)) + Number(!source.agents.has(agentKey));
    if (identities + needed > LIMITS.identities) return reject('identity-limit', 'rejected', true);
    if (!source.sessions.has(sessionKey))
      source.sessions.set(sessionKey, `${handle.sourceId}:s${source.sessions.size + 1}`);
    if (!source.agents.has(agentKey))
      source.agents.set(agentKey, `${handle.sourceId}:a${source.agents.size + 1}`);
    identities += needed;
    source.identities += needed;
    source.accepted++;
    events++;
    return {
      status: 'accepted',
      event: Object.freeze({
        schemaVersion: 1,
        eventId: `${handle.sourceId}:${sequence}`,
        sourceId: handle.sourceId,
        adapter: 'claude-code',
        adapterVersion: 1,
        phase: 'observation',
        kind: KINDS[parsed.hook_event_name],
        record: sequence,
        sessionRef: source.sessions.get(sessionKey),
        agentRef: source.agents.get(agentKey),
        provenance: source.live ? 'source-reported' : 'imported-unverified',
        sourceAuthentication: source.live ? 'bearer-possession' : 'none',
        processBinding: 'unbound',
        transferEvidence: 'unobserved',
        activityCoverage: 'unknown',
        control: 'not-supported',
        decision: 'not-applicable',
      }),
    };
  }

  /**
   * Mark externally detected input loss without retaining a raw error or payload.
   * @param {object} handle Registered source.
   * @returns {void}
   * @since v0.15.1
   */
  function markLoss(handle) {
    const source = sources.get(handle);
    if (source && !source.closed) source.lossDetected = true;
  }

  /**
   * Obtain detached receiver evidence. No status asserts provider coverage.
   * @param {object} handle Registered source.
   * @returns {object|null} Metadata only, or null for an unknown handle.
   * @since v0.15.1
   */
  function snapshot(handle) {
    const source = sources.get(handle);
    if (!source) return null;
    return {
      schemaVersion: 1,
      sourceId: handle.sourceId,
      adapter: 'claude-code',
      adapterVersion: 1,
      transport: source.live ? 'loopback-http' : 'offline-file',
      sourceAuthentication: source.live ? 'bearer-possession' : 'none',
      receiptScope: 'receiver-intake-only',
      sequenceScope: source.live ? 'receiver-arrival' : 'selected-input-records',
      state: source.closed ? 'closed' : 'open',
      lastSequence: source.lastSequence,
      accepted: source.accepted,
      rejected: source.rejected,
      replayed: source.replayed,
      missingSequences: source.missingSequences,
      lossDetected: source.lossDetected,
      activityCoverage: 'unknown',
      identities: source.identities,
      limits: LIMITS,
    };
  }

  /**
   * Revoke intake and release raw IDs. Tombstones and lifetime budgets prevent
   * close/re-register from bypassing caps. New registrations have fresh scopes.
   * @param {object} handle Registered source.
   * @returns {object|null} Final detached receiver evidence.
   * @since v0.15.1
   */
  function close(handle) {
    const source = sources.get(handle);
    if (source) {
      source.closed = true;
      source.sessions.clear();
      source.agents.clear();
    }
    return snapshot(handle);
  }

  return Object.freeze({ register, receive, markLoss, snapshot, close });
}

module.exports = { createAgentEventReceiver, LIMITS };
