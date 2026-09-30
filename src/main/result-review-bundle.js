'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const { TextDecoder } = require('node:util');
const { parseInventoryConfig } = require('./inventory-config');
const owned = new WeakMap();
const LIMITS = Object.freeze({
  files: 128,
  depth: 8,
  entryBytes: 65536,
  payloadBytes: 1048576,
  wireBytes: 2097152,
});
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const exact = (value, keys) =>
  value &&
  [null, Object.prototype].includes(Object.getPrototypeOf(value)) &&
  Reflect.ownKeys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const invalid = () => {
  throw Error('result-bundle-invalid');
};
const sameFile = (a, b) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.ctimeMs === b.ctimeMs;

function safePath(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 240 ||
    value !== value.normalize('NFC') ||
    // eslint-disable-next-line no-control-regex -- Reject invisible filename controls.
    /[\\\x00-\x1f\x7f-\x9f<>:"|?*\ud800-\udfff]|\p{Cf}/u.test(value)
  )
    invalid();
  const parts = value.split(/[/\\]/);
  if (
    parts.length > LIMITS.depth ||
    parts.some(
      (part) =>
        !part ||
        ['.', '..'].includes(part) ||
        /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(part),
    )
  )
    invalid();
  return value;
}
function snapshot(value, budget) {
  if (
    !exact(value, ['complete', 'files']) ||
    typeof value.complete !== 'boolean' ||
    !Array.isArray(value.files) ||
    value.files.length > LIMITS.files
  )
    invalid();
  const names = new Set(),
    files = new Map();
  for (const row of value.files) {
    if (
      !exact(row, ['path', 'kind', 'contentBase64']) ||
      row.kind !== 'file' ||
      typeof row.contentBase64 !== 'string' ||
      row.contentBase64.length > 87384
    )
      invalid();
    const name = safePath(row.path),
      key = name.toUpperCase();
    if (names.has(key)) invalid();
    names.add(key);
    const bytes = Buffer.from(row.contentBase64, 'base64');
    if (bytes.toString('base64') !== row.contentBase64 || bytes.length > LIMITS.entryBytes)
      invalid();
    budget.bytes += bytes.length;
    if (budget.bytes > LIMITS.payloadBytes) invalid();
    files.set(name, bytes);
  }
  const entries = [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const manifest = entries.map(([path, bytes]) => ({
    path,
    bytes: bytes.length,
    sha256: digest(bytes),
  }));
  return {
    complete: value.complete,
    files: new Map(entries),
    manifest,
    digest: digest(Buffer.from(JSON.stringify({ complete: value.complete, files: manifest }))),
  };
}

/** Parse exact versioned selected bytes into copied snapshots; imported claims carry no authority.
 * @param {Buffer} bytes Selected strict JSON bundle bytes.
 * @returns {object} Opaque retained review with bounded immutable comparison metadata. @since v0.17.0 */
function parseResultReviewBundle(bytes) {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length > LIMITS.wireBytes) invalid();
    const copy = Buffer.from(bytes),
      parsed = parseInventoryConfig(copy, 'json');
    if (parsed.parseStatus !== 'parsed') invalid();
    const value = parsed.value;
    if (
      !exact(value, ['schemaVersion', 'captureSource', 'before', 'after', 'claims']) ||
      value.schemaVersion !== 1 ||
      value.captureSource !== 'external-result' ||
      !exact(value.claims, ['accepted', 'stopped', 'boundaryPassed']) ||
      !Object.values(value.claims).every((claim) => typeof claim === 'boolean')
    )
      invalid();
    const budget = { bytes: 0 },
      before = snapshot(value.before, budget),
      after = snapshot(value.after, budget);
    const names = [...new Set([...before.files.keys(), ...after.files.keys()])].sort();
    if (
      names.length > LIMITS.files ||
      new Set(names.map((name) => name.toUpperCase())).size !== names.length
    )
      invalid();
    // A file cannot also be an ancestor of another file in either snapshot.
    for (const name of names)
      for (const other of names)
        if (other.toUpperCase().startsWith(name.toUpperCase() + '/')) invalid();
    const complete = before.complete && after.complete;
    const changes = [];
    for (const name of names) {
      const oldBytes = before.files.get(name),
        newBytes = after.files.get(name);
      if (oldBytes && newBytes && oldBytes.equals(newBytes)) continue;
      const type = !complete ? 'unknown' : !oldBytes ? 'addition' : !newBytes ? 'deletion' : 'edit';
      const prior = oldBytes ? digest(oldBytes) : null,
        next = newBytes ? digest(newBytes) : null;
      changes.push(
        Object.freeze({
          id: digest(Buffer.from(JSON.stringify([name, type, prior, next]))),
          path: name,
          type,
          beforeSha256: prior,
          afterSha256: next,
          beforeBytes: oldBytes?.length ?? null,
          afterBytes: newBytes?.length ?? null,
        }),
      );
    }
    const review = Object.freeze({
      schemaVersion: 1,
      captureSource: 'imported-artifact',
      originalState: complete ? 'complete-imported-baseline-unverified' : 'incomplete-unknown',
      retained: true,
      writerState: 'stop-unconfirmed',
      acceptance: 'unreviewed',
      baselineDigest: before.digest,
      snapshotDigest: after.digest,
      bundleDigest: digest(copy),
      complete,
      changes: Object.freeze(changes),
      launchAllowed: false,
      projectExportAllowed: false,
    });
    owned.set(review, { before, after });
    return review;
  } catch {
    throw Error('result-bundle-invalid');
  }
}

