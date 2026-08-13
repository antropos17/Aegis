/**
 * @file platform/process-snapshot.js
 * @module main/platform/process-snapshot
 * @description Chooses which provider observes the Windows process table on this
 *   pass, and turns whatever answered into the ONE map shape process-utils.js
 *   already consumes.
 *
 *   The chain, in order:
 *     1. the snapshot sidecar (one NtQuerySystemInformation call per snapshot);
 *     2. the existing CIM `Win32_Process` observation — EMERGENCY FALLBACK ONLY,
 *        passed in by the caller so this module never requires win32.js back and
 *        closes a require cycle;
 *     3. nothing — an empty map, which degrades identity to `<pid>:u` and proves
 *        no cached entry. Never a stale generation inherited from an earlier pass.
 *
 *   WHY THE SOURCE IS LOGGED ON EVERY PASS, not on transitions: if the binary is
 *   missing or its path resolves wrong, `auto` silently serves CIM forever while
 *   every test stays green and the block looks shipped. One `mod='perf'` line per
 *   observation naming the source is what makes that visible, and the benchmark
 *   refuses to report a speedup unless each sample names its own source.
 *
 *   Rollout flag `AEGIS_PROC_SNAPSHOT`, read once at load:
 *     - `auto` (default) — sidecar, then CIM, then nothing;
 *     - `cim` — kill switch: the sidecar is never spawned, behaviour is exactly
 *       what it was before this module existed;
 *     - `strict` — sidecar only, no CIM: fail-honest, so a benchmark or a test can
 *       prove that what it measured really was the sidecar.
 *
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.12.0
 */
'use strict';

const logger = require('../logger');
const sensorHealth = require('../sensor-health');
const defaultClient = require('./proc-snapshot-client');

/** @type {string} Sensor id for the health record this module owns. */
const SENSOR_ID = 'proc-snapshot';

/** @type {readonly string[]} */
const MODES = ['auto', 'cim', 'strict'];

/**
 * Milliseconds between the FILETIME epoch (1601-01-01) and the Unix epoch. The
 * conversion runs HERE and only here: the sidecar reports raw 100 ns ticks and
 * never converts, so there is a single place where the `startTime` millisecond
 * contract is produced.
 * @type {bigint}
 */
const FILETIME_EPOCH_OFFSET_MS = 11644473600000n;

let _client = defaultClient;
let _mode = _readMode();
/** @type {import('../sensor-health').SensorHealth} */
let _health = sensorHealth.createSensorHealth(SENSOR_ID);
/** @type {string|null} Source that served the previous pass. */
let _lastSource = null;
let _sourceTransitions = 0;

/**
 * @returns {string} the validated rollout mode; an unknown value is not obeyed
 *   silently — it warns and falls back to `auto`.
 */
function _readMode() {
  const raw = String(process.env.AEGIS_PROC_SNAPSHOT || 'auto')
    .trim()
    .toLowerCase();
  if (MODES.includes(raw)) return raw;
  logger.warn(
    'proc-snapshot',
    `Unknown AEGIS_PROC_SNAPSHOT value "${raw}" — using "auto" (${MODES.join('|')})`,
  );
  return 'auto';
}

/**
 * Convert a process creation time in 100 ns FILETIME ticks to epoch milliseconds.
 *
 * Parsed as BigInt, never as a Number: ticks run around 1.34e17, well past 2^53,
 * so `Number(ticks)` would already have dropped low digits before any division —
 * and a witness that lost its low digits compares equal across generations. The
 * QUOTIENT is small enough to be an exact Number, which is what keeps the frozen
 * `pid:startTime(ms)` contract intact.
 * @param {string} ticks - decimal digits, as they arrive on the wire.
 * @returns {number|null} epoch-ms, or null when the value is unusable (honest).
 */
