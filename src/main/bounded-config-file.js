'use strict';

const fs = require('node:fs');

const MAX_CONFIG_BYTES = 16 * 1024 * 1024;
const sameFile = (left, right) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.size === right.size &&
  left.mtimeMs === right.mtimeMs &&
  left.ctimeMs === right.ctimeMs;

/**
 * Read one selected configuration file from a checked handle with a fixed memory bound.
 * A changed file, link, directory or oversized input is unavailable.
 * @param {string} filename Selected configuration path.
 * @returns {string} Complete UTF-8 file text.
 * @since v0.17.0
 */
function readBoundedConfigFile(filename) {
  let handle;
  try {
    const before = fs.lstatSync(filename);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      !Number.isSafeInteger(before.size) ||
      before.size > MAX_CONFIG_BYTES
    )
      throw new Error('config-file-unavailable');
    handle = fs.openSync(
      filename,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0),
    );
    const opened = fs.fstatSync(handle);
    if (!opened.isFile() || !sameFile(before, opened)) throw new Error('config-file-unavailable');
    const bytes = Buffer.alloc(before.size + 1);
    try {
      let length = 0;
      while (length < bytes.length) {
        const count = fs.readSync(handle, bytes, length, bytes.length - length, length);
        if (count === 0) break;
        length += count;
      }
      if (
        length !== before.size ||
        !sameFile(opened, fs.fstatSync(handle)) ||
        !sameFile(opened, fs.lstatSync(filename))
      )
        throw new Error('config-file-unavailable');
      return bytes.toString('utf8', 0, length);
    } finally {
      bytes.fill(0);
    }
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
}

module.exports = { readBoundedConfigFile, MAX_CONFIG_BYTES };
