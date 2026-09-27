'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const MAX_INPUT_BYTES = 64 * 1024;

/** Capture a private preview only. The native owner reopens and verifies the file
 * under a read-only handle that denies write/delete sharing before copying.
 * @param {string} selected Exact local file path.
 * @param {typeof fs} [io] Native filesystem seam for bounded-read tests.
 * @returns {{path:string,size:number,sha256:string}} Frozen preview binding.
 * @since v0.17.0 */
function captureInputSnapshot(selected, io = fs) {
  if (
    process.platform !== 'win32' ||
    typeof selected !== 'string' ||
    selected.length < 4 ||
    selected.length > 32000 ||
    !/^[a-zA-Z]:\\/.test(selected) ||
    selected.slice(2).includes(':') ||
    path.win32.normalize(selected) !== selected ||
    selected.split('\\').some((part) => part === '.' || part === '..' || /[. ]$/.test(part))
  )
    throw new Error('input-unavailable');
  const root = path.win32.parse(selected).root;
  let current = root;
  const parts = selected.slice(root.length).split('\\');
  if (!parts.length || parts.some((part) => !part)) throw new Error('input-unavailable');
  for (let index = 0; index < parts.length; index++) {
    current = path.win32.join(current, parts[index]);
    const stat = io.lstatSync(current);
    if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile()))
      throw new Error('input-unavailable');
  }
  const fd = io.openSync(selected, 'r');
  try {
    const before = io.fstatSync(fd);
    if (!before.isFile() || before.size > MAX_INPUT_BYTES) throw new Error('input-unavailable');
    const bounded = Buffer.alloc(MAX_INPUT_BYTES + 1);
    try {
      let total = 0;
      while (total < bounded.length) {
        const count = io.readSync(fd, bounded, total, bounded.length - total, null);
        if (count === 0) break;
        total += count;
      }
      const after = io.fstatSync(fd);
      if (
        total > MAX_INPUT_BYTES ||
        total !== before.size ||
        before.size !== after.size ||
        before.ino !== after.ino ||
        before.dev !== after.dev ||
        before.mtimeMs !== after.mtimeMs
      )
        throw new Error('input-unavailable');
      return Object.freeze({
        path: selected,
        size: total,
        sha256: createHash('sha256').update(bounded.subarray(0, total)).digest('hex'),
      });
    } finally {
      bounded.fill(0);
    }
  } finally {
    io.closeSync(fd);
  }
}

module.exports = { captureInputSnapshot, MAX_INPUT_BYTES };
