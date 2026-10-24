'use strict';
const { invalid } = require('./corpus-input');
const { validateControl } = require('./fixture-outcomes');
const { validateReadOutcome } = require('./file-read-outcomes');
const ID = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
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
function catalogueSuccess(events, step, shape, success) {
  if (events === null) return undefined;
  const candidates = events.filter(
    (event) => `${event.event.category[0]}.${event.event.type[0]}` === shape,
  );
  const event = events.find((row) => row.bench.step === step);
  if (
    success
      ? candidates.length !== 1 || candidates[0] !== event
      : candidates.length !== 0 || event !== undefined
  )
    invalid();
  return event;
}
function outcomeState(value, steps, kind, missing) {
  const declared = steps?.rows.filter((s) => s.kind === kind) ?? null;
  if (declared && declared.length > 1) invalid();
  if (value === null)
    return { state: missing ? 'missing' : 'not-declared', declared: declared?.[0] ?? null };
  if (!Array.isArray(value.outcomes) || value.outcomes.length > 1) invalid();
  const step = declared?.[0] ?? null;
  if (!value.outcomes.length)
    return {
      state: !steps
        ? 'steps-unavailable'
        : !step
          ? 'not-declared'
          : step.status === 'skipped'
            ? 'not-executed'
            : 'empty-incomplete',
      declared: step,
    };
  if (steps && (!step || step.status === 'skipped' || step.id !== value.outcomes[0].step))
    invalid();
  return { state: 'recorded', declared: step };
}
/** @param {object|null} value Recorded artifact. @param {object} header Run binding. @param {object|null} steps Validated steps. @param {object[]|null} events Validated events. @param {boolean} required Required column. @returns {object} Safe loopback facts. @since unreleased */
function loopbackRecord(value, header, steps, events, required) {
  const state = outcomeState(value, steps, 'send-loopback-canary', required);
  if (value === null) return { state: state.state };
  exact(value, [
    'schema',
    'schemaVersion',
    'runId',
    'scenario',
    'arm',
    'scope',
    'osOracle',
    'sensorScored',
    'measurementAccepted',
    'outcomes',
  ]);
  bind(value, header);
  if (
    value.schema !== 'fixture-outcomes' ||
    value.scope !== 'controlled-node-loopback' ||
    value.osOracle !== false ||
    value.sensorScored !== false ||
    value.measurementAccepted !== false
  )
    invalid();
  if (state.state !== 'recorded') return { state: state.state };
  const row = value.outcomes[0];
  exact(row, ['runId', 'scenario', 'step', 'nonce', 'control', 'reason']);
  if (
    row.runId !== header.runId ||
    row.scenario !== header.scenario ||
    !ID(row.step) ||
    !ID(row.nonce)
  )
    invalid();
  if (row.control === null) {
    if (row.reason !== 'control-unavailable' || state.declared?.status === 'ok') invalid();
    catalogueSuccess(events, row.step, 'network.start', false);
    return {
      state: 'recorded',
      step: row.step,
      nonce: row.nonce,
      reason: 'control-unavailable',
      sender: null,
      receiver: null,
      combinedConfirmed: null,
    };
  }
  if (row.reason !== null) invalid();
  const control = validateControl(
      row.control,
      header.runId,
      row.nonce,
      row.control.receiver?.plannedDurationMs,
    ),
    s = control.sender,
    r = control.receiver;
  const written = s.writeFinished === true && Number.isSafeInteger(s.sentBytes) && s.sentBytes > 0;
  if (state.declared && (state.declared.status === 'ok') !== written) invalid();
  const exactCandidate = r.matchingPayloads === 1 && !r.wrong && !r.duplicates && !r.oversize;
  const falseReason = r.duplicates
    ? 'duplicate-receipt'
    : r.wrong || r.oversize
      ? 'wrong-receipt'
      : 'receipt-count-mismatch';
  if (
    r.cleanup.confirmed !== (r.cleanup.listenerClosed && r.cleanup.socketsClosed) ||
    (r.exact === null &&
      (r.reason === null ||
        ['wrong-receipt', 'duplicate-receipt', 'receipt-count-mismatch'].includes(r.reason))) ||
    (r.exact === false &&
      (exactCandidate ||
        !r.cleanup.confirmed ||
        r.incomplete ||
        r.protocolErrors ||
        r.reason !== falseReason)) ||
    control.confirmed !==
      (s.reason === null &&
        s.socketClosed === true &&
        r.exact === true &&
        r.cleanup.confirmed === true) ||
    (r.exact === null ? r.verifiedCount !== null : r.verifiedCount !== r.matchingPayloads) ||
    (r.exact === true &&
      (r.verifiedCount !== 1 ||
        r.matchingPayloads !== 1 ||
        r.wrong ||
        r.duplicates ||
        r.oversize ||
        r.incomplete ||
        r.protocolErrors ||
        r.reason !== null ||
        !r.cleanup.confirmed))
  )
    invalid();
  const event = catalogueSuccess(events, row.step, 'network.start', written);
  if (event && (event.bench.nonce !== row.nonce || event.network?.bytes !== s.sentBytes)) invalid();
  return {
    state: 'recorded',
    step: row.step,
    nonce: row.nonce,
    reason: null,
    sender: pick(s, [
      'attempted',
      'writeFinished',
      'sentBytes',
      'responseCompleted',
      'statusCode',
      'socketClosed',
      'reason',
    ]),
    receiver: {
      ...pick(r, [
        'expectedCount',
        'expectedBytes',
        'expectedSha256',
        'connections',
        'requests',
        'completedBodies',
        'matchingPayloads',
        'duplicates',
        'wrong',
        'oversize',
        'incomplete',
        'protocolErrors',
        'observedHashes',
        'verifiedCount',
        'exact',
        'reason',
      ]),
      cleanup: pick(r.cleanup, ['listenerClosed', 'socketsClosed', 'confirmed']),
    },
    combinedConfirmed: control.confirmed,
  };
}
/** @param {object|null} value Recorded artifact. @param {object} header Run binding. @param {object|null} steps Validated steps. @param {object[]|null} events Validated events. @param {boolean} required Required column. @returns {object} Safe read facts. @since unreleased */
function readRecord(value, header, steps, events, required) {
  const state = outcomeState(value, steps, 'read-fixture', required);
  if (value === null) return { state: state.state };
  exact(value, [
    'schema',
    'schemaVersion',
    'runId',
    'scenario',
    'arm',
    'scope',
    'osOracle',
    'sourceAuthenticated',
    'sensorScored',
    'measurementAccepted',
    'outcomes',
  ]);
  bind(value, header);
  if (
    value.schema !== 'file-read-outcomes' ||
    value.scope !== 'owned-file-read-control' ||
    [value.osOracle, value.sourceAuthenticated, value.sensorScored, value.measurementAccepted].some(
      (v) => v !== false,
    )
  )
    invalid();
  if (state.state !== 'recorded') return { state: state.state };
  const row = value.outcomes[0];
  if (!row || !ID(row.step) || !ID(row.fromStep)) invalid();
  if (steps) {
    const sourceIndex = steps.rows.findIndex((s) => s.id === row.fromStep);
    if (
      sourceIndex < 0 ||
      sourceIndex >= steps.rows.findIndex((s) => s.id === row.step) ||
      steps.rows[sourceIndex].kind !== 'write-fixture' ||
      steps.rows[sourceIndex].status !== 'ok'
    )
      invalid();
  }
  const source = events?.find((e) => e.bench.step === row.fromStep);
  if (events && !source) invalid();
  let label = row.fixtureLabel;
  if (source) {
    const match =
      typeof source.file?.path === 'string'
        ? /\/fixtures\/(project|outside-project|persistence-location)\/(canary-[a-z0-9-]{1,40}\.txt)$/.exec(
            source.file.path.replace(/\\/g, '/'),
          )
        : null;
    if (!match || source.event.type[0] !== 'creation') invalid();
    label = `${match[1]}/${match[2]}`;
  }
  const control = validateReadOutcome(row, {
    runId: header.runId,
    scenario: header.scenario,
    step: row.step,
    fromStep: row.fromStep,
    fixtureLabel: label,
    expectedBytes: source?.file.size ?? row.expectedBytes,
    expectedSha256: source?.file.hash.sha256 ?? row.expectedSha256,
  });
  if (state.declared && (state.declared.status === 'ok') !== (control.status === 'complete'))
    invalid();
  const event = catalogueSuccess(events, row.step, 'file.access', control.status === 'complete');
  if (
    event &&
    (event.file?.size !== control.readBytes ||
      event.file?.hash?.sha256 !== control.readSha256 ||
      event.bench.sourceStep !== control.fromStep ||
      event.bench.fixtureLabel !== control.fixtureLabel)
  )
    invalid();
  return {
    state: 'recorded',
    sourceBinding: steps && events ? 'recorded-source-checked' : 'unverified-missing-artifact',
    ...pick(control, [
      'step',
      'fromStep',
      'fixtureLabel',
      'originalIdentitySha256',
      'preIdentitySha256',
      'postIdentitySha256',
      'namedIdentitySha256',
      'expectedBytes',
      'expectedSha256',
      'readBytes',
      'readSha256',
      'progressKnown',
      'status',
      'reason',
    ]),
    closure: pick(control.closure, ['opened', 'closeAttempted', 'closed']),
  };
}
module.exports = { loopbackRecord, readRecord };