function ticksToEpochMs(ticks) {
  if (typeof ticks !== 'string' || !/^\d+$/.test(ticks)) return null;
  const ms = Number(BigInt(ticks) / 10000n - FILETIME_EPOCH_OFFSET_MS);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/**
 * The generation witness for one snapshot record, and where it came from.
 *
 * The kernel SequenceNumber wins when the OS supplies it — it is the documented
 * PID-reuse detector and it separates two instances that share a birth
 * millisecond. Creation-time ticks are the fallback: still finer than the stored
 * epoch-ms, so still a stronger proof than the identity key carries.
 * @param {{seq?: string, ct?: string}} proc
 * @returns {{witness: string, witnessSource: string}|null}
 */
function _witnessOfRecord(proc) {
  if (typeof proc.seq === 'string' && /^\d+$/.test(proc.seq)) {
    return { witness: proc.seq, witnessSource: 'sequence' };
  }
  if (typeof proc.ct === 'string' && /^\d+$/.test(proc.ct)) {
    return { witness: proc.ct, witnessSource: 'createTime100ns' };
  }
  return null;
}

/**
 * Turn a sidecar snapshot into the parent-process map shape.
 * @param {Array<Object>} procs
 * @returns {Map<number, {name: string, ppid: number, startTime: number|null,
 *   witness: string|null, witnessSource: string|null}>}
 */
function _mapFromSnapshot(procs) {
  const map = new Map();
  for (const proc of procs) {
    if (!proc || !Number.isInteger(proc.pid) || proc.pid <= 0) continue;
    const witness = _witnessOfRecord(proc);
    map.set(proc.pid, {
      name: typeof proc.name === 'string' ? proc.name : '',
      ppid: Number.isInteger(proc.ppid) ? proc.ppid : 0,
      startTime: ticksToEpochMs(proc.ct),
      witness: witness ? witness.witness : null,
      witnessSource: witness ? witness.witnessSource : null,
    });
  }
  return map;
}

/**
 * Record which provider served this pass, and make a change of provider visible.
 * A flapping sidecar invalidates every cached witness on each flip — the right,
 * fail-safe direction, but expensive — so the count exists to make that legible
 * instead of mysterious.
 * @param {string} source
 * @returns {void}
 */
function _trackSource(source) {
  if (_lastSource !== null && _lastSource !== source) {
    _sourceTransitions++;
    logger.info('proc-snapshot', `Snapshot source changed ${_lastSource} → ${source}`, {
      transitions: _sourceTransitions,
    });
  }
  _lastSource = source;
}

/**
 * Observe the process table once, through the best provider available.
 * @param {Object} [opts]
 * @param {function(): Promise<Map<number, Object>>} [opts.cimFallback] - the
 *   emergency CIM observation. Injected by win32.js; its entries carry no witness,
 *   and process-utils derives one from the epoch-ms birth time instead.
 * @param {number} [opts.timeoutMs] - deadline for the sidecar request.
 * @returns {Promise<Map<number, Object>>} pid → {name, ppid, startTime, …}. Empty
 *   when nothing could observe — never a remembered map.
 * @since v0.12.0
 */
async function getParentProcessMap(opts = {}) {
  const cimFallback = typeof opts.cimFallback === 'function' ? opts.cimFallback : null;
  const t0 = performance.now();
  let map = null;
  let source = 'none';
  let sidecarError = null;

  if (_mode !== 'cim') {
    try {
      const res = await _client.requestSnapshot({ timeoutMs: opts.timeoutMs });
      map = _mapFromSnapshot(res.procs);
      source = res.source;
    } catch (err) {
      sidecarError = err.message;
      map = null;
    }
  }

  if (map === null && _mode !== 'strict' && cimFallback) {
    map = await cimFallback();
    source = 'cim';
  }
  if (map === null) {
    map = new Map();
    source = 'none';
  }

  const now = Date.now();
  if (map.size === 0) {
    // A machine always has processes, so an empty map is a failed observation,
    // whichever provider produced it. The CIM path resolves empty on error too.
    _health = sensorHealth.markFailed(_health, now, {
      error: sidecarError || 'no provider produced a process map',
      detail: source,
    });
  } else if (source === 'cim') {
    _health = sensorHealth.markDegraded(_health, now, {
      error: sidecarError || 'sidecar not used',
      detail: 'cim-fallback',
    });
  } else {
    _health = sensorHealth.markHealthy(_health, now, { detail: source });
  }

  _trackSource(source);
  logger.debug('perf', 'snapshot', {
    source,
    ms: Math.round(performance.now() - t0),
    procs: map.size,
    mode: _mode,
  });
  return map;
}

/**
 * @returns {import('../sensor-health').SensorHealth} plain health record. Not on
 *   IPC in this block — read by tests and by the operational log.
 */
function getSnapshotHealth() {
  return sensorHealth.toPlain(_health);
}

/** @returns {string} the active rollout mode. */
function getMode() {
  return _mode;
}

/** @returns {{lastSource: string|null, transitions: number}} */
function getSourceStats() {
  return { lastSource: _lastSource, transitions: _sourceTransitions };
}

/** @internal Swap the sidecar client (for tests). */
function _setClientForTest(client) {
  _client = client;
}

/** @internal Restore the real client and re-read the rollout flag. */
function _resetForTest() {
  _client = defaultClient;
  _mode = _readMode();
  _health = sensorHealth.createSensorHealth(SENSOR_ID);
  _lastSource = null;
  _sourceTransitions = 0;
}

module.exports = {
  SENSOR_ID,
  ticksToEpochMs,
  getParentProcessMap,
  getSnapshotHealth,
  getMode,
  getSourceStats,
  _setClientForTest,
  _resetForTest,
};
