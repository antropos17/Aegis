#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { prepareRun, json, fileHash } = require('./lib/native-task-setup');
const { startWorker } = require('./lib/native-task-process');
const { startMonitor } = require('./lib/native-task-monitor');
const {
  TASKS,
  sha,
  hash,
  hashTaskEvidence,
  expectedOutput,
  evaluatePairs,
  evaluateUnknownAlarms,
} = require('./lib/native-task-plan');
const { summarizeRun, markdown } = require('./lib/native-task-report');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ROOT = path.resolve(__dirname, '..');
function emptyRow(task, common) {
  return {
    taskId: task.taskId,
    taskSha256: hashTaskEvidence(task),
    scheduledMs: task.scheduledMs,
    started: false,
    outcome: 'not-started',
    clock: null,
    evaluation: {
      independent: false,
      oracleSha256: common.oracleSha256,
      success: null,
      behavior: 'unknown',
      evidenceSha256: null,
    },
  };
}

/** Execute predeclared controlled native task pairs and consume the existing evaluators.
 * @param {object} options New owned output and bounded fixture size. @returns {Promise<object>} Result.
 * @since 0.21.0 */
async function runNativeTasks(options) {
  const { rows, warmupMs, out, fixture, fixtureSha256, executable, context, common, plan } =
    await prepareRun(ROOT, options);
  const expectedEvents = plan.pairs.flatMap((pair) =>
    pair.order.flatMap((arm) =>
      TASKS.map((taskId) => ({
        context: {
          sourceCommit: context.sourceCommit,
          machine: context.machine,
          os: context.os.release,
          agent: context.agent.version,
          sensorMode: context.sensorMode,
          method: context.method,
        },
        eventId: `${pair.pairId}-${arm}-${taskId}`,
        taskId,
        category: 'file/create',
        fixtureId: taskId === 'ordinary' ? 'project-summary' : 'owned-sibling-summary',
        expectedSha256: sha(expectedOutput(rows)),
        authorization: taskId === 'ordinary' ? 'allowed' : 'prohibited-by-fixture-rubric',
      })),
    ),
  );
  await fs.writeFile(
    path.join(out, 'expected.ndjson'),
    expectedEvents.map((e) => JSON.stringify(e)).join('\n') + '\n',
    { flag: 'wx' },
  );
  const origin = process.hrtime.bigint(),
    now = () => Number((process.hrtime.bigint() - origin) / 1000000n);
  const pairs = [],
    attempts = [],
    enabledStarts = [];
  let stopped = false;
  for (const pair of plan.pairs) {
    const observedPair = { pairId: pair.pairId, order: pair.order, arms: [] };
    pairs.push(observedPair);
    for (const arm of pair.order) {
      const record = { arm, common, treatment: { monitoringEnabled: false }, rows: [] };
      observedPair.arms.push(record);
      const directory = path.join(out, pair.pairId + '-' + arm),
        home = path.join(directory, 'home'),
        project = path.join(home, '.claude', 'project'),
        outside = path.join(home, '.claude', 'owned-sibling');
      await fs.mkdir(project, { recursive: true });
      await fs.mkdir(outside);
      let worker, monitor;
      const attempt = { pairId: pair.pairId, arm, tasks: [], monitor: null, errors: [] };
      attempts.push(attempt);
      try {
        if (stopped) throw Error('previous-arm-failed');
        worker = startWorker(executable, [fixture, project, outside, '--cwd', project]);
        const ready = await worker.ready();
        if (
          ready.kind !== 'ready' ||
          ready.pid !== worker.pid ||
          ready.version !== context.agent.version
        )
          throw Error('worker-not-ready');
        attempt.worker = ready;
        const warmupStart = now();
        if (arm === 'enabled') monitor = await startMonitor(ROOT, directory, worker.pid);
        await sleep(Math.max(0, warmupMs - (now() - warmupStart)));
        attempt.actualWarmupMs = now() - warmupStart;
        if (monitor) {
          const snapshot = await monitor.snapshot();
          attempt.monitor = { before: snapshot };
          if (
            snapshot.stats.monitoringPaused ||
            snapshot.stats.appHealth?.populationReliable !== true ||
            !snapshot.actorSeen
          )
            throw Error('monitoring-population-unavailable');
          record.treatment.monitoringEnabled = true;
        }
        for (const task of plan.tasks) {
          const startMs = now(),
            native = await worker.request(task.taskId);
          const outputFile = path.join(
            task.taskId === 'ordinary' ? project : outside,
            task.taskId === 'ordinary' ? 'ordinary-summary.txt' : 'controlled-summary.txt',
          );
          const actual = await fs.readFile(outputFile).catch(() => null);
          const wanted = Buffer.from(expectedOutput(rows));
          const sourceUnchanged = (await fileHash(fixture)) === fixtureSha256;
          const expectedNames =
            task.taskId === 'ordinary' ? ['ordinary-summary.txt'] : ['controlled-summary.txt'];
          const names = (await fs.readdir(path.dirname(outputFile))).sort();
          const independent = {
            outputPresent: actual !== null,
            exactBytes: actual?.equals(wanted) === true,
            noUnexpectedFiles: JSON.stringify(names) === JSON.stringify(expectedNames),
            sourceUnchanged,
          };
          const success =
            Object.values(independent).every(Boolean) &&
            native.kind === 'result' &&
            native.completed === true &&
            native.task === task.taskId;
          const endMs = now(),
            evidenceSha256 = hash(independent),
            outcome = success
              ? 'completed'
              : native.code === 'worker-timeout'
                ? 'timed-out'
                : 'failed';
          record.rows.push({
            taskId: task.taskId,
            taskSha256: hashTaskEvidence(task),
            scheduledMs: task.scheduledMs,
            started: true,
            outcome,
            clock: {
              startDomain: 'runner-hrtime',
              endDomain: 'runner-hrtime',
              resolutionMs: 1,
              startMs,
              endMs,
            },
            evaluation: {
              independent: true,
              oracleSha256: common.oracleSha256,
              success,
              behavior: success ? 'matches' : 'differs',
              evidenceSha256,
            },
          });
          attempt.tasks.push({
            taskId: task.taskId,
            startMs,
            endMs,
            outcome,
            independent,
            native,
            expectedEventId: `${pair.pairId}-${arm}-${task.taskId}`,
          });
          if (arm === 'enabled')
            enabledStarts.push({
              taskId: `${pair.pairId}-${task.taskId}`,
              startedMs: startMs,
              ordinary: task.taskId === 'ordinary',
              outcome,
            });
          if (!success) throw Error('independent-task-outcome-failed');
        }
        await sleep(context.drainMs);
        if (monitor) attempt.monitor.after = await monitor.snapshot();
      } catch (error) {
        stopped = true;
        attempt.errors.push(error.message);
      } finally {
        for (const task of plan.tasks)
          if (!record.rows.some((r) => r.taskId === task.taskId))
            record.rows.push(emptyRow(task, common));
        if (worker) {
          attempt.workerExit = await worker.stop();
          if (attempt.workerExit.code !== 0) {
            stopped = true;
            attempt.errors.push('worker-exit-unconfirmed-or-failed');
          }
        }
        if (monitor) await monitor.close();
        await json(path.join(directory, 'attempt.json'), { context, attempt });
      }
    }
  }
  const latency = evaluatePairs(plan, pairs),
    falseAlarms = evaluateUnknownAlarms(enabledStarts, context.sourceSha256);
  const evidence = {
    context,
    expectedEvents,
    attempts,
    latency,
    falseAlarms,
    oracles: {
      taskOutcome: 'independent Node exact-byte/inventory checks',
      sysmon: { available: false, reason: 'same-run-capture-not-configured' },
      procmon: { available: false, reason: 'same-run-capture-not-configured' },
    },
    unavailable: {
      recall: 'independent-os-event-oracle-unavailable',
      falseAlarms: 'complete-user-visible-alarm-inventory-unavailable',
      calibratedOverhead: 'product-helper-population-and-instrumentation-calibration-unqualified',
      prevention: 'no-prevention-route-selected',
      detectionLatency: 'independent-event-time-and-delivery-qualification-unavailable',
    },
  };
  const summary = summarizeRun(evidence);
  await json(path.join(out, 'result.json'), evidence);
  await json(path.join(out, 'summary.json'), summary);
  await fs.writeFile(path.join(out, 'summary.md'), markdown(summary), { flag: 'wx' });
  if (stopped) throw Error('native-task-run-incomplete');
  return summary;
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help')
    console.log(
      'Controlled Windows native CSV task pairs. Usage: node bench/native-task-run.cjs --output NEW_ABSOLUTE_DIRECTORY. Requires built renderer/sidecars; no provider, VM or oracle installation. Outputs unknown capture/overhead explicitly.',
    );
  else if (args.length !== 2 || args[0] !== '--output') {
    console.error('usage');
    process.exitCode = 2;
  } else
    runNativeTasks({ output: args[1] })
      .then((result) => console.log(JSON.stringify(result)))
      .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
      });
}
module.exports = { runNativeTasks };
