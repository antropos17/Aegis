/** @file Bounded, on-demand consistency review of an owned daily audit file. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');
const { GENESIS, computeHash } = require('./audit-hashchain');

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_LINE_BYTES = 1024 * 1024;
const MAX_LINES = 20000;
const DEADLINE_MS = 2000;
const unavailable = () => ({ status: 'unavailable' });

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

function sameFile(a, b) {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.ino !== 0n &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs
  );
}

async function directoryIdentity(directory, io) {
  const root = path.parse(directory).root;
  const parts = path.relative(root, directory).split(path.sep).filter(Boolean);
  if (directory.length > 4096 || parts.length > 100) return null;
  const result = [];
  let current = root;
  for (const part of ['', ...parts]) {
    if (part) current = path.join(current, part);
    const stat = await io.lstat(current, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink() || !stat.ino) return null;
    result.push({ path: current, dev: stat.dev, ino: stat.ino });
  }
  return result;
}

async function sameDirectories(expected, io) {
  for (const item of expected) {
    const stat = await io.lstat(item.path, { bigint: true });
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.dev !== item.dev ||
      stat.ino !== item.ino
    )
      return false;
  }
  return true;
}

async function inspect(directory, date, deadline, io) {
  if (!validDate(date) || typeof directory !== 'string' || !path.isAbsolute(directory))
    return unavailable();
  const filename = path.join(directory, `aegis-audit-${date}.json`);
  let handle;
  try {
    const dirs = await directoryIdentity(directory, io);
    if (!dirs) return unavailable();
    const before = await io.lstat(filename, { bigint: true });
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1n ||
      before.size <= 0 ||
      before.size > MAX_BYTES ||
      before.ino === 0n
    )
      return unavailable();
    const flags =
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
    handle = await io.open(filename, flags);
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameFile(before, opened)) return unavailable();
    const data = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < data.length) {
      if (Date.now() >= deadline) return unavailable();
      const { bytesRead } = await handle.read(
        data,
        offset,
        Math.min(65536, data.length - offset),
        offset,
      );
      if (bytesRead <= 0) return unavailable();
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const pathAfter = await io.lstat(filename, { bigint: true });
    if (
      !pathAfter.isFile() ||
      pathAfter.isSymbolicLink() ||
      pathAfter.nlink !== 1n ||
      !sameFile(before, after) ||
      !sameFile(before, pathAfter) ||
      !(await sameDirectories(dirs, io)) ||
      Date.now() >= deadline ||
      data[data.length - 1] !== 0x0a
    )
      return unavailable();
    const rawLines = new TextDecoder('utf-8', { fatal: true }).decode(data).split('\n');
    rawLines.pop();
    if (!rawLines.length || rawLines.length > MAX_LINES) return unavailable();
    const lines = rawLines.filter((line) => line.trim());
    if (!lines.length) return unavailable();
    let previous = GENESIS;
    let status = 'consistent';
    for (let i = 0; i < lines.length; i++) {
      if (Date.now() >= deadline || Buffer.byteLength(lines[i], 'utf8') > MAX_LINE_BYTES)
        return unavailable();
      let entry;
      try {
        entry = JSON.parse(lines[i]);
      } catch {
        status = 'inconsistent';
        break;
      }
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || entry.seq !== i) {
        status = 'inconsistent';
        break;
      }
      const event = { ...entry };
      delete event.seq;
      delete event.hash;
      if (typeof entry.hash !== 'string' || computeHash(previous, event) !== entry.hash) {
        status = 'inconsistent';
        break;
      }
      previous = entry.hash;
      if (i % 50 === 49) await new Promise((resolve) => setImmediate(resolve));
    }
    const finalFile = await handle.stat({ bigint: true });
    const finalPath = await io.lstat(filename, { bigint: true });
    if (
      Date.now() >= deadline ||
      !sameFile(before, finalFile) ||
      !sameFile(before, finalPath) ||
      !finalPath.isFile() ||
      finalPath.isSymbolicLink() ||
      finalPath.nlink !== 1n ||
      !(await sameDirectories(dirs, io))
    )
      return unavailable();
    return { status };
  } catch {
    return unavailable();
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

/** Create one bounded checker. A timed-out operation stays busy until its IO settles.
 * @param {object} options App-owned log directory provider and optional test IO.
 * @returns {function(string): Promise<{status: string}>} Date-scoped checker.
 * @since 0.21.0-beta
 */
function createAuditIntegrityReview({ getLogDir, io = fs.promises }) {
  let busy = false;
  return async (date) => {
    if (busy || !validDate(date)) return unavailable();
    busy = true;
    const deadline = Date.now() + DEADLINE_MS;
    const work = Promise.resolve()
      .then(() => inspect(getLogDir(), date, deadline, io))
      .catch(unavailable)
      .finally(() => {
        busy = false;
      });
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(unavailable()), DEADLINE_MS);
    });
    try {
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
}

module.exports = { createAuditIntegrityReview };
