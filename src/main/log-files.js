/**
 * @file log-files.js
 * @module main/log-files
 * @description Bounded operational-log files and their small daily count index.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Active file plus three closed rotations: at most 8 MiB per new day, 240 MiB over 30 days.
// Pre-existing oversized files remain until rotation/age retention removes them.
const MAX_LOG_BYTES = 2 * 1024 * 1024;
const MAX_ROTATIONS = 3;
const MAX_ENTRY_BYTES = 64 * 1024;
const LOG_FILE_PATTERN = /^aegis-(\d{4}-\d{2}-\d{2})(?:\.([1-3]))?\.log$/;
const COUNT_FILE_PATTERN = /^aegis-(\d{4}-\d{2}-\d{2})\.count$/;

/** @param {Date} date Calendar date. @returns {string} Local YYYY-MM-DD. @since v0.17.0-alpha */
function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** @param {string} dir Log directory. @param {string} day Day key. @param {number} [rotation] Rotation number. @returns {string} Exact log path. @since v0.17.0-alpha */
function logPath(dir, day, rotation = 0) {
  return path.join(dir, `aegis-${day}${rotation ? `.${rotation}` : ''}.log`);
}

/** @param {string} file Exact path. @returns {import('fs').Stats|null} Regular-file metadata or null. @since v0.17.0-alpha */
function regularFile(file) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe operational log path');
  return stat;
}

/** @param {string} dir Log directory. @returns {string[]} Log basenames in chronological order. @since v0.17.0-alpha */
function listLogFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((name) => {
      if (!LOG_FILE_PATTERN.test(name)) return false;
      try {
        return !!regularFile(path.join(dir, name));
      } catch {
        return false;
      }
    })
    .sort((a, b) => {
      const left = a.match(LOG_FILE_PATTERN);
      const right = b.match(LOG_FILE_PATTERN);
      return left[1].localeCompare(right[1]) || Number(right[2] || 0) - Number(left[2] || 0);
    });
}

/** @param {string} dir Log directory. @param {string} day Day key. @returns {void} Move only closed regular files. @since v0.17.0-alpha */
function rotate(dir, day) {
  for (let n = MAX_ROTATIONS; n >= 1; n--) {
    const source = logPath(dir, day, n - 1);
    const target = logPath(dir, day, n);
    const targetStat = regularFile(target);
    const sourceStat = regularFile(source);
    if (targetStat) fs.unlinkSync(target);
    if (sourceStat) fs.renameSync(source, target);
  }
}

/** @param {string} dir Log directory. @param {string} day Day key. @param {string[]} lines Bounded NDJSON lines. @returns {void} Append within the per-file budget. @since v0.17.0-alpha */
function appendLines(dir, day, lines) {
  if (lines.length === 0) return;
  const active = logPath(dir, day);
  let size = regularFile(active)?.size || 0;
  let chunk = '';
  let chunkBytes = 0;
  const writeChunk = () => {
    if (!chunkBytes) return;
    fs.appendFileSync(active, chunk, 'utf-8');
    size += chunkBytes;
    chunk = '';
    chunkBytes = 0;
  };

  for (const line of lines) {
    const bytes = Buffer.byteLength(line, 'utf-8') + 1;
    if (bytes > MAX_ENTRY_BYTES) throw new Error('Unbounded operational log entry');
    if (size + chunkBytes + bytes > MAX_LOG_BYTES) {
      writeChunk();
      rotate(dir, day);
      size = 0;
    }
    chunk += `${line}\n`;
    chunkBytes += bytes;
  }
  writeChunk();
}

/** @param {string} dir Log directory. @param {string} day Day key. @returns {number} Bytes in today's regular log files. @since v0.17.0-alpha */
function dayBytes(dir, day) {
  return listLogFiles(dir)
    .filter((name) => name.match(LOG_FILE_PATTERN)[1] === day)
    .reduce((total, name) => total + regularFile(path.join(dir, name)).size, 0);
}

/** @param {string} dir Log directory. @param {string} day Day key. @returns {number|null} Valid durable count or null. @since v0.17.0-alpha */
function readCount(dir, day) {
  const file = path.join(dir, `aegis-${day}.count`);
  const stat = regularFile(file);
  if (!stat || stat.size > 128) return null;
  try {
    const index = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return Number.isSafeInteger(index.count) &&
      index.count >= 0 &&
      index.bytes === dayBytes(dir, day)
      ? index.count
      : null;
  } catch {
    return null;
  }
}

/** @param {string} dir Log directory. @param {string} day Day key. @param {number} count Durable entries. @returns {void} Persist a bounded count index. @since v0.17.0-alpha */
function writeCount(dir, day, count) {
  const file = path.join(dir, `aegis-${day}.count`);
  regularFile(file);
  fs.writeFileSync(file, JSON.stringify({ count, bytes: dayBytes(dir, day) }), 'utf-8');
}

/** @param {string} dir Log directory. @param {string} day Day key. @returns {Promise<number>} Non-empty lines in existing daily files. @since v0.17.0-alpha */
async function scanCount(dir, day) {
  let count = 0;
  for (const name of listLogFiles(dir)) {
    if (name.match(LOG_FILE_PATTERN)[1] !== day) continue;
    const file = path.join(dir, name);
    const stat = regularFile(file);
    if (!stat?.size) continue;
    const stream = fs.createReadStream(file, { encoding: 'utf-8', end: stat.size - 1 });
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) if (line.trim()) count++;
    } finally {
      lines.close();
      stream.destroy();
    }
  }
  return count;
}

/** @param {string} dir Log directory. @param {number} retentionDays Age policy in days. @returns {void} Remove only old, closed regular log and count files. @since v0.17.0-alpha */
function cleanOldLogs(dir, retentionDays) {
  const cutoff = dateKey(new Date(Date.now() - retentionDays * 86400000));
  for (const name of fs.readdirSync(dir)) {
    const match = name.match(LOG_FILE_PATTERN) || name.match(COUNT_FILE_PATTERN);
    if (!match || match[1] >= cutoff) continue;
    const file = path.join(dir, name);
    try {
      if (regularFile(file)) fs.unlinkSync(file);
    } catch {
      console.error('[logger] unlink old log failed');
    }
  }
}

module.exports = {
  MAX_ENTRY_BYTES,
  appendLines,
  cleanOldLogs,
  dateKey,
  listLogFiles,
  readCount,
  scanCount,
  writeCount,
};
