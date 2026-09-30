'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { validOperationBinding } = require('./session-authority');
const LIMITS = Object.freeze({ entries: 256, recordBytes: 512 });
const LOCK = '.operation-lock';
const HASH = /^[a-f0-9]{64}$/;
let testDeps = null;
const digest = (value) => createHash('sha256').update(value).digest('hex');
const same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode;
const normalized = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);

function identity(binding) {
  if (!validOperationBinding(binding)) throw Error('operation-ledger-unavailable');
  const canonical = {};
  for (const key of [
    'sessionId',
    'epoch',
    'policyRevision',
    'operationId',
    'operation',
    'requestDigest',
    'snapshotDigest',
    'nonce',
    'expiresAt',
  ])
    canonical[key] = binding[key];
  return { name: digest(binding.operationId), bindingSha256: digest(JSON.stringify(canonical)) };
}

function recordBytes(bindingSha256, state, schemaVersion = 1) {
  return Buffer.from(JSON.stringify({ schemaVersion, bindingSha256, state }) + '\n');
}

/** Open a bounded local attempt ledger in an existing owner-selected directory.
 * This is ordinary-account persistence, not protected ownership or rollback authority.
 * File sync precedes dispatch; directory power-loss durability and hostile same-principal
 * mutation are unqualified. Crashed exclusive locks require explicit owner recovery.
 * @param {string} directory Existing canonical absolute local directory.
 * @returns {Promise<object>} consume, settle and inspect interface. @since v0.17.0 */
