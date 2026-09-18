'use strict';

const fs = require('node:fs');
const path = require('node:path');

class InputError extends Error {}
const fail = (code) => {
  throw new InputError(code);
};
const sameFile = (a, b) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.ctimeMs === b.ctimeMs;

/**
 * Read only the selected regular file, in bounded chunks. Callbacks must consume
 * line buffers synchronously; their storage is reused. Canonicalize the selected
 * parent, then check the leaf before opening, before reading and after reading.
 * Best-effort race detection, not a filesystem sandbox.
 * @param {string} filename Explicit input path.
 * @param {{fileBytes:number,lineBytes:number,records:number}} limits Fixed importer limits.
 * @param {(line:Buffer|null, ordinal:number)=>boolean} onLine False stops admission; null means oversized.
 * @param {(code:string, ordinal?:number)=>void} issue Fixed-code diagnostic callback.
 * @returns {Promise<{available:boolean,bytes:number,records:number}>} Read accounting.
 * @since v0.15.1
 */
async function readHandoffLines(filename, limits, onLine, issue) {
  const usage = { available: false, bytes: 0, records: 0 };
  let handle;
  try {
    if (typeof filename !== 'string' || !filename || /^[\\/]{2}/.test(filename))
      fail('input-path-unsupported');
    const selected = path.resolve(filename);
    const name = path.basename(selected);
    // eslint-disable-next-line no-control-regex -- Reject control characters and alternate-stream names.
    if (!name || /[:\x00-\x1f]/.test(name)) fail('input-path-unsupported');
    const parent = await fs.promises.realpath(path.dirname(selected));
    const absolute = path.join(parent, name);
    const checkPath = async () => {
      const stat = await fs.promises.lstat(absolute);
      if (stat.isSymbolicLink()) fail('input-link-rejected');
      if (!stat.isFile()) fail('input-not-regular');
      if (
        (await fs.promises.realpath(absolute)) !== absolute ||
        (await fs.promises.realpath(parent)) !== parent
      )
        fail('input-changed');
      return stat;
    };
    const before = await checkPath();
    if (before.size > limits.fileBytes) fail('file-size-limit');
    handle = await fs.promises.open(
      absolute,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0),
    );
    const opened = await handle.stat();
    if (!opened.isFile() || !sameFile(before, opened) || !sameFile(opened, await checkPath()))
      fail('input-changed');
    usage.available = true;
    const chunk = Buffer.alloc(16 * 1024);
    const line = Buffer.alloc(limits.lineBytes);
    let length = 0;
    let oversized = false;
    let stopped = false;
    while (!stopped && usage.bytes < before.size) {
      const { bytesRead } = await handle.read(
        chunk,
        0,
        Math.min(chunk.length, before.size - usage.bytes),
        usage.bytes,
      );
      if (!bytesRead) fail('input-changed');
      usage.bytes += bytesRead;
      for (let index = 0; index < bytesRead; index++) {
        if (usage.records >= limits.records) {
          issue('record-limit');
          stopped = true;
          break;
        }
        if (chunk[index] === 10) {
          usage.records++;
          stopped = !onLine(oversized ? null : line.subarray(0, length), usage.records);
          length = 0;
          oversized = false;
          if (stopped) break;
        } else if (length < line.length) {
          line[length++] = chunk[index];
        } else {
          oversized = true;
        }
      }
    }
    if (!stopped && (length || oversized)) issue('unterminated-record', usage.records + 1);
    if (!sameFile(opened, await handle.stat()) || !sameFile(opened, await checkPath()))
      fail('input-changed');
  } catch (error) {
    issue(error instanceof InputError ? error.message : 'input-unavailable');
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch (_) {
        issue('input-close-failed');
      }
    }
  }
  return usage;
}

module.exports = { readHandoffLines };
