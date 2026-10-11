/** Durable, disk-bounded Claude accounting and dedup index. No transcript text or raw IDs persist. */
'use strict';

const fs = require('node:fs');
const { createHash } = require('node:crypto');

const APPLICATION_ID = 0x41454754;
const PAGE_BYTES = 4096;
const MAX_BYTES = 128 * 1024 * 1024;

/** @param {string} value @returns {Buffer} Fixed-size, content-free lookup key. */
const digest = (value) => createHash('sha256').update(value).digest();

/** Read only the file whose identity was checked, with no-follow where supported.
 * @param {string} file @param {import('node:fs').Stats} identity @param {number} size
 * @returns {Buffer} Header bytes. @since 0.19.2
 */
function readOwnedHeader(file, identity, size) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const actual = fs.fstatSync(fd);
    if (
      !actual.isFile() ||
      actual.nlink !== 1 ||
      actual.dev !== identity.dev ||
      actual.ino !== identity.ino
    )
      throw Error('dedup-cache-replaced');
    const header = Buffer.alloc(size);
    fs.readSync(fd, header, 0, size, 0);
    return header;
  } finally {
    fs.closeSync(fd);
  }
}

/** Reserve or reopen an owned durable ledger without following links.
 * @param {string} file @returns {boolean} Whether a ledger already exists. @since 0.19.2
 */
function reserve(file) {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    const candidate = file + suffix;
    let identity;
    try {
      identity = fs.lstatSync(candidate);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (!identity.isFile() || identity.nlink !== 1) throw Error('dedup-cache-not-owned');
    // SQLite journal bytes cannot prove that this application created the file.
    // Preserve every preexisting sidecar for explicit recovery rather than delete it.
    if (suffix) throw Error('dedup-journal-not-owned');
  }
  if (fs.existsSync(file)) {
    const header = readOwnedHeader(file, fs.lstatSync(file), 100);
    if (
      header.toString('ascii', 0, 16) !== 'SQLite format 3\0' ||
      header.readInt32BE(68) !== APPLICATION_ID ||
      header.readInt32BE(60) !== 1
    )
      throw Error('dedup-cache-not-owned');
    return true;
  } else fs.closeSync(fs.openSync(file, 'wx', 0o600));
  return false;
}

/** Open the durable index and accepted aggregate. A poisoned transaction cannot emit usage.
 * SQLite's page limit bounds the file; its 2 MiB cache target is not a total RAM limit.
 * @param {{file: string, maxBytes?: number}} options Cache path; :memory: is test-only.
 * @returns {{getAggregate: Function, accumulate: Function, begin: Function, commit: Function, rollback: Function, withSession: Function, isFailed: Function, failureReason: Function, close: Function}}
 * @since 0.18.2
 */
