'use strict';

const { hashTaskEvidence } = require('./task-false-alarms.js');
const LIMITS = Object.freeze({
  bytes: 1048576,
  tasks: 128,
  pairs: 3,
  rows: 768,
  depth: 12,
  nodes: 50000,
});
const ARMS = ['disabled', 'enabled'];
const OUTCOMES = ['completed', 'failed', 'refused', 'timed-out', 'unfinished', 'not-started'];
const COMMON = [
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
];
const invalid = () => {
  throw new Error('paired-task-latency-input-invalid');
};
const integer = (v) => Number.isSafeInteger(v) && v >= 0 && v <= 1_000_000_000_000;
const id = (v) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/.test(v);
const sha = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function exact(v, keys) {
  if (
    !v ||
    Array.isArray(v) ||
    Object.keys(v).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(v, k))
  )
    invalid();
}
function list(v, max) {
  if (!Array.isArray(v) || v.length > max) invalid();
}
function unique(rows, key) {
  if (new Set(rows.map(key)).size !== rows.length) invalid();
}
function common(v) {
  exact(v, COMMON);
  if (!COMMON.every((k) => sha(v[k]))) invalid();
}
function order(v) {
  list(v, 2);
  if (v.length !== 2 || !ARMS.every((a) => v.includes(a))) invalid();
}
function quantile(values, p) {
  const sorted = [...values].sort((a, b) => a - b),
    n = sorted.length;
  if (p === 95) return sorted[Math.ceil(n * 0.95) - 1];
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}
function clock(v) {
  if (v === null) return;
  exact(v, ['startDomain', 'endDomain', 'resolutionMs', 'startMs', 'endMs']);
  if (
    !id(v.startDomain) ||
    !id(v.endDomain) ||
    !integer(v.resolutionMs) ||
    !v.resolutionMs ||
    !integer(v.startMs) ||
    !integer(v.endMs) ||
    v.endMs < v.startMs
  )
    invalid();
}
function elapsed(v) {
  return v && v.startDomain === v.endDomain ? v.endMs - v.startMs : null;
}
function validateRow(row, tasks) {
  exact(row, ['taskId', 'taskSha256', 'scheduledMs', 'started', 'outcome', 'clock', 'evaluation']);
  if (
    !tasks.has(row.taskId) ||
    !sha(row.taskSha256) ||
    !integer(row.scheduledMs) ||
    typeof row.started !== 'boolean' ||
    !OUTCOMES.includes(row.outcome)
  )
    invalid();
  if (row.started === (row.outcome === 'not-started')) invalid();
  clock(row.clock);
  if (!row.started && row.clock !== null) invalid();
  exact(row.evaluation, ['independent', 'oracleSha256', 'success', 'behavior', 'evidenceSha256']);
  const e = row.evaluation;
  if (
    typeof e.independent !== 'boolean' ||
    !sha(e.oracleSha256) ||
    ![true, false, null].includes(e.success) ||
    !['matches', 'differs', 'unknown'].includes(e.behavior) ||
    !(e.evidenceSha256 === null || sha(e.evidenceSha256))
  )
    invalid();
}

/** Evaluate supplied paired task evidence without collection, execution or I/O.
 * @param {object} input Closed paired-task-latency/1 packet.
 * @returns {object} Retained planned rows, outcomes and conditional per-pair estimates.
 * @since v0.19.2
 */
