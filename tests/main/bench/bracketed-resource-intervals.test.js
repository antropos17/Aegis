import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const entry =
  process.env.AEGIS_BRACKET_TEST_MODULE || '../../../bench/lib/bracketed-resource-intervals.js';
const { evaluateBracketedResources: evaluate } = require(entry);
const { sampleSelfResources } = require('../../../bench/lib/self-resource-sampler.js');

async function fixture(options = {}) {
  let ns = 0n,
    calls = 0;
  return sampleSelfResources(
    { runId: 'fixture-1', durationMs: 4000, ...options },
    {
      nowNs: () => ns,
      cpuUsage: () => {
        ns += 5000n;
        return { user: ++calls * 100, system: calls * 20 };
      },
      rss: () => {
        ns += 7000n;
        return 4096;
      },
      setTimer: (fn, ms) => {
        ns += BigInt(Math.ceil(ms * 1000)) * 1000n;
        queueMicrotask(fn);
        return 1;
      },
      clearTimer: () => {},
    },
  );
}
function packet(raw, extra = {}) {
  return {
    raw,
    plan: {
      version: 'bracketed-resource-plan/1',
      runId: raw.runId,
      clock: 'collector-start',
      durationUs: raw.plannedDurationUs,
      maxAcquisitionUs: 1000,
      maxCpuUncertaintyUs: 2000,
      phases: [
        { id: 'idle-1', kind: 'idle', steady: true, startUs: 0, endUs: raw.plannedDurationUs },
      ],
      ...extra,
    },
    provenance: { sourceSha256: 'a'.repeat(64) },
  };
}

