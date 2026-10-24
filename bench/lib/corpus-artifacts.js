'use strict';
const { invalid, LIMITS } = require('./corpus-input');
const { loopbackRecord, readRecord } = require('./corpus-outcomes');
const ID = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
const SHA = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const SHAPES = Object.freeze({
  'copy-binary': 'file.creation',
  'write-fixture': 'file.creation',
  'spawn-process': 'process.start',
  wait: null,
  'terminate-process': 'process.end',
  'delete-file': 'file.deletion',
  'seed-secret-file': 'file.creation',
  'hold-secret-file': 'process.start',
  'send-loopback-canary': 'network.start',
  'read-fixture': 'file.access',
});
const ACTIONS = Object.freeze({
  'file.creation': 'file-created',
  'file.deletion': 'file-deleted',
  'process.start': 'process-started',
  'process.end': 'process-ended',
  'network.start': 'loopback-canary-write-finished',
  'file.access': 'fixture-file-read',
});
const count = (value) => Number.isSafeInteger(value) && value >= 0 && value <= LIMITS.steps;
const pick = (value, fields) => Object.fromEntries(fields.map((field) => [field, value[field]]));
const exact = (value, keys) => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    invalid();
};
const bind = (value, header) => {
  if (
    value.schemaVersion !== 1 ||
    ['runId', 'scenario', 'arm'].some((key) => value[key] !== header[key])
  )
    invalid();
};
/** @param {string} value UTC timestamp. @returns {boolean} Calendar-valid ISO milliseconds. @since unreleased */
function instant(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
/** @param {object} value Raw manifest. @param {string[]} scenarios Supported inventory IDs. @returns {object} Safe identity header. @since unreleased */
function manifestHeader(value, scenarios) {
  if (
    !value ||
    value.schemaVersion !== 2 ||
    !ID(value.runId) ||
    !scenarios.includes(value.scenario) ||
    !['A', 'B', 'C'].includes(value.arm) ||
    !instant(value.startedAt)
  )
    invalid();
  return {
    runId: value.runId,
    scenario: value.scenario,
    arm: value.arm,
    recordedStartedAt: value.startedAt,
  };
}
function stepsRecord(value, header) {
  if (value === null) return null;
  exact(value, [
    'schemaVersion',
    'runId',
    'scenario',
    'arm',
    'counts',
    'expectations',
    'meaning',
    'steps',
  ]);
  bind(value, header);
  if (
    typeof value.meaning !== 'string' ||
    !Array.isArray(value.steps) ||
    !value.steps.length ||
    value.steps.length > LIMITS.steps
  )
    invalid();
  exact(value.counts, ['declared', 'ok', 'failed', 'skipped']);
  exact(value.expectations, ['claimed', 'emitted', 'notExecuted']);
  if (![...Object.values(value.counts), ...Object.values(value.expectations)].every(count))
    invalid();
  const seen = new Set();
  let failed = false;
  for (const step of value.steps) {
    exact(step, ['id', 'kind', 'status', 'expect', 'emits', 'emitted', 'startedAt', 'error']);
    if (
      !ID(step.id) ||
      seen.has(step.id) ||
      !Object.hasOwn(SHAPES, step.kind) ||
      typeof step.kind !== 'string' ||
      !['ok', 'failed', 'skipped'].includes(step.status) ||
      (step.startedAt !== null && !instant(step.startedAt)) ||
      (step.error !== null && typeof step.error !== 'string')
    )
      invalid();
    seen.add(step.id);
    const shape = SHAPES[step.kind];
    if (
      step.emits !== shape ||
      (shape === null
        ? step.expect !== null
        : typeof step.expect !== 'string' || !/^E\d{1,3}$/.test(step.expect)) ||
      step.emitted !== (step.status === 'ok' ? shape : null) ||
      (failed ? step.status !== 'skipped' : step.status === 'skipped')
    )
      invalid();
    failed ||= step.status === 'failed';
  }
  const counts = {
    declared: value.steps.length,
    ok: value.steps.filter((s) => s.status === 'ok').length,
    failed: value.steps.filter((s) => s.status === 'failed').length,
    skipped: value.steps.filter((s) => s.status === 'skipped').length,
  };
  const claimed = value.steps.filter((s) => s.expect !== null),
    expectations = {
      claimed: claimed.length,
      emitted: claimed.filter((s) => s.emitted !== null).length,
      notExecuted: claimed.filter((s) => s.emitted === null).length,
    };
  if (
    Object.keys(counts).some((key) => counts[key] !== value.counts[key]) ||
    Object.keys(expectations).some((key) => expectations[key] !== value.expectations[key])
  )
    invalid();
  return {
    ...counts,
    expectations,
    rows: value.steps.map((s) => pick(s, ['id', 'kind', 'status', 'expect', 'emits', 'emitted'])),
  };
}
function eventsRecord(events, header, steps) {
  if (events === null) return null;
  if (!Array.isArray(events) || events.length > LIMITS.events) invalid();
  const seen = new Set(),
    categories = new Map();
  for (const row of events) {
    if (
      !row ||
      !instant(row['@timestamp']) ||
      !row.bench ||
      row.bench.scenario !== header.scenario ||
      !ID(row.bench.step) ||
      typeof row.bench.expect !== 'string' ||
      !/^E\d{1,3}$/.test(row.bench.expect) ||
      seen.has(row.bench.step)
    )
      invalid();
    exact(row.event, ['kind', 'category', 'type', 'action']);
    if (
      row.event.kind !== 'event' ||
      !Array.isArray(row.event.category) ||
      row.event.category.length !== 1 ||
      typeof row.event.category[0] !== 'string' ||
      !Array.isArray(row.event.type) ||
      row.event.type.length !== 1 ||
      typeof row.event.type[0] !== 'string'
    )
      invalid();
    const shape = `${row.event.category[0]}.${row.event.type[0]}`;
    if (
      !Object.hasOwn(ACTIONS, shape) ||
      row.event.action !== ACTIONS[shape] ||
      !row.process ||
      !Number.isSafeInteger(row.process.pid) ||
      row.process.pid <= 0 ||
      typeof row.process.executable !== 'string' ||
      !row.process.executable.trim()
    )
      invalid();
    if (steps) {
      const step = steps.rows.find((s) => s.id === row.bench.step);
      if (
        !step ||
        step.status !== 'ok' ||
        step.emitted !== shape ||
        step.expect !== row.bench.expect
      )
        invalid();
    }
    if (
      (row.bench.runId !== undefined || shape === 'network.start' || shape === 'file.access') &&
      row.bench.runId !== header.runId
    )
      invalid();
    if (shape === 'file.creation' || shape === 'file.access') {
      if (
        !row.file ||
        !Number.isSafeInteger(row.file.size) ||
        row.file.size < 0 ||
        row.file.size > 1e12 ||
        !SHA(row.file.hash?.sha256)
      )
        invalid();
    }
    if (
      shape === 'file.access' &&
      (!ID(row.bench.sourceStep) ||
        typeof row.bench.fixtureLabel !== 'string' ||
        !/^(project|outside-project|persistence-location)\/canary-[a-z0-9-]{1,40}\.txt$/.test(
          row.bench.fixtureLabel,
        ) ||
        row.bench.timestampBasis !== 'harness-read-completion-observation' ||
        row.file.size <= 0 ||
        row.file.size > 16384)
    )
      invalid();
    if (shape === 'network.start') {
      exact(row.destination, ['ip']);
      exact(row.network, ['transport', 'protocol', 'bytes']);
      if (
        row.destination.ip !== '127.0.0.1' ||
        row.network.transport !== 'tcp' ||
        row.network.protocol !== 'http' ||
        !Number.isSafeInteger(row.network.bytes) ||
        row.network.bytes <= 0 ||
        row.network.bytes > 512 ||
        !ID(row.bench.nonce) ||
        row.bench.timestampBasis !== 'harness-completion-observation'
      )
        invalid();
    }
    seen.add(row.bench.step);
    categories.set(shape, (categories.get(shape) || 0) + 1);
  }
  if (
    steps &&
    (steps.expectations.emitted !== events.length ||
      steps.rows.some((s) => s.emitted !== null && !seen.has(s.id)))
  )
    invalid();
  return {
    count: events.length,
    byCategory: [...categories.keys()].sort().map((shape) => {
      const [category, type] = shape.split('.');
      return { category, type, count: categories.get(shape) };
    }),
  };
}
/** @param {object} data Parsed known artifacts. @param {string[]} scenarios Inventory IDs. @returns {object} Sanitized, reconciled recorded attempt. @since unreleased */
function summarize(data, scenarios) {
  const header = manifestHeader(data.manifest, scenarios),
    steps = stepsRecord(data.steps, header),
    expected = eventsRecord(data.expected, header, steps);
  const loopRequired =
      header.scenario === 'S7-owned-loopback-transfer' ||
      steps?.rows.some((s) => s.kind === 'send-loopback-canary'),
    readRequired =
      header.scenario === 'S8-owned-file-read' ||
      steps?.rows.some((s) => s.kind === 'read-fixture');
  const loopback = loopbackRecord(data.loopback, header, steps, data.expected, loopRequired),
    read = readRecord(data.read, header, steps, data.expected, readRequired);
  const missing = [];
  if (!steps) missing.push('steps.json');
  if (!expected) missing.push('expected.ndjson');
  if (loopRequired && !data.loopback) missing.push('fixture-outcomes.json');
  if (readRequired && !data.read) missing.push('file-read-outcomes.json');
  const incompleteOutcome = [loopback, read].some((row) =>
    ['empty-incomplete', 'steps-unavailable'].includes(row.state),
  );
  return {
    ...header,
    artifactState: missing.length || incompleteOutcome ? 'incomplete' : 'recorded',
    stepState: !steps ? 'unknown' : steps.failed ? 'failed' : 'ok',
    missingArtifacts: missing,
    executedDefinitionMatch: 'unverified',
    steps,
    expected,
    loopback,
    read,
  };
}
module.exports = { summarize, instant };
