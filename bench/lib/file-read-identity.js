'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const FIELDS = Object.freeze(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']);
const MAX_BYTES = 16384;
const TARGETS = Object.freeze(['project', 'outside-project', 'persistence-location']);
/** @param {unknown} value Candidate. @returns {boolean} Safe public ID. @since unreleased */
const safeId = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
/** @param {unknown} value Candidate. @returns {boolean} Lowercase SHA-256. @since unreleased */
const sha = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
/** @param {unknown} value Candidate. @returns {boolean} Safe canary name. @since unreleased */
const name = (value) => typeof value === 'string' && /^canary-[a-z0-9-]{1,40}\.txt$/.test(value);
/** @param {unknown} value Candidate. @param {string[]} keys Fields. @returns {boolean} Closed enumerable data. @since unreleased */
function exact(value, keys) {
  if (
    !value ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length
  )
    return false;
  return keys.every((key) => {
    const d = Object.getOwnPropertyDescriptor(value, key);
    return d && d.enumerable === true && Object.hasOwn(d, 'value');
  });
}
/** @param {object} value Private candidate. @returns {boolean} Complete native identity. @since unreleased */
function validIdentity(value) {
  return (
    exact(value, FIELDS) &&
    FIELDS.every((key) => typeof value[key] === 'string' && /^-?\d{1,30}$/.test(value[key])) &&
    BigInt(value.dev) >= 0n &&
    BigInt(value.ino) > 0n &&
    BigInt(value.size) >= 0n
  );
}
/**
 * Capture an ordinary single-link file identity; unavailable identity stays null.
 * @param {object} stat Native bigint stat.
 * @returns {object|null} Private metadata token.
 * @since unreleased
 */
function identityFromStat(stat) {
  try {
    if (
      !stat.isFile() ||
      stat.isSymbolicLink?.() ||
      stat.nlink !== 1n ||
      !FIELDS.every((key) => typeof stat[key] === 'bigint')
    )
      return null;
    const result = Object.fromEntries(FIELDS.map((key) => [key, stat[key].toString()]));
    return validIdentity(result) ? result : null;
  } catch {
    return null;
  }
}
/**
 * Hash validated file identity metadata without exposing path/metadata strings.
 * @param {object|null} identity Private metadata.
 * @returns {string|null} Safe digest or unavailable.
 * @since unreleased
 */
function identityDigest(identity) {
  return validIdentity(identity)
    ? createHash('sha256')
        .update(JSON.stringify(FIELDS.map((key) => identity[key])))
        .digest('hex')
    : null;
}
/**
 * Refuse nonordinary ancestors through an existing task-owned directory.
 * @param {string} directory Owned local directory.
 * @returns {string} Absolute checked directory.
 * @since unreleased
 */
function ordinaryDirectory(directory) {
  if (
    typeof directory !== 'string' ||
    !directory ||
    directory.length > 1024 ||
    directory.includes('\0') ||
    /^[/\\]{2}/.test(directory)
  )
    throw new Error('file-read-directory-invalid');
  const resolved = path.resolve(directory),
    root = path.parse(resolved).root;
  let current = root;
  for (const part of resolved.slice(root.length).split(path.sep)) {
    if (part.includes(':')) throw new Error('file-read-directory-invalid');
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error('file-read-directory-invalid');
  }
  return resolved;
}
module.exports = {
  identityFromStat,
  identityDigest,
  ordinaryDirectory,
  validIdentity,
  exact,
  safeId,
  sha,
  name,
  MAX_BYTES,
  TARGETS,
};
