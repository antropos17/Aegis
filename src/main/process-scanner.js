/**
 * @file process-scanner.js
 * @module main/process-scanner
 * @description AI-agent process detection via tasklist and process-set change
 *   detection. Parent-chain and editor annotation are in process-utils.js.
 * @requires fs
 * @requires path
 * @requires child_process
 * @requires ../shared/constants
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.2.0
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { IGNORE_PROCESS_PATTERNS, EDITOR_HOSTS } = require('../shared/constants');
const sensorHealth = require('./sensor-health');
const _platform = require('./platform');
let _listProcesses = _platform.listProcesses;
// Identity-quality inputs, mirrored as overridable locals the same way process-utils.js
// holds `providesStartTime` — so a test can state a platform's identity story without
// pretending to be that platform.
let _providesStartTime = _platform.providesStartTime === true;
/** @type {(() => {state: string}) | null} Test override for the proc-snapshot leaf. */
let _getSnapshotHealth = null;

/** Authoritative process-enumeration sensor id (Block B3). One observation source. */
const PROCESS_SENSOR_ID = 'process';

/**
 * Persistent health for process list enumeration. Survives poll ticks; reset only
 * at module reinit / test reset — never recreated per scan.
 * @type {import('./sensor-health').SensorHealth}
 */
let _processHealth = sensorHealth.createSensorHealth(PROCESS_SENSOR_ID);

/**
 * @param {unknown} err
 * @returns {string}
 */
function healthErrorMessage(err) {
  if (err == null) return 'unknown-error';
  if (typeof err === 'string') return err.slice(0, 200);
  const msg = err && err.message != null ? String(err.message) : String(err);
  return msg.slice(0, 200);
}

/**
 * Plain serializable snapshot for future B6 — callers must not mutate.
 * @returns {object}
 * @since 0.11.0
 */
function getProcessSensorHealth() {
  return sensorHealth.toPlain(_processHealth);
}

/**
 * Whether the latest process enumeration produced a trustworthy agent population.
 * Compatibility: when false, `agents: []` means unknown, not confirmed empty fleet.
 * @returns {boolean}
 * @since 0.11.0
 */
function isProcessPopulationReliable() {
  return _processHealth.state === sensorHealth.SENSOR_HEALTH_STATE.HEALTHY;
}

/**
 * Read the `proc-snapshot` leaf's state without going through the platform façade.
 *
 * `platform/win32.js` requires `process-snapshot.js` but does not re-export
 * `getSnapshotHealth` — that re-export is gap F in the app-state design and is not
 * part of this pass. The façade is tried FIRST so this fallback deletes itself the
 * day F lands, and the submodule is required lazily so a POSIX host never loads the
 * sidecar client for a question it has already answered via `providesStartTime`.
 * @returns {string|null} The leaf state, or null when it cannot be read at all.
 */
function readSnapshotState() {
  if (_getSnapshotHealth) return _getSnapshotHealth().state;
  if (typeof _platform.getSnapshotHealth === 'function') {
    return _platform.getSnapshotHealth().state;
  }
  try {
    return require('./platform/process-snapshot').getSnapshotHealth().state;
  } catch (_) {
    // No snapshot module on this host — identity carries no witness.
    return null;
  }
}

/**
 * Identity strength for the keys `identify()` is currently able to form.
 *
 * Annotation only: §3 of the design is explicit that nothing gates on this value.
 * The socket→agent and holder→agent matches are by PID, and a birth witness plays
 * no part in a PID match — so a degraded witness must never be allowed to suppress
 * an observation.
 *
 * STARTING (no snapshot taken yet) maps to `unknown` with the same reasoning as
 * FAILED: no witness has been read, so `identify()` has none to key on.
 * @returns {'witnessed'|'birth-time'|'unknown'}
 * @since 0.12.0
 */
