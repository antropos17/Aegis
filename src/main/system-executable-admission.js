'use strict';
const defaultFs = require('node:fs');
const path = require('node:path');

/**
 * Walk every POSIX symlink hop, including redirected ancestor directories.
 * Process dot segments after links, matching filesystem traversal semantics.
 * @param {string} candidate Absolute installation path.
 * @param {object} fs Filesystem seam.
 * @returns {string|null} Protected regular file, or a rejected/bounded traversal.
 * @since 0.19.2-beta
 */
function walkProtectedExecutable(candidate, fs) {
  let current = '/';
  let pending = candidate.split('/').filter(Boolean);
  let hops = 0;
  let steps = 0;
  const root = fs.lstatSync('/');
  if (root.uid !== 0 || (root.mode & 0o022) !== 0 || !root.isDirectory()) return null;
  while (pending.length) {
    if (++steps > 1024) return null;
    const part = pending.shift();
    if (part === '.') continue;
    if (part === '..') {
      current = path.posix.dirname(current);
      continue;
    }
    const next = path.posix.join(current, part);
    const stat = fs.lstatSync(next);
    if (stat.uid !== 0) return null;
    if (stat.isSymbolicLink()) {
      if (++hops > 40) return null;
      const target = fs.readlinkSync(next);
      if (typeof target !== 'string' || !target || target.length > 4096) return null;
      pending = [...target.split('/').filter(Boolean), ...pending];
      if (pending.length > 1024) return null;
      if (target.startsWith('/')) current = '/';
      continue;
    }
    if ((stat.mode & 0o022) !== 0 || !(pending.length ? stat.isDirectory() : stat.isFile()))
      return null;
    current = next;
  }
  return fs.lstatSync(current).isFile() ? current : null;
}

/**
 * Admit a regular executable in a system installation tree. POSIX symlink targets
 * and every redirected ancestor chain must be root-owned and protected.
 * Windows rejects redirects along the entire default Program Files tree.
 * @param {string} platform Host platform.
 * @param {string[]} candidates Fixed system installation paths.
 * @param {object} [fs] Filesystem seam for focused tests.
 * @returns {{file: string, cwd: string}|null} Absolute command or no admitted CLI.
 * @since 0.19.2-beta
 */
function resolveSystemExecutable(platform, candidates, fs = defaultFs) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  for (const candidate of candidates) {
    try {
      const file = fs.realpathSync(candidate);
      if (!paths.isAbsolute(file)) continue;
      if (platform === 'win32' && file.toLowerCase() !== candidate.toLowerCase()) continue;
      if (platform !== 'win32' && walkProtectedExecutable(candidate, fs) !== file) continue;
      let trusted = true;
      for (const start of new Set([candidate, file])) {
        let current = start;
        while (true) {
          const stat = fs.lstatSync(current);
          if (platform === 'win32') {
            if (stat.isSymbolicLink()) trusted = false;
          } else if (stat.uid !== 0 || (!stat.isSymbolicLink() && (stat.mode & 0o022) !== 0)) {
            trusted = false;
          }
          if (!stat.isSymbolicLink() && !(current === start ? stat.isFile() : stat.isDirectory()))
            trusted = false;
          const parent = paths.dirname(current);
          if (!trusted || parent === current) break;
          current = parent;
        }
        if (!trusted) break;
      }
      if (!trusted || !fs.statSync(file).isFile()) continue;
      fs.accessSync(
        file,
        platform === 'win32' ? defaultFs.constants.F_OK : defaultFs.constants.X_OK,
      );
      return { file, cwd: paths.dirname(file) };
    } catch {
      // Missing, inaccessible and unsafe installation paths all fail closed.
    }
  }
  return null;
}

module.exports = { resolveSystemExecutable };
