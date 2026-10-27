'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { normalizeAuditEntry } = require('./audit-normalize');
const { readAuditIdentity, auditOriginFor } = require('./audit-observation-identity');

// Small, fixed data budgets apply inside an isolated worker. Elapsed checks
// cannot interrupt a stalled synchronous OS or SQLite operation.
const LIMITS = Object.freeze({ files: 32, entries: 128, rows: 2048, bytes: 4 * 1024 * 1024, lineBytes: 65536, elapsedMs: 1000 });
const NAME = /^aegis-audit-\d{4}-\d{2}-\d{2}\.json$/;
const digest = (value) => createHash('sha256').update(value).digest('hex');
const same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode &&
  a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
const expired = (start) => performance.now() - start >= LIMITS.elapsedMs;

function namesAt(directory) {
  const entries = [];
  const dir = fs.opendirSync(directory);
  try {
    let entry, visited = 0;
    while ((entry = dir.readSync()) !== null) {
      if (++visited > LIMITS.entries) throw Error('unavailable');
      if (!entry.name.startsWith('aegis-audit-') || !entry.name.endsWith('.json')) continue;
      if (!NAME.test(entry.name) || !entry.isFile() || entry.isSymbolicLink())
        throw Error('unavailable');
      entries.push(entry.name);
      if (entries.length > LIMITS.files) throw Error('unavailable');
    }
  } finally {
    dir.closeSync();
  }
  return entries.sort();
}

function readFile(directory, file, start) {
  const target = path.join(directory, file);
  const before = fs.lstatSync(target, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n ||
      before.size > BigInt(LIMITS.bytes) || (before.dev === 0n && before.ino === 0n))
    throw Error('unavailable');
  let fd, bytes;
  try {
    fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile() || !same(before, opened)) throw Error('unavailable');
    bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const n = fs.readSync(fd, bytes, offset, Math.min(65536, bytes.length - offset), offset);
      if (!n || expired(start)) throw Error('unavailable');
      offset += n;
    }
    const one = Buffer.alloc(1);
    if (fs.readSync(fd, one, 0, 1, offset) !== 0 || !same(opened, fs.fstatSync(fd, { bigint: true })))
      throw Error('unavailable');
    fs.closeSync(fd);
    fd = undefined;
    if (!same(before, fs.lstatSync(target, { bigint: true })) || expired(start)) throw Error('unavailable');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text && !text.endsWith('\n')) throw Error('unavailable');
    const lines = text.split('\n').map((line) => line.replace(/\r$/, '')).filter((line) => line.trim());
    if (lines.some((line) => Buffer.byteLength(line, 'utf8') > LIMITS.lineBytes)) throw Error('unavailable');
    return { before, lines, bytes: Number(before.size) };
  } finally {
    bytes?.fill(0);
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** Compare one bounded ready index with every byte of its canonical audit files.
 * @param {object} db Open read-only index connection owned by the audit module.
 * @param {string} directory Existing audit directory.
 * @returns {object|null} Private digest-only snapshot, or null on uncertainty.
 * @since 0.21.0-beta
 */
function captureObservationProof(db, directory) {
  const start = performance.now();
  let transaction = false;
  try {
    const directoryStat = fs.lstatSync(directory, { bigint: true });
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw Error('unavailable');
    const names = namesAt(directory);
    db.exec('BEGIN');
    transaction = true;
    const indexed = db.prepare('SELECT file, indexed_bytes, indexed_lines, malformed_lines FROM audit_files ORDER BY file LIMIT ?')
      .all(LIMITS.files + 1);
    if (indexed.length !== names.length || indexed.length > LIMITS.files ||
        indexed.some((row, i) => row.file !== names[i] || row.malformed_lines !== 0))
      throw Error('unavailable');
    const files = new Map();
    let bytes = 0, count = 0;
    for (const meta of indexed) {
      const file = readFile(directory, meta.file, start);
      bytes += file.bytes;
      count += file.lines.length;
      if (bytes > LIMITS.bytes || count > LIMITS.rows ||
          !Number.isSafeInteger(meta.indexed_bytes) || meta.indexed_bytes !== file.bytes ||
          !Number.isSafeInteger(meta.indexed_lines) || meta.indexed_lines !== file.lines.length)
        throw Error('unavailable');
      files.set(meta.file, file);
    }
    const matches = new Map(), observations = new Map();
    let seen = 0, rawBytes = 0;
    const query = db.prepare(`SELECT file, line_no,
      CASE WHEN length(raw) <= ? THEN raw ELSE NULL END AS raw
      FROM audit_events ORDER BY file, line_no LIMIT ?`);
    for (const row of query.iterate(LIMITS.lineBytes, LIMITS.rows + 1)) {
      if (++seen > LIMITS.rows || expired(start) || typeof row.raw !== 'string' ||
          !Number.isSafeInteger(row.line_no) || row.line_no < 0) throw Error('unavailable');
      rawBytes += Buffer.byteLength(row.raw, 'utf8');
      const file = files.get(row.file);
      if (rawBytes > LIMITS.bytes || !file || file.lines[row.line_no] !== row.raw)
        throw Error('unavailable');
      const value = JSON.parse(row.raw);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('unavailable');
      const identity = readAuditIdentity(value.details);
      if (!identity) {
        if (value.details && typeof value.details === 'object' &&
            Object.hasOwn(value.details, 'auditIdentity')) throw Error('unavailable');
        continue;
      }
      const key = digest(JSON.stringify(identity));
      const observation = digest(JSON.stringify([identity.epoch, identity.eventId]));
      observations.set(observation, (observations.get(observation) || 0) + 1);
      const prior = matches.get(key);
      if (prior) prior.count++;
      else matches.set(key, { count: 1, observation, origin: auditOriginFor(row.file, row.line_no),
        content: digest(JSON.stringify(normalizeAuditEntry(value))) });
    }
    if (seen !== count) throw Error('unavailable');
    if (!same(directoryStat, fs.lstatSync(directory, { bigint: true })) ||
        JSON.stringify(namesAt(directory)) !== JSON.stringify(names)) throw Error('unavailable');
    for (const [name, file] of files)
      if (!same(file.before, fs.lstatSync(path.join(directory, name), { bigint: true })))
        throw Error('unavailable');
    if (expired(start)) throw Error('unavailable');
    db.exec('COMMIT');
    transaction = false;
    return { schemaVersion: 1, rows: [...matches].map(([key, value]) => ({
      key, origin: value.origin, content: value.content,
      count: Math.max(value.count, observations.get(value.observation)),
    })) };
  } catch {
    if (transaction) { try { db.exec('ROLLBACK'); } catch { /* unavailable */ } }
    return null;
  }
}

module.exports = { captureObservationProof, LIMITS };
