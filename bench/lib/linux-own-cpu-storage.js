'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '../..');
const FILES = Object.freeze({
  'cpu-reference-plan.json': 16384,
  'cpu-reference-pending.json': 4096,
  'raw-samples.json': 16385,
  'cpu-reference-windows.json': 32768,
  'cpu-reference-final.json': 16384,
});
const SOURCES = Object.freeze([
  'bench/linux-own-cpu-qualify.cjs',
  'bench/lib/linux-own-cpu-reference.js',
  'bench/lib/linux-own-cpu-proc.js',
  'bench/lib/linux-own-cpu-work.js',
  'bench/lib/linux-own-cpu-model.js',
  'bench/lib/linux-own-cpu-capture.js',
  'bench/lib/linux-own-cpu-storage.js',
  'bench/lib/self-resource-sampler.js',
]);
const fail = () => {
  throw Error('linux-own-cpu-storage-unavailable');
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function directory(dir) {
  if (typeof dir !== 'string' || /^[/\\]{2}/.test(dir)) fail();
  let current = path.resolve(dir);
  while (true) {
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail();
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
function same(a, b) {
  return (
    a.isFile() &&
    b.isFile() &&
    !b.isSymbolicLink() &&
    a.nlink === 1n &&
    b.nlink === 1n &&
    a.ino > 0n &&
    ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(
      (key) => typeof a[key] === 'bigint' && a[key] === b[key],
    )
  );
}
/** Read exact fixed implementation source identities, independently of live proc pseudofiles. @returns {object} Bounded disk inventory. @since unreleased */
function inventory() {
  const files = SOURCES.map((file) => {
    const full = path.join(ROOT, file);
    directory(path.dirname(full));
    const named = fs.lstatSync(full, { bigint: true });
    if (
      !named.isFile() ||
      named.isSymbolicLink() ||
      named.nlink !== 1n ||
      named.size < 1n ||
      named.size > 65536n
    )
      fail();
    let fd, value;
    try {
      fd = fs.openSync(full, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const before = fs.fstatSync(fd, { bigint: true });
      if (!same(named, before)) fail();
      const bytes = Buffer.alloc(65537);
      let used = 0;
      while (used < bytes.length) {
        const count = fs.readSync(fd, bytes, used, bytes.length - used, null);
        if (!Number.isSafeInteger(count) || count < 0 || count > bytes.length - used) fail();
        used += count;
        if (!count) break;
      }
      if (
        used > 65536 ||
        BigInt(used) !== before.size ||
        !same(before, fs.fstatSync(fd, { bigint: true })) ||
        !same(before, fs.lstatSync(full, { bigint: true }))
      )
        fail();
      value = bytes.subarray(0, used);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    return { file, sha256: hash(value), byteLength: value.length };
  });
  return {
    basis: 'repository-disk-bytes-at-endpoint',
    nodeVersion: process.version,
    files,
    loadedCodeAuthenticated: false,
  };
}
/** Create a fresh bounded fixed-roster writer. @param {string} out Owned new directory. @returns {object} Confirmed files and writer. @since unreleased */
function createStorage(out) {
  try {
    directory(path.dirname(out));
    fs.mkdirSync(out);
  } catch {
    throw Error('linux-own-cpu-output-refused');
  }
  let reserved = 0;
  const files = [];
  return {
    files,
    write(name, value) {
      if (!Object.hasOwn(FILES, name) || files.some((v) => v.file === name)) fail();
      const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
      if (bytes.length > FILES[name] || reserved + bytes.length > 131072) fail();
      reserved += bytes.length;
      directory(out);
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
module.exports = { ROOT, FILES, SOURCES, inventory, createStorage };
