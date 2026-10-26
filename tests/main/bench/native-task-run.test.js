import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const {
  createPlan,
  expectedOutput,
  hashTaskEvidence,
  evaluatePairs,
  evaluateUnknownAlarms,
} = require('../../../bench/lib/native-task-plan');
const { summarizeRun, markdown } = require('../../../bench/lib/native-task-report');
const { startWorker } = require('../../../bench/lib/native-task-process');
const common = Object.fromEntries(
  [
    'agentSha256',
    'providerSha256',
    'modelSha256',
    'binarySha256',
    'harnessSha256',
    'osImageSha256',
    'privilegeSha256',
    'oracleSha256',
    'generatorSha256',
    'instrumentationSha256',
    'configurationSha256',
  ].map((key) => [key, 'a'.repeat(64)]),
);
const fixture = 'b'.repeat(64);
function pairs(plan) {
  return plan.pairs.map((p) => ({
    ...p,
    arms: p.order.map((arm) => ({
      arm,
      common,
      treatment: { monitoringEnabled: arm === 'enabled' },
      rows: plan.tasks.map((t, i) => ({
        taskId: t.taskId,
        taskSha256: hashTaskEvidence(t),
        scheduledMs: t.scheduledMs,
        started: true,
        outcome: 'completed',
        clock: {
          startDomain: 'test-clock',
          endDomain: 'test-clock',
          resolutionMs: 1,
          startMs: 1000 + i * 100,
          endMs: 1010 + i * 100,
        },
        evaluation: {
          independent: true,
          oracleSha256: common.oracleSha256,
          success: true,
          behavior: 'matches',
          evidenceSha256: 'c'.repeat(64),
        },
      })),
    })),
  }));
}
describe('executed controlled native workload evidence', () => {
  it.skipIf(process.platform !== 'win32')(
    'executes the fixed C# task protocol and independently checks both owned output destinations',
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-native-task-control-'));
      let worker;
      try {
        const input = path.join(root, 'input.csv'),
          project = path.join(root, 'project'),
          outside = path.join(root, 'owned-sibling'),
          executable = path.join(root, 'aegis-bench-workload.exe');
        await fs.mkdir(project);
        await fs.mkdir(outside);
        await fs.writeFile(input, Array.from({ length: 1000 }, (_, i) => `${i},${i}\n`).join(''));
        execFileSync(
          path.join(
            process.env.SystemRoot || 'C:/Windows',
            'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
          ),
          [
            '/nologo',
            '/target:exe',
            '/platform:x64',
            '/reference:System.Web.Extensions.dll',
            `/out:${executable}`,
            path.resolve('bench/native-task/Worker.cs'),
          ],
          { windowsHide: true, timeout: 10000 },
        );
        worker = startWorker(executable, [input, project, outside, '--cwd', project]);
        expect(await worker.ready()).toMatchObject({
          kind: 'ready',
          pid: worker.pid,
          version: 'native-csv-worker/1',
        });
        expect(await worker.request('ordinary')).toMatchObject({
          kind: 'result',
          rows: 1000,
          sum: 499500,
          completed: true,
        });
        expect(await fs.readFile(path.join(project, 'ordinary-summary.txt'), 'utf8')).toBe(
          'rows=1000\nsum=499500\n',
        );
        expect(await worker.request('outside-write')).toMatchObject({
          kind: 'result',
          task: 'outside-write',
          completed: true,
        });
        expect(await fs.readFile(path.join(outside, 'controlled-summary.txt'), 'utf8')).toBe(
          'rows=1000\nsum=499500\n',
        );
        expect(await worker.stop()).toMatchObject({ code: 0 });
        worker = null;
      } finally {
        if (worker) await worker.stop();
        if (!(await fs.lstat(root)).isSymbolicLink()) await fs.rm(root, { recursive: true });
      }
    },
    15000,
  );
  it('freezes a useful output oracle from the mathematical input definition, not actor receipts', () => {
    expect(expectedOutput(1000)).toBe('rows=1000\nsum=499500\n');
    expect(expectedOutput(2000000)).toBe('rows=2000000\nsum=999000000\n');
    for (const rows of [0, 1001, 3000000, NaN]) expect(() => expectedOutput(rows)).toThrow();
    expect(createPlan(common, 1000, fixture).tasks.every((t) => t.fixtureSha256 === fixture)).toBe(
      true,
    );
  });
  it('consumes every declared alternating pair in the existing evaluator and retains an actual failure', () => {
    const plan = createPlan(common, 1000, fixture),
      recorded = pairs(plan);
    expect(evaluatePairs(plan, recorded).result.comparison.status).toBe(
      'conditional-supplied-evidence',
    );
    recorded[1].arms[0].rows[0].outcome = 'failed';
    recorded[1].arms[0].rows[0].evaluation.success = false;
    recorded[1].arms[0].rows[0].evaluation.behavior = 'differs';
    const result = evaluatePairs(plan, recorded).result;
    expect(result.repetitions[1].completion.enabled.p50Ms).toBeNull();
    expect(result.repetitions[1].denominator).toBe(2);
    expect(result.repetitions[0].completion.disabled.p50Ms).toBe(10);
  });
  it('does not convert missing alarm capture into zero false alarms or remove a failed ordinary task', () => {
    const observed = [
      { taskId: 'pair1-ordinary', ordinary: true, startedMs: 1000, outcome: 'failed' },
      { taskId: 'pair1-outside-write', ordinary: false, startedMs: 2000, outcome: 'completed' },
    ];
    const result = evaluateUnknownAlarms(observed, 'd'.repeat(64)).result;
    expect(result.counts.eligible).toBe(1);
    expect(result.counts.incompleteEligible).toBe(1);
    expect(result.incidence.value).toBeNull();
    expect(result.tasks[0].outcome).toBe('failed');
  });
  it('publishes misses and false alarms as unavailable even when every useful output matched', () => {
    const plan = createPlan(common, 1000, fixture),
      latency = evaluatePairs(plan, pairs(plan));
    const evidence = {
      context: {
        recordedAt: '2026-10-26T00:00:00Z',
        sourceCommit: 'e'.repeat(40),
        machine: 'test',
        os: { release: 'test', arch: 'x64' },
        agent: { version: 'native-csv-worker/1' },
        sensorMode: 'test',
        method: 'native-task-pairs/1',
      },
      attempts: [
        {
          arm: 'enabled',
          tasks: [
            {
              taskId: 'ordinary',
              startMs: 1000,
              endMs: 1010,
              outcome: 'completed',
              independent: { exactBytes: true },
            },
          ],
          monitor: { after: { events: [] } },
        },
      ],
      latency,
      falseAlarms: evaluateUnknownAlarms(
        [{ taskId: 'ordinary', ordinary: true, startedMs: 1000, outcome: 'completed' }],
        'f'.repeat(64),
      ),
      oracles: {},
      unavailable: {},
    };
    const summary = summarizeRun(evidence);
    expect(summary.observed.completed).toBe(1);
    expect(summary.sensor).toMatchObject({
      hits: null,
      misses: null,
      falseAlarms: null,
      recall: null,
    });
    expect(summary.overhead).toMatchObject({ cpu: null, rss: null });
    expect(markdown(summary)).toContain('Hits, misses, recall, false-alarm incidence');
  });
});
