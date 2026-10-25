'use strict';
const fs = require('node:fs');
const path = require('node:path');
const session = require('./self-resource-session');
const storage = require('./resource-supervisor-storage');
const lifecycle = require('./resource-supervisor-child');
const FLAGS = Object.freeze({
  sourceAuthenticated: false,
  measurementAccepted: false,
  w8Accepted: false,
});
const invalid = () => {
  throw Error('resource-supervisor-input-invalid');
};
function closed(value, allowed) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const result = {};
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== 'string' ||
      !allowed.includes(key) ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    )
      invalid();
    result[key] = descriptor.value;
  }
  return result;
}
/** Validate all inputs before IO, timers or spawn. @param {object} options Existing five options plus required wallLimitMs/confirmMs; optional signal. @param {object} [deps] Closed lifecycle test seam. @returns {object} Copied options and instrumentation. @since unreleased */
function validateOptions(options, deps = {}) {
  try {
    const o = closed(options, [
      'runId',
      'durationMs',
      'maxAcquisitionUs',
      'maxCpuUncertaintyUs',
      'out',
      'wallLimitMs',
      'confirmMs',
      'signal',
    ]);
    const d = closed(deps, ['spawn', 'nowNs', 'setTimer', 'clearTimer']);
    if (
      !Number.isSafeInteger(o.wallLimitMs) ||
      o.wallLimitMs < 1 ||
      o.wallLimitMs > 120000 ||
      !Number.isSafeInteger(o.confirmMs) ||
      o.confirmMs < 1 ||
      o.confirmMs > 10000 ||
      Object.values(d).some((v) => typeof v !== 'function')
    )
      invalid();
    const base = {
      runId: o.runId,
      durationMs: o.durationMs,
      maxAcquisitionUs: o.maxAcquisitionUs,
      maxCpuUncertaintyUs: o.maxCpuUncertaintyUs,
      out: o.out,
      ...(o.signal === undefined ? {} : { signal: o.signal }),
    };
    const checked = session.validateOptions(base).options;
    return { options: { ...checked, wallLimitMs: o.wallLimitMs, confirmMs: o.confirmMs }, deps: d };
  } catch {
    invalid();
  }
}
function childEnvironment(temporary) {
  const env = {
    TEMP: temporary,
    TMP: temporary,
    TMPDIR: temporary,
    NODE_DISABLE_COMPILE_CACHE: '1',
  };
  for (const key of ['SystemRoot', 'WINDIR']) {
    const value = process.env[key];
    if (typeof value === 'string' && value.length <= 4096 && !value.includes('\0'))
      env[key] = value;
  }
  return env;
}
/** Supervise exactly one fixed own-resource child; never inspect or admit its bundle.
 * @param {object} options Validated five session options plus wallLimitMs/confirmMs; optional AbortSignal.
 * @param {object} [deps] Optional lifecycle instrumentation, labelled injected.
 * @returns {Promise<object>} Fixed exitCode and safe receipt; null before outer creation.
 * @since unreleased
 */
async function superviseSelfResources(options, deps = {}) {
  const checked = validateOptions(options, deps),
    o = checked.options;
  const executionMode = Object.keys(checked.deps).length ? 'injected' : 'real-child';
  let before, writer;
  try {
    before = storage.inventory();
  } catch {
    return { exitCode: 4, receipt: null };
  }
  try {
    writer = storage.createStorage(o.out);
  } catch {
    return { exitCode: 5, receipt: null };
  }
  const receipt = {
    version: 'resource-supervision-final/1',
    runId: o.runId,
    scope: 'owned-node-child',
    executionMode,
    state: 'pending',
    finalPublication: 'not-self-attested',
    childBundleAssessment: 'not-inspected',
    planSha256: null,
    supervision: null,
    sources: { state: 'pending', after: null },
    files: [],
    ...FLAGS,
  };
  const temporary = path.join(o.out, 'temporary');
  try {
    fs.mkdirSync(temporary);
    const plan = {
      version: 'resource-supervision-plan/1',
      runId: o.runId,
      scope: 'owned-node-child',
      executionMode,
      child: {
        entry: 'bench/self-resource-run.cjs',
        output: 'capture',
        durationMs: o.durationMs,
        maxAcquisitionUs: o.maxAcquisitionUs,
        maxCpuUncertaintyUs: o.maxCpuUncertaintyUs,
      },
      wallLimitMs: o.wallLimitMs,
      confirmMs: o.confirmMs,
      streams: { capBytesEach: 16384, retention: 'sha256-prefix-no-text' },
      environment: 'minimal-os-and-owned-temporary-no-inherited-node-options',
      sources: before,
      limits: { totalParentBytes: 65536, files: storage.FILES },
      ...FLAGS,
    };
    receipt.planSha256 = writer.write('supervision-plan.json', plan).sha256;
    writer.write('supervision-pending.json', {
      version: 'resource-supervision-pending/1',
      runId: o.runId,
      state: 'pending',
      planSha256: receipt.planSha256,
      executionMode,
      ...FLAGS,
    });
  } catch {
    return {
      exitCode: 6,
      receipt: { ...receipt, state: 'persistence-failed', files: [...writer.files] },
    };
  }
  const args = [
    path.join(storage.ROOT, 'bench/self-resource-run.cjs'),
    '--run-id',
    o.runId,
    '--duration-ms',
    String(o.durationMs),
    '--max-acquisition-us',
    String(o.maxAcquisitionUs),
    '--max-cpu-uncertainty-us',
    String(o.maxCpuUncertaintyUs),
    '--out',
    path.join(o.out, 'capture'),
  ];
  receipt.supervision = await lifecycle.observeChild(
    {
      command: process.execPath,
      args,
      spawnOptions: {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: temporary,
        env: childEnvironment(temporary),
      },
      wallLimitMs: o.wallLimitMs,
      confirmMs: o.confirmMs,
      signal: o.signal,
    },
    checked.deps,
  );
  try {
    const after = storage.inventory();
    receipt.sources = {
      state: JSON.stringify(after) === JSON.stringify(before) ? 'unchanged' : 'changed',
      after,
    };
  } catch {
    receipt.sources = { state: 'unavailable', after: null };
  }
  const s = receipt.supervision;
  const successful =
    s.cause === null &&
    s.spawnObserved &&
    s.exit.observed &&
    s.exit.code === 0 &&
    s.exit.signal === null &&
    s.close.observed &&
    s.close.code === 0 &&
    s.close.signal === null &&
    s.stdout.complete &&
    s.stderr.complete;
  receipt.state =
    receipt.sources.state !== 'unchanged'
      ? 'source-refused'
      : successful
        ? 'completed-candidate'
        : 'failed';
  receipt.files = [...writer.files];
  let exitCode = receipt.sources.state !== 'unchanged' ? 4 : successful ? 0 : 3;
  try {
    writer.write('supervision-final.json', receipt);
  } catch {
    exitCode = 6;
    return { exitCode, receipt: { ...receipt, state: 'persistence-failed' } };
  }
  return { exitCode, receipt };
}
module.exports = { superviseSelfResources, validateOptions };
