import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { evaluateNativeResources } = require('../../../bench/lib/native-resource-model');
const { summarizeResourceRun, resourceMarkdown } = require('../../../bench/lib/native-task-report');
function repetition() {
  return {
    id: 'rep1',
    ready: { pid: 123, birthTicks: '456' },
    samples: Array.from({ length: 4 }, (_, i) => ({
      id: 's' + i,
      scheduledUs: i * 1000000,
      actualUs: i * 1000000 + 100,
      acquisitionUs: 200,
      before: { birthTicks: '456', userUs: i * 100000, kernelUs: 0 },
      self: { cpuUs: i * 100000 + 1, workingSetBytes: 2000000 },
      after: { birthTicks: '456', userUs: i * 100000 + 2, kernelUs: 0, residentBytes: 2000000 },
    })),
    usefulOutput: [{ exactBytes: true, inventoryMatches: true }],
    cleanup: { worker: { code: 0 } },
  };
}
describe('actual native resource evidence consumers', () => {
  it('uses raw counters in the existing evaluator and retains late final boundary exclusion', () => {
    const result = evaluateNativeResources(repetition(), 'a'.repeat(64));
    expect(result.corroboration.state).toBe('corroborated');
    expect(result.result.estimates.find((x) => x.metric === 'cpu-one-core-pct').p50).toBe(10);
    expect(result.result.intervals.at(-1).reason).toBe('phase-boundary');
    expect(result.result.memorySamples.at(-1).reason).toBe('outside-phase');
  });
  it('refuses scale disagreements and changed birth identity rather than publishing valid cohort totals', () => {
    const r = repetition();
    r.samples[1].self.cpuUs *= 10;
    r.samples[2].after.birthTicks = '999';
    const result = evaluateNativeResources(r, 'a'.repeat(64));
    expect(result.corroboration.state).toBe('refused-or-incomplete');
    expect(result.result.estimates.every((x) => x.p50 === null)).toBe(true);
  });
  it('retains missing points and never promotes observed workload resources into calibrated product overhead', () => {
    const r = repetition();
    r.samples.splice(1, 1);
    r.evaluation = evaluateNativeResources(r, 'a'.repeat(64));
    expect(r.evaluation.result.missingScheduledUs).toEqual([1000000]);
    const context = {
      sourceCommit: 'a'.repeat(40),
      machine: 'fixture',
      os: { release: 'fixture', arch: 'x64' },
      agent: { version: 'fixture' },
    };
    const summary = summarizeResourceRun({ context, repetitions: [r] });
    expect(summary.productOverhead).toEqual({ cpu: null, rss: null });
    expect(summary.sensor.recall).toBeNull();
    expect(resourceMarkdown(summary)).toContain('not captured');
  });
});
