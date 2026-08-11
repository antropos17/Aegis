/**
 * @file resource-monitor.js
 * @module main/resource-monitor
 * @description Per-PID CPU/RAM (and optional NVIDIA GPU memory) sampling for
 *   detected AI-agent processes. The OS is queried BY PID — that is the only handle
 *   it offers — but every sample is requested, cached and returned under the caller's
 *   `instanceId`, so a recycled pid can never inherit the previous holder's numbers.
 *   Self-contained: spawns its own metrics queries
 *   via execFile (NOT the platform dispatcher) so integration can be wired later.
 *   CPU is normalized to 0–100 % of total machine per-PID (C-01). GPU memory is
 *   reported ONLY when nvidia-smi exists — else gpu:null + a one-time warning
 *   (fail honest: never fabricate a number).
 * @requires child_process
 * @requires os
 * @requires ./logger
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.10.0
 */
'use strict';

const { execFile } = require('child_process');
const os = require('os');
const logger = require('./logger');

/** @typedef {{ pid: number, cpu: number|null, memMb: number|null, gpu: {memMb: number}|null }} Resource */
/** @typedef {{ cpuRaw: number, memMb: number|null }} CpuMem */
/**
 * What to sample, and WHO it belongs to. `instanceId` is the caller's stamped
 * process-instance key for that pid on the tick it built this target — never
 * re-resolved here, which would be a second lookup able to straddle a pid recycle.
 * `null` is the honest value for a process the caller could not key.
 * @typedef {{ pid: number, instanceId: string|null }} ResourceTarget
 */
/**
 * One sampled process, carrying the identity it was requested under.
 *
 * `instanceId` is the KEY; `pid` rides alongside for display and diagnostics and must
 * not be used to key anything downstream — the OS reissues it. A record with
 * `instanceId: null` is an unattributed sample: it keeps its own pid and stays
 * individually distinguishable, never merged with other null-key records.
 * @typedef {{ instanceId: string|null, pid: number, cpu: number|null, memMb: number|null, gpu: {memMb: number}|null }} AgentResourceRecord
 */

/** ms — short on purpose: CPU is volatile, but this keeps spawns off the per-tick path. */
const RESOURCE_CACHE_TTL = 5000;
const EXEC_TIMEOUT = 8000;
const LOGICAL_CORES = Math.max(1, os.cpus().length);
const BYTES_PER_MB = 1048576;

/** GPU availability: null = unprobed, true/false after the one-time probe. */
let _gpuAvailable = null;
let _gpuWarned = false;
let _gpuProbePromise = null; // memoizes the one-time probe

/**
 * TTL cache, keyed by `instanceId` — NOT by pid.
 *
 * A pid is not an identity: Windows reissues it, so a pid-keyed hit can hand a sample
 * taken under the previous holder of that pid to the process now wearing it, and the
 * two would silently disagree about whose CPU that was. `instanceId` binds the pid to
 * the OS birth time (process-identity.js), so a hit belongs to the instance that asked
 * for it or to nothing.
 *
 * A target with `instanceId: null` is NEITHER read from NOR written to this map: with
 * no key there is no way to prove the pid still names the same process, so it is
 * resampled every call. That costs a spawn on a path that is already spawn-bound and
 * off the critical path — cheaper than inventing distinguishability we do not have.
 * @type {Map<string, {record: AgentResourceRecord, timestamp: number}>}
 */
const _cache = new Map();

/**
 * Injectable command runner — resolves stdout, rejects on spawn error. Tests
 * override this via _setExecForTest so no real process is ever spawned.
 * @type {(cmd: string, argv: string[], opts?: object) => Promise<string>}
 */
let _exec = (cmd, argv, opts) =>
  new Promise((resolve, reject) => {
    execFile(cmd, argv, { timeout: EXEC_TIMEOUT, windowsHide: true, ...opts }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout || '');
    });
  });

/** @internal Override the command runner (tests). */
function _setExecForTest(fn) {
  _exec = fn;
}

/** Injectable logger (real by default). Tests inject a spy via DI, not module-mock
 * — dodges the ESM/CJS interop identity trap. @type {{ warn: Function }} */
let _log = logger;

/** @internal Override the logger (tests). */
function _setLoggerForTest(fn) {
  _log = fn;
}

/** @internal Reset all module state (tests). */
function _resetForTest() {
  _cache.clear();
  _gpuAvailable = null;
  _gpuWarned = false;
  _gpuProbePromise = null;
  _log = logger;
}

/**
 * Normalize a sum-across-cores percent (0–100×N) to 0–100 % of total machine.
 * @param {number} raw - PercentProcessorTime (win32) / ps %cpu, summed across cores
 * @param {number} cores - logical core count
 * @returns {number} 0–100, one decimal place
 */
