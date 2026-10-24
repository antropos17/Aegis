'use strict';
const path = require('node:path');
const sampler = require('./self-resource-sampler');
const evaluator = require('./bracketed-resource-intervals');
const storage = require('./own-resource-storage');
const FLAGS = Object.freeze({
  sourceAuthenticated: false,
  measurementAccepted: false,
  w8Accepted: false,
});
const invalid = () => {
  throw new Error('self-resource-session-input-invalid');
};
const integer = (v) => Number.isSafeInteger(v) && v >= 0;
function closed(value, keys) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const result = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== 'string' ||
      !keys.includes(key) ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    )
      invalid();
    result[key] = descriptor.value;
  }
  return result;
}
/** Validate closed options and instrumentation before any IO or acquisition. @param {object} options Session options. @param {object} [deps] Existing sampler test dependencies. @returns {object} Safe copied options and dependencies. @since unreleased */
function validateOptions(options, deps = {}) {
  try {
    const o = closed(options, [
      'runId',
      'durationMs',
      'maxAcquisitionUs',
      'maxCpuUncertaintyUs',
      'out',
      'signal',
    ]);
    const d = closed(deps, ['nowNs', 'cpuUsage', 'rss', 'setTimer', 'clearTimer']);
    if (
      typeof o.runId !== 'string' ||
      !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(o.runId) ||
      !integer(o.durationMs) ||
      o.durationMs < 1000 ||
      o.durationMs > 60000 ||
      o.durationMs % 1000 ||
      !integer(o.maxAcquisitionUs) ||
      o.maxAcquisitionUs < 1 ||
      o.maxAcquisitionUs > o.durationMs * 1000 ||
      !integer(o.maxCpuUncertaintyUs) ||
      o.maxCpuUncertaintyUs < 1 ||
      o.maxCpuUncertaintyUs > o.durationMs * 2000 ||
      typeof o.out !== 'string' ||
      o.out.length < 1 ||
      o.out.length > 4096 ||
      o.out.includes('\0') ||
      /^[/\\]{2}/.test(o.out) ||
      (o.signal !== undefined && !(o.signal instanceof AbortSignal)) ||
      Object.values(d).some((v) => v !== null && typeof v !== 'function')
    )
      invalid();
    o.out = path.resolve(o.out);
    if (o.out === path.parse(o.out).root) invalid();
    return { options: o, deps: d };
  } catch {
    invalid();
  }
}
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function finishSources(before) {
  try {
    const after = storage.inventory();
    return {
      state: JSON.stringify(before) === JSON.stringify(after) ? 'unchanged' : 'changed',
      after,
    };
  } catch {
    return { state: 'unavailable', after: null };
  }
}
/** Acquire and retain only the calling Node process, with conditional derivation and fixed file quotas.
 * @param {object} options Required runId, durationMs, maxAcquisitionUs, maxCpuUncertaintyUs, out; optional AbortSignal.
 * @param {object} [samplerDeps] Existing sampler synchronous test seam; marks injected readings.
 * @returns {Promise<object>} Fixed exitCode and safe final receipt, or null before a fresh bundle exists.
 * @since unreleased
 */
