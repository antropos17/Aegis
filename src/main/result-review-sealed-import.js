'use strict';

const { createHash } = require('node:crypto');
const { parseInventoryConfig } = require('./inventory-config');
const LIMITS = Object.freeze({ manifest: 65536, payload: 1048576, file: 65536, files: 128 });
const MAX_BUNDLE = 16 + LIMITS.manifest + LIMITS.payload;
const exact = (value, keys) =>
  value &&
  [null, Object.prototype].includes(Object.getPrototypeOf(value)) &&
  Reflect.ownKeys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const invalid = () => {
  throw Error('result-sealed-import-invalid');
};

function relativePath(name, root = false) {
  if (root && name === '') return name;
  if (typeof name !== 'string' || !name || name.length > 240) invalid();
  const parts = name.split('/');
  if (
    parts.length > 8 ||
    parts.some(
      (part) =>
        part.length > 64 ||
        !/^[a-z0-9][a-z0-9_.-]*$/i.test(part) ||
        part.endsWith('.') ||
        /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part),
    )
  )
    invalid();
  return name;
}
const parent = (name) => (name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '');

/** Decode the native fixture's exact binary format as untrusted external snapshot bytes.
 * A matching format/hash supplies no producer, source-current or protected-owner provenance.
 * No source paths are opened and no files are extracted or executed.
 * @param {string} encoded Canonical base64 of one complete AEGSIM01 artifact.
 * @returns {object} Copied file-only baseline for the existing private review parser. @since v0.19.2
 */
function decodeSealedResultReviewBaseline(encoded) {
  if (
    typeof encoded !== 'string' ||
    encoded.length > 4 * Math.ceil(MAX_BUNDLE / 3) ||
    encoded.length < 24
  )
    invalid();
  const bytes = Buffer.from(encoded, 'base64');
  if (
    bytes.length < 16 ||
    bytes.length > MAX_BUNDLE ||
    bytes.toString('base64') !== encoded ||
    !bytes.subarray(0, 8).equals(Buffer.from('AEGSIM01'))
  )
    invalid();
  const length = bytes.readInt32LE(8),
    payloadLength = bytes.readInt32LE(12);
  if (
    length < 2 ||
    length > LIMITS.manifest ||
    payloadLength < 0 ||
    payloadLength > LIMITS.payload ||
    16 + length + payloadLength !== bytes.length
  )
    invalid();
  const manifestBytes = bytes.subarray(16, 16 + length);
  const parsed = parseInventoryConfig(manifestBytes, 'json');
  const manifest = parsed.value;
  if (
    parsed.parseStatus !== 'parsed' ||
    !exact(manifest, [
      'schemaVersion',
      'profile',
      'developerOnly',
      'launchAllowed',
      'directories',
      'files',
    ]) ||
    manifest.schemaVersion !== 1 ||
    manifest.profile !== 'windows-x64-ntfs-dummy-v1' ||
    manifest.developerOnly !== true ||
    manifest.launchAllowed !== false ||
    !Array.isArray(manifest.directories) ||
    !manifest.directories.length ||
    manifest.directories.length > 32 ||
    manifest.directories[0] !== '' ||
    !Array.isArray(manifest.files) ||
    manifest.files.length > LIMITS.files ||
    !Buffer.from(JSON.stringify(manifest)).equals(manifestBytes) ||
    Object.keys(manifest).join() !==
      'schemaVersion,profile,developerOnly,launchAllowed,directories,files'
  )
    invalid();
  const directories = new Set(),
    names = new Set();
  let previous;
  for (const value of manifest.directories) {
    const name = relativePath(value, true);
    if (
      (previous !== undefined && name <= previous) ||
      names.has(name.toUpperCase()) ||
      (name !== '' && !directories.has(parent(name)))
    )
      invalid();
    directories.add(name);
    names.add(name.toUpperCase());
    previous = name;
  }
  const files = [];
  let offset = 0;
  previous = undefined;
  for (const row of manifest.files) {
    if (
      !exact(row, ['relativePath', 'size', 'sha256', 'offset']) ||
      Object.keys(row).join() !== 'relativePath,size,sha256,offset' ||
      !Number.isSafeInteger(row.size) ||
      row.size < 0 ||
      row.size > LIMITS.file ||
      row.offset !== offset ||
      typeof row.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(row.sha256) ||
      offset + row.size > payloadLength
    )
      invalid();
    const name = relativePath(row.relativePath);
    if (
      (previous !== undefined && name <= previous) ||
      names.has(name.toUpperCase()) ||
      !directories.has(parent(name))
    )
      invalid();
    const content = bytes.subarray(16 + length + offset, 16 + length + offset + row.size);
    if (createHash('sha256').update(content).digest('hex') !== row.sha256) invalid();
    files.push({ path: name, kind: 'file', contentBase64: content.toString('base64') });
    names.add(name.toUpperCase());
    previous = name;
    offset += row.size;
  }
  if (offset !== payloadLength) invalid();
  return { complete: true, files };
}

module.exports = { decodeSealedResultReviewBaseline };
