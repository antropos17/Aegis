/**
 * @file platform/darwin.js
 * @description macOS platform implementation.
 * @since v0.3.0
 */
'use strict';

const { execFile } = require('child_process');

let _execFile = execFile;
/** @internal Override execFile (for tests). */
function _setExecFileForTest(fn) {
  _execFile = fn || require('child_process').execFile;
}

const {
  parsePsOutput,
  parseLsofOutput,
  parseLsofFileHandles,
  parseLsofCwd,
  killProcess,
  suspendProcess,
  resumeProcess,
  parseParentProcessMapFromPs,
} = require('./posix-shared');

/** @type {RegExp[]} macOS-specific file-path patterns to ignore */
const IGNORE_FILE_PATTERNS = [
  /^\/System\//,
  /^\/Library\/Caches\//,
  /^\/private\/var\//,
  /\/\.DS_Store$/,
  /^\/dev\//,
  /^\/usr\/share\//,
  /^\/usr\/lib\//,
  /\.dylib$/,
];

/**
 * List running processes via `ps`.
 * @returns {Promise<Array<{name: string, pid: number}>>}
 */
function listProcesses() {
  return new Promise((resolve, reject) => {
    _execFile('ps', ['-axo', 'comm=,pid='], { maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        reject(err);
        return;
      }
      const results = parsePsOutput(stdout);
      // macOS .app bundles: /Applications/Foo.app/Contents/MacOS/Foo → Foo
      // parsePsOutput extracts basename; override with .app bundle name when present
      for (const line of stdout.trim().split('\n')) {
        const appMatch = line.match(/\/([^/]+)\.app\//);
        if (!appMatch) continue;
        const lastSpace = line.trimEnd().lastIndexOf(' ');
        if (lastSpace === -1) continue;
        const pid = parseInt(line.slice(lastSpace + 1), 10);
        if (isNaN(pid)) continue;
        const proc = results.find((r) => r.pid === pid);
        if (proc) proc.name = appMatch[1];
      }
      resolve(results);
    });
  });
}

/**
 * Build a map of all processes with their parent PIDs via `ps`.
 * @returns {Promise<Map<number, {name: string, ppid: number}>>}
 */
function getParentProcessMap() {
  return new Promise((resolve) => {
    _execFile('ps', ['-axo', 'pid=,ppid=,comm='], { maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        resolve(new Map());
        return;
      }
      resolve(parseParentProcessMapFromPs(stdout));
    });
  });
}

/**
 * Get raw TCP connections for given PIDs via `lsof`.
 * @param {number[]} pids
 * @returns {Promise<Array<{pid: number, ip: string, port: number, state: string}>>}
 */
function getRawTcpConnections(pids) {
  return new Promise((resolve) => {
    if (pids.length === 0) {
      resolve([]);
      return;
    }
    _execFile(
      'lsof',
      ['-i', 'TCP', '-n', '-P', '-F', 'pcnT'],
      { timeout: 10000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }
        const pidSet = new Set(pids);
        resolve(parseLsofOutput(stdout, pidSet));
      },
    );
  });
}

/**
 * Get file handles for a process via `lsof -p PID -F n`.
 * @param {number} pid
 * @returns {Promise<string[]>}
 */
function getFileHandles(pid) {
  return parseLsofFileHandles(pid);
}

/**
 * Get the working directory of a process via lsof.
 * @param {number} pid
 * @returns {Promise<string|null>}
 * @since v0.5.0
 */
function getProcessCwd(pid) {
  return parseLsofCwd(pid);
}

module.exports = {
  listProcesses,
  getParentProcessMap,
  getRawTcpConnections,
  getFileHandles,
  getProcessCwd,
  killProcess,
  suspendProcess,
  resumeProcess,
  IGNORE_FILE_PATTERNS,
  _setExecFileForTest,
};
