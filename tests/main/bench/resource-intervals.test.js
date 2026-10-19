import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { evaluateResourceIntervals } = require('../../../bench/lib/resource-intervals.js');

const fixture = () => ({
  version: 'resource-intervals/1',
  runId: 'run-1',
  cadenceUs: 1_000_000,
  sampleWindow: { startUs: 0, endUs: 4_000_000 },
  units: { wall: 'us', cpu: 'us', memory: 'bytes' },
  provenance: {
    collectorId: 'fixture',
    clockId: 'monotonic-fixture',
    sourceSha256: 'a'.repeat(64),
  },
  memory: {
    platform: 'linux',
    definition: 'rss',
    api: 'fixture-rss',
    sharedPages: 'may-double-count',
  },
  phases: [{ id: 'idle', kind: 'idle', steady: true, startUs: 0, endUs: 4_000_000 }],
  cohorts: ['product'],
  lifetimes: [
    { id: 'main-1', pid: 71, cohort: 'product', startUs: 0, endUs: null },
    { id: 'renderer-1', pid: 72, cohort: 'product', startUs: 0, endUs: null },
  ],
  samples: [0, 1, 2, 3, 4].map((n) => ({
    id: 'sample-' + n,
    scheduledUs: n * 1_000_000,
    actualUs: n * 1_000_000,
    populationKnown: true,
    members: [
      { lifetime: 'main-1', userUs: n * 2_000_000, kernelUs: 0, residentBytes: 100 + n * 100 },
      { lifetime: 'renderer-1', userUs: n * 500_000, kernelUs: 0, residentBytes: 50 + n * 50 },
    ],
  })),
});
const cpu = (r) => r.estimates.find((x) => x.metric === 'cpu-one-core-pct');
const memory = (r) => r.estimates.find((x) => x.metric === 'resident-bytes');

