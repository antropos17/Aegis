'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { fail, hash } = require('./resource-replay-json');
const CAPS = Object.freeze({
  'supervision-plan.json': 16384,
  'supervision-pending.json': 4096,
  'supervision-final.json': 32768,
  'capture/session-plan.json': 16384,
  'capture/session-pending.json': 4096,
  'capture/raw-samples.json': 131073,
  'capture/bracketed-intervals.json': 524289,
  'capture/session-final.json': 16384,
});
/** Validate an ordinary existing local directory and its ancestors. @param {string} dir Path. @returns {string} Resolved path. @since unreleased */
function directory(dir) {
  if (
    typeof dir !== 'string' ||
    !dir ||
    dir.length > 4096 ||
    dir.includes('\0') ||
    /^[/\\]{2}/.test(dir)
  )
    fail();
  let current = path.resolve(dir);
  const resolved = current;
  if (current === path.parse(current).root) fail();
  while (true) {
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail();
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolved;
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
/** Read one fixed artifact or source with close/stability confirmation and aggregate accounting. @param {string} file Explicit path. @param {number} cap Byte cap. @param {object} budget Aggregate. @param {boolean} [optional] ENOENT only. @returns {Buffer|null} Bytes. @since unreleased */
function read(file, cap, budget, optional = false) {
  let named;
  try {
    named = fs.lstatSync(file, { bigint: true });
  } catch (error) {
    if (optional && error.code === 'ENOENT') return null;
    fail();
  }
  if (
    !named.isFile() ||
    named.isSymbolicLink() ||
    named.nlink !== 1n ||
    named.size < 0n ||
    named.size > BigInt(cap) ||
    budget.bytes + Number(named.size) > 1048576
  )
    fail();
  let fd, result;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const before = fs.fstatSync(fd, { bigint: true });
    if (!same(named, before)) fail();
    const bytes = Buffer.alloc(cap + 1);
    let used = 0;
    while (used < bytes.length) {
      const count = fs.readSync(fd, bytes, used, bytes.length - used, used);
      if (!Number.isSafeInteger(count) || count < 0 || count > bytes.length - used) fail();
      used += count;
      if (!count) break;
    }
    if (
      used > cap ||
      BigInt(used) !== before.size ||
      !same(before, fs.fstatSync(fd, { bigint: true })) ||
      !same(before, fs.lstatSync(file, { bigint: true }))
    )
      fail();
    budget.bytes += used;
    if (budget.bytes > 1048576) fail();
    result = bytes.subarray(0, used);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return result;
}
/** Publish exactly one bounded fresh report, preserving partial/competing files. @param {string} out New directory. @param {object} report Safe report. @returns {void} @since unreleased */
function publish(out, report) {
  const bytes = Buffer.from(JSON.stringify(report, null, 2) + '\n');
  if (bytes.length > 65536) fail();
  try {
    directory(path.dirname(out));
    fs.mkdirSync(out);
  } catch {
    throw Error('resource-replay-output-refused');
  }
  directory(out);
  const fd = fs.openSync(
    path.join(out, 'resource-replay.json'),
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
}
module.exports = { CAPS, directory, read, publish, hash };
