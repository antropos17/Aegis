'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createInventoryReader } = require('./inventory-reader');
const { parseInventoryConfig } = require('./inventory-config');
const { validateSnapshot, hashSnapshotValue, SNAPSHOT_BYTES } = require('./inventory-snapshot');

/** Resolve the caller-selected subject once. @param {string} directory @returns {Promise<object>} Canonical root and binding. @since v0.15.1 */
async function resolveSnapshotSubject(directory) {
  const root = await fs.promises.realpath(directory);
  const stat = await fs.promises.stat(root);
  if (!stat.isDirectory()) throw new Error('snapshot-unavailable');
  return { root, rootSha256: hashSnapshotValue(root), dev: stat.dev, ino: stat.ino };
}

/** Check root identity after a best-effort capture. @param {object} subject @returns {Promise<void>} Throws on replacement. @since v0.15.1 */
async function checkSnapshotSubject(subject) {
  const stat = await fs.promises.stat(subject.root);
  if (
    (await fs.promises.realpath(subject.root)) !== subject.root ||
    stat.dev !== subject.dev ||
    stat.ino !== subject.ino
  )
    throw new Error('snapshot-unavailable');
}

async function location(filename, subject) {
  const selected = path.resolve(filename);
  const name = path.basename(selected);
  // Match the reader's filename contract; ':' also selects NTFS alternate streams.
  if (!name || name === '.' || name === '..' || name.includes(':') || name.includes('\\'))
    throw new Error('snapshot-unavailable');
  const directory = await fs.promises.realpath(path.dirname(selected));
  const absolute = path.join(directory, name);
  if (subject) {
    const relative = path.relative(subject.root, absolute);
    if (
      !relative ||
      (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
    )
      throw new Error('snapshot-inside-subject');
  }
  return { directory, absolute, name };
}

/**
 * Read a caller-selected JSON artifact within the existing no-link, byte and parse bounds.
 * @param {string} filename Explicit snapshot or offline catalog file.
 * @param {object|null} [subject] When supplied, reject storage inside this subject.
 * @returns {Promise<object>} Internal parsed value, byte hash and source-path binding.
 * @since v0.15.1
 */
async function readSnapshotJson(filename, subject = null) {
  const target = await location(filename, subject);
  const reader = await createInventoryReader(target.directory);
  let file = null;
  await reader.visit(target.name, (_name, value) => {
    file = value;
  });
  if (!file || reader.issues.length) throw new Error('snapshot-unavailable');
  const parsed = parseInventoryConfig(file.data, 'json');
  if (parsed.parseStatus !== 'parsed') throw new Error('snapshot-invalid');
  return {
    value: parsed.value,
    sha256: file.sha256,
    sourceSha256: hashSnapshotValue(target.absolute),
  };
}

/**
 * Publish one new snapshot with exclusive creation; existing paths are never overwritten.
 * Concurrent readers reject incomplete JSON/digests. No automatic baseline replacement.
 * @param {string} filename Caller-selected new path in an existing outside directory.
 * @param {object} snapshot Validated content-only snapshot.
 * @param {object} subject Canonical subject, used to reject in-project storage.
 * @param {function} [authorize] Optional caller-lifetime guard, checked around asynchronous writes.
 * @returns {Promise<void>} Resolves only after syncing and closing the complete file.
 * @since v0.15.1
 */
async function writeSnapshotFile(filename, snapshot, subject, authorize = () => {}) {
  validateSnapshot(snapshot);
  const data = Buffer.from(JSON.stringify(snapshot) + '\n', 'utf8');
  if (data.length > SNAPSHOT_BYTES) throw new Error('snapshot-size-limit');
  const target = await location(filename, subject);
  let handle;
  let created;
  let succeeded = false;
  let createdPath = target.absolute;
  try {
    authorize();
    handle = await fs.promises.open(
      target.absolute,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        (fs.constants.O_NOFOLLOW || 0),
      0o600,
    );
    created = await handle.stat();
    if (!created.isFile()) throw new Error('snapshot-unavailable');
    createdPath = await fs.promises.realpath(target.absolute);
    if (
      createdPath !== target.absolute ||
      (await fs.promises.realpath(target.directory)) !== target.directory
    )
      throw new Error('snapshot-unavailable');
    const opened = await fs.promises.lstat(target.absolute);
    if (!opened.isFile() || opened.ino !== created.ino || opened.dev !== created.dev)
      throw new Error('snapshot-unavailable');
    authorize();
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = null;
    const final = await fs.promises.lstat(target.absolute);
    if (
      !final.isFile() ||
      final.dev !== created.dev ||
      final.ino !== created.ino ||
      final.size !== data.length ||
      (await fs.promises.realpath(target.absolute)) !== target.absolute
    )
      throw new Error('snapshot-unavailable');
    authorize();
    succeeded = true;
  } catch (error) {
    // Filesystem causes contain private absolute paths and must not escape this API.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(error.code === 'EEXIST' ? 'snapshot-exists' : 'snapshot-unavailable');
  } finally {
    if (handle) await handle.close().catch(() => {});
    if (!succeeded && created?.isFile()) {
      // Remove only this call's closed partial file, never an existing/replaced path.
      try {
        const current = await fs.promises.lstat(createdPath);
        if (
          current.isFile() &&
          current.dev === created.dev &&
          current.ino === created.ino &&
          (await fs.promises.realpath(createdPath)) === createdPath
        )
          await fs.promises.unlink(createdPath);
      } catch (_) {
        /* Fixed failure already returned; never expose filesystem error text. */
      }
    }
  }
}

module.exports = {
  resolveSnapshotSubject,
  checkSnapshotSubject,
  readSnapshotJson,
  writeSnapshotFile,
};
