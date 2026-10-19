import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const {
  evaluatePairedTaskLatency: evaluate,
} = require('../../../bench/lib/paired-task-latency.js');
const { hashTaskEvidence: hash } = require('../../../bench/lib/task-false-alarms.js');
const SHA = 'a'.repeat(64),
  OTHER = 'b'.repeat(64);
const IDENTITY = [
  'agent',
  'provider',
  'model',
  'binary',
  'harness',
  'osImage',
  'privilege',
  'oracle',
  'generator',
  'instrumentation',
  'configuration',
];
function fixture() {
  const common = Object.fromEntries(IDENTITY.map((k) => [k + 'Sha256', SHA]));
  const tasks = [0, 1, 2, 3].map((n) => ({
    taskId: 't' + n,
    definitionSha256: SHA,
    rubricSha256: SHA,
    fixtureSha256: SHA,
    seedSha256: SHA,
    eligible: true,
    timeoutMs: 5000,
    scheduledMs: 6000,
  }));
  const pairs = [0, 1, 2].map((n) => ({
    pairId: 'p' + n,
    order: n % 2 ? ['enabled', 'disabled'] : ['disabled', 'enabled'],
  }));
  const plan = {
    planId: 'frozen',
    common,
    treatment: { disabled: { monitoringEnabled: false }, enabled: { monitoringEnabled: true } },
    tasks,
    pairs,
  };
  const durations = [
    [
      [10, 20, 30, 100],
      [20, 10, 60, 100],
    ],
    [
      [1, 2, 3, 4],
      [2, 4, 6, 8],
    ],
    [
      [100, 200, 300, 400],
      [50, 100, 150, 200],
    ],
  ];
  return {
    version: 'paired-task-latency/1',
    evidenceKind: 'synthetic',
    units: 'monotonic-ms',
    planSha256: hash(plan),
    plan,
    pairs: pairs.map((p, i) => ({
      ...p,
      order: [...p.order],
      arms: ['disabled', 'enabled'].map((arm, j) => ({
        arm,
        common: { ...common },
        treatment: { ...plan.treatment[arm] },
        rows: tasks.map((t, k) => ({
          taskId: t.taskId,
          taskSha256: hash(t),
          scheduledMs: t.scheduledMs,
          started: true,
          outcome: 'completed',
          clock: {
            startDomain: arm + i,
            endDomain: arm + i,
            resolutionMs: 1,
            startMs: 10000 * i,
            endMs: 10000 * i + durations[i][j][k],
          },
          evaluation: {
            independent: true,
            oracleSha256: SHA,
            success: true,
            behavior: 'matches',
            evidenceSha256: SHA,
          },
        })),
      })),
    })),
  };
}
const row = (e) => e.pairs[0].arms[1].rows[0];
const reseal = (e) => {
  e.planSha256 = hash(e.plan);
  return e;
};
const roots = [];
afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('bounded paired task completion latency', () => {
  it('computes exact even median, nearest-rank p95, signed paired deltas and ratios per repetition', () => {
    const e = fixture(),
      before = structuredClone(e),
      result = evaluate(e);
    expect(result.comparison.status).toBe('conditional-supplied-evidence');
    expect(result.launchAllowed).toBe(false);
    expect(result.repetitions.map((r) => r.completion.disabled)).toEqual([
      { p50Ms: 25, p95Ms: 100, reason: null },
      { p50Ms: 2.5, p95Ms: 4, reason: null },
      { p50Ms: 250, p95Ms: 400, reason: null },
    ]);
    expect(result.repetitions.map((r) => r.completion.enabled.p50Ms)).toEqual([40, 5, 125]);
    expect(result.repetitions.map((r) => r.pairedRatio.p50)).toEqual([1.5, 2, 0.5]);
    expect(result.repetitions[0].taskPairs[1]).toEqual({
      taskId: 't1',
      disabledMs: 20,
      enabledMs: 10,
      deltaMs: -10,
      ratio: 0.5,
      percentChange: -50,
    });
    expect(result.repetitions.map((r) => r.denominator)).toEqual([4, 4, 4]);
    expect(e).toEqual(before);
    expect(evaluate(e)).toEqual(result);
  });
  it('uses a true median for odd cohorts and retains predeclared ineligible rows', () => {
    const e = fixture();
    e.plan.tasks[3].eligible = false;
    for (const pair of e.pairs)
      for (const arm of pair.arms) arm.rows[3].taskSha256 = hash(e.plan.tasks[3]);
    const r = evaluate(reseal(e)).repetitions[0];
    expect(r.denominator).toBe(3);
    expect(r.arms.disabled.planned).toBe(4);
    expect(r.completion.disabled).toEqual({ p50Ms: 20, p95Ms: 30, reason: null });
  });
  it('never shrinks a missing task denominator or drops the planned row', () => {
    const e = fixture();
    e.pairs[0].arms[1].rows.pop();
    const r = evaluate(e).repetitions[0];
    expect(r.denominator).toBe(4);
    expect(r.arms.enabled.missing).toBe(1);
    expect(r.arms.enabled.rows[3]).toMatchObject({
      taskId: 't3',
      row: null,
      terminalElapsedMs: null,
    });
    expect(r.completion.disabled).toEqual({
      p50Ms: null,
      p95Ms: null,
      reason: 'incomplete-planned-cohort',
    });
    expect(r.pairedRatio.p50).toBeNull();
  });
  it.each(['failed', 'refused', 'timed-out', 'unfinished', 'not-started'])(
    'retains %s with terminal elapsed separate and suppresses cohort metrics',
    (outcome) => {
      const e = fixture(),
        r = row(e);
      r.outcome = outcome;
      if (outcome === 'not-started') {
        r.started = false;
        r.clock = null;
      }
      r.evaluation.success = false;
      const scored = evaluate(e).repetitions[0];
      expect(scored.arms.enabled.outcomes[outcome]).toBe(1);
      expect(scored.arms.enabled.rows[0].row.outcome).toBe(outcome);
      expect(scored.arms.enabled.rows[0].terminalElapsedMs).toBe(
        outcome === 'not-started' ? null : 20,
      );
      expect(scored.denominator).toBe(4);
      expect(scored.completion.enabled).toEqual({
        p50Ms: null,
        p95Ms: null,
        reason: 'non-success-cohort',
      });
      expect(scored.pairedRatio.p50).toBeNull();
    },
  );
  it.each(IDENTITY)('refuses to compare mismatched %s identity declarations', (key) => {
    const e = fixture();
    e.pairs[0].arms[1].common[key + 'Sha256'] = OTHER;
    expect(evaluate(e).repetitions[0].reasons).toContain('comparison-declaration-mismatch');
    expect(evaluate(e).repetitions[0].completion.enabled.p95Ms).toBeNull();
  });
  it.each([
    'definitionSha256',
    'rubricSha256',
    'fixtureSha256',
    'seedSha256',
    'timeoutMs',
    'scheduledMs',
    'eligible',
  ])('binds task %s to the frozen plan', (key) => {
    const e = fixture();
    e.plan.tasks[0][key] =
      typeof e.plan.tasks[0][key] === 'string' ? OTHER : key === 'eligible' ? false : 123;
    expect(evaluate(reseal(e)).repetitions[0].reasons).toContain('task-plan-mismatch');
  });
  it.each([
    (e) => {
      row(e).scheduledMs--;
    },
    (e) => {
      row(e).evaluation.behavior = 'differs';
    },
    (e) => {
      row(e).evaluation.behavior = 'unknown';
    },
    (e) => {
      row(e).evaluation.independent = false;
    },
    (e) => {
      row(e).evaluation.success = false;
    },
    (e) => {
      row(e).evaluation.success = null;
    },
    (e) => {
      row(e).evaluation.evidenceSha256 = null;
    },
    (e) => {
      row(e).evaluation.oracleSha256 = OTHER;
    },
    (e) => {
      e.pairs[0].arms[1].treatment.monitoringEnabled = false;
    },
    (e) => {
      e.planSha256 = OTHER;
    },
  ])(
    'requires exposure, checked success/behavior, evidence and treatment binding (%#)',
    (change) => {
      const e = fixture();
      change(e);
      const r = evaluate(e).repetitions[0];
      expect(r.reasons.length).toBeGreaterThan(0);
      expect(r.completion.enabled.p50Ms).toBeNull();
      expect(r.completion.disabled.p95Ms).toBeNull();
      expect(r.pairedRatio.p50).toBeNull();
    },
  );
  it.each([
    (e) => {
      e.pairs.pop();
    },
    (e) => {
      e.pairs[0].order.reverse();
    },
    (e) => {
      e.pairs.reverse();
    },
    (e) => {
      e.pairs[0].arms.pop();
    },
  ])('retains missing pair/arm and changed execution order (%#)', (change) => {
    const e = fixture();
    change(e);
    const r = evaluate(e);
    expect(r.comparison.status).toBe('not-comparable');
    expect(r.repetitions).toHaveLength(3);
    expect(r.repetitions[0].completion.enabled.p50Ms).toBeNull();
  });
  it.each([
    (e) => {
      e.pairs[0].arms[1].rows.push(structuredClone(row(e)));
    },
    (e) => {
      row(e).taskId = 'replacement';
    },
    (e) => {
      e.pairs[0].pairId = 'replacement';
    },
    (e) => {
      e.pairs[1].pairId = e.pairs[0].pairId;
    },
    (e) => {
      e.plan.pairs.pop();
    },
    (e) => {
      e.plan.pairs[1].order = [...e.plan.pairs[0].order];
    },
    (e) => {
      e.plan.tasks = [];
    },
    (e) => {
      row(e).clock.startMs = -1;
    },
    (e) => {
      row(e).clock.endMs = Number.MAX_SAFE_INTEGER + 1;
    },
    (e) => {
      row(e).clock.endMs = -1;
    },
    (e) => {
      row(e).clock.resolutionMs = 0;
    },
    (e) => {
      row(e).clock.endMs = 1.5;
    },
    (e) => {
      row(e).unexpected = true;
    },
  ])('rejects duplicate/substituted rows, malformed plans and unsafe values (%#)', (change) => {
    const e = fixture();
    change(e);
    expect(() => evaluate(e)).toThrow('paired-task-latency-input-invalid');
  });
  it('keeps unknown/mixed clock domains unknown without inventing cross-run offsets', () => {
    for (const change of [
      (r) => {
        r.clock = null;
      },
      (r) => {
        r.clock.endDomain = 'other';
      },
    ]) {
      const e = fixture();
      change(row(e));
      const r = evaluate(e).repetitions[0];
      expect(r.reasons).toContain('clock-unknown');
      expect(r.arms.enabled.rows[0].terminalElapsedMs).toBeNull();
      expect(r.completion.enabled.p50Ms).toBeNull();
    }
  });
  it('permits zero duration but gives no ratio or percentage for a zero baseline', () => {
    const e = fixture();
    e.pairs[0].arms[0].rows[0].clock.endMs = 0;
    const r = evaluate(e).repetitions[0];
    expect(r.completion.disabled.p50Ms).toBe(25);
    expect(r.taskPairs[0]).toMatchObject({
      disabledMs: 0,
      enabledMs: 20,
      deltaMs: 20,
      ratio: null,
      percentChange: null,
    });
    expect(r.pairedRatio).toEqual({ p50: null, reason: 'zero-baseline' });
  });
  it('reports an empty eligible cohort and preserves all planned outcomes', () => {
    const e = fixture();
    for (const t of e.plan.tasks) t.eligible = false;
    for (const pair of e.pairs)
      for (const a of pair.arms)
        a.rows.forEach((r, i) => {
          r.taskSha256 = hash(e.plan.tasks[i]);
        });
    const r = evaluate(reseal(e)).repetitions[0];
    expect(r.denominator).toBe(0);
    expect(r.reasons).toContain('empty-eligible-cohort');
    expect(r.arms.enabled.outcomes.completed).toBe(4);
    expect(r.pairedRatio.p50).toBeNull();
  });
  it('keeps successful repetitions separate when one repetition fails', () => {
    const e = fixture();
    row(e).outcome = 'failed';
    const result = evaluate(e);
    expect(result.comparison.status).toBe('not-comparable');
    expect(result.repetitions[0].completion.enabled.p50Ms).toBeNull();
    expect(result.repetitions[1].completion.enabled.p50Ms).toBe(5);
    expect(result.repetitions[2].completion.enabled.p95Ms).toBe(200);
  });
  it.each([
    [5000, 6000, 5500, ['completion-timeout-exceeded']],
    [7000, 6000, 6500, ['completion-exposure-exceeded']],
    [5000, 6000, 7000, ['completion-timeout-exceeded', 'completion-exposure-exceeded']],
  ])(
    'suppresses completed cohorts beyond timeout %s/exposure %s with elapsed %s',
    (timeoutMs, scheduledMs, durationMs, reasons) => {
      const e = fixture(),
        task = e.plan.tasks[0];
      task.timeoutMs = timeoutMs;
      task.scheduledMs = scheduledMs;
      for (const pair of e.pairs)
        for (const arm of pair.arms) {
          arm.rows[0].taskSha256 = hash(task);
          arm.rows[0].scheduledMs = scheduledMs;
        }
      row(e).clock.endMs = durationMs;
      const scored = evaluate(reseal(e)).repetitions[0];
      expect(scored.reasons).toEqual(reasons);
      expect(scored.denominator).toBe(4);
      expect(scored.arms.enabled.rows[0].row).toEqual(row(e));
      expect(scored.arms.enabled.rows[0].terminalElapsedMs).toBe(durationMs);
      expect(scored.arms.enabled.outcomes.completed).toBe(4);
      expect(scored.completion.enabled.p50Ms).toBeNull();
      expect(scored.completion.enabled.p95Ms).toBeNull();
      expect(scored.completion.disabled.p50Ms).toBeNull();
      expect(scored.completion.disabled.p95Ms).toBeNull();
      expect(scored.pairedRatio.p50).toBeNull();
      expect(scored.taskPairs[0].enabledMs).toBeNull();
    },
  );
  it.each([
    [5000, 6000, 5000],
    [7000, 6000, 6000],
    [6000, 6000, 6000],
  ])(
    'admits equality at timeout %s/exposure %s with elapsed %s',
    (timeoutMs, scheduledMs, durationMs) => {
      const e = fixture(),
        task = e.plan.tasks[0];
      task.timeoutMs = timeoutMs;
      task.scheduledMs = scheduledMs;
      for (const pair of e.pairs)
        for (const arm of pair.arms) {
          arm.rows[0].taskSha256 = hash(task);
          arm.rows[0].scheduledMs = scheduledMs;
        }
      row(e).clock.endMs = durationMs;
      const scored = evaluate(reseal(e)).repetitions[0];
      expect(scored.reasons).toEqual([]);
      expect(scored.completion.enabled.p95Ms).toBe(durationMs);
      expect(scored.taskPairs[0].enabledMs).toBe(durationMs);
    },
  );
  it.each(['failed', 'unfinished'])(
    'retains late %s terminal evidence without imputing a deadline or relabeling it',
    (outcome) => {
      const e = fixture();
      row(e).outcome = outcome;
      row(e).evaluation.success = false;
      row(e).clock.endMs = 7000;
      const scored = evaluate(e).repetitions[0];
      expect(scored.reasons).toContain('non-success-cohort');
      expect(scored.reasons).not.toContain('completion-timeout-exceeded');
      expect(scored.reasons).not.toContain('completion-exposure-exceeded');
      expect(scored.arms.enabled.rows[0].row.outcome).toBe(outcome);
      expect(scored.arms.enabled.rows[0].terminalElapsedMs).toBe(7000);
      expect(scored.completion.enabled.p50Ms).toBeNull();
    },
  );
  it('rejects descriptor tricks, cyclic evidence and task population bounds', () => {
    const e = fixture();
    let accessed = false;
    Object.defineProperty(e, 'surprise', {
      enumerable: true,
      get() {
        accessed = true;
        return 0;
      },
    });
    expect(() => evaluate(e)).toThrow('paired-task-latency-input-invalid');
    expect(accessed).toBe(false);
    const cycle = fixture();
    cycle.pairs[0].cycle = cycle;
    expect(() => evaluate(cycle)).toThrow('paired-task-latency-input-invalid');
    const large = fixture();
    large.plan.tasks = Array.from({ length: 129 }, (_, i) => ({
      ...large.plan.tasks[0],
      taskId: 't' + i,
    }));
    expect(() => evaluate(large)).toThrow('paired-task-latency-input-invalid');
  });
});

