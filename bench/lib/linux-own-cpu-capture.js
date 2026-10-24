'use strict';
const proc = require('./linux-own-cpu-proc');
const { runFixedWork, WORK } = require('./linux-own-cpu-work');
const safe = (v) => Number.isSafeInteger(v) && v >= 0;
/** Build a two-record CPU wrapper around the actual sampler seam. @param {object} d Closed dependencies. @param {AbortSignal} [signal] Cancellation. @returns {object} Checked clock, CPU wrapper and retained observations. @since unreleased */
function captureCpu(d, signal) {
  const windows = [];
  let clockReason = null,
    last = null;
  let workload = {
    state: 'not-started',
    reason: 'baseline-unavailable',
    completedIterations: 0,
    checksum: WORK.seed,
    beforeNs: null,
    afterNs: null,
  };
  function now() {
    if (clockReason) throw Error('linux-own-cpu-clock-unavailable');
    try {
      const value = d.nowNs();
      if (typeof value !== 'bigint' || value < 0n || value >= 10n ** 32n) throw Error();
      if (last !== null && value < last) {
        clockReason = 'clock-regressed';
        throw Error();
      }
      last = value;
      return value;
    } catch {
      clockReason ??= 'clock-unavailable';
      throw Error('linux-own-cpu-clock-unavailable');
    }
  }
  const time = () => {
    try {
      return now().toString();
    } catch {
      return null;
    }
  };
  function reference() {
    const beforeNs = time();
    if (beforeNs === null || signal?.aborted) return null;
    let value;
    try {
      value = proc.parseSelfStat(d.readStat(), process.pid);
    } catch {
      return null;
    }
    const afterNs = time();
    if (afterNs === null) return null;
    return { ...value, beforeNs, afterNs, closed: d.readStat === proc.readSelfStat ? true : null };
  }
  function cpuUsage() {
    if (windows.length >= 2) throw Error('linux-own-cpu-reference-limit');
    const row = {
      index: windows.length,
      before: reference(),
      api: { beforeNs: time(), afterNs: null, userUs: null, systemUs: null, reason: null },
      after: null,
      reason: null,
    };
    let threw = false;
    if (signal?.aborted) row.api.reason = 'cancelled';
    else if (row.api.beforeNs === null) row.api.reason = clockReason;
    else {
      try {
        const value = d.cpuUsage();
        const descriptors =
          value && [Object.prototype, null].includes(Object.getPrototypeOf(value))
            ? Object.getOwnPropertyDescriptors(value)
            : {};
        const user = descriptors.user?.value,
          system = descriptors.system?.value;
        if (!safe(user) || !safe(system)) row.api.reason = 'invalid-reading';
        else {
          row.api.userUs = user;
          row.api.systemUs = system;
        }
      } catch {
        row.api.reason = 'api-unavailable';
        threw = true;
      }
    }
    row.api.afterNs = time();
    row.api.reason ??= row.api.afterNs === null ? clockReason : null;
    row.after = reference();
    row.reason =
      clockReason ??
      (signal?.aborted
        ? 'cancelled'
        : !row.before || !row.after
          ? 'proc-stat-unavailable'
          : row.api.reason);
    windows.push(row);
    if (row.index === 0 && row.reason === null) workload = runFixedWork(now, signal);
    if (threw) throw Error('linux-own-cpu-api-unavailable');
    return { user: row.api.userUs, system: row.api.systemUs };
  }
  return {
    now,
    cpuUsage,
    windows,
    get workload() {
      return workload;
    },
    get clockReason() {
      return clockReason;
    },
  };
}
module.exports = { captureCpu };
