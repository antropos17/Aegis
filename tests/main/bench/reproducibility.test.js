// Synthetic declarations; no resource collection or calibration is established.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { hashPlan, evaluateReproducibility } = require('../../../bench/lib/reproducibility.js');
const { evaluateResourceIntervals } = require('../../../bench/lib/resource-intervals.js');
function fixture(values = [1, 2, 3]) {
  const hashes = Object.fromEntries(
    [
      'sourceSha256',
      'harnessSha256',
      'binarySha256',
      'configSha256',
      'inputSha256',
      'agentVersionsSha256',
      'providerVersionsSha256',
      'osImageSha256',
      'calibrationSha256',
    ].map((key) => [key, 'a'.repeat(64)]),
  );
  const identity = {
    commit: 'b'.repeat(40),
    ...hashes,
    machine: 'fixture',
    os: 'fixture-os',
    agentVersions: 'fixture-v1',
    sensorMode: 'fixture',
    method: 'declared-offline',
    privileges: 'ordinary',
  };
  const key = { metric: 'cpu', phase: 'idle', cohort: 'aegis', percentile: 'p50', unit: 'percent' };
  const plan = {
    id: 'plan-1',
    version: 1,
    frozenAt: '2026-10-24T00:00:00.000Z',
    identity,
    runIds: ['r1', 'r2', 'r3'],
    cells: [
      {
        ...key,
        A: 2,
        plannedCount: 4,
        R: 0,
        rationaleId: 'declared-calibration',
        rationaleSha256: 'c'.repeat(64),
        calibrationUncertainty: { value: 0, reason: null },
      },
    ],
  };
  const runs = values.map((estimate, index) => ({
    runId: plan.runIds[index],
    startedAt: `2026-10-24T00:00:0${index + 1}.000Z`,
    identity: structuredClone(identity),
    cells: [
      {
        ...key,
        status: 'complete',
        estimate,
        reason: null,
        counts: { planned: 4, valid: 4, excluded: 0, missing: 0, failed: 0 },
      },
    ],
  }));
  return {
    schema: 'reproducibility-input',
    schemaVersion: 1,
    planSha256: hashPlan(plan),
    plan,
    runs,
  };
}
const evaluate = (input) => {
  input.planSha256 = hashPlan(input.plan);
  return evaluateReproducibility(input);
};
describe('declared three-run reproducibility', () => {
  it('sorts an unsorted vector before computing exact extrema and median', () => {
    const input = fixture([4, 1, 2]);
    input.plan.cells[0].A = 3;
    expect(evaluate(input).cells[0]).toMatchObject({
      estimates: [4, 1, 2],
      minimum: '1',
      median: '2',
      maximum: '4',
      range: '3',
      bound: '3',
      verdict: 'within-declared-bound',
    });
  });
  it('isolates p50 and p95 cells and emits estimates in plan run order despite shuffling', () => {
    const input = fixture([4, 1, 2]);
    input.plan.cells[0].A = 3;
    input.plan.cells.push({ ...structuredClone(input.plan.cells[0]), percentile: 'p95', A: 40 });
    input.plan.runIds = ['r2', 'r3', 'r1'];
    for (const [index, run] of input.runs.entries()) {
      run.cells.push({
        ...structuredClone(run.cells[0]),
        percentile: 'p95',
        estimate: [100, 140, 120][index],
      });
      if (index !== 1) run.cells.reverse();
    }
    input.runs = [input.runs[2], input.runs[0], input.runs[1]];
    const output = evaluate(input);
    expect(output.cells).toMatchObject([
      {
        percentile: 'p50',
        estimates: [1, 2, 4],
        minimum: '1',
        median: '2',
        maximum: '4',
        range: '3',
        bound: '3',
        verdict: 'within-declared-bound',
      },
      {
        percentile: 'p95',
        estimates: [140, 120, 100],
        minimum: '100',
        median: '120',
        maximum: '140',
        range: '40',
        bound: '40',
        verdict: 'within-declared-bound',
      },
    ]);
    expect(output.runs).toEqual(input.runs);
  });
  it('adds nonzero absolute and relative tolerances at the exact threshold', () => {
    const input = fixture([1, 2, 4]);
    Object.assign(input.plan.cells[0], { A: 1, R: 1 });
    expect(evaluate(input).cells[0]).toMatchObject({
      median: '2',
      range: '3',
      bound: '3',
      verdict: 'within-declared-bound',
    });
  });
  it('refuses a short valid population even when other incomplete counters are zero', () => {
    const input = fixture();
    input.runs[0].cells[0].counts.valid = 3;
    expect(evaluate(input).cells[0]).toMatchObject({
      estimates: [1, 2, 3],
      verdict: 'ineligible',
      minimum: null,
      median: null,
      maximum: null,
      reasons: ['incomplete-population'],
    });
  });
  it('rejects an array status that would coerce to a recognized failure reason', () => {
    const input = fixture();
    Object.assign(input.runs[0].cells[0], {
      status: ['failed'],
      estimate: null,
      reason: 'run-failed',
    });
    expect(() => evaluate(input)).toThrow('reproducibility-input-invalid');
  });
  it.each([
    [[0.1, 0.2, 0.3], 0.2, 0, 'within-declared-bound', '0.2'],
    [[0.1, 0.2, 0.3], 0.19999999999999998, 0, 'outside-declared-bound', '0.2'],
    [[-1, 0, 1], 0, 1e308, 'outside-declared-bound', '2'],
    [[0, 0, 0], 0, 0, 'within-declared-bound', '0'],
    [[-3, -2, -1], 0, 1, 'within-declared-bound', '2'],
    [[-1.7e308, -1.7e308, 1.7e308], 1.7e308, 0.5, 'outside-declared-bound', '34' + '0'.repeat(307)],
    [[5e-324, 5e-324, 1e-323], 5e-324, 0, 'within-declared-bound', '0.' + '0'.repeat(323) + '5'],
  ])('compares exact canonical decimals %#', (values, A, R, verdict, range) => {
    const input = fixture(values);
    Object.assign(input.plan.cells[0], { A, R });
    expect(evaluate(input).cells[0]).toMatchObject({ verdict, range });
  });
  it.each(['failed', 'refused', 'timed-out', 'not-started', 'incomplete'])(
    'retains %s rows with null estimates',
    (status) => {
      const input = fixture();
      const reasons = {
        failed: 'run-failed',
        refused: 'run-refused',
        'timed-out': 'run-timed-out',
        'not-started': 'not-started',
        incomplete: 'incomplete-population',
      };
      Object.assign(input.runs[0].cells[0], { status, estimate: null, reason: reasons[status] });
      if (status === 'not-started') input.runs[0].startedAt = null;
      const result = evaluate(input);
      expect(result.runs[0]).toEqual(input.runs[0]);
      expect(result.cells[0].verdict).toBe('ineligible');
      expect(result.cells[0].estimates).toEqual([null, 2, 3]);
    },
  );
  it.each(['excluded', 'missing', 'failed'])(
    'does not trust complete status over %s counts',
    (field) => {
      const input = fixture();
      input.runs[0].cells[0].counts[field] = 1;
      expect(evaluate(input).cells[0].reasons).toContain('incomplete-population');
    },
  );
  it.each(['2026-10-24T00:00:01.000Z', '2026-10-24T00:00:01.500Z', '2026-10-24T00:00:02.000Z'])(
    'requires freeze strictly before every start: %s',
    (frozenAt) => {
      const input = fixture();
      input.plan.frozenAt = frozenAt;
      expect(evaluate(input).cells[0].reasons).toContain('plan-not-before-start');
    },
  );
  it('retains noncomparable identities and unknown calibration as ineligible', () => {
    const input = fixture();
    input.runs[0].identity.inputSha256 = 'f'.repeat(64);
    input.plan.cells[0].calibrationUncertainty = { value: null, reason: 'not-calibrated' };
    const result = evaluate(input);
    expect(result.cells[0].reasons).toEqual([
      'comparison-identity-mismatch',
      'unknown-calibration-uncertainty',
    ]);
    expect(result.runs).toEqual(input.runs);
    expect(result).toMatchObject({
      sourceAuthenticated: false,
      collectionQualified: false,
      measurementAccepted: false,
    });
  });
  it('does not add calibration uncertainty to the declared A/R formula', () => {
    const input = fixture();
    input.plan.cells[0].A = 1;
    input.plan.cells[0].calibrationUncertainty.value = 100;
    expect(evaluate(input).cells[0]).toMatchObject({
      bound: '1',
      verdict: 'outside-declared-bound',
    });
  });
  it.each([
    (x) => x.runs.pop(),
    (x) => x.runs.push(structuredClone(x.runs[0])),
    (x) => x.plan.runIds.push('r4'),
    (x) => (x.plan.runIds[1] = 'r1'),
    (x) => x.runs[0].cells.pop(),
    (x) => x.runs[0].cells.push(structuredClone(x.runs[0].cells[0])),
    (x) => (x.runs[0].cells[0].unit = 'bytes'),
    (x) => (x.runs[0].cells[0].metric = 'other'),
    (x) => (x.plan.cells[0].A = null),
    (x) => (x.plan.cells[0].R = -1),
    (x) => (x.plan.cells[0].R = Infinity),
    (x) => (x.plan.cells[0].A = '2'),
    (x) => delete x.plan.cells[0].rationaleSha256,
    (x) => (x.plan.identity.commit = 'bad'),
    (x) => (x.runs[0].cells[0].estimate = null),
    (x) => (x.runs[0].cells[0].counts.valid = '4'),
    (x) => (x.plan.cells[0].plannedCount = true),
    (x) => (x.runs[0].startedAt = 'local-time'),
    (x) => (x.extra = 'private'),
    (x) => (x.plan.cells = Array(65).fill(x.plan.cells[0])),
    (x) => (x.runs[0].cells[0] = null),
  ])('refuses malformed/structurally incomplete declarations %#', (change) => {
    const input = fixture();
    change(input);
    expect(() => evaluate(input)).toThrow('reproducibility-input-invalid');
  });
  it('refuses a changed plan whose declared hash was not updated', () => {
    const input = fixture();
    input.plan.cells[0].A = 100;
    expect(() => evaluateReproducibility(input)).toThrow('reproducibility-input-invalid');
  });
  it('composes actual resource interval estimates without pooling runs', () => {
    const estimates = [1, 2, 3].map((cpuUs) =>
      evaluateResourceIntervals({
        version: 'resource-intervals/1',
        runId: `resource-${cpuUs}`,
        cadenceUs: 1000000,
        sampleWindow: { startUs: 0, endUs: 1000000 },
        units: { wall: 'us', cpu: 'us', memory: 'bytes' },
        provenance: { collectorId: 'fixture', clockId: 'fixture', sourceSha256: 'a'.repeat(64) },
        memory: {
          platform: 'linux',
          definition: 'rss',
          api: 'fixture',
          sharedPages: 'may-double-count',
        },
        phases: [{ id: 'idle', kind: 'idle', steady: true, startUs: 0, endUs: 1000000 }],
        cohorts: ['aegis'],
        lifetimes: [{ id: 'main', pid: 42, cohort: 'aegis', startUs: 0, endUs: null }],
        samples: [0, 1].map((n) => ({
          id: `s-${n}`,
          scheduledUs: n * 1000000,
          actualUs: n * 1000000,
          populationKnown: true,
          members: [
            { lifetime: 'main', userUs: n * cpuUs * 10000, kernelUs: 0, residentBytes: 100 },
          ],
        })),
      }).estimates.find((cell) => cell.metric === 'cpu-one-core-pct'),
    );
    expect(estimates.map((cell) => cell.p50)).toEqual([1, 2, 3]);
    const input = fixture(estimates.map((cell) => cell.p50));
    input.plan.cells[0].metric = 'cpu-one-core-pct';
    input.plan.cells[0].unit = estimates[0].unit;
    input.plan.cells[0].plannedCount = 1;
    for (const [index, run] of input.runs.entries()) {
      run.cells[0].metric = 'cpu-one-core-pct';
      run.cells[0].unit = estimates[index].unit;
      run.cells[0].counts = {
        planned: 1,
        valid: estimates[index].validCount,
        excluded: estimates[index].excluded.length,
        missing: 0,
        failed: 0,
      };
    }
    expect(evaluate(input).cells[0]).toMatchObject({
      estimates: [1, 2, 3],
      range: '2',
      verdict: 'within-declared-bound',
    });
  });
  it('refuses a changed planned population even when the row declares itself complete', () => {
    const input = fixture();
    Object.assign(input.runs[0].cells[0].counts, { planned: 8, valid: 8 });
    expect(evaluate(input).cells[0]).toMatchObject({
      verdict: 'ineligible',
      reasons: ['planned-count-mismatch'],
    });
  });
  it('refuses duplicated roster rows instead of selecting three convenient estimates', () => {
    const input = fixture();
    input.runs[1].runId = 'r1';
    expect(() => evaluate(input)).toThrow('reproducibility-input-invalid');
  });
  it('retains failed attempts and refuses arithmetic over an incomplete repetition', () => {
    const input = fixture();
    Object.assign(input.runs[1].cells[0], {
      status: 'failed',
      estimate: null,
      reason: 'run-failed',
      counts: { planned: 4, valid: 0, excluded: 0, missing: 0, failed: 4 },
    });
    const result = evaluate(input);
    expect(result.cells[0]).toMatchObject({
      verdict: 'ineligible',
      estimates: [1, null, 3],
      minimum: null,
      maximum: null,
      median: null,
      range: null,
      bound: null,
      reasons: ['incomplete-repetition', 'incomplete-population'],
    });
    expect(result.runs).toEqual(input.runs);
  });
  it('accepts equality at the declared bound and retains every planned estimate', () => {
    const input = fixture();
    const result = evaluateReproducibility(input);
    expect(result.cells).toHaveLength(1);
    expect(result.cells[0]).toMatchObject({
      verdict: 'within-declared-bound',
      estimates: [1, 2, 3],
      minimum: '1',
      maximum: '3',
      median: '2',
      range: '2',
      bound: '2',
    });
    expect(result.plan).toEqual(input.plan);
    expect(result.runs).toEqual(input.runs);
  });
});
