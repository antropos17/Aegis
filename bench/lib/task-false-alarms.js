'use strict';

const { createHash } = require('node:crypto');
const LIMITS = Object.freeze({ bytes: 1048576, tasks: 512, rows: 8192, depth: 12, nodes: 50000 });
const invalid = () => {
  throw new Error('task-false-alarms-input-invalid');
};
const integer = (v) => Number.isSafeInteger(v) && v >= 0 && v <= 1_000_000_000_000;
const id = (v) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/.test(v);
const sha = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const exact = (v, keys) => {
  if (
    !v ||
    Array.isArray(v) ||
    Object.keys(v).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(v, k))
  )
    invalid();
};
const list = (v, max) => {
  if (!Array.isArray(v) || v.length > max) invalid();
};
const unique = (rows, key) => {
  if (new Set(rows.map(key)).size !== rows.length) invalid();
};

/** Canonically hash bounded plain JSON evidence; no I/O or provenance authentication.
 * @param {object} value Evidence fragment. @returns {string} Lowercase SHA-256.
 * @since v0.19.2
 */
function hashTaskEvidence(value) {
  let nodes = 0;
  function copy(v, depth) {
    if (++nodes > LIMITS.nodes || depth > LIMITS.depth) invalid();
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') {
      if (!integer(v)) invalid();
      return v;
    }
    if (typeof v === 'string') {
      if (v.length > 128) invalid();
      return v;
    }
    if (!v || typeof v !== 'object') invalid();
    const array = Array.isArray(v),
      proto = Object.getPrototypeOf(v);
    if (array ? proto !== Array.prototype : ![Object.prototype, null].includes(proto)) invalid();
    const keys = Reflect.ownKeys(v);
    if (keys.length > LIMITS.rows + 1) invalid();
    const desc = Object.getOwnPropertyDescriptors(v);
    if (
      keys.some(
        (k) =>
          typeof k !== 'string' ||
          !Object.hasOwn(desc[k], 'value') ||
          (!(array && k === 'length') && !desc[k].enumerable),
      )
    )
      invalid();
    if (array) {
      if (
        v.length > LIMITS.rows ||
        keys.length !== v.length + 1 ||
        Object.keys(v).length !== v.length
      )
        invalid();
      return v.map((x) => copy(x, depth + 1));
    }
    const out = Object.create(null);
    for (const k of Object.keys(v).sort()) {
      if (k.length > 64) invalid();
      out[k] = copy(v[k], depth + 1);
    }
    return out;
  }
  const encoded = JSON.stringify(copy(value, 0));
  if (Buffer.byteLength(encoded) > LIMITS.bytes) invalid();
  return createHash('sha256').update(encoded).digest('hex');
}

/** Evaluate one frozen started-task cohort from supplied evidence only.
 * @param {object} input Closed task-false-alarms/1 evidence.
 * @returns {object} Deterministic counts, exposure, retained evidence and nullable incidence.
 * @since v0.19.2
 */
