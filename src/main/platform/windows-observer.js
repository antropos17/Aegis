'use strict';
const fs = require('node:fs');
const path = require('node:path');

function resolveExe() {
  const root =
    process.resourcesPath && !process.defaultApp
      ? process.resourcesPath
      : path.join(__dirname, '../../..', 'build');
  const file = path.join(root, 'sidecar', 'aegis-observer.exe');
  return fs.existsSync(file) ? file : null;
}

/** Bounded one-shot native transport; observations are never cached.
 * @param {{execFile: Function, resolveExe?: Function, now?: Function, mode?: string}} deps
 * @returns {{tryRequest: Function}} Parsed observation or null to use the existing fallback.
 * @since 0.15.0
 */
function createWindowsObserver(deps) {
  const locate = deps.resolveExe || resolveExe;
  const now = deps.now || (() => performance.now());
  const mode = deps.mode ?? process.env.AEGIS_OBSERVER_PROVIDER;
  const retryAt = new Map();
  return {
    async tryRequest(kind, input, parse) {
      if (!['tcp', 'cwd', 'holders'].includes(kind)) throw new Error('Invalid observation kind');
      if (mode === 'powershell' || now() < (retryAt.get(kind) || 0)) return null;
      const payload = JSON.stringify(input);
      if (Buffer.byteLength(payload) > 524288 || input.pids?.length > 2048) return null;
      try {
        const exe = locate();
        if (!exe) throw new Error('Observer unavailable');
        const stdout = await new Promise((resolve, reject) => {
          const child = deps.execFile(
            exe,
            [kind],
            {
              timeout: kind === 'holders' ? 10000 : 5000,
              maxBuffer: 2 * 1024 * 1024,
              windowsHide: true,
            },
            (err, text) => (err ? reject(new Error('Observer failed')) : resolve(text)),
          );
          // Early exit can close stdin before writing finishes. The exec callback
          // owns completion and the timeout; never expose payload/OS error text.
          child.stdin.on('error', () => {});
          child.stdin.end(payload, 'utf8');
        });
        const response = JSON.parse(stdout);
        if (response?.version !== 1 || !Array.isArray(response.rows))
          throw new Error('Invalid observer response');
        return parse(response.rows);
      } catch {
        retryAt.set(kind, now() + 60000);
        return null;
      }
    },
  };
}

/** Validate command-line rows against the requested observation, without caching.
 * @param {Array} rows
 * @param {number[]} pids
 * @returns {Array} Validated rows.
 * @since 0.15.0
 */
function validateCwds(rows, pids) {
  const wanted = new Set(pids),
    seen = new Set();
  for (const row of rows) {
    if (
      !row ||
      !wanted.has(row.ProcessId) ||
      seen.has(row.ProcessId) ||
      (row.CommandLine !== null && typeof row.CommandLine !== 'string')
    )
      throw new Error('Invalid CWD observation');
    seen.add(row.ProcessId);
  }
  return rows;
}

/** Bind native holder indices to the original groups; helper output carries no paths.
 * @param {Array} rows
 * @param {Array} groups
 * @returns {Array} Flattened holder observations.
 * @since 0.15.0
 */
function parseNativeHolders(rows, groups) {
  if (rows.length !== groups.length) throw new Error('Incomplete holder observation');
  const seen = new Set(),
    holders = [];
  for (const row of rows) {
    if (
      !row ||
      !Number.isInteger(row.index) ||
      row.index < 0 ||
      row.index >= groups.length ||
      seen.has(row.index) ||
      !Array.isArray(row.pids)
    )
      throw new Error('Invalid holder group');
    seen.add(row.index);
    for (const pid of row.pids) {
      if (!Number.isInteger(pid) || pid <= 0 || pid > 0xffffffff)
        throw new Error('Invalid holder PID');
      const { group, reason } = groups[row.index];
      holders.push({ pid, group, reason });
    }
  }
  return holders;
}

module.exports = { createWindowsObserver, validateCwds, parseNativeHolders };