/** Copy an owner-retained snapshot; serialized handles and substituted buffers are refused.
 * @param {object} review Actual process-private parsed review. @param {'before'|'after'} phase Selected snapshot.
 * @returns {Map<string,Buffer>} Fresh owned byte copies. @since v0.17.0 */
function copyResultReviewSnapshot(review, phase) {
  const value = owned.get(review);
  if (!value || !['before', 'after'].includes(phase)) throw Error('result-review-expired');
  return new Map([...value[phase].files].map(([name, bytes]) => [name, Buffer.from(bytes)]));
}

/** Derive bounded escaped-display previews from retained copies, never from renderer input.
 * @param {object} review Actual owned review. @returns {object} Immutable comparison metadata with finite text. @since v0.17.0 */
function describeResultReviewBundle(review) {
  const retained = owned.get(review);
  if (!retained) throw Error('result-review-expired');
  let remaining = 32768;
  const preview = (snapshot, name) => {
    const bytes = snapshot.files.get(name);
    if (!bytes)
      return Object.freeze({ state: snapshot.complete ? 'absent' : 'incomplete', text: null });
    let text;
    try {
      if (bytes.includes(0)) throw Error('binary');
      text = new TextDecoder('utf8', { fatal: true }).decode(bytes);
    } catch {
      return Object.freeze({ state: 'binary', text: null });
    }
    // Display terminal and directional controls as visible labels. Svelte still escapes HTML.
    const safe = text.replaceAll('\r\n', '\n').replace(
      // eslint-disable-next-line no-control-regex -- Display controls as visible code-point labels.
      /[\x00-\x08\x0b-\x1f\x7f-\x9f]|\p{Cf}/gu,
      (control) => `[U+${control.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}]`,
    );
    const budget = Math.min(2048, remaining);
    let shown = '',
      count = 0;
    for (const character of safe) {
      const size = Buffer.byteLength(character);
      if (count + size > budget) break;
      shown += character;
      count += size;
    }
    remaining -= count;
    return Object.freeze({
      state: shown.length === safe.length ? 'text' : 'truncated',
      text: shown,
    });
  };
  const changes = review.changes.map((change) =>
    Object.freeze({
      ...change,
      beforePreview: preview(retained.before, change.path),
      afterPreview: preview(retained.after, change.path),
    }),
  );
  const metadata = Object.freeze({ ...review, changes: Object.freeze(changes) });
  if (Buffer.byteLength(JSON.stringify(metadata)) > 262144) throw Error('result-preview-budget');
  return metadata;
}

/** Read one native-dialog selected regular file through a bounded retained handle.
 * @param {string} file Main-owned selected filename. @param {() => void} assertOwned Window/revision guard.
 * @returns {Promise<object>} Copied review; no source file remains open. @since v0.17.0 */
async function readResultReviewBundle(file, assertOwned = () => {}) {
  let handle;
  try {
    assertOwned();
    const before = await fs.lstat(file);
    assertOwned();
    if (!before.isFile() || before.isSymbolicLink() || before.size > LIMITS.wireBytes) invalid();
    handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    assertOwned();
    const opened = await handle.stat();
    assertOwned();
    if (!opened.isFile() || !sameFile(before, opened)) invalid();
    const bytes = Buffer.alloc(opened.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      assertOwned();
      if (!read.bytesRead) break;
      offset += read.bytesRead;
    }
    const after = await handle.stat();
    assertOwned();
    if (offset !== opened.size || !sameFile(opened, after)) invalid();
    return parseResultReviewBundle(bytes.subarray(0, offset));
  } catch (error) {
    if (error.message === 'request-denied') throw error;
    throw Error('result-bundle-unavailable', { cause: error });
  } finally {
    if (handle) await handle.close();
  }
}
module.exports = {
  LIMITS,
  parseResultReviewBundle,
  copyResultReviewSnapshot,
  describeResultReviewBundle,
  readResultReviewBundle,
};