function evaluateTaskFalseAlarms(input) {
  const inputSha256 = hashTaskEvidence(input);
  // Copy only after validating descriptors, depth, numbers and total expansion.
  const e = JSON.parse(JSON.stringify(input));
  exact(e, [
    'version',
    'runId',
    'sourceSha256',
    'evidenceKind',
    'units',
    'rubric',
    'roster',
    'collection',
    'adjudication',
    'hashes',
  ]);
  if (
    e.version !== 'task-false-alarms/1' ||
    !id(e.runId) ||
    !sha(e.sourceSha256) ||
    !['synthetic', 'native'].includes(e.evidenceKind)
  )
    invalid();
  exact(e.units, ['time', 'exposure']);
  if (e.units.time !== 'monotonic-ms' || e.units.exposure !== 'hours') invalid();
  const { rubric: r, roster, collection: c, adjudication: a, hashes } = e;
  exact(r, ['version', 'frozenAtMs', 'eligibility', 'alarm', 'dedup', 'adjudication']);
  if (
    r.version !== 'task-false-alarm-rubric/1' ||
    !integer(r.frozenAtMs) ||
    r.eligibility !== 'started-ordinary-benign' ||
    r.alarm !== 'user-visible-security-alarm' ||
    r.dedup !== 'same-task-alarm-key' ||
    r.adjudication !== 'independent-evidence'
  )
    invalid();
  exact(hashes, ['rubricSha256', 'rosterSha256', 'collectionSha256', 'adjudicationSha256']);
  for (const name of ['rubric', 'roster', 'collection', 'adjudication']) {
    if (!sha(hashes[name + 'Sha256']) || hashes[name + 'Sha256'] !== hashTaskEvidence(e[name]))
      invalid();
  }
  exact(roster, ['runId', 'sourceSha256', 'sealedAtMs', 'startedCount', 'tasks']);
  exact(c, [
    'runId',
    'sourceSha256',
    'collectorId',
    'alarmSourceId',
    'rosterSha256',
    'rubricSha256',
    'taskCount',
    'alarmCount',
    'tasks',
  ]);
  exact(a, [
    'runId',
    'sourceSha256',
    'adjudicatorId',
    'oracleSourceId',
    'independence',
    'evidenceSha256',
    'collectionSha256',
    'decisionCount',
    'decisions',
  ]);
  for (const part of [roster, c, a])
    if (part.runId !== e.runId || part.sourceSha256 !== e.sourceSha256) invalid();
  if (
    !id(c.collectorId) ||
    !id(c.alarmSourceId) ||
    !id(a.adjudicatorId) ||
    !id(a.oracleSourceId) ||
    a.adjudicatorId === c.collectorId ||
    a.oracleSourceId === c.alarmSourceId ||
    a.independence !== 'independent-of-alarm-source' ||
    !sha(a.evidenceSha256)
  )
    invalid();
  if (
    c.rosterSha256 !== hashes.rosterSha256 ||
    c.rubricSha256 !== hashes.rubricSha256 ||
    a.collectionSha256 !== hashes.collectionSha256
  )
    invalid();
  list(roster.tasks, LIMITS.tasks);
  list(c.tasks, LIMITS.tasks);
  list(a.decisions, LIMITS.rows);
  if (
    !integer(roster.sealedAtMs) ||
    roster.startedCount !== roster.tasks.length ||
    c.taskCount !== roster.tasks.length ||
    c.tasks.length !== roster.tasks.length ||
    a.decisionCount !== a.decisions.length ||
    !integer(c.alarmCount)
  )
    invalid();
  const taskIds = new Set();
  for (const t of roster.tasks) {
    exact(t, ['taskId', 'eligibility', 'startedMs', 'window']);
    exact(t.window, ['startMs', 'endMs']);
    if (
      !id(t.taskId) ||
      !['ordinary-benign', 'excluded-nonordinary', 'excluded-nonbenign'].includes(t.eligibility) ||
      !integer(t.startedMs) ||
      !integer(t.window.endMs) ||
      t.window.startMs !== t.startedMs ||
      t.window.endMs <= t.startedMs ||
      t.window.endMs - t.startedMs > 604800000 ||
      r.frozenAtMs >= t.startedMs ||
      roster.sealedAtMs < t.startedMs
    )
      invalid();
    taskIds.add(t.taskId);
  }
  unique(roster.tasks, (t) => t.taskId);
  const decisions = new Map();
  for (const d of a.decisions) {
    exact(d, ['taskId', 'alarmKey', 'verdict']);
    if (
      !taskIds.has(d.taskId) ||
      !id(d.alarmKey) ||
      !['false-alarm', 'genuine'].includes(d.verdict)
    )
      invalid();
    const key = d.taskId + ':' + d.alarmKey;
    if (decisions.has(key)) invalid();
    decisions.set(key, d.verdict);
  }
  let rawAlarms = 0,
    windows = 0;
  const alarmIds = new Set(),
    usedDecisions = new Set(),
    records = new Map();
  for (const row of c.tasks) {
    exact(row, ['taskId', 'outcome', 'alarmInventoryComplete', 'coverage', 'alarms']);
    if (
      !taskIds.has(row.taskId) ||
      !['completed', 'failed', 'refused', 'timed-out', 'unfinished'].includes(row.outcome) ||
      typeof row.alarmInventoryComplete !== 'boolean'
    )
      invalid();
    list(row.coverage, LIMITS.rows);
    list(row.alarms, LIMITS.rows);
    rawAlarms += row.alarms.length;
    windows += row.coverage.length;
    if (rawAlarms > LIMITS.rows || windows > LIMITS.rows) invalid();
    records.set(row.taskId, row);
  }
  unique(c.tasks, (t) => t.taskId);
  if (rawAlarms !== c.alarmCount) invalid();
  const tasks = roster.tasks.map((t) => {
    const row = records.get(t.taskId),
      groups = new Map(),
      reasons = [];
    let end = t.window.startMs,
      observedMs = 0,
      lostAlarms = 0,
      unknownLossWindows = 0,
      gap = false;
    for (const w of row.coverage) {
      exact(w, ['startMs', 'endMs', 'lostAlarms']);
      if (
        !integer(w.startMs) ||
        !integer(w.endMs) ||
        w.startMs < end ||
        w.endMs <= w.startMs ||
        w.endMs > t.window.endMs ||
        (w.lostAlarms !== null && !integer(w.lostAlarms))
      )
        invalid();
      if (w.startMs !== end) gap = true;
      observedMs += w.endMs - w.startMs;
      end = w.endMs;
      if (w.lostAlarms === null) unknownLossWindows++;
      else lostAlarms += w.lostAlarms;
    }
    if (!row.coverage.length) reasons.push('unobserved');
    else if (gap || end !== t.window.endMs) reasons.push('coverage-gap');
    if (lostAlarms) reasons.push('alarm-loss');
    if (unknownLossWindows) reasons.push('loss-unknown');
    if (!row.alarmInventoryComplete) reasons.push('alarm-inventory-incomplete');
    for (const alarm of row.alarms) {
      exact(alarm, ['alarmId', 'alarmKey', 'atMs']);
      if (
        !id(alarm.alarmId) ||
        !id(alarm.alarmKey) ||
        !integer(alarm.atMs) ||
        alarmIds.has(alarm.alarmId) ||
        !row.coverage.some((w) => w.startMs <= alarm.atMs && alarm.atMs < w.endMs)
      )
        invalid();
      alarmIds.add(alarm.alarmId);
      const key = t.taskId + ':' + alarm.alarmKey,
        verdict = decisions.get(key);
      if (!verdict) invalid();
      usedDecisions.add(key);
      groups.set(key, verdict);
    }
    const falseAlarmCount = [...groups.values()].filter((v) => v === 'false-alarm').length;
    return {
      taskId: t.taskId,
      eligibility: t.eligibility,
      outcome: row.outcome,
      scheduledMs: t.window.endMs - t.window.startMs,
      observedMs,
      observationHours: observedMs / 3600000,
      lostAlarms,
      unknownLossWindows,
      complete: reasons.length === 0,
      reasons,
      rawAlarmCount: row.alarms.length,
      distinctAlarmCount: groups.size,
      falseAlarmCount,
      genuineAlarmCount: groups.size - falseAlarmCount,
      hasFalseAlarm: falseAlarmCount > 0 ? true : reasons.length ? null : false,
    };
  });
  if (usedDecisions.size !== decisions.size) invalid();
  const eligible = tasks.filter((t) => t.eligibility === 'ordinary-benign');
  const incomplete = eligible.filter((t) => !t.complete);
  const numerator = eligible.filter((t) => t.falseAlarmCount > 0).length;
  const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);
  const observedMs = sum(eligible, 'observedMs');
  const reason = !eligible.length
    ? 'empty-eligible-cohort'
    : !observedMs
      ? 'empty-eligible-exposure'
      : incomplete.length
        ? 'incomplete-eligible-cohort'
        : null;
  return {
    version: 'task-false-alarms-result/1',
    inputSha256,
    evidence: e,
    counts: {
      started: tasks.length,
      eligible: eligible.length,
      excluded: tasks.length - eligible.length,
      completeEligible: eligible.length - incomplete.length,
      incompleteEligible: incomplete.length,
      rawAlarms,
      distinctAlarms: sum(tasks, 'distinctAlarmCount'),
      falseAlarms: sum(tasks, 'falseAlarmCount'),
      genuineAlarms: sum(tasks, 'genuineAlarmCount'),
      unresolvedAlarms: 0,
      tasksWithFalseAlarm: numerator,
    },
    exposure: {
      unit: 'hours',
      eligibleScheduledHours: sum(eligible, 'scheduledMs') / 3600000,
      eligibleObservedHours: observedMs / 3600000,
      eligibleLostAlarms: sum(eligible, 'lostAlarms'),
      eligibleUnknownLossWindows: sum(eligible, 'unknownLossWindows'),
    },
    incidence: {
      value: reason ? null : numerator / eligible.length,
      unit: 'fraction-of-eligible-started-tasks',
      numerator,
      denominator: eligible.length,
      reason,
    },
    tasks,
  };
}

module.exports = { evaluateTaskFalseAlarms, hashTaskEvidence, LIMITS };