function evaluatePairedTaskLatency(input) {
  let inputSha256;
  try {
    inputSha256 = hashTaskEvidence(input);
  } catch {
    invalid();
  }
  const e = JSON.parse(JSON.stringify(input));
  exact(e, ['version', 'evidenceKind', 'units', 'planSha256', 'plan', 'pairs']);
  if (
    e.version !== 'paired-task-latency/1' ||
    !['synthetic', 'supplied'].includes(e.evidenceKind) ||
    e.units !== 'monotonic-ms' ||
    !sha(e.planSha256)
  )
    invalid();
  const p = e.plan;
  exact(p, ['planId', 'common', 'treatment', 'tasks', 'pairs']);
  if (!id(p.planId)) invalid();
  common(p.common);
  exact(p.treatment, ['disabled', 'enabled']);
  for (const arm of ARMS) {
    exact(p.treatment[arm], ['monitoringEnabled']);
    if (p.treatment[arm].monitoringEnabled !== (arm === 'enabled')) invalid();
  }
  list(p.tasks, LIMITS.tasks);
  unique(p.tasks, (t) => t.taskId);
  if (!p.tasks.length) invalid();
  for (const t of p.tasks) {
    exact(t, [
      'taskId',
      'definitionSha256',
      'rubricSha256',
      'fixtureSha256',
      'seedSha256',
      'eligible',
      'timeoutMs',
      'scheduledMs',
    ]);
    if (
      !id(t.taskId) ||
      !['definitionSha256', 'rubricSha256', 'fixtureSha256', 'seedSha256'].every((k) =>
        sha(t[k]),
      ) ||
      typeof t.eligible !== 'boolean' ||
      !integer(t.timeoutMs) ||
      !t.timeoutMs ||
      !integer(t.scheduledMs) ||
      !t.scheduledMs
    )
      invalid();
  }
  list(p.pairs, LIMITS.pairs);
  if (p.pairs.length !== LIMITS.pairs) invalid();
  unique(p.pairs, (pair) => pair.pairId);
  p.pairs.forEach((pair, i) => {
    exact(pair, ['pairId', 'order']);
    if (!id(pair.pairId)) invalid();
    order(pair.order);
    if (i && pair.order[0] === p.pairs[i - 1].order[0]) invalid();
  });
  const tasks = new Map(p.tasks.map((t) => [t.taskId, t]));
  const plannedPairs = new Set(p.pairs.map((pair) => pair.pairId));
  list(e.pairs, LIMITS.pairs);
  unique(e.pairs, (pair) => pair.pairId);
  for (const pair of e.pairs) {
    exact(pair, ['pairId', 'order', 'arms']);
    if (!plannedPairs.has(pair.pairId)) invalid();
    order(pair.order);
    list(pair.arms, 2);
    unique(pair.arms, (a) => a.arm);
    for (const arm of pair.arms) {
      exact(arm, ['arm', 'common', 'treatment', 'rows']);
      if (!ARMS.includes(arm.arm)) invalid();
      common(arm.common);
      exact(arm.treatment, ['monitoringEnabled']);
      if (typeof arm.treatment.monitoringEnabled !== 'boolean') invalid();
      list(arm.rows, LIMITS.tasks);
      unique(arm.rows, (r) => r.taskId);
      arm.rows.forEach((row) => validateRow(row, tasks));
    }
  }
  const globalReasons = [];
  if (hashTaskEvidence(p) !== e.planSha256) globalReasons.push('plan-hash-mismatch');
  if (e.pairs.length !== 3) globalReasons.push('missing-repetition-pair');
  if (
    e.pairs.some(
      (pair, i) =>
        pair.pairId !== p.pairs[i].pairId || pair.order.join() !== p.pairs[i].order.join(),
    )
  )
    globalReasons.push('observed-order-mismatch');
  const repetitions = p.pairs.map((declared) => {
    const pair = e.pairs.find((q) => q.pairId === declared.pairId);
    const reasons = [...globalReasons];
    const add = (reason) => {
      if (!reasons.includes(reason)) reasons.push(reason);
    };
    const arms = {};
    for (const name of ARMS) {
      const a = pair?.arms.find((b) => b.arm === name);
      if (!a) add('missing-arm');
      else if (
        hashTaskEvidence(a.common) !== hashTaskEvidence(p.common) ||
        hashTaskEvidence(a.treatment) !== hashTaskEvidence(p.treatment[name])
      )
        add('comparison-declaration-mismatch');
      const rows = p.tasks.map((t) => {
        const row = a?.rows.find((r) => r.taskId === t.taskId) || null;
        const terminalElapsedMs = elapsed(row?.clock);
        if (!row) add('incomplete-planned-cohort');
        else {
          if (row.taskSha256 !== hashTaskEvidence(t) || row.scheduledMs !== t.scheduledMs)
            add('task-plan-mismatch');
          if (row.evaluation.oracleSha256 !== p.common.oracleSha256) add('oracle-mismatch');
          if (t.eligible) {
            if (row.outcome !== 'completed') add('non-success-cohort');
            if (
              !row.evaluation.independent ||
              row.evaluation.success !== true ||
              !row.evaluation.evidenceSha256
            )
              add('independent-success-unverified');
            if (row.evaluation.behavior !== 'matches') add('behavior-not-equivalent');
            if (terminalElapsedMs === null) add('clock-unknown');
            if (
              row.outcome === 'completed' &&
              row.evaluation.success === true &&
              terminalElapsedMs !== null
            ) {
              if (terminalElapsedMs > t.timeoutMs) add('completion-timeout-exceeded');
              if (terminalElapsedMs > t.scheduledMs) add('completion-exposure-exceeded');
            }
          }
        }
        return {
          taskId: t.taskId,
          eligible: t.eligible,
          scheduledMs: t.scheduledMs,
          row,
          terminalElapsedMs,
        };
      });
      const outcomes = Object.fromEntries(
        OUTCOMES.map((o) => [o, rows.filter((r) => r.row?.outcome === o).length]),
      );
      arms[name] = {
        common: a?.common || null,
        treatment: a?.treatment || null,
        planned: rows.length,
        eligible: rows.filter((r) => r.eligible).length,
        missing: rows.filter((r) => !r.row).length,
        outcomes,
        rows,
      };
    }
    const cohort = p.tasks.filter((t) => t.eligible);
    if (!cohort.length) add('empty-eligible-cohort');
    const taskPairs = cohort.map((t) => {
      const baseline = arms.disabled.rows.find((r) => r.taskId === t.taskId);
      const treatment = arms.enabled.rows.find((r) => r.taskId === t.taskId);
      const comparable = !reasons.length;
      const d = baseline.terminalElapsedMs,
        n = treatment.terminalElapsedMs;
      return {
        taskId: t.taskId,
        disabledMs: comparable ? d : null,
        enabledMs: comparable ? n : null,
        deltaMs: comparable ? n - d : null,
        ratio: comparable && d !== 0 ? n / d : null,
        percentChange: comparable && d !== 0 ? ((n - d) / d) * 100 : null,
      };
    });
    const reason = reasons[0] || null;
    const completion = (name) => {
      const values = taskPairs.map((t) => t[name + 'Ms']);
      return {
        p50Ms: reason ? null : quantile(values, 50),
        p95Ms: reason ? null : quantile(values, 95),
        reason,
      };
    };
    const ratioReason =
      reason || (taskPairs.some((t) => t.ratio === null) ? 'zero-baseline' : null);
    return {
      pairId: declared.pairId,
      order: declared.order,
      observedOrder: pair?.order || null,
      denominator: cohort.length,
      reasons,
      arms,
      taskPairs,
      completion: { disabled: completion('disabled'), enabled: completion('enabled') },
      pairedRatio: {
        p50: ratioReason
          ? null
          : quantile(
              taskPairs.map((t) => t.ratio),
              50,
            ),
        reason: ratioReason,
      },
    };
  });
  return {
    version: 'paired-task-latency-result/1',
    inputSha256,
    planSha256: e.planSha256,
    evidenceKind: e.evidenceKind,
    launchAllowed: false,
    units: 'milliseconds',
    comparison: {
      status: repetitions.some((r) => r.reasons.length)
        ? 'not-comparable'
        : 'conditional-supplied-evidence',
      provenance:
        'Hashes bind supplied declarations; prior freeze, authenticity and completeness are unverified.',
    },
    plan: p,
    repetitions,
  };
}

module.exports = { evaluatePairedTaskLatency, LIMITS };