function _normalizeCpu(raw, cores) {
  if (!Number.isFinite(raw) || raw < 0) return 0;
  const pct = raw / Math.max(1, cores);
  return Math.round(Math.min(100, pct) * 10) / 10;
}

/**
 * Parse Win32_PerfFormattedData_PerfProc_Process JSON (object or array form).
 * @param {string} stdout
 * @returns {Map<number, CpuMem>}
 */
function _parsePerfJson(stdout) {
  const map = new Map();
  const raw = (stdout || '').trim();
  if (!raw) return map;
  let entries;
  try {
    entries = JSON.parse(raw);
  } catch (_) {
    return map;
  }
  if (!Array.isArray(entries)) entries = [entries];
  for (const e of entries) {
    const pid = Number(e && e.IDProcess);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    const cpuRaw = Number(e.PercentProcessorTime);
    const ws = Number(e.WorkingSet);
    map.set(pid, {
      cpuRaw: Number.isFinite(cpuRaw) ? cpuRaw : 0,
      memMb: Number.isFinite(ws) ? Math.round(ws / BYTES_PER_MB) : null,
    });
  }
  return map;
}

/**
 * Parse posix `ps -o pid=,%cpu=,rss=` output (rss in KB).
 * @param {string} stdout
 * @returns {Map<number, CpuMem>}
 */
function _parsePsOutput(stdout) {
  const map = new Map();
  for (const line of (stdout || '').split('\n')) {
    const m = line.trim().match(/^(\d+)\s+([\d.]+)\s+(\d+)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    map.set(pid, { cpuRaw: Number(m[2]) || 0, memMb: Math.round(Number(m[3]) / 1024) });
  }
  return map;
}

/**
 * Parse nvidia-smi compute-apps CSV rows of "pid, used_gpu_memory" (MiB).
 * @param {string} stdout
 * @returns {Map<number, number>} pid → GPU memory in MiB
 */
function _parseGpuCsv(stdout) {
  const map = new Map();
  for (const line of (stdout || '').split('\n')) {
    const m = line.trim().match(/^(\d+)\s*,\s*(\d+)/);
    if (!m) continue;
    const pid = Number(m[1]);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    map.set(pid, Number(m[2]));
  }
  return map;
}

/**
 * One-time probe for an nvidia-smi binary. Sets _gpuAvailable and warns once when
 * absent. Errors/timeouts resolve to unavailable (fail honest); later calls return
 * the memoized result with no extra spawn.
 * @returns {Promise<{available: boolean}>}
 * @since v0.10.0
 */
function probeGpu() {
  if (_gpuProbePromise) return _gpuProbePromise;
  _gpuProbePromise = _exec('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'])
    .then((out) => {
      _gpuAvailable = out.trim().length > 0;
    })
    .catch(() => {
      _gpuAvailable = false;
    })
    .then(() => {
      if (!_gpuAvailable && !_gpuWarned) {
        _gpuWarned = true;
        _log.warn(
          'resource-monitor',
          'GPU metrics degraded: nvidia-smi not found — per-PID GPU memory disabled (gpu:null)',
        );
      }
      return { available: _gpuAvailable === true };
    });
  return _gpuProbePromise;
}

/** @returns {boolean} Whether nvidia-smi GPU detection is currently available. */
function isGpuAvailable() {
  return _gpuAvailable === true;
}

/**
 * Spawn-and-parse CPU/RAM for the given PIDs in a single batched query.
 * Win32 uses PowerShell perf counters; posix uses `ps`. Errors → empty map.
 * @param {number[]} pids
 * @returns {Promise<Map<number, CpuMem>>}
 */
function _fetchCpuMem(pids) {
  if (process.platform === 'win32') {
    const filter = pids.map((p) => `IDProcess=${p}`).join(' OR ');
    const psScript =
      `$ErrorActionPreference="SilentlyContinue";` +
      `Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter '${filter}' ` +
      `| Select-Object IDProcess,PercentProcessorTime,WorkingSet | ConvertTo-Json -Compress`;
    return _exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript])
      .then(_parsePerfJson)
      .catch(() => new Map());
  }
  return _exec('ps', ['-o', 'pid=,%cpu=,rss=', '-p', pids.join(',')])
    .then(_parsePsOutput)
    .catch(() => new Map());
}

/**
 * Per-PID GPU memory via nvidia-smi. Empty map when GPU detection is degraded.
 * @returns {Promise<Map<number, number>>}
 */
function _fetchGpu() {
  if (!isGpuAvailable()) return Promise.resolve(new Map());
  return _exec('nvidia-smi', [
    '--query-compute-apps=pid,used_gpu_memory',
    '--format=csv,noheader,nounits',
  ])
    .then(_parseGpuCsv)
    .catch(() => new Map());
}

/**
 * Drop cache entries older than the TTL once the map grows large (bounded growth).
 * @param {number} now
 */
