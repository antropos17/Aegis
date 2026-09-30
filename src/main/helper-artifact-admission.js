'use strict';
const crypto = require('node:crypto');
const semver = require('semver');
const { parseInventoryConfig } = require('./inventory-config');
const LIMITS = Object.freeze({
  manifestBytes: 8192,
  artifactBytes: 4194304,
  retainedBytes: 8388608,
  tickets: 8,
  keys: 4,
  lifetimeMs: 60000,
});
const own = (v, keys) =>
  v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const keyIdValid = (v) => typeof v === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(v);
const versionValid = (v) =>
  typeof v === 'string' &&
  v.length <= 40 &&
  /^\d+\.\d+\.\d+(?:-alpha(?:\.\d+)?)?$/.test(v) &&
  !!semver.valid(v);
const tupleKeys = ['helper', 'version', 'protocol', 'platform', 'architecture'];
function tupleValid(v) {
  return (
    own(v, tupleKeys) &&
    keyIdValid(v.helper) &&
    versionValid(v.version) &&
    v.protocol === 1 &&
    ['win32', 'linux', 'darwin'].includes(v.platform) &&
    ['x64', 'arm64'].includes(v.architecture)
  );
}
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const digestValid = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
/** Owner selects expected tuple, trusted keys and retained baseline before imported bytes arrive.
 * No installer verification/launch authority is created. State is bounded and close/revoke clears it.
 * @param {object} options expected, trustedKeys Map, optional baseline and trusted now clock.
 * @returns {object} Offline admit/consume/revoke/close/status API. @since v0.17.0 */
function createHelperArtifactAuthority({ expected, trustedKeys, baseline, now = Date.now }) {
  if (
    !tupleValid(expected) ||
    !(trustedKeys instanceof Map) ||
    !trustedKeys.size ||
    trustedKeys.size > LIMITS.keys ||
    typeof now !== 'function'
  )
    throw Error('helper-owner-invalid');
  const selected = Object.freeze({ ...expected }),
    keys = new Map(),
    tickets = new Map();
  for (const [id, material] of trustedKeys) {
    if (!keyIdValid(id)) throw Error('helper-owner-invalid');
    let key;
    try {
      key = material?.type === 'public' ? material : crypto.createPublicKey(material);
    } catch {
      throw Error('helper-owner-invalid');
    }
    if (key.asymmetricKeyType !== 'ed25519') throw Error('helper-owner-invalid');
    keys.set(id, key);
  }
  let retained;
  if (baseline !== undefined) {
    if (
      !own(baseline, ['version', 'bytes', 'sha256']) ||
      !versionValid(baseline.version) ||
      !Number.isSafeInteger(baseline.bytes) ||
      baseline.bytes < 1 ||
      baseline.bytes > LIMITS.artifactBytes ||
      !digestValid(baseline.sha256)
    )
      throw Error('helper-owner-invalid');
    retained = Object.freeze({ ...baseline });
  }
  let revision = 1,
    closed = false,
    bytesRetained = 0;
  const release = (ticket) => {
    const record = tickets.get(ticket);
    if (!record) return;
    record.artifact.fill(0);
    record.manifest.fill(0);
    record.signature.fill(0);
    bytesRetained -= record.artifact.length;
    tickets.delete(ticket);
  };
  const prune = () => {
    const stamp = now();
    if (!Number.isSafeInteger(stamp) || stamp < 0) throw Error('helper-owner-invalid');
    for (const [ticket, record] of tickets) if (stamp >= record.expiresAt) release(ticket);
    return stamp;
  };
  const admit = (value) => {
    if (closed) throw Error('helper-artifact-stale');
    const stamp = prune();
    if (!Number.isSafeInteger(stamp + LIMITS.lifetimeMs)) throw Error('helper-owner-invalid');
    if (
      !own(value, ['keyId', 'manifest', 'signature', 'artifact']) ||
      !keyIdValid(value.keyId) ||
      !keys.has(value.keyId) ||
      !Buffer.isBuffer(value.manifest) ||
      !value.manifest.length ||
      value.manifest.length > LIMITS.manifestBytes ||
      !Buffer.isBuffer(value.signature) ||
      value.signature.length !== 64 ||
      !Buffer.isBuffer(value.artifact) ||
      !value.artifact.length ||
      value.artifact.length > LIMITS.artifactBytes
    )
      throw Error('helper-artifact-refused');
    const manifest = Buffer.from(value.manifest),
      signature = Buffer.from(value.signature),
      artifact = Buffer.from(value.artifact);
    let admitted = false;
    try {
      // Authenticate exact copied bytes before parsing; imported keys never confer trust.
      if (!crypto.verify(null, manifest, keys.get(value.keyId), signature))
        throw Error('helper-artifact-refused');
      const parsed = parseInventoryConfig(manifest, 'json'),
        m = parsed.value;
      if (
        parsed.parseStatus !== 'parsed' ||
        !own(m, ['schema', 'keyId', ...tupleKeys, 'bytes', 'sha256']) ||
        m.schema !== 'aegis-helper-artifact/v1' ||
        m.keyId !== value.keyId ||
        !tupleKeys.every((k) => m[k] === selected[k]) ||
        !Number.isSafeInteger(m.bytes) ||
        m.bytes !== artifact.length ||
        !digestValid(m.sha256) ||
        m.sha256 !== hash(artifact)
      )
        throw Error('helper-artifact-refused');
      if (
        retained &&
        (semver.lt(m.version, retained.version) ||
          (m.version === retained.version &&
            (m.sha256 !== retained.sha256 || m.bytes !== retained.bytes)))
      )
        throw Error('helper-artifact-refused');
      if (tickets.size >= LIMITS.tickets || bytesRetained + artifact.length > LIMITS.retainedBytes)
        throw Error('helper-artifact-quota');
      const ticket = Object.freeze({
        kind: 'offline-helper-acceptance',
        revision,
        expiresAt: stamp + LIMITS.lifetimeMs,
        helper: selected.helper,
        version: selected.version,
        protocol: selected.protocol,
        platform: selected.platform,
        architecture: selected.architecture,
        bytes: artifact.length,
        sha256: m.sha256,
        launchAllowed: false,
      });
      tickets.set(ticket, { manifest, signature, artifact, expiresAt: ticket.expiresAt, revision });
      bytesRetained += artifact.length;
      admitted = true;
      return ticket;
    } finally {
      if (!admitted) {
        manifest.fill(0);
        signature.fill(0);
        artifact.fill(0);
      }
    }
  };
  const consume = (ticket, currentRevision) => {
    prune();
    const record = tickets.get(ticket);
    if (!record) throw Error('helper-artifact-stale');
    // Exactly one attempt, including a wrong/stale owner revision.
    const result = {
      manifest: Buffer.from(record.manifest),
      signature: Buffer.from(record.signature),
      artifact: Buffer.from(record.artifact),
    };
    release(ticket);
    if (closed || currentRevision !== revision || record.revision !== revision) {
      result.manifest.fill(0);
      result.signature.fill(0);
      result.artifact.fill(0);
      throw Error('helper-artifact-stale');
    }
    return Object.freeze(result);
  };
  const revoke = () => {
    for (const ticket of tickets.keys()) release(ticket);
    revision++;
  };
  return {
    admit,
    consume,
    revoke,
    close: () => {
      closed = true;
      revoke();
    },
    status: () => {
      prune();
      return Object.freeze({ revision, closed, tickets: tickets.size, bytesRetained });
    },
  };
}
module.exports = { LIMITS, createHelperArtifactAuthority };
