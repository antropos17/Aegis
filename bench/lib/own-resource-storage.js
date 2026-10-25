'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '../..');
const SOURCES = Object.freeze([
  'bench/self-resource-run.cjs',
  'bench/lib/self-resource-session.js',
  'bench/lib/own-resource-storage.js',
  'bench/lib/self-resource-sampler.js',
  'bench/lib/bracketed-resource-intervals.js',
]);
const CAPS = Object.freeze({
  'session-plan.json': 16384,
  'session-pending.json': 4096,
  'raw-samples.json': 131073,
  'bracketed-intervals.json': 524289,
  'session-final.json': 16384,
});
const QUOTA = 1048576;
const fail = () => {
  throw new Error('self-resource-storage-unavailable');
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
/** Check ordinary local ancestors; this is not adversarial containment. @param {string} dir Existing owned directory. @returns {void} @since unreleased */
function ordinaryDirectory(dir) {
  if (/^[/\\]{2}/.test(dir)) fail();
  let current = path.resolve(dir);
  while (true) {
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail();
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
function source(relative) {
  const file = path.join(ROOT, relative);
  ordinaryDirectory(path.dirname(file));
  const named = fs.lstatSync(file, { bigint: true });
  if (
    named.isSymbolicLink() ||
    !named.isFile() ||
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
/** Hash fixed reporter/adapter disk bytes, without claiming loaded-code authentication. @returns {object} Closed inventory. @since unreleased */
function inventory() {
  return {
    basis: 'repository-disk-bytes-at-endpoint',
    nodeVersion: process.version,
    files: SOURCES.map(source),
  };
}
/** Create a bounded fresh-only artifact writer. @param {string} out New directory path. @returns {object} Writer and confirmed closed-file accounting. @since unreleased */
function createStorage(out) {
  ordinaryDirectory(path.dirname(out));
  fs.mkdirSync(out);
  const files = [];
  let reserved = 0;
  return {
    files,
    write(name, value) {
      if (!Object.hasOwn(CAPS, name) || files.some((f) => f.file === name)) fail();
      const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
      if (bytes.length > CAPS[name] || reserved + bytes.length > QUOTA) fail();
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
module.exports = { createStorage, inventory, ordinaryDirectory, SOURCES, CAPS, QUOTA };
