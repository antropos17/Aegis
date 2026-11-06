/** @file Stage-then-replace writes for the activity exports. @since v0.24.0 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const OWNER_LOST = Symbol('owner-lost');

/**
 * Remove the temporary file this attempt created, and nothing else.
 * @param {string} temporary - Exact path created by the attempt.
 * @returns {Promise<boolean>} Whether the file is confirmed gone.
 */
async function removeTemporary(temporary) {
  try {
    await fs.promises.unlink(temporary);
    return true;
  } catch (err) {
    return err?.code === 'ENOENT';
  }
}

/**
 * Write a sibling temporary file and replace the destination only after it is
 * complete and closed, so a failed attempt leaves an existing file untouched.
 * The owner is rechecked after each asynchronous step and immediately before the
 * replacement is dispatched; a replacement already in flight cannot be cancelled.
 * @param {string} filePath - Destination chosen by the user.
 * @param {string} contents - Complete export.
 * @param {() => boolean} canComplete - Rechecks the requesting renderer.
 * @returns {Promise<{status: 'replaced'|'owner-lost'|'failed', cleanupIncomplete: boolean}>}
 *   Fixed metadata only; neither a path nor a system error message crosses this boundary.
 * @since v0.24.0
 */
async function replaceFileContents(filePath, contents, canComplete) {
  const resolved = path.resolve(filePath);
  const temporary = path.join(path.dirname(resolved), `.aegis-export-${randomUUID()}.tmp`);
  const checkOwner = () => {
    if (!canComplete()) throw OWNER_LOST;
  };
  let handle = null;
  let created = false;
  try {
    handle = await fs.promises.open(temporary, 'wx', 0o600);
    created = true;
    checkOwner();
    await handle.writeFile(contents);
    checkOwner();
    await handle.sync();
    checkOwner();
    const closing = handle;
    handle = null;
    await closing.close();
    checkOwner();
    await fs.promises.rename(temporary, resolved);
    return { status: 'replaced', cleanupIncomplete: false };
  } catch (err) {
    if (handle) await handle.close().catch(() => {});
    return {
      status: err === OWNER_LOST ? 'owner-lost' : 'failed',
      cleanupIncomplete: created && !(await removeTemporary(temporary)),
    };
  }
}

module.exports = { replaceFileContents };
