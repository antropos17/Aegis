'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const LOCK = '.consume-lock';
const MAX_ENTRIES = 1024;
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
    const stat = await fs.lstat(current);
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
  let store, lock, lockStat, receipt;
  let failed = false;
  try {
    if (!validTime(grant)) throw Error('grant-unavailable');
    store = await inspectStore(storePath);
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
    await receipt.writeFile('{"consumed":true}\n', 'utf8');
    await receipt.sync();
    await receipt.close();
    receipt = undefined;
    await verifyStore(store);
  } catch {
    failed = true;
  }
  if (receipt) await receipt.close().catch(() => {});
  if (lock) {
    await lock.close().catch(() => {});
    // Never remove a replaced lock or touch a directory whose identity no longer matches.
    try {
      await verifyStore(store);
      const actual = await fs.lstat(path.join(store.path, LOCK));
      if (!lockStat || !actual.isFile() || actual.isSymbolicLink() || !same(actual, lockStat))
        throw Error('grant-store-changed');
      await fs.unlink(path.join(store.path, LOCK));
      await verifyStore(store);
    } catch {
      failed = true;
    }
  }
  if (failed) throw Error('gateway-grant-unavailable');
  return true;
}

module.exports = { consumeGatewayGrant };
