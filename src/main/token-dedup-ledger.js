/** Run-scoped, disk-bounded Claude dedup index. No transcript text or raw IDs persist. */
'use strict';

const fs = require('node:fs');
const { createHash } = require('node:crypto');

const APPLICATION_ID = 0x41454754;
const PAGE_BYTES = 4096;
const MAX_BYTES = 128 * 1024 * 1024;

/** @param {string} value @returns {Buffer} Fixed-size, content-free lookup key. */
const digest = (value) => createHash('sha256').update(value).digest();

/** Remove only our regular, singly linked file, if its identity is unchanged.
 * @param {string} file @param {import('node:fs').Stats} identity @returns {void}
 */
function removeOwned(file, identity) {
  try {
    const now = fs.lstatSync(file);
    if (now.isFile() && now.nlink === 1 && now.dev === identity.dev && now.ino === identity.ino)
      fs.unlinkSync(file);
  } catch {
    // A locked or replaced cache is left for the next verified startup.
  }
}

/** Reserve an exact cache path; never overwrite a foreign file or follow a link.
 * @param {string} file @returns {import('node:fs').Stats}
 */
function reserve(file) {
  if (fs.existsSync(file)) {
    const identity = fs.lstatSync(file);
    if (!identity.isFile() || identity.nlink !== 1) throw Error('dedup-cache-not-owned');
    const fd = fs.openSync(file, 'r');
    const header = Buffer.alloc(100);
    try {
      fs.readSync(fd, header, 0, header.length, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (
      header.toString('ascii', 0, 16) !== 'SQLite format 3\0' ||
      header.readInt32BE(68) !== APPLICATION_ID
    )
      throw Error('dedup-cache-not-owned');
    removeOwned(file, identity);
  }
  fs.closeSync(fs.openSync(file, 'wx', 0o600));
  return fs.lstatSync(file);
}

/** Create a fresh index for this application run. A poisoned transaction cannot emit usage.
 * SQLite's page limit bounds the file; its 2 MiB cache target is not a total RAM limit.
 * @param {{file: string, maxBytes?: number}} options Cache path; :memory: is test-only.
 * @returns {{begin: Function, commit: Function, rollback: Function, withSession: Function, isFailed: Function, close: Function}}
 * @since 0.18.2
 */
function createLedger({ file, maxBytes = MAX_BYTES }) {
  const pages = Math.floor(maxBytes / PAGE_BYTES);
  if (!Number.isSafeInteger(pages) || pages < 4 || pages > MAX_BYTES / PAGE_BYTES)
    throw Error('dedup-cache-limit-invalid');
  const { DatabaseSync } = require('node:sqlite');
  const identity = file === ':memory:' ? null : reserve(file);
  let db;
  let failed = false;
  let transaction = false;
  let closed = false;
  try {
    db = new DatabaseSync(file);
    db.exec(`PRAGMA page_size=${PAGE_BYTES}; PRAGMA max_page_count=${pages};
      PRAGMA cache_size=-2048; PRAGMA mmap_size=0; PRAGMA journal_mode=MEMORY;
      PRAGMA temp_store=MEMORY; PRAGMA application_id=${APPLICATION_ID};
      CREATE TABLE sessions (sid BLOB PRIMARY KEY, offset INTEGER NOT NULL,
        skipping INTEGER NOT NULL) WITHOUT ROWID;
      CREATE TABLE messages (sid BLOB, mid BLOB, PRIMARY KEY(sid, mid)) WITHOUT ROWID;
      CREATE TABLE tails (sid BLOB, fid BLOB, offset INTEGER NOT NULL,
        skipping INTEGER NOT NULL, PRIMARY KEY(sid, fid)) WITHOUT ROWID;`);
  } catch (error) {
    if (db) db.close();
    if (identity) removeOwned(file, identity);
    throw error;
  }
  const statements = {
    session: db.prepare('SELECT offset, skipping FROM sessions WHERE sid=?'),
    saveSession: db.prepare('INSERT OR REPLACE INTO sessions VALUES (?, ?, ?)'),
    seen: db.prepare('SELECT 1 FROM messages WHERE sid=? AND mid=?'),
    add: db.prepare('INSERT OR IGNORE INTO messages VALUES (?, ?)'),
    tail: db.prepare('SELECT offset, skipping FROM tails WHERE sid=? AND fid=?'),
    offset: db.prepare(`INSERT INTO tails VALUES (?, ?, ?, 0)
      ON CONFLICT(sid, fid) DO UPDATE SET offset=excluded.offset`),
    skipping: db.prepare(`INSERT INTO tails VALUES (?, ?, 0, ?)
      ON CONFLICT(sid, fid) DO UPDATE SET skipping=excluded.skipping`),
  };

  // Mark failures even when the subagent reader catches them as file errors.
  const guarded = (operation) => {
    if (failed) throw Error('dedup-transaction-failed');
    try {
      return operation();
    } catch (error) {
      failed = true;
      throw error;
    }
  };
  const run = (name, ...args) => guarded(() => statements[name].run(...args));
  const get = (name, ...args) => guarded(() => statements[name].get(...args));

  const ledger = {
    begin() {
      if (transaction) return;
      failed = false;
      guarded(() => db.exec('BEGIN'));
      transaction = true;
    },
    commit() {
      if (!transaction) return false;
      guarded(() => db.exec('COMMIT'));
      transaction = false;
      return true;
    },
    rollback() {
      if (transaction) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // SQLITE_FULL can already have rolled back the transaction.
        }
      }
      transaction = false;
      failed = false;
    },
    isFailed: () => failed,
    withSession(sessionId, read) {
      ledger.begin();
      guarded(() => db.exec('SAVEPOINT proc'));
      const sid = digest(sessionId);
      const row = get('session', sid);
      const state = {
        storageFailed: () => failed,
        offset: row?.offset ?? 0,
        skippingMain: Boolean(row?.skipping),
        seenIds: {
          has: (messageId) => Boolean(get('seen', sid, digest(messageId))),
          add: (messageId) => run('add', sid, digest(messageId)),
        },
        subOffsets: {
          get: (filePath) => get('tail', sid, digest(filePath))?.offset,
          set: (filePath, offset) => run('offset', sid, digest(filePath), offset),
        },
        subSkipping: {
          has: (filePath) => Boolean(get('tail', sid, digest(filePath))?.skipping),
          add: (filePath) => run('skipping', sid, digest(filePath), 1),
          delete: (filePath) => run('skipping', sid, digest(filePath), 0),
        },
        flush() {
          run('saveSession', sid, this.offset, Number(this.skippingMain));
        },
      };
      try {
        const deltas = read(state);
        state.flush();
        guarded(() => db.exec('RELEASE proc'));
        return deltas;
      } catch (error) {
        // A filesystem failure must not suppress unrelated processes or retain
        // message IDs whose deltas never reached the caller.
        if (!failed) guarded(() => db.exec('ROLLBACK TO proc; RELEASE proc'));
        throw error;
      }
    },
    close() {
      if (closed) return;
      ledger.rollback();
      db.close();
      closed = true;
      process.removeListener('exit', onExit);
      if (identity) removeOwned(file, identity);
    },
  };
  const onExit = () => ledger.close();
  process.once('exit', onExit);
  return ledger;
}

module.exports = { createLedger, MAX_BYTES };
