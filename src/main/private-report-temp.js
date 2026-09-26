/**
 * @file private-report-temp.js
 * @description Bounded storage for browser-opened HTML reports.
 * @since v0.16.0-alpha
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DIRECTORY_NAME = 'aegis-private-reports-v1';
const REPORT_NAME = /^aegis-(?:threat-report|report)-[0-9a-f]{32}\.html$/;
const MIN_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_AGE_MS = 7 * MIN_AGE_MS;
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_REPORT_BYTES = 8 * 1024 * 1024;
const MAX_SWEEP_ENTRIES = 512;
const MAX_SWEEP_DELETES = 128;
let sweepTimer = null;

/**
 * Check the exact AEGIS report directory without following a link or junction.
 * On POSIX an existing directory must belong to this user and exclude group/other access.
 * Windows ACLs are inherited; this check makes no Windows ACL guarantee.
 * @param {string} tempRoot Electron's temp path.
 * @param {boolean} create Whether to create the directory when absent.
 * @returns {string|null} Valid directory or null when absent and create is false.
 * @since v0.16.0-alpha
 */
function reportDirectory(tempRoot, create = false) {
  if (typeof tempRoot !== 'string' || !path.isAbsolute(tempRoot))
    throw new Error('Private report directory unavailable');
  const directory = path.join(tempRoot, DIRECTORY_NAME);
  if (create) {
    try {
      fs.mkdirSync(directory, { mode: 0o700 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  let stat;
  try {
    stat = fs.lstatSync(directory);
  } catch (error) {
    if (error.code === 'ENOENT' && !create) return null;
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error('Private report directory unavailable');
  if (process.platform !== 'win32' && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0))
    throw new Error('Private report directory unavailable');
  return directory;
}

/**
 * Remove only aged, regular AEGIS report files in the exact checked directory.
 * Recent files get at least a day for the external viewer to open. The size limit
 * is soft while newer files remain; locked files are skipped and retried later.
 * @param {string} tempRoot Electron's temp path.
 * @param {number} [now] Current epoch milliseconds (test seam).
 * @returns {{removed:number, bytes:number, scanned:number, truncated:boolean}} Bounded sweep results.
 * @since v0.16.0-alpha
 */
function prunePrivateReports(tempRoot, now = Date.now()) {
  const directory = reportDirectory(tempRoot);
  if (!directory) return { removed: 0, bytes: 0, scanned: 0, truncated: false };
  const files = [];
  let scanned = 0;
  let truncated = false;
  const handle = fs.opendirSync(directory);
  try {
    let entry;
    while ((entry = handle.readSync()) !== null) {
      if (scanned === MAX_SWEEP_ENTRIES) {
        truncated = true;
        break;
      }
      scanned++;
      if (!REPORT_NAME.test(entry.name) || !entry.isFile() || entry.isSymbolicLink()) continue;
      const target = path.join(directory, entry.name);
      try {
        const stat = fs.lstatSync(target);
        if (!stat.isFile() || stat.isSymbolicLink() || !Number.isFinite(stat.mtimeMs)) continue;
        files.push({ target, stat });
      } catch (_) {
        // A changed or inaccessible file is retried on a later sweep.
      }
    }
  } finally {
    handle.closeSync();
  }
  files.sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);
  let bytes = files.reduce((total, file) => total + file.stat.size, 0);
  let removed = 0;
  for (const file of files) {
    if (removed === MAX_SWEEP_DELETES) {
      truncated = true;
      break;
    }
    const age = now - file.stat.mtimeMs;
    if (age < MIN_AGE_MS || (age < MAX_AGE_MS && bytes <= MAX_TOTAL_BYTES)) continue;
    try {
      // Recheck before unlink: never follow a replaced symlink or prune a changed file.
      const current = fs.lstatSync(file.target);
      if (
        !current.isFile() ||
        current.isSymbolicLink() ||
        current.ino !== file.stat.ino ||
        current.size !== file.stat.size ||
        current.mtimeMs !== file.stat.mtimeMs
      )
        continue;
      fs.unlinkSync(file.target);
      bytes -= file.stat.size;
      removed++;
    } catch (_) {
      // Sharing violations, access errors, and races are retried on a later sweep.
    }
  }
  return { removed, bytes, scanned, truncated };
}

/**
 * Write bounded HTML to a cryptographically random, exclusive file. The writer
 * closes before the caller opens the file in an external viewer.
 * @param {string} tempRoot Electron's temp path.
 * @param {'threat-report'|'report'} kind Report kind.
 * @param {string} html Complete report HTML.
 * @returns {string} Absolute report path.
 * @since v0.16.0-alpha
 */
function writePrivateReport(tempRoot, kind, html) {
  if (
    !['threat-report', 'report'].includes(kind) ||
    typeof html !== 'string' ||
    Buffer.byteLength(html, 'utf8') > MAX_REPORT_BYTES
  )
    throw new Error('Private report input invalid');
  const directory = reportDirectory(tempRoot, true);
  for (let attempt = 0; attempt < 3; attempt++) {
    const target = path.join(
      directory,
      `aegis-${kind}-${crypto.randomBytes(16).toString('hex')}.html`,
    );
    let descriptor;
    try {
      descriptor = fs.openSync(
        target,
        fs.constants.O_WRONLY |
          fs.constants.O_CREAT |
          fs.constants.O_EXCL |
          (fs.constants.O_NOFOLLOW || 0),
        0o600,
      );
    } catch (error) {
      if (error.code === 'EEXIST') continue;
      throw error;
    }
    try {
      fs.writeFileSync(descriptor, html, 'utf8');
      fs.closeSync(descriptor);
      return target;
    } catch (error) {
      try {
        fs.closeSync(descriptor);
      } catch (_) {
        // The descriptor may already be closed.
      }
      try {
        fs.unlinkSync(target);
      } catch (_) {
        // A failed partial write remains eligible for the next retention sweep.
      }
      throw error;
    }
  }
  throw new Error('Private report file unavailable');
}

/**
 * Sweep on app startup and every six hours while the app stays open.
 * @param {() => string} getTempRoot Resolve Electron's current temp path.
 * @param {() => void} [onError] Generic, path-free failure notice.
 * @returns {void}
 * @since v0.16.0-alpha
 */
function startPrivateReportRetention(getTempRoot, onError = () => {}) {
  if (sweepTimer) return;
  const sweep = () => {
    try {
      const result = prunePrivateReports(getTempRoot());
      if (result.truncated) onError();
    } catch (_) {
      onError();
    }
  };
  sweep();
  sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
}

module.exports = {
  reportDirectory,
  prunePrivateReports,
  writePrivateReport,
  startPrivateReportRetention,
  MIN_AGE_MS,
  MAX_AGE_MS,
  MAX_TOTAL_BYTES,
};
