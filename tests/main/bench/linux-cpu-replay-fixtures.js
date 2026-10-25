import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { vi } from 'vitest';
const bases = [];
const flags = {
  sourceAuthenticated: false,
  measurementAccepted: false,
  calibrationAccepted: false,
  w8Accepted: false,
};
const model = {
  version: 'aggregate-floor-enclosure/1',
  tickEndpointAllowance: 2,
  apiEndpointAllowanceUs: 2,
  progressRule: 'reference-delta-lower-us-strictly-greater-than-four-and-api-delta-positive',
  upperBoundary: 'exclusive',
  kernelReference: 'linux-v6.14',
  kernelModelQualified: false,
};
const workPlan = {
  version: 'lcg32-fixed/1',
  multiplier: 1664525,
  increment: 1013904223,
  seed: 1,
  iterations: 67108864,
  chunk: 65536,
  budgetNs: '2000000000',
};
export const files = [
  'cpu-reference-plan.json',
  'cpu-reference-pending.json',
  'raw-samples.json',
  'cpu-reference-windows.json',
  'cpu-reference-final.json',
];
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** Read owned fixture JSON. @param {object} b Fixture. @param {string} name Fixed artifact. @returns {object} Data. @since unreleased */
export function read(b, name) {
  return JSON.parse(fs.readFileSync(path.join(b.input, name), 'utf8'));
}
/** Write owned fixture JSON only. @param {object} b Fixture. @param {string} name File. @param {object} value Data. @returns {void} @since unreleased */
export function write(b, name, value) {
  fs.writeFileSync(path.join(b.input, name), JSON.stringify(value, null, 2) + '\n');
}
const record = (b, file) => {
  const bytes = fs.readFileSync(path.join(b.input, file));
  return { file, sha256: hash(bytes), byteLength: bytes.length, closed: true };
};
/** Restamp exact links after deliberate coherent edits, retaining missing artifacts. @param {object} b Fixture. @returns {void} @since unreleased */
export function restamp(b) {
  const present = (n) => fs.existsSync(path.join(b.input, n));
  const digest = (n) => (present(n) ? record(b, n).sha256 : null);
  for (const n of [files[1], files[3], files[4]])
    if (present(n)) {
      const v = read(b, n);
      if (present(files[0])) v.planSha256 = digest(files[0]);
      if (n !== files[1] && present(files[2])) v.rawSha256 = digest(files[2]);
      if (n === files[4] && present(files[3])) v.windowsSha256 = digest(files[3]);
      if (n === files[4])
        v.files = files
          .slice(0, 4)
          .filter(present)
          .map((file) => record(b, file));
      write(b, n, v);
    }
}
/** Literal fabricated complete bundle; no sampler, proc, getconf or LCG execution. @param {object} [options] Optional copied source root, unused historical authority. @returns {object} Fixture. @since unreleased */
export function createBundle({ root } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-cpu-replay-'));
  bases.push(base);
  const b = { base, input: path.join(base, 'input'), out: path.join(base, 'report'), root };
  fs.mkdirSync(b.input);
  const inventory = {
    basis: 'repository-disk-bytes-at-endpoint',
    nodeVersion: 'v24.20.0',
    loadedCodeAuthenticated: false,
    files: [
      'bench/linux-own-cpu-qualify.cjs',
      'bench/lib/linux-own-cpu-reference.js',
      'bench/lib/linux-own-cpu-proc.js',
      'bench/lib/linux-own-cpu-work.js',
      'bench/lib/linux-own-cpu-model.js',
      'bench/lib/linux-own-cpu-capture.js',
      'bench/lib/linux-own-cpu-storage.js',
      'bench/lib/self-resource-sampler.js',
    ].map((file) => ({ file, sha256: '1'.repeat(64), byteLength: 100 })),
  };
  const platform = {
    family: 'linux',
    kernelVersion: '6.14-fixture',
    arch: 'x64',
    kernelModelQualified: false,
  };
  const plan = {
    version: 'linux-own-cpu-plan/1',
    runId: 'cpu-fixture',
    scope: 'calling-node-process-cpu',
    collectionMode: 'injected-test-seams',
    platform,
    clockTicksPerSecond: '100',
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
    model,
    workload: workPlan,
    rssAssessment: 'not-qualified',
    sources: inventory,
    limits: {
      totalBytes: 131072,
      files: {
        'cpu-reference-plan.json': 16384,
        'cpu-reference-pending.json': 4096,
        'raw-samples.json': 16385,
        'cpu-reference-windows.json': 32768,
        'cpu-reference-final.json': 16384,
      },
    },
    ...flags,
  };
  const rows = [0, 1].map((index) => {
    const r = (start) => ({
      userTicks: index ? '110' : '100',
      systemTicks: '20',
      startTicks: '500',
      byteLength: 100,
      sha256: '2'.repeat(64),
      beforeNs: String(index * 20 + start),
      afterNs: String(index * 20 + start + 1),
      closed: null,
    });
    return {
      index,
      before: r(1),
      api: {
        beforeNs: String(index * 20 + 3),
        afterNs: String(index * 20 + 4),
        userUs: index ? 1100000 : 1000000,
        systemUs: 200000,
        reason: null,
      },
      after: r(5),
      reason: null,
    };
  });
  const rational = (n) => ({ numerator: String(n), denominator: '100' });
  const comparison = {
    version: 'linux-own-cpu-comparison/1',
    state: 'consistent-under-declared-model',
    reason: null,
    endpoints: [
      {
        index: 0,
        apiLowerUs: '1200000',
        apiUpperExclusiveUs: '1200002',
        referenceLowerUs: rational(120000000),
        referenceUpperExclusiveUs: rational(122000000),
        consistent: true,
      },
      {
        index: 1,
        apiLowerUs: '1300000',
        apiUpperExclusiveUs: '1300002',
        referenceLowerUs: rational(130000000),
        referenceUpperExclusiveUs: rational(132000000),
        consistent: true,
      },
    ],
    delta: {
      apiDeltaUs: '100000',
      apiLowerUs: '99998',
      apiUpperExclusiveUs: '100002',
      referenceLowerUs: rational(8000000),
      referenceUpperExclusiveUs: rational(12000000),
      consistent: true,
      sufficientResolution: true,
    },
    model,
    ...flags,
  };
  // Independent BigInt affine composition rather than a 67-million-iteration burst.
  let a = 1664525n,
    c = 1013904223n,
    value = 1n,
    n = 67108864n;
  while (n) {
    if (n & 1n) value = (a * value + c) & 0xffffffffn;
    c = (a * c + c) & 0xffffffffn;
    a = (a * a) & 0xffffffffn;
    n >>= 1n;
  }
  const workload = {
    state: 'completed',
    reason: null,
    completedIterations: 67108864,
    checksum: Number(value),
    beforeNs: '7',
    afterNs: '20',
  };
  const raw = {
    version: 'self-resource-samples/1',
    runId: plan.runId,
    readingMode: 'injected',
    scope: 'calling-node-process',
    cadenceUs: 1000000,
    plannedDurationUs: 2000000,
    plannedPoints: 2,
    limits: { maxSamples: 2, maxOutputBytes: 16384, maxDurationUs: 60000000 },
    sources: {
      clock: 'process.hrtime.bigint',
      cpu: 'process.cpuUsage',
      rss: 'process.memoryUsage.rss',
    },
    units: { clock: 'us', cpu: 'us', rss: 'bytes' },
    memoryDefinition: 'node-process-rss',
    memoryCaveat: 'shared-pages-may-double-count',
    clock: {
      epoch: 'collector-start',
      quantization: 'floor-nanoseconds-to-microseconds',
      lastObservedUs: 1000100,
      reason: null,
    },
    identity: { osBirthTime: null, reason: 'not-observed' },
    population: { complete: null, reason: 'not-collected' },
    samples: rows.map((r, i) => ({
      scheduledUs: i * 1000000,
      actualUs: i * 1000000 + 1,
      latenessUs: 1,
      cpu: {
        beforeUs: i * 1000000 + 2,
        afterUs: i * 1000000 + 50,
        userUs: r.api.userUs,
        systemUs: r.api.systemUs,
        reason: null,
      },
      rss: {
        beforeUs: i * 1000000 + 51,
        afterUs: i * 1000000 + 52,
        residentBytes: i ? 1024 : 4096,
        reason: null,
      },
    })),
    missed: [],
    unattempted: null,
    stopReason: null,
    complete: true,
    pendingTimer: false,
    cleanupReason: null,
    inFlightReading: false,
  };
  write(b, files[0], plan);
  write(b, files[1], {
    version: 'linux-own-cpu-pending/1',
    runId: plan.runId,
    state: 'pending',
    planSha256: record(b, files[0]).sha256,
    collectionMode: plan.collectionMode,
    ...flags,
  });
  write(b, files[2], raw);
  write(b, files[3], {
    version: 'linux-own-cpu-windows/1',
    runId: plan.runId,
    planSha256: record(b, files[0]).sha256,
    rawSha256: record(b, files[2]).sha256,
    clockTicksPerSecond: '100',
    clock: plan.clock,
    collectionMode: plan.collectionMode,
    windows: rows,
    workload,
    comparison,
    rssAssessment: 'not-qualified',
    ...flags,
  });
  write(b, files[4], {
    version: 'linux-own-cpu-final/1',
    runId: plan.runId,
    scope: plan.scope,
    collectionMode: plan.collectionMode,
    state: 'consistent-under-declared-model',
    reason: null,
    finalPublication: 'not-self-attested',
    rssAssessment: 'not-qualified',
    platform,
    clockTicksPerSecond: '100',
    planSha256: record(b, files[0]).sha256,
    rawSha256: record(b, files[2]).sha256,
    windowsSha256: record(b, files[3]).sha256,
    acquisition: {
      complete: true,
      readingMode: 'injected',
      observedPoints: 2,
      missedPoints: 0,
      unattemptedPoints: 0,
      stopReason: null,
      pendingTimer: false,
      cleanupReason: null,
      inFlightReading: false,
    },
    comparison,
    workload,
    sources: { state: 'unchanged', after: inventory },
    files: files.slice(0, 4).map((file) => record(b, file)),
    ...flags,
  });
  return b;
}
/** Restore spies and remove only exact owned ordinary bases. @returns {void} @since unreleased */
export function cleanup() {
  vi.restoreAllMocks();
  for (const base of bases.splice(0)) {
    if (
      path.dirname(base) !== path.resolve(os.tmpdir()) ||
      !path.basename(base).startsWith('linux-cpu-replay-') ||
      fs.lstatSync(base).isSymbolicLink()
    )
      throw Error('unsafe-cleanup');
    fs.rmSync(base, { recursive: true });
  }
}
