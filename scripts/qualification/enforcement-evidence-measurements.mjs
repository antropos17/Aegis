import { performance } from 'node:perf_hooks';

/** Measure one tool call after setup, including its local receiver's work.
 * @param {() => Promise<object>} run Fixed internal scenario.
 * @returns {Promise<object>} Scenario result with process-local empirical samples. @since v0.19.2 */
export async function measureEvidenceScenario(run) {
  const cpu = process.cpuUsage();
  const before = process.memoryUsage();
  const started = performance.now();
  const result = await run();
  const durationMs = performance.now() - started;
  const used = process.cpuUsage(cpu);
  const after = process.memoryUsage();
  return {
    result,
    measurement: {
      durationMs,
      userCpuMs: used.user / 1000,
      systemCpuMs: used.system / 1000,
      observedRssBytes: Math.max(before.rss, after.rss),
      observedHeapUsedBytes: Math.max(before.heapUsed, after.heapUsed),
    },
  };
}

/** Summarize matched direct/gateway workflows without promoting unavailable comparisons.
 * @param {object[]} samples Ordered fixed-corpus measurements with independent effect counts.
 * @returns {object} Raw samples, denominators and process-scoped nearest-rank percentiles. @since v0.19.2 */
export function summarizeEvidenceMeasurements(samples) {
  if (!Array.isArray(samples) || samples.length !== 6) throw Error('measurement-corpus-invalid');
  const groups = {};
  for (const arm of ['direct', 'gateway']) {
    const rows = samples.filter((row) => row.arm === arm);
    if (
      rows.length !== 3 ||
      rows.some(
        (row) =>
          !Number.isSafeInteger(row.observedEffects) ||
          row.observedEffects < 0 ||
          typeof row.completed !== 'boolean' ||
          typeof row.passed !== 'boolean' ||
          !row.measurement ||
          ![
            'durationMs',
            'userCpuMs',
            'systemCpuMs',
            'observedRssBytes',
            'observedHeapUsedBytes',
          ].every((key) => Number.isFinite(row.measurement[key]) && row.measurement[key] >= 0),
      )
    )
      throw Error('measurement-corpus-invalid');
    const durations = rows.map((row) => row.measurement.durationMs).sort((a, b) => a - b);
    groups[arm] = {
      sampleCount: rows.length,
      taskDenominator: rows.length,
      taskSuccesses: rows.filter((row) => row.completed && row.observedEffects === 1).length,
      observedEffects: rows.reduce((sum, row) => sum + row.observedEffects, 0),
      completionsWithoutObservedEffect: rows.filter(
        (row) => row.completed && row.observedEffects !== 1,
      ).length,
      p50Ms: durations[Math.ceil(rows.length * 0.5) - 1],
      p95Ms: durations[Math.ceil(rows.length * 0.95) - 1],
    };
  }
  return {
    scope: 'local-generated-policy-gateway-workflow',
    timingScope: 'one-tools-call-excluding-setup-replay-cleanup',
    cpuScope: 'qualification-process-delta-including-loopback-receiver',
    memoryScope: 'qualification-process-before-after-samples-not-peak',
    warmupSamplesExcluded: 0,
    samples,
    groups,
    notRun: ['protected-session', 'installed-claude', 'installed-codex', 'other-products'],
  };
}