function createLedger({ file, maxBytes = MAX_BYTES }) {
  const pages = Math.floor(maxBytes / PAGE_BYTES);
  // The schema and four table roots require five pages before accepting usage.
  if (!Number.isSafeInteger(pages) || pages < 5 || pages > MAX_BYTES / PAGE_BYTES)
    throw Error('dedup-cache-limit-invalid');
  const { DatabaseSync } = require('node:sqlite');
  const reopening = file !== ':memory:' && reserve(file);
  let db;
  let failed = false;
  let failureReason = null;
  let transaction = false;
  let closed = false;
  let nextSessionKey = 1;
  try {
    db = new DatabaseSync(file);
    if (reopening) {
      const columns = {
        sessions: ['sid', 'id', 'offset', 'skipping'],
        messages: ['sid', 'mid'],
        tails: ['sid', 'fid', 'offset', 'skipping'],
        aggregate: [
          'id',
          'inputTokens',
          'outputTokens',
          'costUsd',
          'estimated',
          'pricingEstimated',
        ],
      };
      for (const [table, expected] of Object.entries(columns)) {
        const actual = db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((row) => row.name);
        if (JSON.stringify(actual) !== JSON.stringify(expected))
          throw Error('dedup-schema-incompatible');
      }
      if (!db.prepare('SELECT 1 FROM aggregate WHERE id=1').get())
        throw Error('dedup-aggregate-missing');
    }
    db.exec(`PRAGMA page_size=${PAGE_BYTES}; PRAGMA max_page_count=${pages};
      PRAGMA cache_size=-2048; PRAGMA mmap_size=0; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
      PRAGMA temp_store=MEMORY; PRAGMA application_id=${APPLICATION_ID};
      CREATE TABLE IF NOT EXISTS sessions (sid BLOB PRIMARY KEY, id INTEGER NOT NULL,
        offset INTEGER NOT NULL, skipping INTEGER NOT NULL) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS messages (sid INTEGER, mid BLOB, PRIMARY KEY(sid, mid)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS tails (sid INTEGER, fid BLOB, offset INTEGER NOT NULL,
        skipping INTEGER NOT NULL, PRIMARY KEY(sid, fid)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS aggregate (id INTEGER PRIMARY KEY CHECK(id=1),
        inputTokens REAL NOT NULL, outputTokens REAL NOT NULL, costUsd REAL NOT NULL,
        estimated INTEGER NOT NULL, pricingEstimated INTEGER NOT NULL);
      INSERT OR IGNORE INTO aggregate VALUES (1, 0, 0, 0, 0, 0); PRAGMA user_version=1;`);
    const aggregate = db
      .prepare(
        'SELECT inputTokens, outputTokens, costUsd, estimated, pricingEstimated FROM aggregate WHERE id=1',
      )
      .get();
    if (
      !aggregate ||
      ![aggregate.inputTokens, aggregate.outputTokens, aggregate.costUsd].every(
        (v) => Number.isFinite(v) && v >= 0,
      )
    )
      throw Error('dedup-aggregate-invalid');
    nextSessionKey = Number(
      db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM sessions').get().next,
    );
    if (!Number.isSafeInteger(nextSessionKey)) throw Error('dedup-session-key-invalid');
  } catch (error) {
    if (db) db.close();
    throw error;
  }
  const statements = {
    aggregate: db.prepare(
      'SELECT inputTokens, outputTokens, costUsd, estimated, pricingEstimated FROM aggregate WHERE id=1',
    ),
    accumulate:
      db.prepare(`UPDATE aggregate SET inputTokens=inputTokens+?, outputTokens=outputTokens+?,
      costUsd=costUsd+?, estimated=MAX(estimated, ?), pricingEstimated=MAX(pricingEstimated, ?) WHERE id=1`),
    session: db.prepare('SELECT id, offset, skipping FROM sessions WHERE sid=?'),
    addSession: db.prepare('INSERT INTO sessions (sid, id, offset, skipping) VALUES (?, ?, 0, 0)'),
    saveSession: db.prepare('UPDATE sessions SET offset=?, skipping=? WHERE sid=?'),
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
      // Node SQLite exposes the primary result code even for extended failures.
      // Keep the public reason content-free: error messages can contain paths.
      failureReason = (error.errcode & 0xff) === 13 ? 'capacity' : 'unavailable';
      throw error;
    }
  };
  const run = (name, ...args) => guarded(() => statements[name].run(...args));
  const get = (name, ...args) => guarded(() => statements[name].get(...args));

  const ledger = {
    getAggregate() {
      const row = get('aggregate');
      return {
        ...row,
        estimated: Boolean(row.estimated),
        pricingEstimated: Boolean(row.pricingEstimated),
      };
    },
    accumulate(deltas) {
      return guarded(() => {
        if (!transaction) throw Error('dedup-transaction-required');
        const current = ledger.getAggregate();
        const sum = {
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          estimated: false,
          pricingEstimated: false,
        };
        for (const d of deltas) {
          if (
            ![d.inputTokens, d.outputTokens, d.acceptedCostUsd].every(
              (v) => Number.isFinite(v) && v >= 0,
            )
          )
            throw Error('dedup-aggregate-invalid');
          sum.inputTokens += d.inputTokens;
          sum.outputTokens += d.outputTokens;
          sum.costUsd += d.acceptedCostUsd;
          sum.estimated ||= d.acceptedEstimated === true;
          sum.pricingEstimated ||= d.acceptedPricingEstimated === true;
        }
        if (
          ![
            current.inputTokens + sum.inputTokens,
            current.outputTokens + sum.outputTokens,
            current.costUsd + sum.costUsd,
            current.inputTokens + sum.inputTokens + current.outputTokens + sum.outputTokens,
          ].every(Number.isFinite)
        )
          throw Error('dedup-aggregate-overflow');
        if (deltas.length)
          run(
            'accumulate',
            sum.inputTokens,
            sum.outputTokens,
            sum.costUsd,
            Number(sum.estimated),
            Number(sum.pricingEstimated),
          );
      });
    },
    begin() {
      if (transaction) return;
      failed = false;
      failureReason = null;
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
      failureReason = null;
    },
    isFailed: () => failed,
    failureReason: () => failureReason,
    withSession(sessionId, read) {
      ledger.begin();
      guarded(() => db.exec('SAVEPOINT proc'));
      const sessionDigest = digest(sessionId);
      const row = get('session', sessionDigest);
      // Reopened keys start beyond the committed maximum. Rollbacks may
      // leave gaps, but never reuse a key belonging to another session.
      const sid = row?.id ?? nextSessionKey++;
      if (!row) run('addSession', sessionDigest, sid);
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
          run('saveSession', this.offset, Number(this.skippingMain), sessionDigest);
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
    },
  };
  const onExit = () => ledger.close();
  process.once('exit', onExit);
  return ledger;
}

module.exports = { createLedger, MAX_BYTES };
