'use strict';
const path = require('node:path');
const os = require('node:os');
const sampler = require('./self-resource-sampler');
const proc = require('./linux-own-cpu-proc');
const storage = require('./linux-own-cpu-storage');
const { captureCpu } = require('./linux-own-cpu-capture');
const { MODEL, evaluateCpuReference } = require('./linux-own-cpu-model');
const { WORK } = require('./linux-own-cpu-work');
const FLAGS = Object.freeze({
  sourceAuthenticated: false,
  measurementAccepted: false,
  calibrationAccepted: false,
  w8Accepted: false,
});
const invalid = () => {
  throw Error('linux-own-cpu-input-invalid');
};
function closed(value, keys) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const copy = {};
  for (const key of Reflect.ownKeys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== 'string' ||
      !keys.includes(key) ||
      !d.enumerable ||
      !Object.hasOwn(d, 'value')
    )
      invalid();
    copy[key] = d.value;
  }
  return copy;
}
/** Validate closed caller inputs before filesystem, preflight or observation. @param {object} options Required runId/out and optional signal. @param {object} [deps] Synchronous instrumentation. @returns {object} Copied inputs. @since unreleased */
function validateOptions(options, deps = {}) {
  try {
    const o = closed(options, ['runId', 'out', 'signal']);
    const d = closed(deps, [
      'platform',
      'nowNs',
      'cpuUsage',
      'readStat',
      'getconf',
      'rss',
      'setTimer',
      'clearTimer',
      'kernelVersion',
      'arch',
    ]);
    if (
      typeof o.runId !== 'string' ||
      !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(o.runId) ||
      typeof o.out !== 'string' ||
      !o.out ||
      o.out.length > 4096 ||
      o.out.includes('\0') ||
      /^[/\\]{2}/.test(o.out) ||
      (o.signal !== undefined && !(o.signal instanceof AbortSignal)) ||
      Object.values(d).some((v) => typeof v !== 'function')
    )
      invalid();
    o.out = path.resolve(o.out);
    if (o.out === path.parse(o.out).root) invalid();
    return { options: o, deps: d };
  } catch {
    invalid();
  }
}
function metadata(fn) {
  try {
    const v = fn();
    return typeof v === 'string' && /^[A-Za-z0-9._+-]{1,128}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}
/** Retain one fixed Linux SELF CPU corroboration under a predeclared quantization model.
 * @param {object} options Required safe runId, fresh out; optional genuine AbortSignal.
 * @param {object} [deps] Closed synchronous test readers/timers; never supplies PID/path/command/workload.
 * @returns {Promise<object>} Fixed exitCode and sanitized final candidate receipt.
 * @since unreleased
 */
async function runLinuxOwnCpuReference(options, deps = {}) {
  const checked = validateOptions(options, deps),
    o = checked.options;
  const collectionMode = Object.keys(checked.deps).length
    ? 'injected-test-seams'
    : 'linux-own-defaults';
  const d = {
    platform: () => process.platform,
    nowNs: () => process.hrtime.bigint(),
    cpuUsage: () => process.cpuUsage(),
    readStat: proc.readSelfStat,
    getconf: proc.getClockTicks,
    rss: () => process.memoryUsage.rss(),
    setTimer: setTimeout,
    clearTimer: clearTimeout,
    kernelVersion: () => os.release(),
    arch: () => process.arch,
    ...checked.deps,
  };
  const receipt = {
    version: 'linux-own-cpu-final/1',
    runId: o.runId,
    scope: 'calling-node-process-cpu',
    collectionMode,
    state: 'pending',
    reason: null,
    finalPublication: 'not-self-attested',
    rssAssessment: 'not-qualified',
    platform: {
      family: 'unsupported',
      kernelVersion: null,
      arch: null,
      kernelModelQualified: false,
    },
    clockTicksPerSecond: null,
    planSha256: null,
    rawSha256: null,
    windowsSha256: null,
    acquisition: null,
    comparison: null,
    workload: null,
    sources: { state: 'pending', after: null },
    files: [],
    ...FLAGS,
  };
  let before;
  try {
    if (d.platform() !== 'linux')
      return {
        exitCode: 7,
        receipt: { ...receipt, state: 'unsupported', reason: 'unsupported-platform' },
      };
  } catch {
    return {
      exitCode: 7,
      receipt: { ...receipt, state: 'unavailable', reason: 'platform-unavailable' },
    };
  }
  receipt.platform = {
    family: 'linux',
    kernelVersion: metadata(d.kernelVersion),
    arch: metadata(d.arch),
    kernelModelQualified: false,
  };
  try {
    receipt.clockTicksPerSecond = proc.parseClockTicks(d.getconf());
    before = storage.inventory();
  } catch {
    return {
      exitCode: 7,
      receipt: { ...receipt, state: 'unavailable', reason: 'preflight-or-source-unavailable' },
    };
  }
  let writer;
  try {
    writer = storage.createStorage(o.out);
  } catch {
    return {
      exitCode: 5,
      receipt: { ...receipt, state: 'output-refused', reason: 'output-refused' },
    };
  }
  const plan = {
    version: 'linux-own-cpu-plan/1',
    runId: o.runId,
    scope: 'calling-node-process-cpu',
    collectionMode,
    platform: receipt.platform,
    clockTicksPerSecond: receipt.clockTicksPerSecond,
    clock: 'process.hrtime.bigint-arbitrary-domain',
    stat: {
      source: '/proc/self/stat',
      fields: [14, 15, 22],
      maxBytes: 16384,
      identity: 'same-self-start-ticks-not-birth-authority',
    },
    getconf: {
      source: '/usr/bin/getconf CLK_TCK',
      timeoutMs: 1000,
      maxBytes: 128,
      inheritedEnvironment: false,
    },
    sampler: { durationMs: 2000, maxSamples: 2, maxOutputBytes: 16384 },
    model: MODEL,
    workload: WORK,
    rssAssessment: 'not-qualified',
    sources: before,
    limits: { totalBytes: 131072, files: storage.FILES },
    ...FLAGS,
  };
  try {
    receipt.planSha256 = writer.write('cpu-reference-plan.json', plan).sha256;
    writer.write('cpu-reference-pending.json', {
      version: 'linux-own-cpu-pending/1',
      runId: o.runId,
      state: 'pending',
      planSha256: receipt.planSha256,
      collectionMode,
      ...FLAGS,
    });
  } catch {
    return {
      exitCode: 6,
      receipt: {
        ...receipt,
        state: 'persistence-failed',
        reason: 'persistence-unavailable',
        files: [...writer.files],
      },
    };
  }
  const capture = captureCpu(d, o.signal);
  let raw = null,
    persistenceFailed = false;
  try {
    raw = await sampler.sampleSelfResources(
      { runId: o.runId, ...plan.sampler, ...(o.signal === undefined ? {} : { signal: o.signal }) },
      {
        nowNs: capture.now,
        cpuUsage: capture.cpuUsage,
        rss: d.rss,
        setTimer: d.setTimer,
        clearTimer: d.clearTimer,
      },
    );
  } catch {
    receipt.reason = 'sampler-unavailable';
  }
  receipt.workload = capture.workload;
  if (raw) {
    receipt.acquisition = {
      complete: raw.complete,
      readingMode: raw.readingMode,
      observedPoints: raw.samples.length,
      missedPoints: raw.missed.length,
      unattemptedPoints: raw.unattempted?.count ?? 0,
      stopReason: raw.stopReason,
      pendingTimer: raw.pendingTimer,
      cleanupReason: raw.cleanupReason,
      inFlightReading: raw.inFlightReading,
    };
    try {
      receipt.rawSha256 = writer.write('raw-samples.json', raw).sha256;
    } catch {
      persistenceFailed = true;
    }
  }
  try {
    receipt.comparison = evaluateCpuReference({
      clockTicksPerSecond: receipt.clockTicksPerSecond,
      windows: capture.windows,
    });
  } catch {
    receipt.comparison = { state: 'refused', reason: 'reference-shape-invalid' };
  }
  if (capture.clockReason === 'clock-regressed')
    receipt.comparison = { ...receipt.comparison, state: 'refused', reason: 'clock-regressed' };
  try {
    receipt.windowsSha256 = writer.write('cpu-reference-windows.json', {
      version: 'linux-own-cpu-windows/1',
      runId: o.runId,
      planSha256: receipt.planSha256,
      rawSha256: receipt.rawSha256,
      clockTicksPerSecond: receipt.clockTicksPerSecond,
      clock: plan.clock,
      collectionMode,
      windows: capture.windows,
      workload: receipt.workload,
      comparison: receipt.comparison,
      rssAssessment: 'not-qualified',
      ...FLAGS,
    }).sha256;
  } catch {
    persistenceFailed = true;
  }
  try {
    const after = storage.inventory();
    receipt.sources = {
      state: JSON.stringify(before) === JSON.stringify(after) ? 'unchanged' : 'changed',
      after,
    };
  } catch {
    receipt.sources = { state: 'unavailable', after: null };
  }
  const complete =
    raw?.complete === true &&
    raw.samples.length === 2 &&
    raw.pendingTimer === false &&
    raw.cleanupReason === null &&
    raw.inFlightReading === false &&
    receipt.workload.state === 'completed' &&
    receipt.workload.completedIterations === WORK.iterations &&
    receipt.comparison.state === 'consistent-under-declared-model';
  const refused = receipt.comparison.state === 'refused';
  receipt.state = persistenceFailed
    ? 'persistence-failed'
    : receipt.sources.state !== 'unchanged'
      ? 'unavailable'
      : refused
        ? 'refused'
        : complete
          ? 'consistent-under-declared-model'
          : 'incomplete';
  receipt.reason = persistenceFailed
    ? 'persistence-unavailable'
    : receipt.sources.state !== 'unchanged'
      ? 'source-unavailable-or-changed'
      : refused
        ? receipt.comparison.reason
        : complete
          ? null
          : (capture.clockReason ??
            (o.signal?.aborted ? 'cancelled' : null) ??
            receipt.workload.reason ??
            receipt.comparison.reason ??
            raw?.stopReason ??
            'incomplete-acquisition');
  receipt.files = [...writer.files];
  let exitCode = persistenceFailed
    ? 6
    : receipt.sources.state !== 'unchanged'
      ? 7
      : refused
        ? 4
        : complete
          ? 0
          : 3;
  try {
    writer.write('cpu-reference-final.json', receipt);
  } catch {
    exitCode = 6;
    return {
      exitCode,
      receipt: { ...receipt, state: 'persistence-failed', reason: 'persistence-unavailable' },
    };
  }
  return { exitCode, receipt };
}
module.exports = { runLinuxOwnCpuReference, validateOptions };
