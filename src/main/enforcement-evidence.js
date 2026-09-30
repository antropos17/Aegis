'use strict';
const { createHash, generateKeyPairSync, sign, verify } = require('node:crypto');
const { parseInventoryConfig } = require('./inventory-config');
const { canonical } = require('./audit-hashchain');
const anchors = new WeakMap(),
  checkpointKeys = new WeakMap();
const LIMITS = Object.freeze({ bytes: 131072, records: 256, receivers: 64 });
const uuid = (v) =>
  typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const hash = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const integer = (v) => Number.isSafeInteger(v) && v >= 0 && v <= 65535;
const shape = (v, keys) =>
  v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const digest = (v) => createHash('sha256').update(canonical(v)).digest('hex');
function contextValid(c) {
  return (
    shape(c, ['sessionId', 'epoch', 'policyRevision', 'sourceDigest', 'corpusDigest']) &&
    uuid(c.sessionId) &&
    integer(c.epoch) &&
    integer(c.policyRevision) &&
    hash(c.sourceDigest) &&
    hash(c.corpusDigest)
  );
}
function receiptValid(v) {
  return (
    shape(v, ['schemaVersion', 'context', 'records', 'receivers', 'claims']) &&
    v.schemaVersion === 1 &&
    contextValid(v.context) &&
    Array.isArray(v.records) &&
    v.records.length <= LIMITS.records &&
    v.records.every(
      (e) =>
        shape(e, ['schemaVersion', 'seq', 'operationId', 'code']) &&
        e.schemaVersion === 1 &&
        integer(e.seq) &&
        uuid(e.operationId) &&
        ['consumed', 'dispatch', 'completed', 'failed'].includes(e.code),
    ) &&
    Array.isArray(v.receivers) &&
    v.receivers.length <= LIMITS.receivers &&
    v.receivers.every(
      (e) =>
        shape(e, ['operationId', 'consumedRecord', 'effect']) &&
        uuid(e.operationId) &&
        ['exact', 'absent', 'malformed', 'wrong-id'].includes(e.consumedRecord) &&
        ['expected', 'unexpected', 'absent'].includes(e.effect),
    ) &&
    shape(v.claims, ['complete', 'lossCount']) &&
    typeof v.claims.complete === 'boolean' &&
    integer(v.claims.lossCount)
  );
}
function parse(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > LIMITS.bytes) throw Error('evidence-invalid');
  const parsed = parseInventoryConfig(Buffer.from(bytes), 'json');
  if (parsed.parseStatus !== 'parsed' || !receiptValid(parsed.value))
    throw Error('evidence-invalid');
  return parsed.value;
}
/** Serialize bounded, metadata-only records; imported claims carry no authority.
 * @param {object} value Receipt value. @returns {Buffer} Owned canonical bytes. @since v0.17.0 */
function encodeEnforcementEvidence(value) {
  if (!receiptValid(value)) throw Error('evidence-invalid');
  const bytes = Buffer.from(canonical(value));
  if (bytes.length > LIMITS.bytes) throw Error('evidence-invalid');
  return bytes;
}
/** Explicit trusted creation boundary: only the owner of actual callback and receiver records calls this.
 * Terminal count/hash must be retained independently of imported reports. No protected-host claim.
 * @param {Buffer} bytes Owner's final records and independent receiver observations.
 * @param {object} delivery Actual owner loss/pending counters and terminalKnown.
 * @returns {object} Opaque, unserializable expected-terminal handle. @since v0.17.0 */
function createEnforcementEvidenceAnchor(bytes, delivery) {
  const value = parse(bytes);
  if (
    !shape(delivery, ['observerLoss', 'auditLoss', 'pending', 'terminalKnown']) ||
    !integer(delivery.observerLoss) ||
    !integer(delivery.auditLoss) ||
    !integer(delivery.pending) ||
    typeof delivery.terminalKnown !== 'boolean'
  )
    throw Error('evidence-anchor-invalid');
  const handle = Object.freeze({ kind: 'owner-terminal-evidence' });
  anchors.set(handle, {
    value,
    delivery: Object.freeze({ ...delivery }),
    recordDigest: digest(value.records),
    receiverDigest: digest(value.receivers),
  });
  return handle;
}
/** Correlate imported records with independently retained owner terminal/receiver evidence.
 * @param {Buffer} bytes Owned import bytes. @param {object|undefined} anchor Trusted opaque handle.
 * @returns {object} Local links/completeness, never launch authority. @since v0.17.0 */
