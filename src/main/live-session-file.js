'use strict';

const fs = require('node:fs');
const path = require('node:path');
const io = fs.promises;
const same = (a, b) =>
  ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every((key) => a[key] === b[key]);
const sameGrowingFile = (a, b) =>
  b.isFile() &&
  b.nlink === 1n &&
  a.dev === b.dev &&
  a.ino === b.ino &&
  (same(a, b) || b.size > a.size);

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
 * A growing JSONL tail requires one identical reread of the selected byte window
 * and remains partial. Replacement, shrinking and changed selected bytes refuse.
 * No path/content/error logging, discovery or file writes; no hidden retry.
 * @param {string} file Application-selected path. @param {number} maximum Total read byte budget.
 * @param {boolean} tail Allow a bounded tail. @returns {Promise<{bytes:Buffer,headTruncated:boolean,tailTruncated:boolean}>}
 * @since v0.21.0 */
async function readLiveSessionFile(file, maximum, tail = false) {
  let handle,
    bytes,
    returned = false;
  try {
    // Reserve the growing-tail verification pass before reading any source bytes.
    const windowLimit = tail ? Math.floor(maximum / 2) : maximum;
    if (!Number.isSafeInteger(windowLimit) || windowLimit < 1) throw Error();
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
    let tailTruncated = !same(before, opened);
    if (
      !opened.isFile() ||
      opened.nlink !== 1n ||
      (tailTruncated &&
        (!tail || !sameGrowingFile(before, opened) || opened.size <= before.size)) ||
      opened.size > BigInt(Number.MAX_SAFE_INTEGER)
    )
      throw Error();
    const size = Number(opened.size),
      start = Math.max(0, size - windowLimit);
    bytes = Buffer.alloc(size - start);
    const readWindow = async (buffer) => {
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(
          buffer,
          offset,
          Math.min(65536, buffer.length - offset),
          start + offset,
        );
        if (!bytesRead) throw Error();
        offset += bytesRead;
      }
    };
    await readWindow(bytes);
    const afterRead = await handle.stat({ bigint: true }),
      selectedAfterRead = await inspect(file);
    if (!same(opened, afterRead) || !same(opened, selectedAfterRead)) {
      if (
        !tail ||
        !sameGrowingFile(opened, afterRead) ||
        !sameGrowingFile(afterRead, selectedAfterRead) ||
        selectedAfterRead.size <= opened.size
      )
        throw Error();
      tailTruncated = true;
    }
    if (tailTruncated) {
      const verified = Buffer.alloc(bytes.length);
      try {
        await readWindow(verified);
        if (!verified.equals(bytes)) throw Error();
        const afterVerify = await handle.stat({ bigint: true }),
          selectedAfterVerify = await inspect(file);
        if (
          !sameGrowingFile(selectedAfterRead, afterVerify) ||
          !sameGrowingFile(afterVerify, selectedAfterVerify)
        )
          throw Error();
      } finally {
        verified.fill(0);
      }
    }
    await handle.close();
    handle = null;
    // The parser discards this first partial line; remove any split UTF-8 prefix.
    const lf = start > 0 ? bytes.indexOf(10) : 0;
    const begin = lf < 0 ? bytes.length : lf;
    let end = bytes.length;
    if (tail && bytes[end - 1] !== 10) {
      end = bytes.lastIndexOf(10) + 1;
      tailTruncated = true;
    }
    if (begin > 0 || end < bytes.length) {
      const complete = Buffer.from(bytes.subarray(Math.min(begin, end), end));
      bytes.fill(0);
      bytes = complete;
    }
    returned = true;
    return { bytes, headTruncated: start > 0, tailTruncated };
  } catch {
    throw Error('live-session-source-unavailable');
  } finally {
    if (!returned) bytes?.fill(0);
    if (handle) await handle.close().catch(() => {});
  }
}

module.exports = { readLiveSessionFile };
