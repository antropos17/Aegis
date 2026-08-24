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
const sensorHealth = require('./sensor-health');

/** @type {string} A single NUL byte (avoids a control char in a regex literal) */
const NUL_CHAR = String.fromCharCode(0);

let _execFile = execFile;
let _getPlatform = () => process.platform;

/** WSL-inner agent discovery sensor id (Block B3, finding B-S12). */
const WSL_SENSOR_ID = 'wsl';

/**
 * The record this platform is entitled to. Off win32 there is no WSL to observe, ever,
 * so the leaf is UNSUPPORTED and stays out of the global worst-of — the same shape
 * `fs-rm` takes on a platform with no Restart Manager.
 * @returns {import('./sensor-health').SensorHealth}
 */
function createInitialHealth() {
  return _getPlatform() === 'win32'
    ? sensorHealth.createSensorHealth(WSL_SENSOR_ID)
    : sensorHealth.createUnsupported(WSL_SENSOR_ID, {
        detail: 'platform-no-wsl',
        now: Date.now(),
      });
}

/**
 * Persistent health for WSL enumeration. Lifetime = module lifetime; reset only by
 * {@link _resetForTest}, never recreated per refresh.
 * @type {import('./sensor-health').SensorHealth}
 */
let _health = createInitialHealth();

/**
 * Plain serializable snapshot for the app-health composer — callers must not mutate.
 * @returns {object}
 * @since 0.13.0
 */
function getWslSensorHealth() {
  return sensorHealth.toPlain(_health);
}

/**
 * Short, secret-free token for a failed spawn: the error CODE or the kill reason,
 * never the message — a `wsl.exe` message can quote a distro name and a path.
 * @param {unknown} err
 * @returns {string}
 */
function errorCode(err) {
  const e = /** @type {{code?: unknown, killed?: unknown}} */ (err || {});
  if (typeof e.code === 'string' && e.code.length > 0) return e.code;
  if (typeof e.code === 'number') return `exit${e.code}`;
  if (e.killed === true) return 'timeout';
  return 'unknown';
}

/**
 * Whether the binary RAN and reported a condition, as opposed to never producing a
 * verdict. A numeric `code` is an exit status; a string `code` (ENOENT, EACCES) or
 * none at all (a timeout kill) means the spawn itself failed.
 * @param {unknown} err
 * @returns {boolean}
 */
function ranButFailed(err) {
  return typeof (err && /** @type {{code?: unknown}} */ (err).code) === 'number';
}

/**
 * @internal Override dependencies (for tests).
 * @param {{ execFile?: Function, platform?: string }} overrides
 */
function _setDepsForTest(overrides) {
  if (overrides.execFile) _execFile = overrides.execFile;
  if (overrides.platform) {
    _getPlatform = () => overrides.platform;
    // UNSUPPORTED is a statement ABOUT the platform. A test that declares a different
    // one has to get the record that platform would have had, or the first mark* call
    // lands on a state that refuses it.
    _health = createInitialHealth();
  }
}

