import { expect, it } from 'vitest';
import {
  measureEvidenceScenario,
  summarizeEvidenceMeasurements,
} from '../../scripts/qualification/enforcement-evidence-measurements.mjs';

const corpus = () =>
  ['direct', 'gateway'].flatMap((arm) =>
    [1, 2, 30].map((durationMs, pair) => ({
      arm,
      pair,
      passed: true,
      completed: true,
      observedEffects: 1,
      measurement: {
        durationMs,
        userCpuMs: 0,
        systemCpuMs: 0,
        observedRssBytes: 10,
        observedHeapUsedBytes: 5,
      },
    })),
  );

it('retains failures and false completion claims in the task denominator and raw samples', () => {
  const samples = corpus();
  samples[3].passed = false;
  samples[3].observedEffects = 0;
  samples[4].completed = false;
  const report = summarizeEvidenceMeasurements(samples);
  expect(report.groups.gateway).toMatchObject({
    sampleCount: 3,
    taskDenominator: 3,
    taskSuccesses: 1,
    observedEffects: 2,
    completionsWithoutObservedEffect: 1,
    p50Ms: 2,
    p95Ms: 30,
  });
  expect(report.samples[3].passed).toBe(false);
  expect(report.notRun).toContain('installed-codex');
});

it('refuses missing or invalid measurements rather than replacing them with zero or dropping them', () => {
  const samples = corpus();
  expect(() => summarizeEvidenceMeasurements(samples.slice(1))).toThrow(
    'measurement-corpus-invalid',
  );
  for (const value of [undefined, NaN, Infinity, -1]) {
    samples[0].measurement.userCpuMs = value;
    expect(() => summarizeEvidenceMeasurements(samples)).toThrow('measurement-corpus-invalid');
  }
});

it('measures the awaited operation and propagates unexpected execution failure', async () => {
  const row = await measureEvidenceScenario(async () => ({ completed: true }));
  expect(row.result).toEqual({ completed: true });
  expect(row.measurement.durationMs).toBeGreaterThanOrEqual(0);
  expect(row.measurement.observedRssBytes).toBeGreaterThan(0);
  await expect(
    measureEvidenceScenario(async () => {
      throw Error('failed');
    }),
  ).rejects.toThrow('failed');
});
