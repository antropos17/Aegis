/** @file Private, one-use operational custody for explicit object-bound ETW reads. */
'use strict';
const { randomUUID, randomBytes, createHmac } = require('node:crypto');
const { validObservation, verifiedIssuer, id } = require('./etw-file-schema');
const scope = require('./etw-file-scope');
const PROFILE = 'win11-x64-26300.9457-experimental';
const MAX_PENDING = 256;
const MAX_BYTES = 1024 * 1024;
const CONTINUITY_KEYS = [
  'telemetryAvailable',
  'operational',
  'querySucceeded',
  'eventsLostZero',
  'realTimeBuffersLostZero',
  'logBuffersLostZero',
  'droppedZero',
  'decoderErrorsZero',
  'mapEpochZero',
  'mapResetsZero',
  'mapConflictsZero',
  'stickyClear',
];
const withinRoot = (label, root) =>
  scope.validRoot(root) &&
  typeof label === 'string' &&
  !/[\p{Cc}/]/u.test(label) &&
  !label.slice(3).includes(':') &&
  label.toLowerCase().startsWith(root.replace(/\\$/, '').toLowerCase() + '\\') &&
  label.split('\\').every((part) => part !== '.' && part !== '..' && !/[. ]$/.test(part));

/** Own policy-before-read handshakes and session-local, one-use claims.
 * @param {Object} deps Trusted runtime callbacks; raw capsules never leave this owner.
 * @returns {Object} Session, intake, binding ACK and claim methods. @since v0.20.1
 */