function getIdentityQuality() {
  // darwin/linux publish no birth time at all → identify() yields "<pid>:u".
  if (_providesStartTime !== true) return 'unknown';
  const state = readSnapshotState();
  if (state === sensorHealth.SENSOR_HEALTH_STATE.HEALTHY) return 'witnessed';
  // cim-fallback: _witnessOf drops to startTimeMs, so keys still form.
  if (state === sensorHealth.SENSOR_HEALTH_STATE.DEGRADED) return 'birth-time';
  return 'unknown';
}

/**
 * @typedef {Object} ProcessCapabilities
 * @property {'STARTING'|'HEALTHY'|'DEGRADED'|'FAILED'} populationState - the `process`
 *   LEAF's state, never a plane roll-up
 * @property {boolean} populationReliable - true iff populationState === 'HEALTHY'
 * @property {number|null} populationAsOf - the leaf's lastSuccessAt: how old the list is
 * @property {'witnessed'|'birth-time'|'unknown'} identityQuality - annotation, gates nothing
 */

/**
 * The capability contract dependants consume — and the ONLY thing they may consume
 * to decide whether an agent-scoped observation is allowed to run.
 *
 * Deliberately not the process PLANE enum: that value is a display roll-up, safe by
 * accident for today's single cause of plane-DEGRADED and silently wrong the moment
 * the `process` leaf itself can degrade. Dependent correctness must not be
 * reverse-engineered out of a display value (design §3).
 * @returns {ProcessCapabilities}
 * @since 0.12.0
 */
function getProcessCapabilities() {
  return {
    populationState: /** @type {'STARTING'|'HEALTHY'|'DEGRADED'|'FAILED'} */ (_processHealth.state),
    populationReliable: _processHealth.state === sensorHealth.SENSOR_HEALTH_STATE.HEALTHY,
    populationAsOf: _processHealth.lastSuccessAt,
    identityQuality: getIdentityQuality(),
  };
}

/**
 * Record a hard process-scan failure that escaped scanProcesses (e.g. non-EPERM
 * throw caught by scan-loop). Does not fabricate agents.
 * @param {unknown} err
 * @returns {void}
 * @since 0.11.0
 */
function noteProcessScanHardFailure(err) {
  const now = Date.now();
  _processHealth = sensorHealth.markFailed(_processHealth, now, {
    error: healthErrorMessage(err),
    detail: 'hard-scan-failure',
  });
}

/** @internal Override platform functions (for tests). */
function _setPlatformForTest(overrides) {
  if (overrides.listProcesses) _listProcesses = overrides.listProcesses;
  if (typeof overrides.providesStartTime === 'boolean') {
    _providesStartTime = overrides.providesStartTime;
  }
  if (overrides.getSnapshotHealth) _getSnapshotHealth = overrides.getSnapshotHealth;
}
/** @internal Reset state (for tests). */
function _resetForTest() {
  lastProcessPidSet = '';
  permissionDeniedScans = 0;
  _processHealth = sensorHealth.createSensorHealth(PROCESS_SENSOR_ID);
  _providesStartTime = _platform.providesStartTime === true;
  _getSnapshotHealth = null;
}

let _agentDb = null;
let _aiAgents = null;

/** @returns {void} Lazily parse agent-database.json on first use. */
function _ensureAgentDb() {
  if (_agentDb) return;
  _agentDb = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'shared', 'agent-database.json'), 'utf-8'),
  );
  _aiAgents = _agentDb.agents.map((a) => ({ name: a.displayName, patterns: a.names }));
}

/** Set of editor host process names (lowercased) for fast lookup */
const EDITOR_HOST_SET = new Set(EDITOR_HOSTS.map((h) => h.toLowerCase()));

let lastProcessPidSet = '';
let permissionDeniedScans = 0;

const knownHandles = new Map();
const activityLog = [];
const monitoringStarted = Date.now();
let peakAgents = 0;
const uniqueAgentNames = new Set();

let _trackSeenAgent = null;

/**
 * Initialise with external dependencies.
 * @param {{ trackSeenAgent: Function }} deps
 * @returns {void}
 * @since v0.1.0
 */
function init(deps) {
  _trackSeenAgent = deps.trackSeenAgent;
}

