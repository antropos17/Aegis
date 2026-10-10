'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const LOCK = '.consume-lock';
const CREDENTIAL_KEY = '.credential-key';
const MAX_ENTRIES = 1024;
const CONSUMED = Buffer.from('{"consumed":true}\n');
const validId = (value) =>
  typeof value === 'string' &&
  value.length >= 32 &&
  value.length <= 64 &&
  !/[^A-Za-z0-9_-]/.test(value);
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const normalized = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);

async function inspectStore(storePath) {
  if (typeof storePath !== 'string' || !path.isAbsolute(storePath))
    throw Error('grant-store-unavailable');
  const resolved = path.resolve(storePath);
  const canonical = await fs.realpath(resolved);
  if (normalized(canonical) !== normalized(resolved)) throw Error('grant-store-unavailable');
  const chain = [];
  for (let current = resolved; ; current = path.dirname(current)) {
    const stat = await fs.lstat(current, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('grant-store-unavailable');
    chain.push({ path: current, stat });
    if (path.dirname(current) === current) break;
  }
  return { path: resolved, chain };
}

async function verifyStore(store) {
  const current = await inspectStore(store.path);
  if (
    current.chain.length !== store.chain.length ||
    current.chain.some((item, index) => !same(item.stat, store.chain[index].stat))
  )
    throw Error('grant-store-changed');
}

async function releaseLock(store, lock, lockStat) {
  // Retain an uncertain or replaced lock. Failed cleanup never admits an operation.
  await lock.close();
  await verifyStore(store);
  const filename = path.join(store.path, LOCK);
  const actual = await fs.lstat(filename);
  if (!lockStat || !actual.isFile() || actual.isSymbolicLink() || !same(actual, lockStat))
    throw Error('grant-store-changed');
  await fs.unlink(filename);
  await verifyStore(store);
}

/** Read the private store key used for HTTP bearer or stdio route tags.
 * A missing, replaced or malformed key never falls back to an unbound grant.
 * @param {string} storePath Explicit absolute grant-store directory.
 * @param {AbortSignal} [signal] Owning connection cancellation.
 * @returns {Promise<Buffer>} A 32-byte key that the caller must zero after use.
 * @since v0.17.0 */
async function readGatewayCredentialKey(storePath, signal) {
  return readCredentialKey(await inspectStore(storePath), signal);
}

async function readCredentialKey(store, signal) {
  let handle,
    key,
    failed = false;
  try {
    if (signal?.aborted) throw Error('credential-key-unavailable');
    await verifyStore(store);
    const filename = path.join(store.path, CREDENTIAL_KEY);
    const before = await fs.lstat(filename);
    if (!before.isFile() || before.isSymbolicLink() || before.size !== 32)
      throw Error('credential-key-unavailable');
    handle = await fs.open(filename, 'r');
    const opened = await handle.stat();
    if (!opened.isFile() || !same(before, opened)) throw Error('credential-key-changed');
    const bounded = Buffer.alloc(33);
    let offset = 0;
    try {
      while (offset < bounded.length) {
        const { bytesRead } = await handle.read(bounded, offset, bounded.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset !== 32) throw Error('credential-key-changed');
      key = Buffer.from(bounded.subarray(0, 32));
    } finally {
      bounded.fill(0);
    }
    const after = await fs.lstat(filename);
    await verifyStore(store);
    if (signal?.aborted || !after.isFile() || after.size !== 32 || !same(before, after))
      throw Error('credential-key-changed');
  } catch {
    failed = true;
  }
  if (handle) {
    try {
      await handle.close();
      await verifyStore(store);
    } catch {
      failed = true;
    }
  }
  // Check after close: a timed-out caller must never receive a late live key.
  if (failed || signal?.aborted) {
    key?.fill(0);
    throw Error('credential-key-unavailable');
  }
  return key;
}

/** Explicitly create the store's private tag key once, serialized with grants.
 * An incomplete key is retained and causes subsequent reads to fail closed.
 * @param {string} storePath Explicit absolute grant-store directory.
 * @returns {Promise<Buffer>} Existing or new 32-byte key; caller must zero it.
 * @since v0.17.0 */
async function initializeGatewayCredentialKey(storePath) {
  let store,
    lock,
    lockStat,
    key,
    failed = false;
  try {
    store = await inspectStore(storePath);
    lock = await fs.open(path.join(store.path, LOCK), 'wx', 0o600);
    lockStat = await lock.stat();
    await verifyStore(store);
    const filename = path.join(store.path, CREDENTIAL_KEY);
    let exists = false;
    try {
      await fs.lstat(filename);
      exists = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (!exists) {
      const entries = await fs.opendir(store.path);
      let count = 0;
      for await (const entry of entries) {
        if (!entry.name || ++count >= MAX_ENTRIES) throw Error('grant-store-full');
      }
      const file = await fs.open(filename, 'wx', 0o600);
      try {
        key = randomBytes(32);
        await file.writeFile(key);
        await file.sync();
      } finally {
        await file.close();
      }
    }
    await verifyStore(store);
    const confirmed = await readGatewayCredentialKey(storePath);
    if (key && !timingSafeEqual(key, confirmed)) {
      confirmed.fill(0);
      throw Error('credential-key-changed');
    }
    key?.fill(0);
    key = confirmed;
  } catch {
    failed = true;
  }
  if (lock) {
    try {
      await releaseLock(store, lock, lockStat);
    } catch {
      failed = true;
    }
  }
  if (failed) {
    key?.fill(0);
    throw Error('credential-key-unavailable');
  }
  return key;
}

function validTime(grant) {
  const now = Date.now();
  return (
    grant &&
    validId(grant.id) &&
    validId(grant.taskId) &&
    Number.isSafeInteger(grant.notBefore) &&
    Number.isSafeInteger(grant.expiresAt) &&
    grant.notBefore >= 0 &&
    grant.expiresAt - grant.notBefore <= 86400000 &&
    grant.notBefore <= now &&
    now < grant.expiresAt
  );
}

/** Persist one irreversible attempt before dispatch. The directory must already exist.
 * All entries count toward the 1024-entry ceiling, including the temporary exclusive lock.
 * Crashed writers can leave a lock requiring operator revocation and a new store.
 * This does not resist hostile same-account filesystem mutation or guarantee power-loss durability.
 * @param {string} storePath Absolute canonical operator-owned directory.
 * @param {{id: string, taskId: string, notBefore: number, expiresAt: number}} grant Bound grant.
 * @returns {Promise<boolean>} True only after syncing the receipt and releasing the lock.
 * @since v0.15.1 */
async function consumeGatewayGrant(storePath, grant) {
  return consumeGrant(await inspectStore(storePath), grant);
}

async function consumeGrant(store, grant, retain = false) {
  let lock, lockStat, receipt, retained;
  let failed = false;
  try {
    if (!validTime(grant)) throw Error('grant-unavailable');
    await verifyStore(store);
    lock = await fs.open(path.join(store.path, LOCK), 'wx', 0o600);
    lockStat = await lock.stat();
    await verifyStore(store);
    // Bound enumeration even when a pre-existing directory contains an excessive number of files.
    const entries = await fs.opendir(store.path);
    let count = 0;
    for await (const entry of entries) {
      if (!entry.name || ++count >= MAX_ENTRIES) throw Error('grant-store-full');
    }
    if (!validTime(grant)) throw Error('grant-unavailable');
    await verifyStore(store);
    // Hash only the global grant ID: changing tasks never renews an already consumed grant.
    const name = createHash('sha256').update(grant.id).digest('hex') + '.used';
    receipt = await fs.open(path.join(store.path, name), 'wx', 0o600);
    await receipt.writeFile(CONSUMED);
    await receipt.sync();
    if (retain)
      retained = {
        filename: path.join(store.path, name),
        stat: await receipt.stat({ bigint: true }),
      };
    await receipt.close();
    receipt = undefined;
    await verifyStore(store);
  } catch {
    failed = true;
  }
  if (receipt) await receipt.close().catch(() => {});
  if (lock) {
    try {
      await releaseLock(store, lock, lockStat);
    } catch {
      failed = true;
    }
  }
  if (failed) throw Error('gateway-grant-unavailable');
  return retain ? retained : true;
}

const unchangedReceipt = (a, b) =>
  same(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
const validReceipt = (stat) =>
  stat.isFile() &&
  !stat.isSymbolicLink() &&
  stat.nlink === 1n &&
  stat.size === BigInt(CONSUMED.length);

async function verifyConsumedReceipt(store, retained) {
  let handle;
  await verifyStore(store);
  try {
    const before = await fs.lstat(retained.filename, { bigint: true });
    if (!validReceipt(before) || !unchangedReceipt(before, retained.stat))
      throw Error('grant-store-changed');
    handle = await fs.open(retained.filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const opened = await handle.stat({ bigint: true });
    if (!validReceipt(opened) || !unchangedReceipt(opened, before))
      throw Error('grant-store-changed');
    const bytes = Buffer.alloc(CONSUMED.length + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (
      offset !== CONSUMED.length ||
      !bytes.subarray(0, offset).equals(CONSUMED) ||
      !validReceipt(after) ||
      !unchangedReceipt(after, opened)
    )
      throw Error('grant-store-changed');
  } finally {
    await handle?.close();
  }
  const afterClose = await fs.lstat(retained.filename, { bigint: true });
  if (!validReceipt(afterClose) || !unchangedReceipt(afterClose, retained.stat))
    throw Error('grant-store-changed');
  await verifyStore(store);
}

/** Pin one gateway's store and ancestor identities for its connection lifetime.
 * Replacing the selected directory never renews an open owner's grants. This
 * does not establish protected ownership or resist rollback across restarts.
 * @param {string} storePath Existing canonical absolute store directory.
 * @returns {Promise<object>} Private consume reservation, key-read and final identity check.
 * @since v0.19.2 */
async function captureGatewayGrantStore(storePath) {
  const store = await inspectStore(storePath);
  const reservations = new WeakMap();
  return Object.freeze({
    async consume(grant) {
      const retained = await consumeGrant(store, grant, true);
      const reservation = Object.freeze({});
      reservations.set(reservation, retained);
      return reservation;
    },
    readCredentialKey: (signal) => readCredentialKey(store, signal),
    async recheck(reservation) {
      if (reservation === undefined) return verifyStore(store);
      const retained = reservations.get(reservation);
      if (!retained) throw Error('grant-reservation-unavailable');
      return verifyConsumedReceipt(store, retained);
    },
  });
}

module.exports = {
  consumeGatewayGrant,
  readGatewayCredentialKey,
  initializeGatewayCredentialKey,
  captureGatewayGrantStore,
};
