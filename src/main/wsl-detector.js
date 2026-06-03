/**
 * @file wsl-detector.js
 * @module main/wsl-detector
 * @description Detects AI agents running INSIDE WSL (grok, opencode). These run
 *   in a Linux PID namespace invisible to Windows `tasklist`, so the Windows
 *   process scanner never sees them. Primary signal: enumerate WSL processes via
 *   `wsl.exe -e ps` and match new signatures. When enumeration is unavailable
 *   (no `ps`, distro error), the fallback is the passive config-path watch on
 *   `~/.grok-build` / `~/.opencode` registered in AGENT_CONFIG_PATHS.
 *
 *   Detected WSL agents are surfaced with `pid: 0`: a WSL Linux PID is
 *   namespace-local and would COLLIDE with an unrelated Windows PID, causing the
 *   file-handle / TCP scanners to mis-attribute that Windows process's activity.
 *   pid 0 keeps the synthetic agent inert for those scanners (they guard pid>0).
 * @requires child_process
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.1.0
 * @since v0.11.0-alpha
 */
'use strict';

const { execFile } = require('child_process');

/** @type {string} A single NUL byte (avoids a control char in a regex literal) */
const NUL_CHAR = String.fromCharCode(0);

let _execFile = execFile;
let _getPlatform = () => process.platform;

/**
 * @internal Override dependencies (for tests).
 * @param {{ execFile?: Function, platform?: string }} overrides
 */
function _setDepsForTest(overrides) {
  if (overrides.execFile) _execFile = overrides.execFile;
  if (overrides.platform) _getPlatform = () => overrides.platform;
}

/** @internal Reset to real dependencies and clear all caches (for tests). */
function _resetForTest() {
  _execFile = execFile;
  _getPlatform = () => process.platform;
  _wslAvailable = null;
  _cache = [];
  _lastRefresh = 0;
  _refreshing = false;
}

// ═══ SIGNATURES ═══

/**
 * @typedef {Object} WslSignature
 * @property {RegExp} pattern - tested against each `ps` command line
 * @property {string} agent - display name to surface
 */

/**
 * AI agents commonly run under WSL. Patterns require a path/word boundary so a
 * substring inside an unrelated path does not false-match.
 * @type {readonly WslSignature[]}
 */
const WSL_SIGNATURES = [
  { pattern: /(?:^|\/|\s)opencode(?:\s|$)/i, agent: 'opencode' },
  { pattern: /(?:^|\/|\s)grok(?:-cli)?(?:\s|$)/i, agent: 'grok' },
];

// ═══ CACHE ═══

/** @type {number} How long an enumeration stays fresh (ms) — WSL spawn is heavy */
const REFRESH_TTL_MS = 60000;

/** @type {boolean|null} Cached WSL availability (null = not yet probed) */
let _wslAvailable = null;
/** @type {Array<Object>} Last detected synthetic agents */
let _cache = [];
let _lastRefresh = 0;
let _refreshing = false;

// ═══ INTERNAL ═══

/**
 * Run an executable, resolving `{ ok, stdout }`. Never rejects.
 * @param {string} cmd
 * @param {string[]} args
 * @returns {Promise<{ ok: boolean, stdout: string }>}
 */
function run(cmd, args) {
  return new Promise((resolve) => {
    _execFile(cmd, args, { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err) {
        resolve({ ok: false, stdout: '' });
        return;
      }
      resolve({
        ok: true,
        stdout: typeof stdout === 'string' ? stdout : (stdout || '').toString(),
      });
    });
  });
}

/**
 * Parse `ps -eo pid=,args=` output into matched synthetic agents.
 * @param {string} stdout
 * @returns {Array<Object>}
 */
function parsePsOutput(stdout) {
  const detected = [];
  const seenAgents = new Set();
  for (const line of stdout.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!m) continue;
    const wslPid = parseInt(m[1], 10);
    const cmdline = m[2];
    for (const sig of WSL_SIGNATURES) {
      if (seenAgents.has(sig.agent)) continue;
      if (!sig.pattern.test(cmdline)) continue;
      seenAgents.add(sig.agent);
      detected.push({
        agent: sig.agent,
        process: cmdline.split(/\s+/)[0],
        pid: 0,
        status: 'running',
        category: 'ai',
        parentEditor: 'WSL',
        host: 'wsl',
        wslPid,
        detectionMethod: 'wsl-process',
      });
    }
  }
  return detected;
}

// ═══ PUBLIC API ═══

/**
 * Whether WSL is installed with at least one distro. Cached after first probe.
 * `wsl.exe -l -q` emits UTF-16LE; decoded as UTF-8 it interleaves a null byte
 * between characters, so we strip null bytes before the emptiness check (we only
 * need existence, not exact distro names).
 * @returns {Promise<boolean>}
 * @since v0.11.0-alpha
 */
async function isWslAvailable() {
  if (_wslAvailable !== null) return _wslAvailable;
  if (_getPlatform() !== 'win32') {
    _wslAvailable = false;
    return false;
  }
  const { ok, stdout } = await run('wsl.exe', ['-l', '-q']);
  _wslAvailable = ok && stdout.split(NUL_CHAR).join('').trim().length > 0;
  return _wslAvailable;
}

/**
 * Enumerate WSL processes and surface matching AI agents as synthetic agents.
 * Windows-only; no-ops to `[]` on other platforms or when WSL is unavailable or
 * `ps` cannot be run (the config-path watch is the documented fallback then).
 * @returns {Promise<Array<Object>>} Synthetic agent objects
 * @since v0.11.0-alpha
 */
async function detectWslAgents() {
  if (_getPlatform() !== 'win32') return [];
  if (!(await isWslAvailable())) return [];
  const { ok, stdout } = await run('wsl.exe', ['-e', 'ps', '-eo', 'pid=,args=']);
  if (!ok || !stdout.trim()) return [];
  return parsePsOutput(stdout);
}

/**
 * Return the most recent enumeration synchronously, kicking off a throttled
 * background refresh when stale. Never blocks the hot scan path — spawning into
 * the WSL VM never delays the batched IPC. First call returns `[]` until the
 * first refresh completes.
 * @returns {Array<Object>} Cached synthetic agents
 * @since v0.11.0-alpha
 */
function getCachedWslAgents() {
  const now = Date.now();
  if (!_refreshing && (_lastRefresh === 0 || now - _lastRefresh > REFRESH_TTL_MS)) {
    _refreshing = true;
    detectWslAgents()
      .then((agents) => {
        _cache = agents;
      })
      .catch(() => {})
      .finally(() => {
        _lastRefresh = Date.now();
        _refreshing = false;
      });
  }
  return _cache;
}

module.exports = {
  isWslAvailable,
  detectWslAgents,
  getCachedWslAgents,
  parsePsOutput,
  WSL_SIGNATURES,
  _setDepsForTest,
  _resetForTest,
};
