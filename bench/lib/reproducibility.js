'use strict';
const crypto = require('node:crypto');
const BASE = 10n ** 324n;
const LIMITS = Object.freeze({
  bytes: 1048576,
  outputBytes: 4194304,
  cells: 64,
  runs: 3,
  depth: 12,
  nodes: 20000,
});
const invalid = () => {
  throw new Error('reproducibility-input-invalid');
};
const id = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value);
const sha = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 1000000000;
const KEY = ['metric', 'phase', 'cohort', 'percentile', 'unit'];
const HASHES = [
  'sourceSha256',
  'harnessSha256',
  'binarySha256',
  'configSha256',
  'inputSha256',
  'agentVersionsSha256',
  'providerVersionsSha256',
  'osImageSha256',
  'calibrationSha256',
];
const LABELS = ['machine', 'os', 'agentVersions', 'sensorMode', 'method', 'privileges'];
const REASONS = {
  incomplete: 'incomplete-population',
  failed: 'run-failed',
  refused: 'run-refused',
  'timed-out': 'run-timed-out',
  'not-started': 'not-started',
};
function exact(value, keys) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    invalid();
}
function list(value, max) {
  if (!Array.isArray(value) || value.length > max) invalid();
}
function unique(values) {
  if (new Set(values).size !== values.length) invalid();
}
function instant(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    invalid();
  return Date.parse(value);
}
function identity(value) {
  exact(value, ['commit', ...HASHES, ...LABELS]);
  if (
    typeof value.commit !== 'string' ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.commit) ||
    !HASHES.every((key) => sha(value[key])) ||
    !LABELS.every((key) => id(value[key]))
  )
    invalid();
}
function cellKey(value) {
  if (!KEY.every((key) => id(value[key])) || !['p50', 'p95'].includes(value.percentile)) invalid();
  return KEY.slice(0, 4)
    .map((key) => value[key])
    .join('|');
}
function bounded(value) {
  let nodes = 0;
  function visit(item, depth) {
    if (++nodes > LIMITS.nodes || depth > LIMITS.depth) invalid();
    if (typeof item === 'string' && item.length > 1024) invalid();
    if (item && typeof item === 'object') {
      if (![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(item)))
        invalid();
      const descriptors = Object.getOwnPropertyDescriptors(item),
        keys = Object.keys(item);
      if (
        Object.getOwnPropertyNames(item).some(
          (key) => key !== 'length' && !descriptors[key].enumerable,
        )
      )
        invalid();
      if (keys.length > 1024 || Object.getOwnPropertySymbols(item).length) invalid();
      for (const key of keys) {
        if (descriptors[key].get || descriptors[key].set) invalid();
        visit(item[key], depth + 1);
      }
    } else if (!['string', 'number', 'boolean'].includes(typeof item) && item !== null) invalid();
  }
  visit(value, 0);
  if (Buffer.byteLength(canonical(value)) > LIMITS.bytes) invalid();
}
function validate(input) {
  bounded(input);
  exact(input, ['schema', 'schemaVersion', 'planSha256', 'plan', 'runs']);
  if (input.schema !== 'reproducibility-input' || input.schemaVersion !== 1) invalid();
  const plan = input.plan;
  exact(plan, ['id', 'version', 'frozenAt', 'identity', 'runIds', 'cells']);
  if (
    !id(plan.id) ||
    !Number.isSafeInteger(plan.version) ||
    plan.version < 1 ||
    !sha(input.planSha256) ||
    hashPlan(plan) !== input.planSha256
  )
    invalid();
  instant(plan.frozenAt);
  identity(plan.identity);
  list(plan.runIds, LIMITS.runs);
  unique(plan.runIds);
  if (plan.runIds.length !== 3 || !plan.runIds.every(id)) invalid();
  list(plan.cells, LIMITS.cells);
  if (!plan.cells.length) invalid();
  for (const cell of plan.cells) {
    exact(cell, [
      ...KEY,
      'A',
      'R',
      'plannedCount',
      'rationaleId',
      'rationaleSha256',
      'calibrationUncertainty',
    ]);
    cellKey(cell);
    if (
      !finite(cell.A) ||
      !count(cell.plannedCount) ||
      !cell.plannedCount ||
      cell.A < 0 ||
      !finite(cell.R) ||
      cell.R < 0 ||
      !id(cell.rationaleId) ||
      !sha(cell.rationaleSha256)
    )
      invalid();
    const fact = cell.calibrationUncertainty;
    exact(fact, ['value', 'reason']);
    if (
      fact.value === null
        ? !['unavailable', 'not-calibrated'].includes(fact.reason)
        : !finite(fact.value) || fact.value < 0 || fact.reason !== null
    )
      invalid();
  }
  unique(plan.cells.map(cellKey));
  list(input.runs, LIMITS.runs);
  if (input.runs.length !== 3) invalid();
  unique(input.runs.map((run) => run?.runId));
  for (const run of input.runs) {
    exact(run, ['runId', 'startedAt', 'identity', 'cells']);
    if (!plan.runIds.includes(run.runId)) invalid();
    if (run.startedAt !== null) instant(run.startedAt);
    identity(run.identity);
    list(run.cells, LIMITS.cells);
    if (run.cells.length !== plan.cells.length) invalid();
    unique(run.cells.map(cellKey));
    for (const cell of run.cells) {
      exact(cell, [...KEY, 'status', 'estimate', 'reason', 'counts']);
      if (
        !plan.cells.some(
          (declared) => cellKey(declared) === cellKey(cell) && declared.unit === cell.unit,
        )
      )
        invalid();
      if (typeof cell.status !== 'string') invalid();
      if (
        cell.status === 'complete'
          ? !finite(cell.estimate) || cell.reason !== null
          : !Object.hasOwn(REASONS, cell.status) ||
            cell.estimate !== null ||
            cell.reason !== REASONS[cell.status]
      )
        invalid();
      exact(cell.counts, ['planned', 'valid', 'excluded', 'missing', 'failed']);
      if (
        !Object.values(cell.counts).every(count) ||
        (run.startedAt === null && cell.status !== 'not-started') ||
        (run.startedAt !== null && cell.status === 'not-started')
      )
        invalid();
    }
  }
}
const canonical = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && !Array.isArray(item) && typeof item === 'object'
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
function decimal(value) {
  const [coefficient, exponent = '0'] = value.toString().split('e');
  const [whole, fraction = ''] = coefficient.split('.');
  return BigInt(whole + fraction) * 10n ** BigInt(324 + Number(exponent) - fraction.length);
}
function format(value, scale = 324) {
  const digits = (value < 0n ? -value : value).toString().padStart(scale + 1, '0');
  const fraction = digits.slice(-scale).replace(/0+$/, '');
  return `${value < 0n ? '-' : ''}${digits.slice(0, -scale)}${fraction ? '.' + fraction : ''}`;
}
/**
 * Hash canonical declared plan fields.
 * @param {object} plan Declared plan.
 * @returns {string} Plan digest.
 * @since v0.11.0
 */
