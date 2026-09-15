'use strict';

/** @file Content-bound inventory snapshots. Local acceptance is not authentication. */
const crypto = require('node:crypto');
const { getInventoryProfile } = require('./inventory-profiles');
const SNAPSHOT_BYTES = 1048576;
const HEX = /^[a-f0-9]{64}$/;
const isHash = (value) => typeof value === 'string' && value.length === 64 && HEX.test(value);
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const ordered = (items, key) =>
  items.sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0));

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (record(value))
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('snapshot-invalid');
  return value;
}

/** Hash internal JSON values with deterministic object-key order. @param {unknown} value @returns {string} SHA-256. @since v0.15.1 */
function hashSnapshotValue(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

function seal(body, state) {
  const document = {
    format: 'aegis-inventory-snapshot',
    schemaVersion: 1,
    assessment: 'not-performed',
    state,
    body,
  };
  return { ...document, digest: hashSnapshotValue(document) };
}

/**
 * Project an internal inventory into a compact snapshot containing paths and hashes.
 * @param {object} inventory Fresh bounded inventory.
 * @param {string} rootSha256 Canonical selected-directory binding.
 * @param {object|null} [catalog] Explicit offline tool catalog summary.
 * @returns {object} Unreviewed snapshot; saving it never accepts its contents.
 * @since v0.15.1
 */
function createSnapshot(inventory, rootSha256, catalog = null) {
  const body = {
    subject: {
      rootSha256,
      adapter: inventory.adapter.id,
      contractSha256: hashSnapshotValue({
        schemaVersion: inventory.schemaVersion,
        mode: inventory.mode,
        adapter: inventory.adapter,
        scope: inventory.scope,
        limits: inventory.limits,
      }),
      toolSourceSha256: catalog?.sourceSha256 ?? null,
    },
    complete: inventory.complete && (catalog?.complete ?? true),
    issueCount: inventory.issues.length + (catalog && !catalog.complete ? 1 : 0),
    catalogSha256: catalog?.sha256 ?? null,
    components: ordered(
      inventory.components.map(({ path, sha256, ...metadata }) => ({
        path,
        sha256,
        metadataSha256: hashSnapshotValue(metadata),
      })),
      'path',
    ),
    packages: ordered(
      inventory.packages.map((entry) => ({
        path: entry.manifest,
        sha256: hashSnapshotValue(entry),
      })),
      'path',
    ),
    tools: ordered(
      (catalog?.tools ?? []).map((entry) => ({ ...entry })),
      'id',
    ),
  };
  const snapshot = seal(body, 'observed');
  validateSnapshot(snapshot);
  return snapshot;
}

function keys(value, expected) {
  return (
    record(value) &&
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function relative(name) {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= 4096 &&
    !Array.from(name).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) &&
    !name.includes('\\') &&
    !name.includes(':') &&
    name.split('/').every((part) => part && part !== '.' && part !== '..')
  );
}

function entries(items, maximum, fields, id) {
  if (!Array.isArray(items) || items.length > maximum) return false;
  let previous = null;
  return items.every((item) => {
    if (
      !keys(item, fields) ||
      !fields.every((field) => (field === 'path' ? relative(item[field]) : isHash(item[field])))
    )
      return false;
    if (previous !== null && previous >= item[id]) return false;
    previous = item[id];
    return true;
  });
}

/**
 * Validate an imported snapshot before using its trust state or emitting any fields.
 * The digest detects inconsistent bytes/metadata; it is not a signature or MAC.
 * @param {object} snapshot Untrusted parsed JSON.
 * @returns {object} The validated snapshot.
 * @since v0.15.1
 */
function validateSnapshot(snapshot) {
  const fail = () => {
    throw new Error('snapshot-invalid');
  };
  if (
    !keys(snapshot, ['format', 'schemaVersion', 'assessment', 'state', 'body', 'digest']) ||
    snapshot.format !== 'aegis-inventory-snapshot' ||
    snapshot.schemaVersion !== 1 ||
    snapshot.assessment !== 'not-performed' ||
    !['observed', 'accepted'].includes(snapshot.state) ||
    !isHash(snapshot.digest)
  )
    fail();
  const { body } = snapshot;
  if (
    !keys(body, [
      'subject',
      'complete',
      'issueCount',
      'catalogSha256',
      'components',
      'packages',
      'tools',
    ]) ||
    !keys(body.subject, ['rootSha256', 'adapter', 'contractSha256', 'toolSourceSha256'])
  )
    fail();
  const subject = body.subject;
  if (typeof subject.adapter !== 'string') fail();
  if (!['rootSha256', 'contractSha256'].every((key) => isHash(subject[key]))) fail();
  try {
    getInventoryProfile(subject.adapter);
  } catch (_) {
    fail();
  }
  if (
    typeof body.complete !== 'boolean' ||
    !Number.isSafeInteger(body.issueCount) ||
    body.issueCount < 0 ||
    body.issueCount > 8192 ||
    body.complete !== (body.issueCount === 0)
  )
    fail();
  if ((subject.toolSourceSha256 === null) !== (body.catalogSha256 === null)) fail();
  if (
    subject.toolSourceSha256 !== null &&
    ![subject.toolSourceSha256, body.catalogSha256].every(isHash)
  )
    fail();
  if (
    !entries(body.components, 1024, ['path', 'sha256', 'metadataSha256'], 'path') ||
    !entries(body.packages, 64, ['path', 'sha256'], 'path') ||
    !entries(body.tools, 256, ['id', 'sha256'], 'id') ||
    (subject.toolSourceSha256 === null && body.tools.length) ||
    (snapshot.state === 'accepted' && !body.complete)
  )
    fail();
  const { digest, ...document } = snapshot;
  if (hashSnapshotValue(document) !== digest) fail();
  if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > SNAPSHOT_BYTES)
    throw new Error('snapshot-size-limit');
  return snapshot;
}

/**
 * Accept exactly a reviewed digest after a fresh matching capture; never mutate it.
 * @param {object} snapshot Previously saved observed snapshot.
 * @param {string} expectedDigest Explicit reviewed snapshot digest.
 * @param {object} current Fresh capture with the same root, scope and tool source.
 * @returns {object} A new accepted snapshot, requiring a separately selected output file.
 * @since v0.15.1
 */
function acceptSnapshot(snapshot, expectedDigest, current) {
  validateSnapshot(snapshot);
  validateSnapshot(current);
  if (snapshot.digest !== expectedDigest) throw new Error('snapshot-digest-mismatch');
  if (snapshot.state !== 'observed') throw new Error('snapshot-already-accepted');
  if (!snapshot.body.complete || !current.body.complete) throw new Error('snapshot-incomplete');
  if (hashSnapshotValue(snapshot.body) !== hashSnapshotValue(current.body))
    throw new Error('snapshot-changed-since-review');
  return seal(structuredClone(snapshot.body), 'accepted');
}

module.exports = {
  createSnapshot,
  validateSnapshot,
  acceptSnapshot,
  hashSnapshotValue,
  SNAPSHOT_BYTES,
};