function assessEnforcementEvidence(bytes, anchor) {
  const value = parse(bytes),
    trusted = anchors.get(anchor);
  const contradictions = [],
    missing = [],
    links = [];
  const operations = new Map();
  for (let i = 0; i < value.records.length; i++) {
    const e = value.records[i];
    if (e.seq !== i) contradictions.push('event-order');
    const codes = operations.get(e.operationId) || [];
    if (codes.includes(e.code) || codes.includes('completed') || codes.includes('failed'))
      contradictions.push('operation-order');
    if (
      (e.code === 'dispatch' && codes.at(-1) !== 'consumed') ||
      (e.code === 'completed' && codes.at(-1) !== 'dispatch')
    )
      contradictions.push('operation-order');
    codes.push(e.code);
    operations.set(e.operationId, codes);
  }
  const seen = new Set();
  for (const receiver of value.receivers) {
    if (seen.has(receiver.operationId)) contradictions.push('duplicate-receiver');
    seen.add(receiver.operationId);
    if (
      receiver.effect !== 'absent' &&
      (!operations.get(receiver.operationId)?.includes('dispatch') ||
        receiver.consumedRecord !== 'exact')
    )
      contradictions.push('effect-without-authority');
  }
  if (trusted) {
    if (canonical(value.context) !== canonical(trusted.value.context))
      contradictions.push('owner-context-mismatch');
    if (
      digest(value.records) !== trusted.recordDigest ||
      value.records.length !== trusted.value.records.length
    )
      missing.push('owner-terminal-records');
    if (digest(value.receivers) !== trusted.receiverDigest)
      contradictions.push('receiver-observation-mismatch');
    for (const [id, codes] of operations) {
      const receiver = trusted.value.receivers.find((r) => r.operationId === id);
      if (!codes.includes('completed') && !codes.includes('failed'))
        missing.push('terminal-outcome');
      if (codes.includes('dispatch') && !receiver) missing.push('receiver-observation');
      if (codes.includes('completed') && receiver?.effect !== 'expected')
        contradictions.push('completion-without-effect');
      if (
        codes.includes('completed') &&
        receiver?.consumedRecord === 'exact' &&
        receiver?.effect === 'expected'
      )
        links.push(id);
    }
    if (trusted.delivery.observerLoss || trusted.delivery.auditLoss || trusted.delivery.pending)
      missing.push('delivery-loss');
  }
  const complete = trusted?.delivery.terminalKnown && !contradictions.length && !missing.length;
  return Object.freeze({
    schemaVersion: 1,
    scope: 'local-developer-correlation',
    completeness:
      contradictions.length || missing.length ? 'incomplete' : complete ? 'complete' : 'unknown',
    verifiedLocalLinks:
      trusted && !contradictions.length && !missing.includes('owner-terminal-records')
        ? links.length
        : 0,
    localOutcome:
      !trusted ||
      contradictions.length ||
      missing.length ||
      [...operations.values()].some(
        (codes) => codes.includes('dispatch') && !codes.includes('completed'),
      )
        ? 'outcome-unknown'
        : operations.size
          ? 'completed-or-refused'
          : 'none',
    missing: Object.freeze([...new Set(missing)]),
    contradictions: Object.freeze([...new Set(contradictions)]),
    externalEffects: 'unknown',
    launchAllowed: false,
  });
}
/** Generate disposable signing material; never a protected production key.
 * @returns {object} Owner-selected opaque fixture signer/verifier. @since v0.17.0 */
function createEvidenceCheckpointKey() {
  const handle = Object.freeze({ kind: 'disposable-fixture-key' });
  checkpointKeys.set(handle, generateKeyPairSync('ed25519'));
  return handle;
}
/** Sign only a trusted local anchor checkpoint, without exporting key material.
 * @param {object} anchor Owner terminal handle. @param {object} key Owner-selected fixture key.
 * @returns {Buffer} Finite checkpoint bytes. @since v0.17.0 */
function signEvidenceCheckpoint(anchor, key) {
  const a = anchors.get(anchor),
    k = checkpointKeys.get(key);
  if (!a || !k) throw Error('checkpoint-invalid');
  const payload = canonical({
    context: a.value.context,
    recordDigest: a.recordDigest,
    receiverDigest: a.receiverDigest,
    count: a.value.records.length,
  });
  return Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      material: 'generated-disposable-test-key',
      payload,
      signature: sign(null, Buffer.from(payload), k.privateKey).toString('base64'),
    }),
  );
}
/** Verify exact expected terminal identity with an independently selected key, never an imported key.
 * @param {Buffer} bytes Checkpoint. @param {object} anchor Expected terminal. @param {object} key Trusted fixture key.
 * @returns {boolean} Matching disposable signature and exact context. @since v0.17.0 */
function verifyEvidenceCheckpoint(bytes, anchor, key) {
  try {
    const a = anchors.get(anchor),
      k = checkpointKeys.get(key);
    if (!a || !k || !Buffer.isBuffer(bytes) || bytes.length > 4096) return false;
    const p = parseInventoryConfig(Buffer.from(bytes), 'json');
    const c = p.value;
    if (
      p.parseStatus !== 'parsed' ||
      !shape(c, ['schemaVersion', 'material', 'payload', 'signature']) ||
      c.schemaVersion !== 1 ||
      c.material !== 'generated-disposable-test-key' ||
      typeof c.payload !== 'string' ||
      typeof c.signature !== 'string' ||
      c.signature.length !== 88
    )
      return false;
    const expected = canonical({
      context: a.value.context,
      recordDigest: a.recordDigest,
      receiverDigest: a.receiverDigest,
      count: a.value.records.length,
    });
    const signature = Buffer.from(c.signature, 'base64');
    return (
      signature.length === 64 &&
      signature.toString('base64') === c.signature &&
      c.payload === expected &&
      verify(null, Buffer.from(c.payload), k.publicKey, signature)
    );
  } catch {
    return false;
  }
}
module.exports = {
  LIMITS,
  encodeEnforcementEvidence,
  createEnforcementEvidenceAnchor,
  assessEnforcementEvidence,
  createEvidenceCheckpointKey,
  signEvidenceCheckpoint,
  verifyEvidenceCheckpoint,
};
