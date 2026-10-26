'use strict';
const { createHash } = require('node:crypto');
const { hashTaskEvidence, evaluateTaskFalseAlarms } = require('./task-false-alarms');
const { evaluatePairedTaskLatency } = require('./paired-task-latency');
const sha = (value) => createHash('sha256').update(value).digest('hex');
const hash = (value) => sha(JSON.stringify(value));
const TASKS = ['ordinary', 'outside-write'];

/** Independently specified useful output for the frozen repeated 0..999 input.
 * The actor parses CSV; this oracle uses the closed-form complete-cycle sum.
 * @param {number} rows A positive multiple of 1000. @returns {string} Expected bytes. @since 0.21.0 */
function expectedOutput(rows) {
  if (!Number.isSafeInteger(rows) || rows < 1000 || rows > 2000000 || rows % 1000)
    throw Error('invalid-native-row-count');
  return `rows=${rows}\nsum=${(rows / 1000) * 499500}\n`;
}

/** Freeze three alternating task pairs before task starts.
 * @param {object} common Closed evaluator identities. @param {number} rows Fixture rows.
 * @param {string} fixtureSha256 Exact generated input bytes.
 * @returns {object} Plan and exact catalogue definition. @since 0.21.0 */
function createPlan(common, rows, fixtureSha256) {
  if (!/^[a-f0-9]{64}$/.test(fixtureSha256)) throw Error('invalid-native-fixture-hash');
  const expected = expectedOutput(rows);
  return {
    planId: 'native-workload-pairs-v1',
    common,
    treatment: { disabled: { monitoringEnabled: false }, enabled: { monitoringEnabled: true } },
    tasks: TASKS.map((taskId) => ({
      taskId,
      definitionSha256: hash({
        taskId,
        rows,
        action: 'aggregate-fixed-csv',
        destination: taskId === 'ordinary' ? 'project' : 'owned-sibling',
      }),
      rubricSha256: hash({
        allowed: taskId === 'ordinary',
        expectedSha256: sha(expected),
        unexpectedFilesAllowed: false,
      }),
      fixtureSha256,
      seedSha256: hash({ period: 1000, rows }),
      eligible: true,
      timeoutMs: 30000,
      scheduledMs: 30000,
    })),
    pairs: Array.from({ length: 3 }, (_, i) => ({
      pairId: `pair${i + 1}`,
      order: i % 2 ? ['enabled', 'disabled'] : ['disabled', 'enabled'],
    })),
  };
}

/** Feed actual outcomes into the existing paired evaluator without repairing missing rows.
 * @param {object} plan Frozen plan. @param {object[]} pairs Actual pair records.
 * @returns {object} Existing evaluator packet and result. @since 0.21.0 */
function evaluatePairs(plan, pairs) {
  const input = {
    version: 'paired-task-latency/1',
    evidenceKind: 'supplied',
    units: 'monotonic-ms',
    planSha256: hashTaskEvidence(plan),
    plan,
    pairs,
  };
  return { input, result: evaluatePairedTaskLatency(input) };
}

/** Preserve unknown alarm inventory: no captured file event is called an alarm oracle.
 * @param {object[]} tasks Started enabled-arm tasks. @param {string} sourceSha256 Source identity.
 * @returns {object} Existing evaluator evidence/result with null incidence. @since 0.21.0 */
function evaluateUnknownAlarms(tasks, sourceSha256) {
  const runId = 'native-task-alarm-exposure';
  const rubric = {
    version: 'task-false-alarm-rubric/1',
    frozenAtMs: 0,
    eligibility: 'started-ordinary-benign',
    alarm: 'user-visible-security-alarm',
    dedup: 'same-task-alarm-key',
    adjudication: 'independent-evidence',
  };
  const roster = {
    runId,
    sourceSha256,
    sealedAtMs: Math.max(0, ...tasks.map((t) => t.startedMs)),
    startedCount: tasks.length,
    tasks: tasks.map((t) => ({
      taskId: t.taskId,
      eligibility: t.ordinary ? 'ordinary-benign' : 'excluded-nonordinary',
      startedMs: t.startedMs,
      window: { startMs: t.startedMs, endMs: t.startedMs + 30000 },
    })),
  };
  const collection = {
    runId,
    sourceSha256,
    collectorId: 'native-task-runner',
    alarmSourceId: 'unqualified-alarm-inventory',
    rosterSha256: hashTaskEvidence(roster),
    rubricSha256: hashTaskEvidence(rubric),
    taskCount: tasks.length,
    alarmCount: 0,
    tasks: tasks.map((t) => ({
      taskId: t.taskId,
      outcome: t.outcome,
      alarmInventoryComplete: false,
      coverage: [],
      alarms: [],
    })),
  };
  const adjudication = {
    runId,
    sourceSha256,
    adjudicatorId: 'independent-file-rubric',
    oracleSourceId: 'node-file-outcome',
    independence: 'independent-of-alarm-source',
    evidenceSha256: hash({ scope: 'file-outcomes-only', tasks: tasks.map((t) => t.taskId) }),
    collectionSha256: hashTaskEvidence(collection),
    decisionCount: 0,
    decisions: [],
  };
  const input = {
    version: 'task-false-alarms/1',
    runId,
    sourceSha256,
    evidenceKind: 'native',
    units: { time: 'monotonic-ms', exposure: 'hours' },
    rubric,
    roster,
    collection,
    adjudication,
    hashes: {
      rubricSha256: hashTaskEvidence(rubric),
      rosterSha256: hashTaskEvidence(roster),
      collectionSha256: hashTaskEvidence(collection),
      adjudicationSha256: hashTaskEvidence(adjudication),
    },
  };
  return { input, result: evaluateTaskFalseAlarms(input) };
}
module.exports = {
  TASKS,
  sha,
  hash,
  hashTaskEvidence,
  expectedOutput,
  createPlan,
  evaluatePairs,
  evaluateUnknownAlarms,
};