describe('acquisition-window resource intervals', () => {
  it('consumes the actual raw sampler format and returns exact conditional rational bounds', async () => {
    const input = packet(await fixture());
    const r = evaluate(input);
    expect(r.intervals).toHaveLength(3);
    expect(r.intervals[0]).toMatchObject({
      phaseId: 'idle-1',
      reason: null,
      elapsedMinUs: 999994,
      elapsedMaxUs: 1000006,
      uncertaintyUs: 12,
      user: { deltaUs: 100, reason: null },
      system: { deltaUs: 20, reason: null },
      deltaCpuUs: 120,
      left: { lowerUs: 0, upperExclusiveUs: 6, widthUs: 6 },
      rateBounds: {
        unit: 'percent-one-core',
        scale: 100,
        lower: { numerator: 120, denominator: 1000006 },
        upper: { numerator: 120, denominator: 999994 },
      },
    });
    expect(r.readingMode).toBe('injected');
    expect(r.raw).toEqual(input.raw);
    expect(r.plan).toEqual(input.plan);
    expect(r.provenance).toEqual(input.provenance);
    expect(r.raw.identity.osBirthTime).toBeNull();
    expect(r.raw.population.complete).toBeNull();
    expect(r.memory[0]).toMatchObject({
      residentBytes: 4096,
      window: { lowerUs: 5, upperExclusiveUs: 13, widthUs: 8 },
    });
  });
  it('uses each RSS window and excludes a phase-crossing RSS acquisition independently of CPU', async () => {
    const input = packet(await fixture(), {
      phases: [
        { id: 'one', kind: 'idle', steady: true, startUs: 0, endUs: 1000007 },
        { id: 'two', kind: 'workload', steady: true, startUs: 1000007, endUs: 4000000 },
      ],
    });
    const r = evaluate(input);
    expect(r.intervals[0].rateBounds).not.toBeNull();
    expect(r.intervals[1].reason).toBe('phase-boundary');
    expect(r.memory[1]).toMatchObject({ residentBytes: null, reason: 'phase-boundary' });
    expect(r.memory[2]).toMatchObject({ phaseId: 'two', residentBytes: 4096, reason: null });
  });
  it('cannot replace CPU brackets with a scheduler timestamp at a phase boundary', async () => {
    const input = packet(await fixture(), {
      phases: [{ id: 'one', kind: 'idle', steady: true, startUs: 0, endUs: 1000003 }],
    });
    expect(input.raw.samples[1].actualUs).toBeLessThan(input.plan.phases[0].endUs);
    expect(evaluate(input).intervals[0]).toMatchObject({
      reason: 'phase-boundary',
      rateBounds: null,
    });
  });
  it('accounts for the extra floor-quantization microsecond even on zero-width recorded brackets', async () => {
    const input = packet(await fixture());
    for (const s of input.raw.samples) s.cpu.afterUs = s.cpu.beforeUs;
    const r = evaluate(input);
    expect(r.intervals[0]).toMatchObject({
      elapsedMinUs: 999999,
      elapsedMaxUs: 1000001,
      uncertaintyUs: 2,
    });
  });
  it('enforces caller acquisition width and CPU uncertainty limits without defaults', async () => {
    const raw = await fixture();
    expect(evaluate(packet(raw, { maxAcquisitionUs: 5 })).intervals[0].reason).toBe(
      'acquisition-too-wide',
    );
    expect(evaluate(packet(raw, { maxAcquisitionUs: 6 })).intervals[0].reason).toBeNull();
    expect(evaluate(packet(raw, { maxCpuUncertaintyUs: 11 })).intervals[0].reason).toBe(
      'cpu-time-uncertainty',
    );
    expect(evaluate(packet(raw, { maxCpuUncertaintyUs: 12 })).intervals[0].reason).toBeNull();
    const input = packet(raw);
    delete input.plan.maxAcquisitionUs;
    expect(() => evaluate(input)).toThrow('bracketed-resource-input-invalid');
  });
  it('preserves a regressing user counter despite a positive combined difference', async () => {
    const input = packet(await fixture());
    input.raw.samples[1].cpu.userUs = 90;
    input.raw.samples[1].cpu.systemUs = 1000;
    expect(evaluate(input).intervals[0]).toMatchObject({
      user: { deltaUs: null, reason: 'counter-regressed' },
      system: { deltaUs: 980, reason: null },
      deltaCpuUs: null,
      reason: 'counter-regressed',
      rateBounds: null,
    });
  });
  it('keeps a separate system regression and acquisition ordering refusal', async () => {
    const input = packet(await fixture());
    input.raw.samples[1].cpu.systemUs = 10;
    expect(evaluate(input).intervals[0]).toMatchObject({
      user: { deltaUs: 100, reason: null },
      system: { deltaUs: null, reason: 'counter-regressed' },
      rateBounds: null,
    });
    input.raw.samples[1].cpu.systemUs = 40;
    input.raw.samples[1].cpu.beforeUs = 999999;
    expect(evaluate(input).intervals[0]).toMatchObject({
      reason: 'acquisition-order',
      rateBounds: null,
    });
  });
  it('retains unavailable counters and clock reasons without substituting zeros', async () => {
    const input = packet(await fixture());
    const read = input.raw.samples[1].cpu;
    read.reason = 'api-unavailable';
    read.userUs = null;
    read.systemUs = null;
    input.raw.complete = false;
    expect(evaluate(input).intervals[0]).toMatchObject({
      user: { deltaUs: null, reason: 'counter-unavailable' },
      rateBounds: null,
    });
    read.userUs = 200;
    read.systemUs = 40;
    read.afterUs = null;
    read.reason = 'clock-unavailable';
    const r = evaluate(input);
    expect(r.intervals[0]).toMatchObject({
      reason: 'bracket-unavailable',
      user: { deltaUs: null, reason: 'acquisition-unavailable' },
    });
    expect(r.raw.samples[1].cpu.reason).toBe('clock-unavailable');
    expect(r.memory[1].residentBytes).toBe(4096);
  });
  it('keeps actual zero distinct from absent scheduled tail and never adds a closing sample', async () => {
    const input = packet(await fixture({ maxSamples: 1 }));
    Object.assign(input.raw.samples[0].cpu, { userUs: 0, systemUs: 0 });
    input.raw.samples[0].rss.residentBytes = 0;
    const r = evaluate(input);
    expect(r.intervals).toEqual([]);
    expect(r.memory[0].residentBytes).toBe(0);
    expect(r.schedule.map((x) => x.state)).toEqual([
      'observed',
      'unattempted',
      'unattempted',
      'unattempted',
    ]);
    expect(r.raw.unattempted).toEqual({
      firstScheduledUs: 1000000,
      count: 3,
      reason: 'sample-limit',
    });
    expect(r.boundaries).toMatchObject({
      plannedEndUs: 4000000,
      closingScheduledPoint: false,
      reason: 'end-exclusive-schedule',
    });
    const full = packet(await fixture());
    for (const s of full.raw.samples) Object.assign(s.cpu, { userUs: 0, systemUs: 0 });
    expect(evaluate(full).intervals[0].rateBounds.lower.numerator).toBe(0);
    expect(evaluate(full).boundaries.closingScheduledPoint).toBe(false);
    expect(evaluate(full)).not.toHaveProperty('complete');
    expect(evaluate(full)).not.toHaveProperty('estimates');
  });
  it('retains missed interior points and terminal tail rather than bridging them', async () => {
    const input = packet(await fixture());
    input.raw.samples = [input.raw.samples[0], input.raw.samples[2]];
    input.raw.missed = [{ scheduledUs: 1000000, reason: 'scheduler-late' }];
    input.raw.unattempted = { firstScheduledUs: 3000000, count: 1, reason: 'cancelled' };
    input.raw.stopReason = 'cancelled';
    input.raw.complete = false;
    const r = evaluate(input);
    expect(r.intervals[0]).toMatchObject({ reason: 'missing-scheduled-sample', rateBounds: null });
    expect(r.schedule.map((x) => x.state)).toEqual([
      'observed',
      'missed',
      'observed',
      'unattempted',
    ]);
    input.raw.missed = [];
    expect(() => evaluate(input)).toThrow('bracketed-resource-input-invalid');
  });
  it('keeps an entirely unobserved cancelled plan empty and unknown', async () => {
    const controller = new AbortController();
    controller.abort();
    const r = evaluate(packet(await fixture({ signal: controller.signal })));
    expect(r.intervals).toEqual([]);
    expect(r.memory).toEqual([]);
    expect(r.boundaries.firstCpu).toBeNull();
    expect(r.boundaries.lastCpu).toBeNull();
    expect(r.schedule.every((x) => x.state === 'unattempted')).toBe(true);
  });
  it('refuses overlapping timing enclosures and unsafe counter sums', async () => {
    const input = packet(await fixture(), {
      maxAcquisitionUs: 2000000,
      maxCpuUncertaintyUs: 4000000,
    });
    input.raw.samples[0].cpu.afterUs = 1000000;
    expect(evaluate(input).intervals[0]).toMatchObject({
      reason: 'overlapping-acquisitions',
      rateBounds: null,
    });
    input.raw.samples[0].cpu.afterUs = 5;
    Object.assign(input.raw.samples[0].cpu, { userUs: 0, systemUs: 0 });
    Object.assign(input.raw.samples[1].cpu, {
      userUs: Number.MAX_SAFE_INTEGER,
      systemUs: Number.MAX_SAFE_INTEGER,
    });
    expect(evaluate(input).intervals[0]).toMatchObject({
      reason: 'numeric-overflow',
      deltaCpuUs: null,
      rateBounds: null,
    });
    input.raw.samples[0].cpu.afterUs = Number.MAX_SAFE_INTEGER;
    expect(evaluate(input).intervals[0]).toMatchObject({
      reason: 'numeric-overflow',
      rateBounds: null,
    });
  });
  it('excludes nonsteady phases and preserves phase gaps', async () => {
    const input = packet(await fixture(), {
      phases: [{ id: 'warm', kind: 'warmup', steady: false, startUs: 0, endUs: 2000000 }],
    });
    const r = evaluate(input);
    expect(r.intervals[0].reason).toBe('nonsteady-phase');
    expect(r.memory[0].reason).toBe('nonsteady-phase');
    expect(r.memory[3].reason).toBe('phase-boundary');
  });
  it.each([
    'scope',
    'units',
    'population',
    'source',
    'plan',
    'count',
    'duplicate',
    'getter',
    'symbol',
    'sparse',
    'provenance',
    'alias',
  ])('rejects malformed or nonordinary %s input with a fixed error', async (kind) => {
    const input = packet(await fixture());
    let getterCalls = 0;
    if (kind === 'scope') input.raw.scope = 'whole-product';
    if (kind === 'units') input.raw.units.cpu = 'ms';
    if (kind === 'population') input.raw.population.complete = true;
    if (kind === 'source') input.raw.sources.cpu = 'unverified';
    if (kind === 'plan') input.plan.runId = 'foreign';
    if (kind === 'count') input.raw.plannedPoints++;
    if (kind === 'duplicate') input.raw.missed.push({ scheduledUs: 0, reason: 'scheduler-late' });
    if (kind === 'getter')
      Object.defineProperty(input.provenance, 'sourceSha256', {
        get: () => {
          getterCalls++;
          throw Error('private-canary');
        },
        enumerable: true,
      });
    if (kind === 'symbol') input[Symbol('private-canary')] = 1;
    if (kind === 'sparse') delete input.raw.samples[1];
    if (kind === 'provenance') input.provenance.sourceSha256 = 'private-canary';
    if (kind === 'alias') input.raw.samples[1] = input.raw.samples[0];
    expect(() => evaluate(input)).toThrow(/^bracketed-resource-input-invalid$/);
    expect(getterCalls).toBe(0);
  });
  it.each([
    'negative',
    'fraction',
    'large',
    'invalid-phase',
    'too-many-phases',
    'missing-missed',
    'long-string',
    'extra-array-key',
    'cycle',
    'null-missed',
  ])('bounds or refuses %s before producing evidence', async (kind) => {
    const input = packet(await fixture());
    if (kind === 'negative') input.raw.samples[0].cpu.userUs = -1;
    if (kind === 'fraction') input.raw.samples[0].rss.residentBytes = 0.5;
    if (kind === 'large') input.raw.samples[0].cpu.afterUs = Number.MAX_SAFE_INTEGER + 1;
    if (kind === 'invalid-phase') input.plan.phases[0].steady = 'yes';
    if (kind === 'too-many-phases')
      input.plan.phases = Array.from({ length: 17 }, (_, i) => ({
        id: `p${i}`,
        kind: 'idle',
        steady: true,
        startUs: i,
        endUs: i + 1,
      }));
    if (kind === 'missing-missed') input.raw.samples.shift();
    if (kind === 'long-string') input.provenance.sourceSha256 = 'x'.repeat(129);
    if (kind === 'extra-array-key') input.raw.samples.extra = 1;
    if (kind === 'cycle') input.plan.phases[0] = input;
    if (kind === 'null-missed') input.raw.missed.push(null);
    expect(() => evaluate(input)).toThrow(/^bracketed-resource-input-invalid$/);
  });
  it('returns independent deterministic evidence without product module dependencies', async () => {
    const input = packet(await fixture());
    const a = evaluate(input),
      b = evaluate(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.raw).not.toBe(input.raw);
    expect(a.raw.samples[0]).not.toBe(input.raw.samples[0]);
    expect(require.cache[require.resolve(entry)].children).toHaveLength(0);
  });
});
