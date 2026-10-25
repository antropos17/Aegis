'use strict';

const fs = require('node:fs');
const path = require('node:path');
const io = fs.promises;
const same = (a, b) =>
  ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every((key) => a[key] === b[key]);

/** Check the selected native local path without traversing directory contents.
 * This is ordinary same-user filesystem evidence, not the native reader's
 * reparse/loader custody guarantee. Callers must not promote it to confirmed.
 * @param {string} file Absolute application-selected path. @returns {Promise<object>}
 * @since v0.21.0 */
async function inspect(file) {
  if (
    !path.isAbsolute(file) ||
    file.length > 4096 ||
    /\p{Cc}/u.test(file) ||
    (process.platform === 'win32' && !/^[a-z]:[\\/]/i.test(file))
  )
    throw Error();
  let cursor = file,
    leaf;
  for (let depth = 0; depth < 128; depth++) {
    const stat = await io.lstat(cursor, { bigint: true });
    if (
      stat.isSymbolicLink() ||
      (cursor === file ? !stat.isFile() || stat.nlink !== 1n : !stat.isDirectory())
    )
      throw Error();
    if (cursor === file) leaf = stat;
    const parent = path.dirname(cursor);
    if (parent === cursor) return leaf;
    cursor = parent;
  }
  throw Error();
}

/** Read one stable bounded file/tail, returning an owned buffer to clear after parsing.
 * No path/content/error logging, discovery or file writes. Concurrent append,
 * replacement and incomplete reads are unavailable; they never hide an OS event.
 * @param {string} file Application-selected path. @param {number} maximum Byte limit.
 * @param {boolean} tail Allow a bounded tail. @returns {Promise<{bytes:Buffer,headTruncated:boolean}>}
 * @since v0.21.0 */
async function readLiveSessionFile(file, maximum, tail = false) {
  let handle,
    bytes,
    returned = false;
  try {
    const before = await inspect(file);
    if (
      before.ino === 0n ||
      before.size <= 0n ||
      before.size > BigInt(Number.MAX_SAFE_INTEGER) ||
      (!tail && before.size > BigInt(maximum))
    )
      throw Error();
    handle = await io.open(
      file,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0),
    );
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || !same(before, opened)) throw Error();
    const size = Number(before.size),
      start = Math.max(0, size - maximum);
    bytes = Buffer.alloc(size - start);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        Math.min(65536, bytes.length - offset),
        start + offset,
      );
      if (!bytesRead) throw Error();
      offset += bytesRead;
    }
    if (!same(before, await handle.stat({ bigint: true })) || !same(before, await inspect(file)))
      throw Error();
    await handle.close();
    handle = null;
    // The parser discards this first partial line; remove any split UTF-8 prefix.
    if (start > 0) {
      const lf = bytes.indexOf(10);
      const complete = Buffer.from(bytes.subarray(lf < 0 ? bytes.length : lf));
      bytes.fill(0);
      bytes = complete;
    }
    returned = true;
    return { bytes, headTruncated: start > 0 };
  } catch {
    throw Error('live-session-source-unavailable');
  } finally {
    if (!returned) bytes?.fill(0);
    if (handle) await handle.close().catch(() => {});
  }
}

module.exports = { readLiveSessionFile };