describe('explicit offline CLI', () => {
  const run = (args) =>
    spawnSync(process.execPath, ['bench/paired-task-latency.cjs', ...args], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 65536,
    });
  it('explains units/bounds/schema and rejects incorrect usage', () => {
    const help = run(['--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('paired-task-latency/1');
    expect(help.stdout).toContain('128 planned tasks');
    expect(help.stdout).toContain('milliseconds');
    expect(run([]).status).toBe(2);
  });
  it('writes deterministic new files and preserves input/existing output on collision', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-paired-'));
    roots.push(dir);
    const input = path.join(dir, 'e.json'),
      a = path.join(dir, 'a.json'),
      b = path.join(dir, 'b.json');
    const encoded = JSON.stringify(fixture());
    fs.writeFileSync(input, encoded);
    expect(run(['--input', input, '--output', a]).status).toBe(0);
    expect(run(['--input', input, '--output', b]).status).toBe(0);
    expect(fs.readFileSync(a, 'utf8')).toBe(fs.readFileSync(b, 'utf8'));
    expect(run(['--input', input, '--output', a]).status).toBe(5);
    expect(run(['--input', input, '--output', input]).status).toBe(5);
    expect(fs.readFileSync(input, 'utf8')).toBe(encoded);
    const output = JSON.parse(fs.readFileSync(a));
    expect(output.launchAllowed).toBe(false);
  });
  it('returns fixed errors for malformed, duplicate-key, oversized and missing input without output', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-paired-'));
    roots.push(dir);
    const input = path.join(dir, 'e.json'),
      output = path.join(dir, 'new.json');
    expect(run(['--input', input, '--output', output]).status).toBe(3);
    for (const text of ['{', '{"version":1,"version":2}', '{}']) {
      fs.writeFileSync(input, text);
      expect(run(['--input', input, '--output', output]).status).toBe(4);
      expect(fs.existsSync(output)).toBe(false);
    }
    fs.writeFileSync(input, ' '.repeat(1048577));
    expect(run(['--input', input, '--output', output]).status).toBe(3);
  });
  it('writes null results for incomplete cohorts without manufacturing durations', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-paired-'));
    roots.push(dir);
    const input = path.join(dir, 'e.json'),
      output = path.join(dir, 'new.json');
    const e = fixture();
    e.pairs[0].arms[1].rows.pop();
    fs.writeFileSync(input, JSON.stringify(e));
    const result = run(['--input', input, '--output', output]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('not-comparable');
    const scored = JSON.parse(fs.readFileSync(output));
    expect(scored.repetitions[0].completion.enabled.p50Ms).toBeNull();
    expect(scored.repetitions[0].arms.enabled.missing).toBe(1);
  });
});