function createAdmission({
  now = Date.now,
  getAgents,
  getHealth,
  getRoot,
  onRead = () => false,
  onBindingCandidate = () => null,
  isPolicyCurrent = () => false,
  sendBinding = () => false,
  idFactory = randomUUID,
}) {
  let context = null,
    scopeGeneration = null,
    secret = randomBytes(32),
    tokens = new WeakMap();
  let bindings = new Map(),
    pending = [],
    pendingBytes = 0,
    lastSeq = 0n;
  let revoked = false,
    firstRevocation = null,
    consumerRejected = 0,
    pendingDropped = 0,
    accepted = 0,
    bindingDropped = 0;
  function clear() {
    tokens = new WeakMap();
    bindings.clear();
    pending = [];
    pendingBytes = 0;
  }
  function expireBindings() {
    for (const [key, value] of bindings)
      if (now() - value.at > 10000 || !isPolicyCurrent(value.policyGeneration))
        bindings.delete(key);
  }
  function actor(pid, birth) {
    const health = getHealth();
    if (health?.populationReliable !== true || health.identityDegraded === true) return null;
    const epochMs = Number((BigInt(birth) - 116444736000000000n) / 10000n);
    const rows = getAgents();
    if (
      !Number.isSafeInteger(epochMs) ||
      epochMs <= 0 ||
      !Array.isArray(rows) ||
      rows.length > 4096
    )
      return null;
    const matches = rows.filter(
      (row) =>
        row.pid === pid &&
        row.createTime100ns === birth &&
        row.instanceIdSource === 'os' &&
        row.instanceId === `${pid}:${epochMs}` &&
        typeof row.agent === 'string' &&
        row.agent.length > 0,
    );
    if (matches.length !== 1) return null;
    const row = matches[0];
    return Object.freeze({
      pid,
      agent: row.agent,
      category: row.category,
      instanceId: row.instanceId,
      createTime100ns: birth,
      instanceIdSource: 'os',
      ...(row.parentEditor === undefined ? {} : { parentEditor: row.parentEditor }),
      ...(row.cwd === undefined ? {} : { cwd: row.cwd }),
    });
  }
  function active() {
    return (
      !revoked &&
      scopeGeneration !== null &&
      context?.active === true &&
      context.continuous === true &&
      context.objectBridge === PROFILE
    );
  }
  function qualificationConditions() {
    return Object.freeze({
      qualified: active(),
      revoked,
      scopePresent: scopeGeneration !== null,
      contextPresent: context !== null,
      contextActive: context?.active === true,
      continuous: context?.continuous === true,
      exactProfile: context?.objectBridge === PROFILE,
    });
  }
  function continuityConditions() {
    return Object.freeze(
      Object.fromEntries(CONTINUITY_KEYS.map((key) => [key, context?.continuity?.[key] === true])),
    );
  }
  function rememberRevocation(cause) {
    if (firstRevocation === null)
      firstRevocation = Object.freeze({
        cause,
        conditions: qualificationConditions(),
        continuity: continuityConditions(),
      });
  }
  function qualification() {
    return Object.freeze({
      schema: 'aegis-etw-object-qualification/1',
      conditions: qualificationConditions(),
      continuity: continuityConditions(),
      firstRevocation,
    });
  }
  function policyValid(value) {
    return (
      value &&
      id(value.scopeGeneration) &&
      value.scopeGeneration === scopeGeneration &&
      id(value.policyGeneration) &&
      value.policy &&
      typeof value.policy.sensitive === 'boolean' &&
      typeof value.policy.reason === 'string' &&
      Buffer.byteLength(value.policy.reason) <= 1024 &&
      !/\p{Cc}/u.test(value.policy.reason) &&
      ['ssh-aws', 'agent-config', 'sensitive', 'ordinary'].includes(value.policy.classification) &&
      value.policy.sensitive === (value.policy.classification !== 'ordinary')
    );
  }
  function candidate(value) {
    expireBindings();
    if (bindings.size >= 64) {
      bindingDropped++;
      return;
    }
    if (!active() || bindings.has(value.bindingId) || !withinRoot(value.label, getRoot())) return;
    const matched = actor(value.issuerPid, value.createTime100ns);
    if (!matched) return;
    let result;
    try {
      result = onBindingCandidate(Object.freeze({ ...value }), { scopeGeneration, actor: matched });
    } catch {
      return;
    }
    if (!policyValid(result) || !isPolicyCurrent(result.policyGeneration)) return;
    const bound = {
      ...value,
      requestId: idFactory(),
      scopeGeneration,
      policyGeneration: result.policyGeneration,
      policy: Object.freeze({
        sensitive: result.policy.sensitive,
        reason: result.policy.reason,
        classification: result.policy.classification,
      }),
      ack: null,
      at: now(),
    };
    bindings.set(value.bindingId, bound);
    if (
      !sendBinding({
        requestId: bound.requestId,
        bindingId: bound.bindingId,
        scopeGeneration,
        policyGeneration: bound.policyGeneration,
      })
    )
      bindings.delete(value.bindingId);
  }
  function eventTime(proof, qpc) {
    try {
      const frequency = BigInt(context.frequency),
        ready = context.clock,
        fresh = proof.clock;
      if (
        frequency <= 0n ||
        frequency > BigInt(Number.MAX_SAFE_INTEGER) ||
        !ready ||
        !Number.isSafeInteger(Number(ready.unixMs)) ||
        !Number.isSafeInteger(Number(fresh.unixMs)) ||
        BigInt(fresh.qpc) < BigInt(ready.qpc)
      )
        return null;
      const freshUncertainty = Number(BigInt(fresh.uncertaintyQpc) * 1000n) / Number(frequency);
      const readyUncertainty = Number(BigInt(ready.uncertaintyQpc) * 1000n) / Number(frequency);
      if (freshUncertainty > 10 || readyUncertainty > 10) return null;
      const elapsed = (Number(BigInt(fresh.qpc) - BigInt(ready.qpc)) * 1000) / Number(frequency);
      if (
        Math.abs(Number(fresh.unixMs) - Number(ready.unixMs) - elapsed) >
        100 + freshUncertainty + readyUncertainty
      )
        return null;
      const value = Math.floor(
        Number(fresh.unixMs) - (Number(BigInt(fresh.qpc) - BigInt(qpc)) * 1000) / Number(frequency),
      );
      return Number.isSafeInteger(value) && value <= now() + 10 && now() - value <= 10000
        ? value
        : null;
    } catch {
      return null;
    }
  }
  function claim(record) {
    const proof = record.objectProof,
      bound = bindings.get(proof?.bindingId);
    if (
      !active() ||
      !bound ||
      bound.ack === null ||
      !isPolicyCurrent(bound.policyGeneration) ||
      proof.scopeGeneration !== scopeGeneration ||
      proof.policyGeneration !== bound.policyGeneration ||
      proof.fromQpc !== bound.ack ||
      proof.volumeSerial !== bound.volumeSerial ||
      proof.fileId128 !== bound.fileId128 ||
      proof.path !== bound.label ||
      record.issuerPid !== bound.issuerPid ||
      record.generationWitness !== bound.createTime100ns ||
      BigInt(record.qpc) <= BigInt(bound.ack) ||
      BigInt(proof.toQpc) > BigInt(context.watermarkQpc)
    )
      return null;
    const matched = actor(record.issuerPid, record.generationWitness),
      timestamp = eventTime(proof, record.qpc);
    if (!matched || timestamp === null) return null;
    const objectKey = createHmac('sha256', secret)
      .update(`${bound.bindingId}:${bound.volumeSerial}:${bound.fileId128}`)
      .digest('hex');
    return Object.freeze({
      observationId: `${context.sessionId}:${record.eventSeq}`,
      actor: matched,
      timestamp,
      createTime100ns: record.generationWitness,
      object: Object.freeze({
        objectKey,
        bindingId: bound.bindingId,
        label: bound.label,
        scopeGeneration,
        policyGeneration: bound.policyGeneration,
        policy: bound.policy,
        provenance: 'issuer-handle-file-id',
      }),
    });
  }
  function drain() {
    if (!active()) return;
    expireBindings();
    const waiting = [];
    let bytes = 0;
    for (const item of pending) {
      if (now() - item.at > 10000) {
        pendingDropped++;
        continue;
      }
      if (BigInt(item.record.objectProof.toQpc) > BigInt(context.watermarkQpc)) {
        waiting.push(item);
        bytes += item.bytes;
        continue;
      }
      const value = claim(item.record);
      if (!value) continue;
      tokens.set(item.record, { value, at: now(), session: context.sessionId });
      let delivered = false;
      try {
        delivered = onRead(item.record) === true;
      } catch {
        /* Consumer rejection remains explicit. */
      }
      if (!delivered) {
        tokens.delete(item.record);
        consumerRejected++;
      } else accepted++;
    }
    pending = waiting;
    pendingBytes = bytes;
  }
  return {
    begin(generation) {
      clear();
      scopeGeneration = generation;
      context = null;
      revoked = false;
      firstRevocation = null;
      secret = randomBytes(32);
      lastSeq = 0n;
    },
    revoke() {
      revoked = true;
      rememberRevocation('explicit');
      clear();
    },
    update(value) {
      if (context?.sessionId && value.sessionId !== context.sessionId) clear();
      context = value;
      if (value.active && (!value.continuous || value.objectBridge !== PROFILE)) {
        revoked = true;
        rememberRevocation(
          !value.continuous ? (value.objectBridge !== PROFILE ? 'both' : 'continuity') : 'profile',
        );
        clear();
      }
      if (!value.active) clear();
      drain();
    },
    bound(value) {
      const entry = bindings.get(value.bindingId);
      if (
        !active() ||
        !entry ||
        value.requestId !== entry.requestId ||
        value.scopeGeneration !== scopeGeneration ||
        value.policyGeneration !== entry.policyGeneration ||
        !isPolicyCurrent(entry.policyGeneration)
      )
        return;
      if (!value.accepted || BigInt(value.fromQpc) < BigInt(entry.fromQpc)) {
        bindings.delete(value.bindingId);
        return;
      }
      entry.ack = value.fromQpc;
    },
    accept(records) {
      if (!active()) return;
      for (const record of records) {
        if (
          !validObservation(record) ||
          !verifiedIssuer(record) ||
          BigInt(record.eventSeq) <= lastSeq
        )
          continue;
        lastSeq = BigInt(record.eventSeq);
        if (record.objectCandidate) candidate(record.objectCandidate);
        if (!record.objectProof) continue;
        const bytes = Buffer.byteLength(JSON.stringify(record));
        if (pending.length >= MAX_PENDING || pendingBytes + bytes > MAX_BYTES) {
          pendingDropped++;
          continue;
        }
        pending.push({ record, bytes, at: now() });
        pendingBytes += bytes;
      }
      drain();
    },
    take(record) {
      expireBindings();
      const token = record && tokens.get(record);
      if (record) tokens.delete(record);
      return token &&
        active() &&
        token.session === context.sessionId &&
        now() - token.at <= 10000 &&
        now() - token.value.timestamp <= 10000 &&
        bindings.has(token.value.object.bindingId) &&
        isPolicyCurrent(token.value.object.policyGeneration) &&
        actor(token.value.actor.pid, token.value.createTime100ns)
        ? token.value
        : null;
    },
    snapshot: () => ({
      accepted,
      consumerRejected,
      pendingDropped,
      bindingDropped,
      pending: pending.length,
      boundObjects: [...bindings.values()].filter((value) => value.ack !== null).length,
      pendingBindings: [...bindings.values()].filter((value) => value.ack === null).length,
      mode: scopeGeneration === null ? 'display' : 'object-bound',
      qualified: active(),
      qualification: qualification(),
    }),
  };
}
module.exports = { createAdmission };
