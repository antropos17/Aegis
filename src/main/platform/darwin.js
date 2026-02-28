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
      const results = [];
      const lines = stdout.trim().split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // pid is the last whitespace-separated token
        const lastSpace = trimmed.lastIndexOf(' ');
        if (lastSpace === -1) continue;
        const comm = trimmed.slice(0, lastSpace).trim();
        const pid = parseInt(trimmed.slice(lastSpace + 1), 10);
        if (isNaN(pid) || !comm) continue;
        // Extract basename from full path; map .app bundle paths to app name
        let name = comm;
        const slashIdx = name.lastIndexOf('/');
        if (slashIdx !== -1) name = name.slice(slashIdx + 1);
        // Handle macOS .app bundles: /Applications/Foo.app/Contents/MacOS/Foo → Foo
        const appMatch = comm.match(/\/([^/]+)\.app\//);
        if (appMatch) name = appMatch[1];
        results.push({ name, pid });
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
