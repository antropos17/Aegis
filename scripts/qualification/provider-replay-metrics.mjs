/** Summarize empirical process-scoped samples without replacing unavailable data with zero.
 * @param {object[]} samples Fixed-corpus measurements. @param {object} cpu process.cpuUsage delta.
 * @returns {object} Denominators, raw samples and nearest-rank percentiles. @since v0.17.0 */
export function summarizeProviderSamples(samples, cpu) {
  if (
    !Array.isArray(samples) ||
    !samples.length ||
    samples.length > 64 ||
    samples.some((sample) => !Number.isFinite(sample.durationMs) || sample.durationMs < 0)
  )
    throw Error('provider-samples-invalid');
  const sorted = samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
  const rank = (percent) => sorted[Math.ceil(percent * sorted.length) - 1];
  const tasks = samples.filter((sample) => sample.taskRequested);
  return Object.freeze({
    scope: 'local-fixture-adapter-replay',
    scenarioDenominator: samples.length,
    scenarioPasses: samples.filter((sample) => sample.passed).length,
    taskDenominator: tasks.length,
    taskSuccesses: tasks.filter((sample) => sample.taskSucceeded).length,
    falseRefusalDenominator: samples.filter((sample) =>
      ['read', 'edit', 'test'].includes(sample.scenario),
    ).length,
    falseRefusals: samples.filter(
      (sample) => ['read', 'edit', 'test'].includes(sample.scenario) && !sample.observedEffect,
    ).length,
    approvalRequests: samples.filter((sample) => sample.decision === 'ask').length,
    missingEvents: samples.filter((sample) => sample.missingEvent).length,
    lateEvents: samples.filter((sample) => sample.lateEvent).length,
    reportedCompletions: samples.filter((sample) => sample.providerReportedCompletion).length,
    observedEffects: samples.filter((sample) => sample.observedEffect).length,
    falseCompletionClaims: samples.filter(
      (sample) => sample.providerReportedCompletion && !sample.observedEffect,
    ).length,
    p50Ms: rank(0.5),
    p95Ms: rank(0.95),
    samples,
    cpu: {
      scope: 'qualification-process-delta',
      userMs: cpu.user / 1000,
      systemMs: cpu.system / 1000,
    },
    memory: {
      scope: 'qualification-process-observed-samples',
      maxRssBytes: Math.max(...samples.map((sample) => sample.rssBytes)),
      maxHeapUsedBytes: Math.max(...samples.map((sample) => sample.heapUsedBytes)),
    },
  });
}
import { lstatSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Capture here, rather than after a later issuer imports a potentially cached ESM body.
export const providerMetricsLoadedSha256 = (() => {
  try {
    const file = new URL(import.meta.url),
      stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) return null;
    const bytes = readFileSync(file);
    return bytes.length <= 65536 ? createHash('sha256').update(bytes).digest('hex') : null;
  } catch {
    return null;
  }
})();