async function runSelfResourceSession(options, samplerDeps = {}) {
  const checked = validateOptions(options, samplerDeps),
    o = checked.options;
  let before;
  try {
    before = storage.inventory();
  } catch {
    return { exitCode: 4, receipt: null };
  }
  const plan = freeze({
    version: 'self-resource-session-plan/1',
    runId: o.runId,
    scope: 'calling-node-process',
    activity: 'owned-node-waiting-no-workload',
    plan: {
      version: 'bracketed-resource-plan/1',
      runId: o.runId,
      clock: 'collector-start',
      durationUs: o.durationMs * 1000,
      maxAcquisitionUs: o.maxAcquisitionUs,
      maxCpuUncertaintyUs: o.maxCpuUncertaintyUs,
      phases: [
        { id: 'owned-idle', kind: 'idle', steady: true, startUs: 0, endUs: o.durationMs * 1000 },
      ],
    },
    sampler: { durationMs: o.durationMs, maxSamples: o.durationMs / 1000, maxOutputBytes: 131072 },
    sources: before,
    limits: { totalBytes: storage.QUOTA, files: storage.CAPS },
    ...FLAGS,
  });
  let writer;
  try {
    writer = storage.createStorage(o.out);
  } catch {
    return { exitCode: 5, receipt: null };
  }
  const receipt = {
    version: 'self-resource-session-final/1',
    runId: o.runId,
    scope: 'calling-node-process',
    state: 'pending',
    priorArtifactState: 'partial',
    finalPublication: 'not-self-attested',
    planSha256: null,
    rawSha256: null,
    acquisition: { state: 'not-started', complete: null, reason: null, readingMode: null },
    derivation: { state: 'not-started', reason: null },
    cleanup: { pendingTimer: null, reason: null, inFlightReading: null },
    sources: { state: 'pending', after: null },
    files: [],
    ...FLAGS,
  };
  let persistenceFailed = false;
  try {
    receipt.planSha256 = writer.write('session-plan.json', plan).sha256;
    writer.write('session-pending.json', {
      version: 'self-resource-session-pending/1',
      runId: o.runId,
      state: 'pending',
      scope: 'calling-node-process',
      planSha256: receipt.planSha256,
      roster: Object.keys(storage.CAPS),
      ...FLAGS,
    });
  } catch {
    return {
      exitCode: 6,
      receipt: { ...receipt, state: 'persistence-failed', files: [...writer.files] },
    };
  }
  let raw;
  try {
    raw = await sampler.sampleSelfResources(
      {
        runId: o.runId,
        ...plan.sampler,
        ...(o.signal === undefined ? {} : { signal: o.signal }),
      },
      checked.deps,
    );
    receipt.acquisition = {
      state:
        raw.stopReason === 'cancelled' ? 'cancelled' : raw.complete ? 'complete' : 'incomplete',
      complete: raw.complete,
      reason: raw.stopReason ?? (raw.complete ? null : 'reading-incomplete'),
      readingMode: raw.readingMode,
    };
    receipt.cleanup = {
      pendingTimer: raw.pendingTimer,
      reason: raw.cleanupReason,
      inFlightReading: raw.inFlightReading,
    };
  } catch {
    receipt.acquisition = {
      state: 'failed',
      complete: null,
      reason: 'acquisition-unavailable',
      readingMode: Object.keys(checked.deps).length ? 'injected' : 'own-process',
    };
  }
  if (raw) {
    try {
      receipt.rawSha256 = writer.write('raw-samples.json', raw).sha256;
    } catch {
      persistenceFailed = true;
    }
    if (!persistenceFailed) {
      let derived;
      try {
        derived = evaluator.evaluateBracketedResources({
          raw,
          plan: plan.plan,
          provenance: { sourceSha256: receipt.planSha256 },
        });
      } catch {
        receipt.derivation = { state: 'refused', reason: 'derivation-unavailable' };
      }
      if (derived) {
        try {
          writer.write('bracketed-intervals.json', derived);
          receipt.derivation = { state: 'written', reason: null };
        } catch {
          persistenceFailed = true;
          receipt.derivation = { state: 'not-written', reason: 'persistence-unavailable' };
        }
      }
    }
  }
  receipt.sources = finishSources(before);
  receipt.files = [...writer.files];
  const cleaned =
    receipt.cleanup.pendingTimer === false &&
    receipt.cleanup.reason === null &&
    receipt.cleanup.inFlightReading === false;
  receipt.state = persistenceFailed
    ? 'persistence-failed'
    : receipt.sources.state !== 'unchanged'
      ? 'source-refused'
      : receipt.acquisition.state === 'complete' &&
          receipt.derivation.state === 'written' &&
          cleaned
        ? 'complete-candidate'
        : 'incomplete';
  receipt.priorArtifactState = receipt.files.length === 4 ? 'complete' : 'partial';
  let exitCode = persistenceFailed
    ? 6
    : receipt.sources.state !== 'unchanged'
      ? 4
      : receipt.state === 'complete-candidate'
        ? 0
        : 3;
  try {
    writer.write('session-final.json', receipt);
  } catch {
    exitCode = 6;
    return { exitCode, receipt: { ...receipt, state: 'persistence-failed' } };
  }
  return { exitCode, receipt };
}
module.exports = { runSelfResourceSession, validateOptions };