/**
 * Scan running processes via tasklist and match against AI_AGENTS.
 * Editor hosts (VS Code etc.) are skipped themselves, but their child
 * processes are scanned — matched children get parentEditor set.
 * @returns {Promise<{agents: Array, changed: boolean}>}
 * @since v0.2.0
 */
async function scanProcesses() {
  _ensureAgentDb();
  let processes;
  // A scan is "reliable" only when the process list was actually enumerated.
  // A permission-denied scan returns an empty list that must NOT be read as
  // "all agents exited" — the session tracker uses this flag to ignore it.
  // Health is authoritative; `reliable` remains compatibility metadata and must
  // never be false while health is HEALTHY (and never true while FAILED).
  let reliable = true;
  const now = Date.now();
  try {
    processes = await _listProcesses();
    permissionDeniedScans = 0;
  } catch (err) {
    const code = err.code || '';
    const msg = (err.message || '').toLowerCase();
    if (code === 'EPERM' || code === 'EACCES' || msg.includes('access is denied')) {
      // B-S01: full permission denial → no trustworthy population. Compatibility
      // shape stays { agents: [], reliable: false }; health = FAILED (not empty fleet).
      permissionDeniedScans++;
      processes = [];
      reliable = false;
      _processHealth = sensorHealth.markFailed(_processHealth, now, {
        error: healthErrorMessage(err),
        detail: 'permission-denied',
      });
      // Still run the empty path below for pid-set / peakAgents bookkeeping so
      // callers keep a stable return shape. Do not markHealthy on this path.
    } else {
      // Hard provider failure: leave the health write to noteProcessScanHardFailure,
      // called from the catch that in scan-loop's doProcessScan encloses ONLY this call,
      // so we do not double-increment consecutiveFailures. That catch is the boundary —
      // a throw from anything downstream of this return value reaches a different handler
      // and writes no process health at all.
      throw err;
    }
  }
  const detected = [];
  for (const proc of processes) {
    const procName = proc.name.toLowerCase();
    if (IGNORE_PROCESS_PATTERNS.some((p) => procName.includes(p))) continue;
    if (EDITOR_HOST_SET.has(procName)) continue;
    for (const agent of _aiAgents) {
      if (agent.patterns.some((p) => procName === p.toLowerCase())) {
        detected.push({
          agent: agent.name,
          process: proc.name,
          pid: proc.pid,
          status: 'running',
          category: 'ai',
        });
        break;
      }
    }
  }
  const seen = new Set();
  const unique = detected.filter((d) => {
    if (seen.has(d.pid)) return false;
    seen.add(d.pid);
    return true;
  });
  if (unique.length > peakAgents) peakAgents = unique.length;
  unique.forEach((a) => {
    uniqueAgentNames.add(a.agent);
    if (_trackSeenAgent) _trackSeenAgent(a.agent);
  });
  const pidSetKey = unique
    .map((u) => u.pid)
    .sort()
    .join(',');
  const changed = pidSetKey !== lastProcessPidSet;
  lastProcessPidSet = pidSetKey;
  // Valid enumeration (including empty fleet) → HEALTHY. Cardinality is not health.
  // Permission-denied path already marked FAILED and left reliable false.
  if (reliable) {
    _processHealth = sensorHealth.markHealthy(_processHealth, now);
  }
  return { agents: unique, changed, reliable };
}

module.exports = {
  get AI_AGENTS() {
    _ensureAgentDb();
    return _aiAgents;
  },
  get agentDb() {
    _ensureAgentDb();
    return _agentDb;
  },
  init,
  scanProcesses,
  getProcessSensorHealth,
  isProcessPopulationReliable,
  getProcessCapabilities,
  noteProcessScanHardFailure,
  PROCESS_SENSOR_ID,
  _setPlatformForTest,
  _resetForTest,
  knownHandles,
  activityLog,
  monitoringStarted,
  get peakAgents() {
    return peakAgents;
  },
  set peakAgents(v) {
    peakAgents = v;
  },
  uniqueAgentNames,
  get permissionDeniedScans() {
    return permissionDeniedScans;
  },
};
