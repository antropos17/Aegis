'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { ordinaryDirectory } = require('./own-resource-storage');
const ROOT = path.resolve(__dirname, '../..');
const FILES = Object.freeze({
  'supervision-plan.json': 16384,
  'supervision-pending.json': 4096,
  'supervision-final.json': 32768,
});
const SOURCES = Object.freeze([
  'bench/self-resource-supervise.cjs',
  'bench/lib/resource-supervisor.js',
  'bench/lib/resource-supervisor-child.js',
  'bench/lib/resource-supervisor-stream.js',
  'bench/lib/resource-supervisor-storage.js',
  'bench/self-resource-run.cjs',
  'bench/lib/self-resource-session.js',
  'bench/lib/own-resource-storage.js',
  'bench/lib/self-resource-sampler.js',
  'bench/lib/bracketed-resource-intervals.js',
]);
const fail = () => {
  throw Error('resource-supervisor-storage-unavailable');
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function same(a, b) {
  return (
    a.isFile() &&
    b.isFile() &&
    a.nlink === 1n &&
    b.nlink === 1n &&
    a.ino > 0n &&
    ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(
      (key) => typeof a[key] === 'bigint' && a[key] === b[key],
    )
  );
}
function source(relative) {
  const file = path.join(ROOT, relative);
  ordinaryDirectory(path.dirname(file));
  const named = fs.lstatSync(file, { bigint: true });
  if (
    !named.isFile() ||
    named.isSymbolicLink() ||
    named.nlink !== 1n ||
    named.size < 1n ||
    named.size > 65536n
  )
    fail();
  let fd, bytes;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const before = fs.fstatSync(fd, { bigint: true });
    if (!same(named, before)) fail();
    const buffer = Buffer.alloc(65537);
    let total = 0;
    while (total < buffer.length) {
      const count = fs.readSync(fd, buffer, total, buffer.length - total, null);
      if (!Number.isSafeInteger(count) || count < 0 || count > buffer.length - total) fail();
      if (!count) break;
      total += count;
    }
    if (
      BigInt(total) !== before.size ||
      total > 65536 ||
      !same(before, fs.fstatSync(fd, { bigint: true })) ||
      !same(before, fs.lstatSync(file, { bigint: true }))
    )
      fail();
    bytes = buffer.subarray(0, total);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return { file: relative, sha256: hash(bytes), byteLength: bytes.length };
}
/** Snapshot fixed parent/child disk source bytes without loaded-code authentication. @returns {object} Bounded inventory. @since unreleased */
function inventory() {
  return {
    basis: 'repository-disk-bytes-at-endpoint',
    nodeVersion: process.version,
    files: SOURCES.map(source),
  };
}
/** Make a fresh outer directory and exclusive fixed-roster writer. @param {string} out Owned new local directory. @returns {object} Closed-file accounting and writer. @since unreleased */
function createStorage(out) {
  ordinaryDirectory(path.dirname(out));
  fs.mkdirSync(out);
  const files = [];
  let reserved = 0;
  return {
    files,
    write(name, object) {
      if (!Object.hasOwn(FILES, name) || files.some((f) => f.file === name)) fail();
      const bytes = Buffer.from(JSON.stringify(object, null, 2) + '\n');
      if (bytes.length > FILES[name] || reserved + bytes.length > 65536) fail();
      reserved += bytes.length;
      ordinaryDirectory(out);
      const fd = fs.openSync(
        path.join(out, name),
        fs.constants.O_WRONLY |
          fs.constants.O_CREAT |
          fs.constants.O_EXCL |
          (fs.constants.O_NOFOLLOW || 0),
      );
      try {
        let offset = 0;
        while (offset < bytes.length) {
          const count = fs.writeSync(fd, bytes, offset, bytes.length - offset, null);
          if (!Number.isSafeInteger(count) || count <= 0 || count > bytes.length - offset) fail();
          offset += count;
        }
      } finally {
        fs.closeSync(fd);
      }
      const record = { file: name, sha256: hash(bytes), byteLength: bytes.length, closed: true };
      files.push(record);
      return record;
    },
  };
}
module.exports = { inventory, createStorage, ROOT, FILES, SOURCES };