function _pruneCache(now) {
  if (_cache.size <= 500) return;
  for (const [instanceId, entry] of _cache) {
    if (now - entry.timestamp > RESOURCE_CACHE_TTL) _cache.delete(instanceId);
  }
}

/**
 * Drop anything that is not a sampleable target, and collapse exact duplicates.
 *
 * Dedup is on the (instanceId, pid) PAIR, not on pid alone: two agents sharing a pid
 * under different keys are two requests and both are answered. An exact repeat of the
 * same pair is one process named twice, and nothing distinguishes the two — collapsing
 * it is what the old pid-level `new Set` did and it stays correct.
 * @param {unknown} targets
 * @returns {ResourceTarget[]}
 */
function _normalizeTargets(targets) {
  if (!Array.isArray(targets)) return [];
  const seen = new Set();
  /** @type {ResourceTarget[]} */
  const out = [];
  for (const t of targets) {
    if (!t || typeof t !== 'object') continue;
    const pid = Number(/** @type {{pid: unknown}} */ (t).pid);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    const raw = /** @type {{instanceId: unknown}} */ (t).instanceId;
    const instanceId = typeof raw === 'string' && raw !== '' ? raw : null;
    const dedupKey = `${instanceId ?? ''} ${pid}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    out.push({ pid, instanceId });
  }
  return out;
}

/**
 * Resolve CPU/RAM/GPU for a set of {pid, instanceId} targets, batched and TTL-cached
 * BY INSTANCE. Fresh cache hits are served without spawning; unkeyed targets and stale
 * or missing instances trigger one batched query for their pids.
 *
 * Returns an ARRAY, not a Map, and that is load-bearing: a Map keyed on `instanceId`
 * would put every unattributed record under one `null` key and lose all but the last,
 * while a Map keyed on pid would reintroduce the pid-as-identity the cache migration
 * exists to remove. The array preserves one record per requested target, in request
 * order.
 * @param {ResourceTarget[]} targets
 * @returns {Promise<AgentResourceRecord[]>}
 * @since v0.10.0
 */
async function getResourcesForPids(targets) {
  const wanted = _normalizeTargets(targets);
  if (wanted.length === 0) return [];

  const now = Date.now();
  _pruneCache(now);

  /** @type {Map<ResourceTarget, AgentResourceRecord>} */
  const resolved = new Map();
  /** @type {ResourceTarget[]} */
  const needSample = [];
  for (const target of wanted) {
    const cached = target.instanceId ? _cache.get(target.instanceId) : undefined;
    if (cached && now - cached.timestamp <= RESOURCE_CACHE_TTL) resolved.set(target, cached.record);
    else needSample.push(target);
  }

  if (needSample.length > 0) {
    await probeGpu(); // one-time; memoized no-op after first call
    const pids = [...new Set(needSample.map((t) => t.pid))];
    const [cpuMem, gpu] = await Promise.all([_fetchCpuMem(pids), _fetchGpu()]);

    for (const target of needSample) {
      const cm = cpuMem.get(target.pid);
      const gpuMb = gpu.get(target.pid);
      /** @type {AgentResourceRecord} */
      const record = {
        instanceId: target.instanceId,
        pid: target.pid,
        cpu: cm ? _normalizeCpu(cm.cpuRaw, LOGICAL_CORES) : null,
        memMb: cm ? cm.memMb : null,
        gpu: gpuMb !== undefined ? { memMb: gpuMb } : null,
      };
      // Unkeyed samples are never stored: see the `_cache` note.
      if (target.instanceId) _cache.set(target.instanceId, { record, timestamp: now });
      resolved.set(target, record);
    }
  }

  return wanted.map((t) => /** @type {AgentResourceRecord} */ (resolved.get(t)));
}

/**
 * Resolve CPU/RAM/GPU for a single PID. Returns an all-null resource when the
 * PID cannot be sampled (exited, denied, or unparseable).
 *
 * Unchanged contract: a bare pid in, a pid-shaped {@link Resource} out. It carries no
 * instance key, so — like every unkeyed target — it never reads or writes the cache and
 * samples afresh on each call.
 * @param {number} pid
 * @returns {Promise<Resource>}
 * @since v0.10.0
 */
async function getResourcesByPid(pid) {
  const [record] = await getResourcesForPids([{ pid: Number(pid), instanceId: null }]);
  if (!record) return { pid: Number(pid), cpu: null, memMb: null, gpu: null };
  return { pid: record.pid, cpu: record.cpu, memMb: record.memMb, gpu: record.gpu };
}

module.exports = {
  getResourcesByPid,
  getResourcesForPids,
  probeGpu,
  isGpuAvailable,
  RESOURCE_CACHE_TTL,
  _setExecForTest,
  _setLoggerForTest,
  _resetForTest,
  _parsePerfJson,
  _parsePsOutput,
  _parseGpuCsv,
  _normalizeCpu,
};
