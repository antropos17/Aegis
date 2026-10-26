'use strict';

const { createValues, LIMITS, object, text, epoch } = require('./session-context-value');
const { parseRecords } = require('./session-context-parser');

/**
 * Create an isolated local metadata adapter/correlator. This module does no IO,
 * discovery, logging, persistence, IPC, or OS verification. The trusted owner
 * supplies selected session bytes and independently verified process evidence.
 * Transcript fields and lifecycle bearer possession never verify OS identity.
 *
 * @param {{digestKey: Buffer}} options Private per-owner HMAC key, 32..128 bytes.
 * @returns {object} parse, bind, correlate and objectDigest operations.
 * @since v0.19.0
 */
function createSessionContext(options) {
  const values = createValues(options?.digestKey);
  const batches = new WeakMap();
  const bindings = new WeakMap();
  const bySession = new Map();
  const byInstance = new Map();
  const limitBinding = Object.freeze({
    strength: 'unattributed',
    evidence: Object.freeze(['binding-limit']),
  });
  let attempts = 0;

  /** Project one explicitly selected source without retaining its raw bytes.
   * @param {string} source claude-code, codex or gemini-cli.
   * @param {Buffer|null} bytes Complete bounded UTF-8 records; caller retains ownership.
   * @param {object} selection sessionId, absolute cwd, platform win32/posix, optional format json/jsonl and truncation flags.
   * @returns {object} Frozen metadata batch, usable only by this owner.
   * @since v0.19.0 */
  function parse(source, bytes, selection) {
    const parsed = parseRecords(source, bytes, selection, values);
    batches.set(parsed.projection, parsed);
    return parsed.projection;
  }

  /** Bind metadata to a process observed independently by the trusted caller.
   * A confirmed binding requires exact PID + process birth + cwd + session ID,
   * a one-to-one verification, and verified-local-registry or verified-live-enrollment
   * provenance. These labels describe a caller verification contract, never an
   * authentication mechanism. The existing agent-event-receiver cannot supply it.
   * Limit rejection reuses one private owner sentinel; selecting it stops association.
   * @param {object} batch Exact parse result from this owner.
   * @param {object} process Observed pid, startTime (epoch ms), instanceId pid:startTime, absolute cwd and optional endTime.
   * @param {object} evidence Trusted verifier result: sessionId, pid, processStartTime, cwd, oneToOne and provenance.
   * @returns {object} Frozen opaque binding; no raw identifiers or cwd retained.
   * @since v0.19.0 */
  function bind(batch, process, evidence) {
    if (attempts >= LIMITS.records) return limitBinding;
    attempts++;
    const parsed = object(batch) ? batches.get(batch) : null;
    const reasons = [];
    let strength = 'unattributed';
    let instanceRef = null;
    const result = () => {
      const binding = Object.freeze({ strength, evidence: Object.freeze(reasons) });
      if (instanceRef !== null)
        bindings.set(binding, {
          parsed,
          instanceRef,
          startTime: process.startTime,
          endTime: process.endTime ?? null,
          strength,
        });
      return binding;
    };

    if (!parsed) {
      reasons.push('source-unavailable');
      return result();
    }
    if (
      !object(process) ||
      !Number.isSafeInteger(process.pid) ||
      process.pid <= 0 ||
      !epoch(process.startTime) ||
      process.instanceId !== `${process.pid}:${process.startTime}` ||
      (process.endTime != null && (!epoch(process.endTime) || process.endTime < process.startTime))
    ) {
      reasons.push('process-identity-unavailable');
      return result();
    }
    if (
      values.pathDigest(process.cwd, parsed.platform) !== parsed.cwdDigest ||
      !object(evidence) ||
      !text(evidence.sessionId) ||
      values.digest(`session:${batch.source}`, evidence.sessionId) !== batch.sessionRef
    ) {
      reasons.push('session-binding-mismatch');
      return result();
    }
    if (
      (evidence.pid != null && evidence.pid !== process.pid) ||
      (evidence.processStartTime != null && evidence.processStartTime !== process.startTime) ||
      (evidence.cwd != null &&
        values.pathDigest(evidence.cwd, parsed.platform) !== parsed.cwdDigest)
    ) {
      reasons.push('process-binding-mismatch');
      return result();
    }
    if (bySession.size >= LIMITS.calls || byInstance.size >= LIMITS.calls) {
      return limitBinding;
    }
    instanceRef = values.digest('instance', process.instanceId);
    const sessions = byInstance.get(instanceRef) || new Set();
    const instances = bySession.get(batch.sessionRef) || new Set();
    sessions.add(batch.sessionRef);
    instances.add(instanceRef);
    byInstance.set(instanceRef, sessions);
    bySession.set(batch.sessionRef, instances);
    const verified =
      ['verified-local-registry', 'verified-live-enrollment'].includes(evidence.provenance) &&
      evidence.oneToOne === true &&
      evidence.pid === process.pid &&
      evidence.processStartTime === process.startTime &&
      values.pathDigest(evidence.cwd, parsed.platform) === parsed.cwdDigest;
    strength =
      verified && parsed.complete && sessions.size === 1 && instances.size === 1
        ? 'confirmed'
        : 'inferred';
    reasons.push(verified ? 'exact-session-binding' : 'session-binding-inferred');
    if (!parsed.complete) reasons.push('partial-source');
    return result();
  }

  /** Compare an OS event against source-reported preceding tool records.
   * Intervals are inclusive; clockSkewMs means OS time minus provider time.
   * A missing end uses the caller's documented 0..5000ms tolerance. Missing
   * measured skew, time-only overlap and mismatched objects remain unattributed.
   * An explicit same-host-assumed basis permits only inferred association and
   * records that limitation; it never substitutes a measured zero offset.
   * Confirmed describes association evidence, and makes no causal claim.
   * @param {object} event Observed instanceId, atMs, objectKind path/endpoint and objectValue; path platform comes from the selected source.
   * @param {object[]} selected Exact binding results from this owner (max 256).
   * @param {object} timing Measured clockSkewMs (-60000..60000), or clockBasis same-host-assumed without clockSkewMs; missingEndToleranceMs (0..5000).
   * @returns {object} Frozen strength, fixed reasons and all privacy-projected candidates.
   * @since v0.19.0 */
  function correlate(event, selected, timing) {
    const candidates = new Map();
    const verifiedCandidates = new Set();
    const reasons = new Set();
    const reply = (strength) =>
      Object.freeze({
        strength,
        reasons: Object.freeze([...reasons]),
        candidates: Object.freeze([...candidates.values()]),
      });
    if (
      !object(event) ||
      !text(event.instanceId) ||
      !epoch(event.atMs) ||
      !Array.isArray(selected) ||
      selected.length > LIMITS.calls
    ) {
      reasons.add('invalid-event-or-bindings');
      return reply('unattributed');
    }
    // One private reusable sentinel preserves selected loss at any binding cap.
    // It carries no process identity, so its explicit selection stops association.
    if (selected.includes(limitBinding)) {
      reasons.add('binding-limit');
      return reply('unattributed');
    }
    const assumedLocal =
      timing?.clockBasis === 'same-host-assumed' && timing.clockSkewMs === undefined;
    const skewMs = assumedLocal ? 0 : timing?.clockSkewMs;
    if (!object(timing) || !Number.isSafeInteger(skewMs) || Math.abs(skewMs) > LIMITS.skewMs) {
      reasons.add('clock-skew-unavailable');
      return reply('unattributed');
    }
    if (assumedLocal) reasons.add('clock-skew-assumed-local');
    if (
      !Number.isSafeInteger(timing.missingEndToleranceMs) ||
      timing.missingEndToleranceMs < 0 ||
      timing.missingEndToleranceMs > LIMITS.toleranceMs
    ) {
      reasons.add('invalid-time-tolerance');
      return reply('unattributed');
    }
    const instanceRef = values.digest('instance', event.instanceId);
    for (const handle of selected) {
      const binding = object(handle) ? bindings.get(handle) : null;
      if (
        !binding ||
        binding.instanceRef !== instanceRef ||
        event.atMs < binding.startTime ||
        (binding.endTime !== null && event.atMs > binding.endTime)
      ) {
        reasons.add('binding-unavailable-or-outside-lifetime');
        continue;
      }
      const { parsed } = binding;
      if (!parsed.complete) reasons.add('partial-source');
      const digest = values.objectDigest(event.objectKind, event.objectValue, parsed.platform);
      for (const call of parsed.projection.calls) {
        if (call.startMs === null) {
          reasons.add('timestamp-unavailable');
          continue;
        }
        const start = call.startMs + skewMs;
        const end = (call.endMs ?? call.startMs + timing.missingEndToleranceMs) + skewMs;
        if (
          !epoch(start) ||
          !epoch(end) ||
          start < binding.startTime ||
          event.atMs < start ||
          event.atMs > end
        )
          continue;
        if (digest === null || call.objectDigest === null || digest !== call.objectDigest) {
          reasons.add('time-overlap-without-object-match');
          continue;
        }
        const oneToOne =
          bySession.get(call.sessionRef)?.size === 1 && byInstance.get(instanceRef)?.size === 1;
        const strength =
          binding.strength === 'confirmed' && oneToOne && !assumedLocal ? 'confirmed' : 'inferred';
        const candidateKey = `${call.callRef}:${call.argsDigest}:${call.startMs}:${call.endMs}`;
        if (binding.strength === 'confirmed' && oneToOne) verifiedCandidates.add(candidateKey);
        if (!candidates.has(candidateKey) && candidates.size >= LIMITS.calls) {
          candidates.clear();
          reasons.add('candidate-limit');
          return reply('unattributed');
        }
        const prior = candidates.get(candidateKey);
        candidates.set(
          candidateKey,
          Object.freeze({
            ...call,
            deltaMs: event.atMs - start,
            strength: prior?.strength === 'inferred' ? 'inferred' : strength,
          }),
        );
      }
    }
    if (reasons.has('partial-source')) {
      for (const [ref, call] of candidates)
        candidates.set(ref, Object.freeze({ ...call, strength: 'inferred' }));
    }
    if (!candidates.size) {
      reasons.add('no-qualifying-tool-call');
      return reply('unattributed');
    }
    if (candidates.size > 1) {
      for (const [ref, call] of candidates)
        candidates.set(ref, Object.freeze({ ...call, strength: 'inferred' }));
      reasons.add('ambiguous-tool-calls');
      return reply('inferred');
    }
    const strength = [...candidates.values()][0].strength;
    const confirmedBinding = [...candidates.keys()].every((key) => verifiedCandidates.has(key));
    reasons.add(
      strength === 'confirmed'
        ? 'exact-binding-object-and-interval'
        : assumedLocal && confirmedBinding
          ? 'exact-session-binding'
          : 'session-binding-inferred',
    );
    return reply(strength);
  }

  /** Compute comparable keyed lexical object metadata without returning raw values.
   * @param {'path'|'endpoint'} kind Object category.
   * @param {string} value Absolute path or HTTP(S) URL.
   * @param {'win32'|'posix'} platform Explicit path semantics.
   * @returns {string|null} Digest, or null when normalization is unavailable.
   * @since v0.19.0 */
  function objectDigest(kind, value, platform) {
    return values.objectDigest(kind, value, platform);
  }

  return Object.freeze({ parse, bind, correlate, objectDigest });
}

module.exports = { createSessionContext, LIMITS };