function hashPlan(plan) {
  bounded(plan);
  return crypto.createHash('sha256').update(canonical(plan)).digest('hex');
}
/**
 * Evaluate conditional reproducibility arithmetic.
 * @param {object} input Declared repetitions.
 * @returns {object} Conditional results.
 * @since v0.11.0
 */
function evaluateReproducibility(input) {
  try {
    validate(input);
  } catch {
    invalid();
  }
  const ordered = input.plan.runIds.map((runId) => input.runs.find((run) => run.runId === runId));
  const cells = input.plan.cells.map((cell) => {
    const rows = ordered.map((run) => run.cells.find((row) => cellKey(row) === cellKey(cell)));
    const estimates = rows.map((row) => row.estimate);
    const reasons = [];
    if (rows.some((row) => row.counts.planned !== cell.plannedCount))
      reasons.push('planned-count-mismatch');
    if (rows.some((row) => row.status !== 'complete')) reasons.push('incomplete-repetition');
    if (
      rows.some(
        ({ counts: c }) =>
          !c.planned || c.valid !== c.planned || c.excluded || c.missing || c.failed,
      )
    )
      reasons.push('incomplete-population');
    if (ordered.some((run) => canonical(run.identity) !== canonical(input.plan.identity)))
      reasons.push('comparison-identity-mismatch');
    if (
      ordered.some(
        (run) => run.startedAt === null || instant(run.startedAt) <= instant(input.plan.frozenAt),
      )
    )
      reasons.push('plan-not-before-start');
    if (cell.calibrationUncertainty.value === null) reasons.push('unknown-calibration-uncertainty');
    if (reasons.length)
      return {
        metric: cell.metric,
        phase: cell.phase,
        cohort: cell.cohort,
        percentile: cell.percentile,
        unit: cell.unit,
        estimates,
        minimum: null,
        maximum: null,
        median: null,
        range: null,
        bound: null,
        verdict: 'ineligible',
        reasons,
      };
    const values = estimates.map(decimal).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const [minimum, median, maximum] = values;
    const range = maximum - minimum;
    const bound = decimal(cell.A) * BASE + decimal(cell.R) * (median < 0n ? -median : median);
    return {
      metric: cell.metric,
      phase: cell.phase,
      cohort: cell.cohort,
      percentile: cell.percentile,
      unit: cell.unit,
      estimates,
      minimum: format(minimum),
      maximum: format(maximum),
      median: format(median),
      range: format(range),
      bound: format(bound, 648),
      verdict: range * BASE <= bound ? 'within-declared-bound' : 'outside-declared-bound',
      reasons: [],
    };
  });
  return {
    schema: 'reproducibility-result',
    schemaVersion: 1,
    sourceAuthenticated: false,
    collectionQualified: false,
    measurementAccepted: false,
    inputSha256: hashPlan(input),
    planSha256: input.planSha256,
    plan: JSON.parse(canonical(input.plan)),
    runs: JSON.parse(canonical(input.runs)),
    cells,
  };
}
module.exports = { hashPlan, evaluateReproducibility, LIMITS };
