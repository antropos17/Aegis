'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { normalizeAuditEntry } = require('./audit-normalize');
const { readAuditIdentity, auditOriginFor } = require('./audit-observation-identity');

// Fixed memory budgets; the parent deadline terminates the worker. Synchronous
// OS and SQLite operations can exceed elapsed checkpoints or delay termination.
const LIMITS = Object.freeze({ files: 32, entries: 128, targets: 100, lineBytes: 65536 });
const NAME = /^aegis-audit-\d{4}-\d{2}-\d{2}\.json$/;
const HEX = /^[a-f0-9]{64}$/;
const digest = (value) => createHash('sha256').update(value).digest('hex');
const same = (a, b) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.mode === b.mode &&
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs;

function namesAt(directory) {
  const entries = [];
  const dir = fs.opendirSync(directory);
  try {
    let entry,
      visited = 0;
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

function targetsFrom(input) {
  if (!Array.isArray(input) || input.length > LIMITS.targets) throw Error('unavailable');
  const targets = new Map(),
    pairs = new Map();
  for (const target of input) {
    if (
      !target ||
      Object.keys(target).length !== 2 ||
      !HEX.test(target.key) ||
      !HEX.test(target.pair)
    )
      throw Error('unavailable');
    if (targets.has(target.key) && targets.get(target.key).pair !== target.pair)
      throw Error('unavailable');
    targets.set(target.key, { pair: target.pair, count: 0, origin: '', content: '' });
    pairs.set(target.pair, 0);
  }
  return { targets, pairs };
}

/** Compare the entire canonical audit corpus with its indexed rows in a worker.
 * @param {object} db Read-only index connection.
 * @param {string} directory Canonical audit directory.
 * @param {object[]} requested Bounded private tuple and pair digests.
 * @returns {object|null} Digest-only snapshot, or null on uncertainty.
 * @since 0.21.0-beta
 */
function captureObservationProof(db, directory, requested) {
  let transaction = false;
  const chunk = Buffer.alloc(65536),
    line = Buffer.alloc(LIMITS.lineBytes + 1);
  try {
    const { targets, pairs } = targetsFrom(requested);
    const directoryStat = fs.lstatSync(directory, { bigint: true });
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw Error('unavailable');
    const names = namesAt(directory);
    db.exec('BEGIN');
    transaction = true;
    const indexed = db
      .prepare(
        'SELECT file, indexed_bytes, indexed_lines, malformed_lines FROM audit_files ORDER BY file LIMIT ?',
      )
      .all(LIMITS.files + 1);
    if (
      indexed.length !== names.length ||
      indexed.some((row, i) => row.file !== names[i] || row.malformed_lines !== 0)
    )
      throw Error('unavailable');
    const query = db.prepare(`SELECT file, line_no,
      CASE WHEN length(CAST(raw AS BLOB)) <= ? THEN raw ELSE NULL END AS raw
      FROM audit_events ORDER BY file, line_no`);
    const iterator = query.iterate(LIMITS.lineBytes)[Symbol.iterator]();
    let next = iterator.next();
    const snapshots = [];
    for (const meta of indexed) {
      const filename = path.join(directory, meta.file);
      const before = fs.lstatSync(filename, { bigint: true });
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        before.nlink !== 1n ||
        (before.dev === 0n && before.ino === 0n) ||
        before.size > BigInt(Number.MAX_SAFE_INTEGER)
      )
        throw Error('unavailable');
      if (
        !Number.isSafeInteger(meta.indexed_bytes) ||
        meta.indexed_bytes !== Number(before.size) ||
        !Number.isSafeInteger(meta.indexed_lines) ||
        meta.indexed_lines < 0
      )
        throw Error('unavailable');
      snapshots.push([filename, before]);
      let fd,
        offset = 0,
        used = 0,
        ordinal = 0;
      try {
        fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
        const opened = fs.fstatSync(fd, { bigint: true });
        if (!opened.isFile() || !same(before, opened)) throw Error('unavailable');
        const consume = () => {
          let end = used;
          if (end && line[end - 1] === 13) end--;
          const text = new TextDecoder('utf-8', { fatal: true }).decode(line.subarray(0, end));
          used = 0;
          if (!text.trim()) return;
          if (
            next.done ||
            next.value.file !== meta.file ||
            next.value.line_no !== ordinal ||
            typeof next.value.raw !== 'string' ||
            next.value.raw !== text
          )
            throw Error('unavailable');
          const value = JSON.parse(text);
          if (!value || typeof value !== 'object' || Array.isArray(value))
            throw Error('unavailable');
          const identity = readAuditIdentity(value.details);
          if (!identity) {
            if (
              value.details &&
              typeof value.details === 'object' &&
              Object.hasOwn(value.details, 'auditIdentity')
            )
              throw Error('unavailable');
          } else {
            const pair = digest(JSON.stringify([identity.epoch, identity.eventId]));
            if (pairs.has(pair)) pairs.set(pair, Math.min(2, pairs.get(pair) + 1));
            const target = targets.get(digest(JSON.stringify(identity)));
            if (target) {
              target.count = Math.min(2, target.count + 1);
              target.origin = auditOriginFor(meta.file, ordinal);
              target.content = digest(JSON.stringify(normalizeAuditEntry(value)));
            }
          }
          ordinal++;
          next = iterator.next();
        };
        for (;;) {
          const n = fs.readSync(fd, chunk, 0, chunk.length, offset);
          if (!n) break;
          offset += n;
          let from = 0;
          while (from < n) {
            const nl = chunk.indexOf(10, from);
            const end = nl < 0 || nl >= n ? n : nl;
            const length = end - from;
            if (used + length > LIMITS.lineBytes) throw Error('unavailable');
            chunk.copy(line, used, from, end);
            used += length;
            if (end < n) consume();
            from = end + (end < n ? 1 : 0);
          }
        }
        if (
          used !== 0 ||
          offset !== Number(before.size) ||
          ordinal !== meta.indexed_lines ||
          !same(opened, fs.fstatSync(fd, { bigint: true }))
        )
          throw Error('unavailable');
      } finally {
        if (fd !== undefined) fs.closeSync(fd);
      }
    }
    if (
      !next.done ||
      !same(directoryStat, fs.lstatSync(directory, { bigint: true })) ||
      JSON.stringify(namesAt(directory)) !== JSON.stringify(names)
    )
      throw Error('unavailable');
    for (const [filename, before] of snapshots)
      if (!same(before, fs.lstatSync(filename, { bigint: true }))) throw Error('unavailable');
    db.exec('COMMIT');
    transaction = false;
    return {
      schemaVersion: 1,
      rows: [...targets]
        .filter(([, item]) => item.count > 0)
        .map(([key, item]) => ({
          key,
          origin: item.origin,
          content: item.content,
          count: Math.max(item.count, pairs.get(item.pair)),
        })),
    };
  } catch {
    if (transaction) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* unavailable */
      }
    }
    return null;
  } finally {
    chunk.fill(0);
    line.fill(0);
  }
}

module.exports = { captureObservationProof, LIMITS };