async function createOperationLedger(directory) {
  const io = testDeps?.fs || fs;
  let unavailable = false;
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || directory.startsWith('\\\\'))
    throw Error('operation-ledger-unavailable');
  const root = path.resolve(directory);
  if (normalized(await io.realpath(root)) !== normalized(root))
    throw Error('operation-ledger-unavailable');
  const ancestors = [];
  let current = root;
  for (;;) {
    const stat = await io.lstat(current, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('operation-ledger-unavailable');
    ancestors.push({ filename: current, stat });
    if (ancestors.length > 64) throw Error('operation-ledger-unavailable');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const verify = async () => {
    for (const ancestor of ancestors) {
      const stat = await io.lstat(ancestor.filename, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink() || !same(stat, ancestor.stat))
        throw Error('operation-ledger-unavailable');
    }
    if (normalized(await io.realpath(root)) !== normalized(root))
      throw Error('operation-ledger-unavailable');
  };
  const boundedEntries = async () => {
    const entries = await io.opendir(root);
    let count = 0;
    for await (const entry of entries) {
      if (
        ++count >= LIMITS.entries ||
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        !(
          entry.name === LOCK ||
          /^[a-f0-9]{64}\.(spent|outcome|pending|pending-unknown)$/.test(entry.name)
        )
      )
        throw Error('operation-ledger-unavailable');
    }
  };
  const read = async (filename, optional = false) => {
    let handle;
    try {
      await verify();
      let before;
      try {
        before = await io.lstat(filename, { bigint: true });
      } catch (error) {
        if (optional && error.code === 'ENOENT') return null;
        throw error;
      }
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        before.nlink !== 1n ||
        before.size > BigInt(LIMITS.recordBytes)
      )
        throw Error('operation-ledger-unavailable');
      handle = await io.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      const stat = await handle.stat({ bigint: true });
      if (!same(stat, before) || stat.size !== before.size)
        throw Error('operation-ledger-unavailable');
      const bytes = Buffer.alloc(Number(stat.size));
      let offset = 0;
      while (offset < bytes.length) {
        const result = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!result.bytesRead) throw Error('operation-ledger-unavailable');
        offset += result.bytesRead;
      }
      const after = await handle.stat({ bigint: true });
      if (
        !same(after, stat) ||
        after.size !== stat.size ||
        after.mtimeNs !== stat.mtimeNs ||
        after.ctimeNs !== stat.ctimeNs
      )
        throw Error('operation-ledger-unavailable');
      const value = JSON.parse(bytes.toString('utf8'));
      if (
        !HASH.test(value.bindingSha256) ||
        !['consumed', 'completed', 'outcome-unknown', 'not-dispatched'].includes(value.state) ||
        !bytes.equals(
          recordBytes(value.bindingSha256, value.state, filename.endsWith('.spent') ? 1 : 2),
        )
      )
        throw Error('operation-ledger-unavailable');
      await verify();
      return value;
    } finally {
      await handle?.close();
    }
  };
  const write = async (filename, bytes) => {
    let handle;
    try {
      await verify();
      handle = await io.open(filename, 'wx', 0o600);
      let offset = 0;
      while (offset < bytes.length) {
        const result = await handle.write(bytes, offset, bytes.length - offset, offset);
        if (!result.bytesWritten) throw Error('operation-ledger-unavailable');
        offset += result.bytesWritten;
      }
      await handle.sync();
      await verify();
    } finally {
      await handle?.close();
    }
  };
  const exclusive = async (work) => {
    if (unavailable) throw Error('operation-ledger-unavailable');
    let lock, lockStat, failure, result;
    try {
      await verify();
      lock = await io.open(path.join(root, LOCK), 'wx', 0o600);
      lockStat = await lock.stat({ bigint: true });
      await verify();
      await boundedEntries();
      result = await work();
      await verify();
    } catch {
      failure = true;
    }
    if (lock) {
      try {
        await lock.close();
        await verify();
        const stat = await io.lstat(path.join(root, LOCK), { bigint: true });
        if (!stat.isFile() || stat.isSymbolicLink() || !same(stat, lockStat))
          throw Error('invalid');
        await io.unlink(path.join(root, LOCK));
        await verify();
      } catch {
        failure = true;
      }
    }
    if (failure) {
      // Once publication succeeds, cleanup cannot change the terminal decision.
      // Stop new mutations through this handle if post-publication checks fail.
      if (!result?.published) throw Error('operation-ledger-unavailable');
      unavailable = true;
    }
    return result;
  };
  return Object.freeze({
    consume(binding) {
      const key = identity(binding);
      return exclusive(async () => {
        await write(
          path.join(root, key.name + '.spent'),
          recordBytes(key.bindingSha256, 'consumed'),
        );
        const actual = await read(path.join(root, key.name + '.spent'));
        if (actual.bindingSha256 !== key.bindingSha256 || actual.state !== 'consumed')
          throw Error('invalid');
      });
    },
    settle(binding, state, { signal } = {}) {
      const key = identity(binding);
      if (!['completed', 'outcome-unknown', 'not-dispatched'].includes(state))
        throw Error('operation-ledger-unavailable');
      return exclusive(async () => {
        const spent = await read(path.join(root, key.name + '.spent'));
        if (spent.bindingSha256 !== key.bindingSha256 || spent.state !== 'consumed')
          throw Error('invalid');
        const outcome = await read(path.join(root, key.name + '.outcome'), true);
        if (outcome) throw Error('invalid');
        let stage = path.join(root, key.name + '.pending');
        const prepare = async () => {
          await write(stage, recordBytes(key.bindingSha256, state, 2));
          const actual = await read(stage);
          if (actual.bindingSha256 !== key.bindingSha256 || actual.state !== state)
            throw Error('invalid');
        };
        await prepare();
        if (signal?.aborted && state === 'completed') {
          state = 'outcome-unknown';
          stage = path.join(root, key.name + '.pending-unknown');
          await prepare();
        }
        await verify();
        // No await separates this last cancellation check from publication.
        // A late abort cannot downgrade a committed terminal record.
        if (signal?.aborted && state === 'completed') throw Error('invalid');
        await io.rename(stage, path.join(root, key.name + '.outcome'));
        return Object.freeze({ state, published: true });
      });
    },
    async inspect(operationId) {
      try {
        if (typeof operationId !== 'string' || !/^[a-f0-9]{32}$/.test(operationId))
          throw Error('invalid');
        const name = digest(operationId);
        const spent = await read(path.join(root, name + '.spent'), true);
        if (!spent) return Object.freeze({ state: 'unrecorded' });
        if (spent.state !== 'consumed') throw Error('invalid');
        const outcome = await read(path.join(root, name + '.outcome'), true);
        if (
          outcome &&
          (outcome.bindingSha256 !== spent.bindingSha256 || outcome.state === 'consumed')
        )
          throw Error('invalid');
        return Object.freeze({ state: outcome?.state || 'outcome-unknown' });
      } catch {
        return Object.freeze({ state: 'unavailable' });
      }
    },
  });
}

/** @param {object} deps Trusted filesystem seam. @returns {void} @since v0.17.0 */
function _setDepsForTest(deps) {
  testDeps = deps;
}
/** @returns {void} @since v0.17.0 */
function _resetForTest() {
  testDeps = null;
}

module.exports = { createOperationLedger, LIMITS, _setDepsForTest, _resetForTest };
