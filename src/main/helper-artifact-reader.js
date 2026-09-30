'use strict';
const fs = require('node:fs/promises');
const constants = require('node:fs').constants;
const path = require('node:path');
const { LIMITS } = require('./helper-artifact-admission');
const same = (a, b) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.ctimeMs === b.ctimeMs;
/** Read only fixed owner-selected filenames under one canonical regular directory.
 * Captured bytes become owned snapshots; no source-current or hostile-principal promise follows close.
 * @param {object} selection Exact root/keyId descriptor, never imported manifest paths.
 * @param {Function} assertCurrent Owner epoch check at every asynchronous boundary.
 * @returns {Promise<object>} Owned bounded manifest/signature/artifact bytes. @since v0.17.0 */
async function readHelperArtifactFiles(selection, assertCurrent) {
  if (
    !selection ||
    Object.keys(selection).length !== 2 ||
    typeof selection.root !== 'string' ||
    selection.root.length > 4096 ||
    !path.isAbsolute(selection.root) ||
    typeof selection.keyId !== 'string' ||
    !/^[a-z][a-z0-9-]{0,31}$/.test(selection.keyId) ||
    !Object.hasOwn(selection, 'root') ||
    !Object.hasOwn(selection, 'keyId') ||
    typeof assertCurrent !== 'function'
  )
    throw Error('helper-artifact-unavailable');
  const root = path.resolve(selection.root),
    owned = {};
  try {
    assertCurrent();
    const directory = await fs.lstat(root);
    assertCurrent();
    if (
      !directory.isDirectory() ||
      directory.isSymbolicLink() ||
      path.resolve(await fs.realpath(root)) !== root
    )
      throw Error('source-directory');
    assertCurrent();
    const recheck = async () => {
      const actual = await fs.lstat(root);
      assertCurrent();
      if (
        actual.isSymbolicLink() ||
        !actual.isDirectory() ||
        actual.dev !== directory.dev ||
        actual.ino !== directory.ino
      )
        throw Error('source-directory');
    };
    for (const [field, name, max] of [
      ['manifest', 'manifest.json', LIMITS.manifestBytes],
      ['signature', 'signature.bin', 64],
      ['artifact', 'helper.bin', LIMITS.artifactBytes],
    ]) {
      await recheck();
      const file = path.join(root, name),
        before = await fs.lstat(file);
      assertCurrent();
      if (!before.isFile() || before.isSymbolicLink() || before.size <= 0 || before.size > max)
        throw Error('source-file');
      const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      try {
        assertCurrent();
        const opened = await handle.stat();
        assertCurrent();
        if (!same(before, opened)) throw Error('source-identity');
        const bytes = Buffer.alloc(before.size + 1);
        let offset = 0;
        while (offset < bytes.length) {
          const read = await handle.read(
            bytes,
            offset,
            Math.min(bytes.length - offset, 65536),
            offset,
          );
          assertCurrent();
          if (!read.bytesRead) break;
          offset += read.bytesRead;
        }
        const after = await handle.stat();
        assertCurrent();
        const current = await fs.lstat(file);
        assertCurrent();
        if (
          offset !== before.size ||
          !same(before, after) ||
          !same(before, current) ||
          current.isSymbolicLink()
        )
          throw Error('source-changed');
        owned[field] = Buffer.from(bytes.subarray(0, offset));
        bytes.fill(0);
      } finally {
        await handle.close();
      }
      assertCurrent();
      await recheck();
    }
    return { keyId: selection.keyId, ...owned };
  } catch {
    for (const value of Object.values(owned)) value.fill(0);
    throw Error('helper-artifact-unavailable');
  }
}
module.exports = { readHelperArtifactFiles };
