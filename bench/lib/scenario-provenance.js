'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const MAX_BYTES = 65536;
const tracked = new WeakMap();
const fail = () => {
  throw new Error('scenario-provenance-unavailable');
};
const digest = (bytes) => ({
  sha256: createHash('sha256').update(bytes).digest('hex'),
  byteLength: bytes.length,
});
function ordinary(file) {
  let dir = path.dirname(file);
  while (true) {
    const stat = fs.lstatSync(dir, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail();
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const stat = fs.lstatSync(file, { bigint: true });
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1n ||
    stat.size < 1n ||
    stat.size > BigInt(MAX_BYTES)
  )
    fail();
  return stat;
}
function same(a, b) {
  return (
    ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(
      (key) => typeof a[key] === 'bigint' && a[key] === b[key],
    ) &&
    a.ino > 0n &&
    a.isFile() &&
    b.isFile() &&
    a.nlink === 1n &&
    b.nlink === 1n
  );
}
function read(file) {
  const named = ordinary(file);
  let fd, bytes;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const before = fs.fstatSync(fd, { bigint: true });
    if (!same(named, before)) fail();
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const count = fs.readSync(fd, buffer, total, buffer.length - total, null);
      if (!count) break;
      total += count;
    }
    if (
      BigInt(total) !== before.size ||
      total > MAX_BYTES ||
      !same(before, fs.fstatSync(fd, { bigint: true })) ||
      !same(before, ordinary(file))
    )
      fail();
    bytes = buffer.subarray(0, total);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return bytes;
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
function record(entry, final) {
  return freeze({
    version: 1,
    loaded: { ...entry.loaded },
    final,
    sourceAuthenticated: false,
    measurementAccepted: false,
  });
}
/** Load and privately bind the exact bytes parsed. @param {string} file Owned scenario file. @returns {object} Parsed scenario. @since unreleased */
function load(file) {
  const bytes = read(file);
  const scenario = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (scenario && typeof scenario === 'object')
    tracked.set(scenario, {
      file,
      loaded: digest(bytes),
      canonical: JSON.stringify(scenario),
      sealed: false,
    });
  return scenario;
}
/** Opt in to an immutable execution snapshot, preserving legacy mutable callers. @param {object} scenario Loaded scenario. @returns {object} Same frozen object. @since unreleased */
function seal(scenario) {
  const entry = tracked.get(scenario);
  if (!entry || JSON.stringify(scenario) !== entry.canonical)
    throw new Error('scenario-provenance-invalid');
  freeze(scenario);
  entry.sealed = true;
  return scenario;
}
/** Initial evidence survives before execution starts. @param {object|null} scenario Sealed loaded object. @returns {object|null} Pending record, or absent binding. @since unreleased */
function initial(scenario) {
  const entry = tracked.get(scenario);
  return entry?.sealed ? record(entry, { state: 'pending', sha256: null, byteLength: null }) : null;
}
/** Compare source endpoints; this cannot prove absence of intermediate changes. @param {object} scenario Sealed loaded object. @returns {object|null} Final record. @since unreleased */
function finish(scenario) {
  const entry = tracked.get(scenario);
  if (!entry?.sealed) return null;
  let final;
  try {
    const current = digest(read(entry.file));
    final = {
      state:
        current.sha256 === entry.loaded.sha256 && current.byteLength === entry.loaded.byteLength
          ? 'unchanged'
          : 'changed',
      ...current,
    };
  } catch {
    final = { state: 'unavailable', sha256: null, byteLength: null };
  }
  return record(entry, final);
}
module.exports = { load, seal, initial, finish, MAX_BYTES };
