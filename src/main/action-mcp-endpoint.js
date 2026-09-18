'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { readActionFile } = require('./action-policy');
let testDeps = null;
const identity = (a, b) => a && b && a.dev === b.dev && a.ino === b.ino;
const same = (a, b) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.ctimeMs === b.ctimeMs;

/**
 * Exclusively publish an operator-selected endpoint; never replace a prior file.
 * Windows permissions are inherited from the directory, not guaranteed by 0600.
 * @param {string} filename Explicit new descriptor in an operator-private directory.
 * @param {{schemaVersion:number,port:number,token:string}} endpoint Private bearer endpoint.
 * @returns {Promise<() => Promise<boolean>>} Remove only this unchanged regular file.
 * @since v0.15.1
 */
async function publishActionEndpoint(filename, endpoint) {
  if (typeof filename !== 'string' || !filename || /^[\\/]{2}/.test(filename))
    throw new Error('endpoint-unavailable');
  const selected = path.resolve(filename);
  const name = path.basename(selected);
  // eslint-disable-next-line no-control-regex -- Reject alternate streams and control characters.
  if (!name || /[:\x00-\x1f]/.test(name)) throw new Error('endpoint-unavailable');
  const parent = await fs.realpath(path.dirname(selected));
  const absolute = path.join(parent, name);
  const bytes = Buffer.from(JSON.stringify(endpoint) + '\n');
  let handle;
  let written;
  let created;
  const removeUnchanged = async (expected, stamp, allowPrefix = false) => {
    let currentBytes;
    try {
      if (!stamp || !identity(stamp, created)) return false;
      const current = await fs.lstat(absolute);
      if (
        !current.isFile() ||
        current.isSymbolicLink() ||
        !same(current, stamp) ||
        current.size > expected.length ||
        (!allowPrefix && current.size !== expected.length) ||
        (await fs.realpath(parent)) !== parent
      )
        return false;
      currentBytes = await readActionFile(absolute);
      if (
        !currentBytes.equals(expected.subarray(0, current.size)) ||
        !same(await fs.lstat(absolute), stamp)
      )
        return false;
      // lstat/unlink cannot be atomic in Node. This requires the documented
      // operator-private parent directory, not a hostile same-user writer.
      await fs.unlink(absolute);
      return true;
    } catch {
      return false;
    } finally {
      currentBytes?.fill(0);
    }
  };
  try {
    handle = await (testDeps?.open || fs.open)(absolute, 'wx', 0o600);
    // Capture creation identity independently of later write/stat failures.
    created = await handle.stat();
    await handle.writeFile(bytes);
    written = await handle.stat();
    await handle.close();
  } catch {
    let partial = written;
    try {
      if (handle) {
        const current = await handle.stat();
        partial = written && !same(current, written) ? undefined : current;
      }
    } catch {
      /* Retain without usable metadata. */
    }
    try {
      await handle?.close();
    } catch {
      /* Locked/uncertain files are retained if unlink fails. */
    }
    try {
      if (created) await removeUnchanged(bytes, partial, true);
    } finally {
      bytes.fill(0);
    }
    throw new Error('endpoint-unavailable');
  }
  return async () => {
    try {
      return await removeUnchanged(bytes, written);
    } finally {
      bytes.fill(0);
    }
  };
}
/** @param {object} deps Trusted test-only file opener. @returns {void} @since v0.15.1 */
function _setDepsForTest(deps) {
  testDeps = deps;
}
/** @returns {void} @since v0.15.1 */
function _resetForTest() {
  testDeps = null;
}
module.exports = { publishActionEndpoint, _setDepsForTest, _resetForTest };