/** @internal Reset to real dependencies and clear all caches (for tests). */
function _resetForTest() {
  _execFile = execFile;
  _getPlatform = () => process.platform;
  _wslAvailable = null;
  _cache = [];
  _lastRefresh = 0;
  _refreshing = false;
  _health = createInitialHealth();
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
 * Run an executable, resolving `{ ok, stdout, err }`. Never rejects.
 *
 * The rejection is CARRIED, not swallowed: the callers have to tell "wsl.exe answered
 * that there is nothing here" from "wsl.exe never answered", and one boolean cannot.
 * @param {string} cmd
 * @param {string[]} args
 * @returns {Promise<{ ok: boolean, stdout: string, err: unknown }>}
 */
function run(cmd, args) {
  return new Promise((resolve) => {
    _execFile(cmd, args, { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err) {
        resolve({ ok: false, stdout: '', err });
        return;
      }
      resolve({
        ok: true,
        stdout: typeof stdout === 'string' ? stdout : (stdout || '').toString(),
        err: null,
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
  const { ok, stdout, err } = await run('wsl.exe', ['-l', '-q']);
  if (!ok) {
    if (errorCode(err) === 'ENOENT' || ranButFailed(err)) {
      // Two DEFINITE answers, one state. ENOENT: no `wsl.exe` on this machine at all.
      // A numeric exit status: `wsl.exe` ran and refused, and on `-l -q` that is "no
      // installed distributions" — the stock Windows shape, since the binary ships in
      // System32 whether or not WSL was ever set up. Nothing exists to enumerate BY
      // DESIGN, so the leaf is UNSUPPORTED and leaves the worst-of, rather than holding
      // the whole app DEGRADED over a condition that is not a fault.
      _wslAvailable = false;
      _health = sensorHealth.markUnsupported(_health, Date.now(), {
        detail: errorCode(err) === 'ENOENT' ? 'wsl-not-installed' : 'wsl-no-distro',
      });
      return false;
    }
    // The spawn produced no verdict: a timeout kill, EACCES, EAGAIN. NOT cached — a
    // cached `false` is what turned one bad probe into a blind spot for the rest of the
    // process life, and the 60s refresh will ask again. DEGRADED, because for as long
    // as this lasts a WSL-hosted agent would be missing from the fleet unannounced.
    _health = sensorHealth.markDegraded(_health, Date.now(), {
      error: `wsl-probe-failed:${errorCode(err)}`,
      detail: 'wsl-probe-failed',
    });
    return false;
  }
  const hasDistro = stdout.split(NUL_CHAR).join('').trim().length > 0;
  _wslAvailable = hasDistro;
  if (!hasDistro) {
    // `wsl.exe` answered with an empty list: installed, no distro. Definite, permanent
    // for this process life, and not a fault.
    _health = sensorHealth.markUnsupported(_health, Date.now(), { detail: 'wsl-no-distro' });
  }
  // A distro exists: availability is not the observation this sensor names, so no
  // success is claimed here. `detectWslAgents` performs the enumeration and writes it.
  return hasDistro;
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
  const { ok, stdout, err } = await run('wsl.exe', ['-e', 'ps', '-eo', 'pid=,args=']);
  if (!ok) {
    // WSL is installed and its process list was not read, so an agent running inside the
    // distro is invisible for this cycle. DEGRADED, not FAILED: the passive config-path
    // watch on `~/.grok-build` / `~/.opencode` still stands, and it belongs to a
    // different sensor. Not UNSUPPORTED either — the distro is right there; only the
    // look inside failed, and `no ps in this image` is a blind spot, not a design.
    _health = sensorHealth.markDegraded(_health, Date.now(), {
      error: `wsl-enumeration-unavailable:${errorCode(err)}`,
      detail: 'wsl-enumeration-unavailable',
    });
    return [];
  }
  if (!stdout.trim()) {
    // `ps` exited 0 and printed nothing. A live distro lists at least the `ps` process
    // doing the asking, so an empty page is an unread list, never an empty one — the
    // same reasoning the `process` leaf applies to an empty process table.
    _health = sensorHealth.markDegraded(_health, Date.now(), {
      error: 'wsl-enumeration-empty',
      detail: 'wsl-enumeration-empty',
    });
    return [];
  }
  const detected = parsePsOutput(stdout);
  // The distro's process list was read. An empty `detected` here IS a confirmed "no
  // WSL-hosted agents running".
  _health = sensorHealth.markHealthy(_health, Date.now());
  return detected;
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
      .catch((err) => {
        // `detectWslAgents` writes its own record on every path it can reach, so an
        // escape to here is a throw from outside that logic — this refresh performed no
        // enumeration and the cache below is older than it looks. UNSUPPORTED is left
        // alone: there was nothing to observe, and `markFailed` refuses that state.
        if (_health.state === sensorHealth.SENSOR_HEALTH_STATE.UNSUPPORTED) return;
        _health = sensorHealth.markFailed(_health, Date.now(), {
          error: `refresh-threw:${errorCode(err)}`,
          detail: 'refresh-threw',
        });
      })
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
  getWslSensorHealth,
  WSL_SENSOR_ID,
  parsePsOutput,
  WSL_SIGNATURES,
  _setDepsForTest,
  _resetForTest,
};
