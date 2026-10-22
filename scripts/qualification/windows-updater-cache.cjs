'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

/** Hash a bounded, caller-validated fixture file. @since 0.20.1 */
async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** Verify NSIS's baseline cache without allowing a preseeded update. @since 0.20.1 */
async function inspectInitialCache(directory, baseline) {
  const result = { pendingAbsent: true, files: [] };
  let stat;
  try {
    stat = await fs.lstat(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return result;
    throw error;
  }
  assert(stat.isDirectory() && !stat.isSymbolicLink(), 'Invalid updater cache directory');
  const entries = await fs.readdir(directory);
  // Normal NSIS installation copies its own EXE here for differential updates.
  // No pending directory, update metadata, or other content may precede the test.
  assert(
    entries.length <= 1 && entries.every((name) => name === 'installer.exe'),
    'Unexpected preexisting update cache content: ' + entries.slice(0, 10).join(', '),
  );
  for (const name of entries) {
    const file = path.join(directory, name);
    const entry = await fs.lstat(file);
    assert(entry.isFile() && !entry.isSymbolicLink(), 'Invalid cached baseline file');
    assert.equal(entry.size, baseline.bytes, 'Cached baseline size mismatch');
    const sha256 = await hashFile(file);
    assert.equal(sha256, baseline.sha256, 'Cached baseline hash mismatch');
    result.files.push({ name, bytes: entry.size, sha256 });
  }
  return result;
}

module.exports = { hashFile, inspectInitialCache };
