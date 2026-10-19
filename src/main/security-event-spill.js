'use strict';
const fsDefault = require('fs');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const { SENSORS, replayRecord } = require('./security-event-record');
const digest = (value) => createHash('sha256').update(value).digest('hex');
const DATA = /^\d{16}-[a-f0-9-]{36}\.(spill|tmp|bad)$/;
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;

/** Quota-managed store. Generated basenames only; no recursive cleanup or link traversal.
 * @param {Object} options Storage, bounds and fixed-code failure callback.
 * @returns {Object} Synchronous bounded segment store.
 * @since 0.19.2
 */
function createSpillStore(options) {
  const fs = options.fs ?? fsDefault;
  const root = path.resolve(options.directory);
  const quota = options.diskQuotaBytes ?? 32 * 1024 * 1024;
  const maxFiles = options.maxFiles ?? 1024;
  const maxSegment = options.maxSegmentBytes ?? 6 * 1024 * 1024;
  if (
    !Number.isSafeInteger(quota) ||
    quota < 65536 ||
    quota > 1024 * 1024 * 1024 ||
    !Number.isSafeInteger(maxFiles) ||
    maxFiles < 4 ||
    maxFiles > 4096 ||
    !Number.isSafeInteger(maxSegment) ||
    maxSegment < 1024 ||
    maxSegment > 6 * 1024 * 1024
  )
    throw new Error('invalid-spill-options');
  let identity;
  let blocked = false;
  let sequence = 0;
  let bytes = 0;
  const files = [];
  const pending = [];

  function checkRoot() {
    let cursor = root;
    while (true) {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('spill-unsafe-path');
      if (cursor === root && identity && !same(stat, identity))
        throw new Error('spill-unsafe-path');
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  function read(name, limit) {
    checkRoot();
    const target = path.join(root, name);
    const before = fs.lstatSync(target);
    if (!before.isFile() || before.isSymbolicLink() || before.size > limit)
      throw new Error('spill-corrupt');
    const fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      const opened = fs.fstatSync(fd);
      if (!same(before, opened) || opened.size > limit || !opened.isFile())
        throw new Error('spill-unsafe-path');
      const buffer = Buffer.alloc(opened.size);
      let offset = 0;
      while (offset < buffer.length) {
        const n = fs.readSync(fd, buffer, offset, buffer.length - offset, offset);
        if (n === 0) throw new Error('spill-corrupt');
        offset += n;
      }
      if (!same(opened, fs.lstatSync(target))) throw new Error('spill-unsafe-path');
      return buffer.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  }
  function describe(records) {
    return SENSORS.map((sensor) => {
      const rows = records.filter((r) => r.sensor === sensor);
      return {
        sensor,
        count: rows.length,
        first: rows.length ? Math.min(...rows.map((r) => r.timestamp)) : null,
        last: rows.length ? Math.max(...rows.map((r) => r.timestamp)) : null,
      };
    });
  }
  function parseHeader(raw) {
    const end = raw.indexOf('\n');
    if (end < 0 || end > 2048) throw new Error('spill-corrupt');
    const envelope = JSON.parse(raw.slice(0, end));
    if (envelope.hash !== digest(JSON.stringify(envelope.meta))) throw new Error('spill-corrupt');
    const meta = envelope.meta;
    if (
      !Array.isArray(meta.sensors) ||
      meta.sensors.length !== SENSORS.length ||
      meta.sensors.some(
        (s, i) =>
          s.sensor !== SENSORS[i] ||
          !Number.isSafeInteger(s.count) ||
          s.count < 0 ||
          s.count > 16384 ||
          (s.count &&
            (!Number.isSafeInteger(s.first) ||
              !Number.isSafeInteger(s.last) ||
              s.first < 0 ||
              s.last < s.first ||
              s.last > 8640000000000000)),
      )
    )
      throw new Error('spill-corrupt');
    return { meta, body: raw.slice(end + 1) };
  }
  try {
    // Validate every existing parent before creating the one owned child.
    if (!fs.existsSync(root)) {
      const parent = path.dirname(root);
      let cursor = parent;
      while (true) {
        const stat = fs.lstatSync(cursor);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('spill-unsafe-path');
        const next = path.dirname(cursor);
        if (next === cursor) break;
        cursor = next;
      }
      fs.mkdirSync(root, { mode: 0o700 });
    }
    checkRoot();
    identity = fs.lstatSync(root);
    const dir = fs.opendirSync(root);
    try {
      let entry;
      while ((entry = dir.readSync())) {
        if (files.length >= maxFiles) throw new Error('spill-discovery-limit');
        if (!DATA.test(entry.name) && !['loss.json', 'loss.tmp'].includes(entry.name))
          throw new Error('spill-foreign-file');
        const stat = fs.lstatSync(path.join(root, entry.name));
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('spill-unsafe-path');
        bytes += stat.size;
        files.push({ name: entry.name, bytes: stat.size });
        if (DATA.test(entry.name)) sequence = Math.max(sequence, Number(entry.name.slice(0, 16)));
      }
    } finally {
      dir.closeSync();
    }
    files.sort((a, b) => a.name.localeCompare(b.name));
    if (files.some((item) => item.name === 'loss.tmp'))
      options.onFault('loss-ledger-corrupt', null);
    pending.push(...files.filter((f) => DATA.test(f.name) && !f.name.endsWith('.bad')));
    if (bytes > quota) throw new Error('spill-quota');
  } catch {
    blocked = true;
    options.onFault('spill-storage-unavailable', null);
  }

  function writeFile(name, content, replace = false) {
    checkRoot();
    const target = path.join(root, name);
    const fd = fs.openSync(target, replace ? 'w' : 'wx', 0o600);
    try {
      fs.writeFileSync(fd, content);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }
  function append(records) {
    if (blocked) return 'spill-storage-unavailable';
    const body = JSON.stringify(records);
    const meta = { sensors: describe(records), hash: digest(body) };
    const content = JSON.stringify({ meta, hash: digest(JSON.stringify(meta)) }) + '\n' + body;
    const size = Buffer.byteLength(content);
    // Reserve space for two bounded loss ledgers (atomic replacement).
    if (size > maxSegment || bytes + size + 65536 > quota || files.length + 3 > maxFiles)
      return 'spill-quota';
    const stem = `${String(++sequence).padStart(16, '0')}-${randomUUID()}`;
    const item = { name: `${stem}.spill`, bytes: size, count: records.length };
    const temporary = `${stem}.tmp`;
    try {
      writeFile(temporary, content);
      checkRoot();
      fs.renameSync(path.join(root, temporary), path.join(root, item.name));
      bytes += size;
      files.push(item);
      pending.push(item);
      return null;
    } catch {
      // Failed admission is already counted by the caller; retain an undeletable
      // partial as quarantine, not a replay candidate that counts the loss twice.
      try {
        const stat = fs.lstatSync(path.join(root, temporary));
        checkRoot();
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('spill-unsafe-path');
        try {
          fs.unlinkSync(path.join(root, temporary));
        } catch {
          const name = `${stem}.bad`;
          try {
            fs.renameSync(path.join(root, temporary), path.join(root, name));
            bytes += stat.size;
            files.push({ name, bytes: stat.size });
          } catch {
            bytes += stat.size;
            files.push({ name: temporary, bytes: stat.size });
            blocked = true;
          }
        }
      } catch (error) {
        if (error.code !== 'ENOENT') blocked = true;
      }
      return 'spill-write-failed';
    }
  }
  function remove(item) {
    checkRoot();
    const stat = fs.lstatSync(path.join(root, item.name));
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('spill-unsafe-path');
    fs.unlinkSync(path.join(root, item.name));
    bytes -= item.bytes;
    files.splice(files.indexOf(item), 1);
  }
  function replay(consume) {
    if (blocked) return false;
    while (pending.length) {
      const item = pending[0];
      if (!item.acknowledged) {
        let metadata = null;
        let rows;
        try {
          const parsed = parseHeader(read(item.name, maxSegment));
          metadata = parsed.meta.sensors;
          item.count = metadata.reduce((sum, row) => sum + row.count, 0);
          if (parsed.meta.hash !== digest(parsed.body)) throw new Error('spill-corrupt');
          const decoded = JSON.parse(parsed.body);
          if (!Array.isArray(decoded) || decoded.length > 16384) throw new Error('spill-corrupt');
          rows = decoded.map(replayRecord);
          if (JSON.stringify(describe(rows)) !== JSON.stringify(metadata))
            throw new Error('spill-corrupt');
        } catch {
          // Transfer loss ownership to a durable ledger before retiring the source.
          if (!options.onFault('spill-corrupt', metadata, item.name)) return false;
          try {
            checkRoot();
            const bad = item.name.replace(/\.(spill|tmp)$/, '.bad');
            fs.renameSync(path.join(root, item.name), path.join(root, bad));
            item.name = bad;
            pending.shift();
            continue;
          } catch {
            blocked = true;
            return false;
          }
        }
        if (!consume(rows)) return false;
        // Volatile ACK prevents live retry amplification; restart replays the stable IDs.
        item.acknowledged = true;
      }
      try {
        remove(item);
        pending.shift();
      } catch {
        if (!item.deleteFaultReported) {
          options.onFault('spill-delete-failed', null);
          item.deleteFaultReported = true;
        }
        return false;
      }
    }
    return true;
  }
  function loadLoss() {
    const item = files.find((f) => f.name === 'loss.json');
    if (!item || blocked) return null;
    try {
      return JSON.parse(read(item.name, 32768));
    } catch {
      options.onFault('loss-ledger-corrupt', null);
      return null;
    }
  }
  function saveLoss(losses) {
    if (blocked) return false;
    try {
      const text = JSON.stringify(losses);
      const size = Buffer.byteLength(text);
      const stale = files.find((f) => f.name === 'loss.tmp');
      if (stale) remove(stale);
      if (size > 32768 || bytes + size > quota || files.length >= maxFiles) return false;
      writeFile('loss.tmp', text);
      const old = files.find((f) => f.name === 'loss.json');
      checkRoot();
      fs.renameSync(path.join(root, 'loss.tmp'), path.join(root, 'loss.json'));
      if (old) {
        bytes -= old.bytes;
        files.splice(files.indexOf(old), 1);
      }
      bytes += size;
      files.push({ name: 'loss.json', bytes: size });
      return true;
    } catch {
      // Count a partial temporary ledger, and never recursively queue a marker.
      if (!files.some((f) => f.name === 'loss.tmp')) {
        try {
          const size = fs.lstatSync(path.join(root, 'loss.tmp')).size;
          files.push({ name: 'loss.tmp', bytes: size });
          bytes += size;
        } catch {
          /* creation failed */
        }
      }
      return false;
    }
  }
  return {
    append,
    replay,
    loadLoss,
    saveLoss,
    hasPending: () => pending.length > 0,
    stats: () => ({
      bytes,
      files: files.length,
      records: pending.reduce((sum, item) => sum + (item.count ?? 0), 0),
      quotaBytes: quota,
      blocked,
    }),
  };
}
module.exports = { createSpillStore };