describe('offline resource intervals, no collectors', () => {
  it.each([
    ['leading', 1_000_000, 4_000_000, 0, 4_000_000],
    ['trailing root probe', 0, 1_000_000, 0, 10_000_000],
    ['wholly before', 1_000_000, 4_000_000, 0, 500_000],
    ['wholly after', 0, 4_000_000, 5_000_000, 6_000_000],
  ])('rejects declared phase outside the planned window: %s', (_name, start, end, a, b) => {
    const input = fixture();
    input.sampleWindow = { startUs: start, endUs: end };
    input.samples = input.samples.filter((s) => s.scheduledUs >= start && s.scheduledUs <= end);
    input.phases[0] = { ...input.phases[0], startUs: a, endUs: b };
    expect(() => evaluateResourceIntervals(input)).toThrow('resource-input-invalid');
  });
  it('admits covered phases with gaps and boundaries between scheduled points', () => {
    const input = fixture();
    input.phases = [
      { id: 'idle', kind: 'idle', steady: true, startUs: 0, endUs: 1_000_000 },
      { id: 'work', kind: 'workload', steady: true, startUs: 1_500_000, endUs: 3_500_000 },
    ];
    const r = evaluateResourceIntervals(input);
    expect(r.missingScheduledUs).toEqual([]);
    expect(r.intervals.map((x) => x.cohorts[0].value)).toEqual([250, null, 250, null]);
    expect(
      r.estimates.find((x) => x.phaseId === 'work' && x.metric === 'cpu-one-core-pct'),
    ).toMatchObject({ p50: 250, p95: 250, validCount: 1, reason: null });
    expect(
      r.estimates.find((x) => x.phaseId === 'work' && x.metric === 'resident-bytes'),
    ).toMatchObject({ p50: 525, p95: 600, validCount: 2, reason: null });
  });
  it('sums aligned lifetime deltas on one core and retains raw evidence/definitions', () => {
    const input = fixture(),
      before = structuredClone(input),
      r = evaluateResourceIntervals(input);
    expect(r.intervals[0].members.map((m) => m.value)).toEqual([200, 50]);
    expect(r.intervals.map((x) => x.cohorts[0].value)).toEqual([250, 250, 250, 250]);
    expect(cpu(r)).toMatchObject({ p50: 250, p95: 250, reason: null, unit: 'percent-one-core' });
    expect(r.memorySamples.map((x) => x.cohorts[0].value)).toEqual([150, 300, 450, 600, null]);
    expect(memory(r)).toMatchObject({ p50: 375, p95: 600, validCount: 4, reason: null });
    expect(r.memorySamples[4].reason).toBe('outside-phase');
    expect(r.intervals[3].cohorts[0].value).toBe(250);
    expect(r.memory).toEqual(input.memory);
    expect(r.samples).toEqual(input.samples);
    expect(r.provenance).toEqual(input.provenance);
    expect(input).toEqual(before);
  });
  it('refuses an incomplete population instead of adding a missing member as zero', () => {
    const input = fixture();
    input.samples[2].members.pop();
    const r = evaluateResourceIntervals(input);
    expect(r.intervals[1].cohorts[0]).toMatchObject({ value: null, reason: 'missing-member' });
    expect(cpu(r)).toMatchObject({ p50: null, p95: null, reason: 'incomplete-population' });
    expect(memory(r)).toMatchObject({ p50: null, p95: null, reason: 'incomplete-population' });
    expect(cpu(r).valid).toHaveLength(2);
    expect(cpu(r).excluded).toHaveLength(2);
  });
  it.each(['first', 'last'])(
    'detects a missing %s scheduled endpoint from the declared sample window',
    (endpoint) => {
      const input = fixture();
      const removed = endpoint === 'first' ? input.samples.shift() : input.samples.pop();
      const r = evaluateResourceIntervals(input);
      expect(r.missingScheduledUs).toEqual([removed.scheduledUs]);
      for (const estimate of [cpu(r), memory(r)]) {
        expect(estimate).toMatchObject({ p50: null, p95: null, reason: 'incomplete-population' });
        expect(estimate.validCount).toBeGreaterThan(0);
        expect(
          estimate.excluded.some(
            (x) =>
              x.sampleId === `scheduled:${removed.scheduledUs}` && x.reason === 'missing-sample',
          ),
        ).toBe(true);
      }
    },
  );
  it('excludes warmup and cross-phase intervals while estimating each steady phase separately', () => {
    const boundary = fixture();
    boundary.phases = [
      { id: 'idle', kind: 'idle', steady: true, startUs: 0, endUs: 1_500_000 },
      { id: 'work', kind: 'workload', steady: true, startUs: 1_500_000, endUs: 4_000_000 },
    ];
    const crossing = evaluateResourceIntervals(boundary);
    expect(crossing.intervals[1].cohorts[0].value).toBeNull();
    expect(crossing.intervals[1].cohorts[0].reason).toBe('phase-boundary');
    expect(cpu(crossing).validCount).toBe(1);
    const input = fixture();
    input.phases = [
      { id: 'warmup', kind: 'warmup', steady: false, startUs: 0, endUs: 1_500_000 },
      { id: 'idle', kind: 'idle', steady: true, startUs: 1_500_000, endUs: 3_500_000 },
      { id: 'work', kind: 'workload', steady: true, startUs: 3_500_000, endUs: 4_000_000 },
    ];
    const r = evaluateResourceIntervals(input);
    expect(r.intervals.map((x) => x.reason)).toEqual([
      'nonsteady-phase',
      'phase-boundary',
      null,
      'phase-boundary',
    ]);
    expect(r.intervals[1].cohorts[0].value).toBeNull();
    expect(
      r.estimates.find((x) => x.phaseId === 'idle' && x.metric === 'cpu-one-core-pct'),
    ).toMatchObject({ p50: 250, validCount: 1 });
    expect(r.estimates.find((x) => x.phaseId === 'warmup')).toMatchObject({
      p50: null,
      reason: 'nonsteady-phase',
    });
    expect(r.estimates.find((x) => x.phaseId === 'work')).toMatchObject({
      p50: null,
      reason: 'empty-population',
    });
  });
  it('never joins a reused PID or invents CPU for a transient between snapshots', () => {
    const stale = fixture();
    stale.lifetimes[0].endUs = 1_500_000;
    expect(evaluateResourceIntervals(stale).intervals[1].cohorts[0].value).toBeNull();
    const input = fixture();
    input.lifetimes[0].endUs = 1_500_000;
    input.lifetimes.push({ ...input.lifetimes[0], id: 'main-2', startUs: 1_500_000, endUs: null });
    for (let n = 2; n < input.samples.length; n++)
      input.samples[n].members[0] = {
        ...input.samples[n].members[0],
        lifetime: 'main-2',
        userUs: (n - 2) * 1_000_000,
      };
    const r = evaluateResourceIntervals(input);
    expect(
      r.intervals[1].members
        .filter((m) => m.cohort === 'product' && m.lifetime.startsWith('main'))
        .map((m) => m.reason),
    ).toEqual(['lifetime-churn', 'lifetime-churn']);
    expect(r.intervals[1].cohorts[0].value).toBeNull();
    expect(r.intervals[2].cohorts[0].value).toBe(150);
    expect(cpu(r).p95).toBeNull();
    const short = fixture();
    short.lifetimes.push({
      id: 'helper',
      pid: 73,
      cohort: 'product',
      startUs: 250_000,
      endUs: 750_000,
    });
    const missingHelper = evaluateResourceIntervals(short);
    expect(missingHelper.intervals[0].cohorts[0]).toMatchObject({
      value: null,
      reason: 'lifetime-churn',
    });
    expect(memory(missingHelper)).toMatchObject({
      p50: null,
      p95: null,
      reason: 'incomplete-population',
    });
    expect(memory(missingHelper).excluded.some((e) => e.reason === 'unsampled-lifetime')).toBe(
      true,
    );
  });
  it.each([
    [
      'unknown population',
      (f) => {
        f.samples[2].populationKnown = false;
      },
      'population-unknown',
    ],
    [
      'missing CPU',
      (f) => {
        f.samples[2].members[0].kernelUs = null;
      },
      'missing-cpu',
    ],
    [
      'counter regression',
      (f) => {
        f.samples[2].members[0].userUs = 1;
        f.samples[2].members[0].kernelUs = 9_000_000;
      },
      'counter-regression',
    ],
    [
      'reversed actual clock',
      (f) => {
        f.samples[2].actualUs = 999_999;
      },
      'nonmonotonic-time',
    ],
    [
      'duplicate scheduled clock',
      (f) => {
        f.samples[2].scheduledUs = 1_000_000;
      },
      'nonmonotonic-schedule',
    ],
    [
      'missing scheduled sample',
      (f) => {
        f.samples.splice(2, 1);
      },
      'missing-sample',
    ],
  ])('retains a null CPU interval and cause for %s', (_name, mutate, reason) => {
    const input = fixture();
    mutate(input);
    const r = evaluateResourceIntervals(input);
    expect(r.intervals[1].cohorts[0]).toMatchObject({ value: null, reason });
    expect(cpu(r)).toMatchObject({ p50: null, p95: null, reason: 'incomplete-population' });
    expect(cpu(r).excluded.some((x) => x.reason === reason)).toBe(true);
  });
  it('preserves missing memory and unsafe totals without using zero or rounded sums', () => {
    const input = fixture();
    input.samples[1].members[0].residentBytes = null;
    expect(memory(evaluateResourceIntervals(input))).toMatchObject({
      p50: null,
      reason: 'incomplete-population',
    });
    input.samples[1].members.forEach((m) => {
      m.residentBytes = Number.MAX_SAFE_INTEGER;
    });
    expect(evaluateResourceIntervals(input).memorySamples[1].cohorts[0]).toMatchObject({
      value: null,
      reason: 'numeric-overflow',
    });
    const precise = fixture();
    precise.samples = precise.samples.slice(0, 3);
    precise.sampleWindow.endUs = 2_000_000;
    precise.phases[0].endUs = 2_000_000;
    precise.lifetimes.pop();
    precise.samples.forEach((s, n) => {
      s.members.pop();
      s.members[0].residentBytes = Number.MAX_SAFE_INTEGER - (n === 0 ? 1 : 0);
    });
    expect(memory(evaluateResourceIntervals(precise))).toMatchObject({
      p50: null,
      p95: null,
      reason: 'numeric-overflow',
    });
  });
  it('uses raw interval even medians and nearest-rank p95, without run or cohort pooling', () => {
    const input = fixture();
    const counts = [0, 1, 3, 6, 10];
    input.samples.forEach((s, n) => {
      s.members[0].userUs = counts[n] * 1_000_000;
      s.members[1].userUs = 0;
    });
    const r = evaluateResourceIntervals(input);
    expect(cpu(r)).toMatchObject({ p50: 250, p95: 400, validCount: 4, excludedCount: 0 });
    expect(cpu(r).valid.map((x) => x.value)).toEqual([100, 200, 300, 400]);
    // [150, 300, 450, 600]: median (300 + 450) / 2; rank ceil(.95 * 4) = 4.
    expect(memory(r)).toMatchObject({ p50: 375, p95: 600, validCount: 4, reason: null });
    expect(memory(r).valid.map((x) => x.value)).toEqual([150, 300, 450, 600]);
    input.samples.pop();
    input.sampleWindow.endUs = 3_000_000;
    input.phases[0].endUs = 3_000_000;
    // [150, 300, 450]: middle value 300; rank ceil(.95 * 3) = 3.
    expect(memory(evaluateResourceIntervals(input))).toMatchObject({
      p50: 300,
      p95: 450,
      validCount: 3,
      reason: null,
    });
    input.cohorts.push('agent');
    input.lifetimes[1].cohort = 'agent';
    input.samples.forEach((s) => {
      s.members[1].userUs = 0;
    });
    const separate = evaluateResourceIntervals(input);
    expect(separate.intervals[0].cohorts.map((c) => c.value)).toEqual([100, 0]);
    expect(separate.estimates.every((e) => e.runId === 'run-1')).toBe(true);
  });
  it('distinguishes observed zero from empty estimates and returns independent deterministic data', () => {
    const input = fixture();
    input.samples.forEach((s) =>
      s.members.forEach((m) => {
        m.userUs = 0;
        m.residentBytes = 0;
      }),
    );
    const r = evaluateResourceIntervals(input);
    expect(cpu(r)).toMatchObject({ p50: 0, p95: 0, reason: null });
    expect(memory(r)).toMatchObject({ p50: 0, p95: 0, reason: null });
    expect(JSON.stringify(r)).toBe(JSON.stringify(evaluateResourceIntervals(input)));
    r.samples[0].members[0].residentBytes = 900;
    expect(input.samples[0].members[0].residentBytes).toBe(0);
    input.samples = [];
    expect(cpu(evaluateResourceIntervals(input))).toMatchObject({
      p50: null,
      p95: null,
      reason: 'incomplete-population',
    });
    input.samples = fixture().samples.map((s) => ({ ...s, members: [] }));
    input.lifetimes = [];
    expect(memory(evaluateResourceIntervals(input)).p50).toBeNull();
  });
  it.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, '100'])(
    'rejects unsafe or coerced counter %s',
    (value) => {
      const input = fixture();
      input.samples[0].members[0].userUs = value;
      expect(() => evaluateResourceIntervals(input)).toThrow('resource-input-invalid');
    },
  );
  it.each([
    (f) => {
      f.version = 'resource-intervals/2';
    },
    (f) => {
      f.units.cpu = 'ms';
    },
    (f) => {
      f.cadenceUs = 100;
    },
    (f) => {
      f.samples[0].runId = 'other-run';
    },
    (f) => {
      f.samples[0].members[0].actualUs = 1;
    },
    (f) => {
      f.runAverages = [100, 200, 300];
    },
    (f) => {
      f.phases[0].kind = 'warmup';
    },
    (f) => {
      f.memory.definition = 'unique-physical-memory';
    },
    (f) => {
      f.samples[0].members.push({ ...f.samples[0].members[0] });
    },
    (f) => {
      f.lifetimes.push({ ...f.lifetimes[0], id: 'overlapping-reuse' });
    },
    (f) => {
      f.samples = Array(2049).fill(f.samples[0]);
    },
  ])('rejects invalid contract, cross-run metadata and unbounded input %#', (mutate) => {
    const input = fixture();
    mutate(input);
    expect(() => evaluateResourceIntervals(input)).toThrow('resource-input-invalid');
  });
  it('rejects accessor/secret metadata without invoking it or echoing its contents', () => {
    const input = fixture();
    let called = false;
    Object.defineProperty(input.provenance, 'collectorId', {
      get() {
        called = true;
        throw Error('SECRET_CANARY');
      },
      enumerable: true,
    });
    expect(() => evaluateResourceIntervals(input)).toThrow('resource-input-invalid');
    expect(called).toBe(false);
    const bad = fixture();
    bad.memory.api = '/private/SECRET_CANARY';
    try {
      evaluateResourceIntervals(bad);
      throw Error('expected rejection');
    } catch (error) {
      expect(error.message).toBe('resource-input-invalid');
    }
  });
  it('bounds expanded missing populations and serialized raw data before evaluation', () => {
    const huge = fixture();
    huge.lifetimes = Array.from({ length: 256 }, (_, n) => ({
      ...huge.lifetimes[0],
      id: 'life-' + n,
      pid: n + 1,
    }));
    huge.samples = Array.from({ length: 65 }, (_, n) => ({
      ...huge.samples[0],
      id: 'sample-' + n,
      members: [],
    }));
    expect(() => evaluateResourceIntervals(huge)).toThrow('resource-input-invalid');
    const bytes = fixture();
    bytes.lifetimes = Array.from({ length: 128 }, (_, n) => ({
      ...bytes.lifetimes[0],
      id: ('life-' + n).padEnd(64, 'x'),
      pid: n + 1,
    }));
    bytes.samples = Array.from({ length: 128 }, (_, n) => ({
      id: 'sample-' + n,
      scheduledUs: n * 1_000_000,
      actualUs: n * 1_000_000,
      populationKnown: true,
      members: bytes.lifetimes.map((l) => ({
        lifetime: l.id,
        userUs: Number.MAX_SAFE_INTEGER,
        kernelUs: Number.MAX_SAFE_INTEGER,
        residentBytes: Number.MAX_SAFE_INTEGER,
      })),
    }));
    bytes.sampleWindow.endUs = 127_000_000;
    expect(() => evaluateResourceIntervals(bytes)).toThrow('resource-input-invalid');
  });
  it('has a pure measurement module graph without src or I/O imports', () => {
    const entry = require.resolve('../../../bench/lib/resource-intervals.js');
    const graph = [require.cache[entry], ...require.cache[entry].children];
    expect(graph).toHaveLength(2);
    for (const module of graph) {
      expect(module.filename.replaceAll('\\', '/')).not.toContain('/src/');
      expect(fs.readFileSync(module.filename, 'utf8')).not.toMatch(
        /child_process|node:fs|process\./,
      );
    }
  });
});
