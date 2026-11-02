import fs from 'node:fs';
import path from 'node:path';

/** Project scanner conditions without retaining actor data or raw diagnostics.
 * @param {object|null} value Actual bounded main-process evidence.
 * @param {{pid:number,birth:string}} witness Independent fixture identity.
 * @returns {object} Fixed boolean conditions and a capped population count.
 * @since v0.20.1
 */
export function projectScannerReadiness(value, witness) {
  const agents = Array.isArray(value?.agents) ? value.agents : [];
  const populationReliable = value?.readiness?.populationReliable === true;
  const identityNonDegraded = value?.readiness?.identityDegraded === false;
  const monitoringActive = value?.readiness?.monitoringPaused === false;
  const isActor = (agent) => agent?.pid === witness.pid;
  const actorExactMatch = agents.some(
    (agent) =>
      isActor(agent) && agent.instanceIdSource === 'os' && agent.createTime100ns === witness.birth,
  );
  return {
    accepted: populationReliable && identityNonDegraded && monitoringActive && actorExactMatch,
    projectionAvailable: value != null,
    readinessAvailable: value?.readiness != null,
    agentsAvailable: Array.isArray(value?.agents),
    populationReliable,
    identityNonDegraded,
    monitoringActive,
    projectedAgentCount: Math.min(agents.length, 128),
    actorPidObserved: agents.some(isActor),
    actorOsIdentityObserved: agents.some(
      (agent) => isActor(agent) && agent.instanceIdSource === 'os',
    ),
    actorBirthMatched: agents.some(
      (agent) => isActor(agent) && agent.createTime100ns === witness.birth,
    ),
    actorExactMatch,
  };
}

/** Retain only the latest scanner condition sample before the caller's guard.
 * @param {object|null} value Actual bounded main-process evidence.
 * @param {{pid:number,birth:string}} witness Independent fixture identity.
 * @param {{samples:number,last:object|null}} observation Owned scenario receipt.
 * @returns {boolean} The unchanged strict scanner/actor acceptance decision.
 * @since v0.20.1
 */
export function recordScannerReadiness(value, witness, observation) {
  observation.last = projectScannerReadiness(value, witness);
  observation.samples = Math.min(observation.samples + 1, 512);
  return observation.last.accepted;
}

/** Read existing main-process snapshot getters without exporting private diagnostics.
 * This closure is self-contained because Playwright serializes it into Electron.
 * @param {{app?:object}} electron Actual Electron exports, or no app for unavailable.
 * @param {Function} [loadModule] Test-only module loader; production uses the app archive.
 * @returns {object} Closed enums, booleans and capped counters only. @since v0.20.1
 */
export function readScannerSnapshotDiagnostic({ app }, loadModule) {
  const result = {
    schema: 'aegis-native-read-snapshot-diagnostic/2',
    snapshotAvailable: false,
    clientAvailable: false,
    state: null,
    detail: null,
    source: null,
    mode: null,
    transitions: null,
    errorPresent: null,
    connected: null,
    stickyPresent: null,
    failures: null,
    capabilityClass: null,
    sequence: null,
    topology: null,
    firstFailure: null,
    populationAsOf: null,
    processLastSuccessAt: null,
    snapshotLastAttemptAt: null,
    snapshotLastSuccessAt: null,
    scanCadence: { maxProcessGapMs: null, skippedProcessTicks: null, lastSkippedAt: null },
  };
  if (!app) return result;
  const pick = (value, choices) => (choices.includes(value) ? value : null);
  const flag = (value) => (typeof value === 'boolean' ? value : null);
  const count = (value, limit) =>
    Number.isSafeInteger(value) && value >= 0 ? Math.min(value, limit) : null;
  const time = (value) =>
    Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000 ? value : null;
  try {
    const load =
      loadModule ||
      process.mainModule.require('node:module').createRequire(app.getAppPath() + '/package.json');
    try {
      const snapshot = load('./src/main/platform/process-snapshot.js');
      const health = snapshot.getSnapshotHealth(),
        source = snapshot.getSourceStats();
      result.state = pick(health?.state, ['STARTING', 'HEALTHY', 'DEGRADED', 'FAILED']);
      result.detail = pick(health?.detail, ['basic', 'class5', 'cim-fallback', 'cim', 'none']);
      result.source = pick(source?.lastSource, ['basic', 'class5', 'cim', 'none']);
      result.mode = pick(snapshot.getMode(), ['auto', 'strict', 'cim']);
      result.transitions = count(source?.transitions, 512);
      result.snapshotLastAttemptAt = time(health?.lastAttemptAt);
      result.snapshotLastSuccessAt = time(health?.lastSuccessAt);
      result.errorPresent =
        typeof health?.lastError === 'string'
          ? health.lastError.length > 0
          : health?.lastError === null
            ? false
            : null;
      result.snapshotAvailable = true;
    } catch {
      /* Keep unavailable fields fixed; never export raw exceptions. */
    }
    try {
      const state = load('./src/main/platform/proc-snapshot-client.js').getState();
      result.connected = flag(state?.connected);
      result.stickyPresent =
        state?.sticky === null ? false : typeof state?.sticky === 'string' ? true : null;
      result.failures = count(state?.failures, 3);
      result.capabilityClass = pick(state?.caps?.class, ['basic', 'class5']);
      result.sequence = flag(state?.caps?.sequence);
      result.topology = flag(state?.caps?.topology);
      const first = state?.firstFailure;
      const kind = pick(first?.kind, [
        'binary-missing',
        'spawn-failed',
        'child-error',
        'child-exit',
        'handshake-timeout',
        'snapshot-timeout',
        'stdin-failed',
        'frame-invalid',
        'protocol-mismatch',
        'capabilities-invalid',
        'sidecar-error',
        'response-invalid',
      ]);
      if (kind !== null)
        result.firstFailure = {
          kind,
          exitCode:
            Number.isInteger(first.exitCode) &&
            first.exitCode >= -2147483648 &&
            first.exitCode <= 4294967295
              ? first.exitCode
              : null,
          stderrClass: pick(first.stderrClass, [
            'none',
            'other-stderr',
            'probe-other',
            'probe-query-unavailable',
            'probe-query-failed',
            'probe-query-limit',
            'probe-query-growth',
            'probe-self-times',
            'probe-entry-bounds',
            'probe-birth-mismatch',
            'probe-empty-name',
            'probe-chain-limit',
            'probe-negative-offset',
            'probe-self-missing',
            'probe-population-small',
          ]),
          nativeStatus:
            Number.isInteger(first.nativeStatus) &&
            first.nativeStatus >= 0 &&
            first.nativeStatus <= 4294967295
              ? first.nativeStatus
              : null,
          responseClass: pick(first.responseClass, [
            'query-unavailable',
            'query-failed',
            'query-limit',
            'query-growth',
            'snapshot-entry-bounds',
            'snapshot-chain-limit',
            'snapshot-negative-offset',
            'snapshot-overlapping-offset',
          ]),
        };
      result.clientAvailable = true;
    } catch {
      /* Snapshot health remains useful when the client getter is absent. */
    }
    try {
      const scanner = load('./src/main/process-scanner.js');
      result.populationAsOf = time(scanner.getProcessCapabilities()?.populationAsOf);
      result.processLastSuccessAt = time(scanner.getProcessSensorHealth()?.lastSuccessAt);
    } catch {
      /* Missing current process health is explicit, not an inferred timestamp. */
    }
    try {
      const cadence = load('./src/main/scan-loop.js').getScanCadence();
      result.scanCadence = {
        maxProcessGapMs:
          Number.isSafeInteger(cadence?.maxProcessGapMs) &&
          cadence.maxProcessGapMs > 0 &&
          cadence.maxProcessGapMs <= 3600000
            ? cadence.maxProcessGapMs
            : null,
        skippedProcessTicks: count(cadence?.skippedProcessTicks, 1000000),
        lastSkippedAt: time(cadence?.lastSkippedAt),
      };
    } catch {
      /* No scheduler action or new observation is requested. */
    }
  } catch {
    /* Missing main-module loader leaves a fixed unavailable projection. */
  }
  return result;
}

/** Validate the closed getter result before retaining it across a lost connection.
 * @param {object} value Unknown transported result. @returns {object|null} Closed copy.
 * @since v0.20.1
 */
function closedSnapshotDiagnostic(value) {
  const empty = readScannerSnapshotDiagnostic({});
  const keys = (object, expected) =>
    object &&
    typeof object === 'object' &&
    !Array.isArray(object) &&
    Object.keys(object).length === expected.length &&
    expected.every((key) => Object.hasOwn(object, key));
  const integer = (number, max, min = 0) =>
    Number.isSafeInteger(number) && number >= min && number <= max;
  const nullable = (value, accept) => value === null || accept(value);
  const time = (value) => integer(value, 8640000000000000);
  const choices = (value, allowed) => nullable(value, (item) => allowed.includes(item));
  if (!keys(value, Object.keys(empty)) || value.schema !== empty.schema) return null;
  if (!['snapshotAvailable', 'clientAvailable'].every((key) => typeof value[key] === 'boolean'))
    return null;
  if (
    !['errorPresent', 'connected', 'stickyPresent', 'sequence', 'topology'].every((key) =>
      nullable(value[key], (item) => typeof item === 'boolean'),
    )
  )
    return null;
  if (
    !choices(value.state, ['STARTING', 'HEALTHY', 'DEGRADED', 'FAILED']) ||
    !choices(value.detail, ['basic', 'class5', 'cim-fallback', 'cim', 'none']) ||
    !choices(value.source, ['basic', 'class5', 'cim', 'none']) ||
    !choices(value.mode, ['auto', 'strict', 'cim']) ||
    !choices(value.capabilityClass, ['basic', 'class5']) ||
    !nullable(value.transitions, (item) => integer(item, 512)) ||
    !nullable(value.failures, (item) => integer(item, 3)) ||
    ![
      'populationAsOf',
      'processLastSuccessAt',
      'snapshotLastAttemptAt',
      'snapshotLastSuccessAt',
    ].every((key) => nullable(value[key], time))
  )
    return null;
  const cadence = value.scanCadence;
  if (
    !keys(cadence, Object.keys(empty.scanCadence)) ||
    !nullable(cadence.maxProcessGapMs, (item) => integer(item, 3600000, 1)) ||
    !nullable(cadence.skippedProcessTicks, (item) => integer(item, 1000000)) ||
    !nullable(cadence.lastSkippedAt, time)
  )
    return null;
  const first = value.firstFailure;
  if (
    first !== null &&
    (!keys(first, ['kind', 'exitCode', 'stderrClass', 'nativeStatus', 'responseClass']) ||
      ![
        'binary-missing',
        'spawn-failed',
        'child-error',
        'child-exit',
        'handshake-timeout',
        'snapshot-timeout',
        'stdin-failed',
        'frame-invalid',
        'protocol-mismatch',
        'capabilities-invalid',
        'sidecar-error',
        'response-invalid',
      ].includes(first.kind) ||
      !nullable(first.exitCode, (item) => integer(item, 4294967295, -2147483648)) ||
      !choices(first.stderrClass, [
        'none',
        'other-stderr',
        'probe-other',
        'probe-query-unavailable',
        'probe-query-failed',
        'probe-query-limit',
        'probe-query-growth',
        'probe-self-times',
        'probe-entry-bounds',
        'probe-birth-mismatch',
        'probe-empty-name',
        'probe-chain-limit',
        'probe-negative-offset',
        'probe-self-missing',
        'probe-population-small',
      ]) ||
      !nullable(first.nativeStatus, (item) => integer(item, 4294967295)) ||
      !choices(first.responseClass, [
        'query-unavailable',
        'query-failed',
        'query-limit',
        'query-growth',
        'snapshot-entry-bounds',
        'snapshot-chain-limit',
        'snapshot-negative-offset',
        'snapshot-overlapping-offset',
      ]))
  )
    return null;
  return JSON.parse(JSON.stringify(value));
}

/** Retain three fixed diagnostic snapshots and durably checkpoint before cleanup.
 * @param {object} options Owned output, fixture witness, receipt and read-only getter.
 * @returns {{begin:Function,observe:Function,finish:Function}} Bounded checkpoint collector.
 * @since v0.20.1
 */
export function createScannerIdentityCheckpoint({ output, witness, observation, read }) {
  const filename = path.join(output, 'identity-diagnostic.json');
  const temporary = filename + '.tmp';
  const state = {
    schema: 'aegis-native-read-identity-checkpoint/1',
    phase: 'observing',
    readiness: null,
    initial: null,
    firstFailure: null,
    last: null,
    capture: { attempts: 0, timedOut: false, unavailable: false },
  };
  let lastCaptureAt = -Infinity;
  let stopped = false;
  let written = false;
  let finished = false;
  let inFlight = null;
  const flush = () => {
    const bytes = Buffer.from(JSON.stringify(state) + '\n');
    if (bytes.length > 16384 || (!written && fs.existsSync(filename)))
      throw new Error('Identity diagnostic checkpoint refused');
    let descriptor;
    let created = false;
    try {
      descriptor = fs.openSync(temporary, 'wx');
      created = true;
      fs.writeFileSync(descriptor, bytes);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporary, filename);
      written = true;
    } catch {
      try {
        if (descriptor !== undefined) fs.closeSync(descriptor);
        if (created && fs.existsSync(temporary)) fs.unlinkSync(temporary);
      } catch {
        /* Preserve the fixed persistence failure without private I/O details. */
      }
      throw new Error('Identity diagnostic checkpoint persistence failed');
    }
    observation.snapshotDiagnostic = JSON.parse(
      JSON.stringify(state.last?.diagnostic ?? readScannerSnapshotDiagnostic({})),
    );
    observation.diagnosticCheckpoint = {
      schema: state.schema,
      filename: 'identity-diagnostic.json',
      persisted: true,
      captures: state.capture.attempts,
    };
  };
  const capture = async (force) => {
    const now = Date.now();
    if (stopped || state.capture.attempts >= 32 || (!force && now - lastCaptureAt < 1000)) return;
    state.capture.attempts++;
    lastCaptureAt = now;
    const timeout = Symbol('diagnostic-timeout');
    let timer;
    try {
      const value = await Promise.race([
        Promise.resolve().then(read),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(timeout), 1000);
        }),
      ]);
      if (finished) return;
      if (value === timeout) {
        state.capture.timedOut = true;
        stopped = true;
        return;
      }
      const diagnostic = closedSnapshotDiagnostic(value);
      if (!diagnostic || (!diagnostic.snapshotAvailable && !diagnostic.clientAvailable)) {
        state.capture.unavailable = true;
        return;
      }
      const snapshot = { observedAt: Date.now(), diagnostic };
      state.initial ??= snapshot;
      if (
        !state.firstFailure &&
        (diagnostic.firstFailure || ['FAILED', 'DEGRADED'].includes(diagnostic.state))
      )
        state.firstFailure = snapshot;
      state.last = snapshot;
    } catch {
      if (finished) return;
      state.capture.unavailable = true;
      stopped = true;
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    begin() {
      flush();
    },
    observe(value) {
      const previousReadiness = JSON.stringify(state.readiness);
      const previousAttempts = state.capture.attempts;
      state.readiness = projectScannerReadiness(value, witness);
      if (
        !inFlight &&
        !stopped &&
        state.capture.attempts < 32 &&
        Date.now() - lastCaptureAt >= 1000
      ) {
        inFlight = capture(false).then(() => {
          inFlight = null;
          if (!finished) {
            try {
              flush();
            } catch {
              observation.diagnosticCheckpointPersisted = false;
              stopped = true;
            }
          }
        });
      }
      if (
        !written ||
        previousAttempts !== state.capture.attempts ||
        previousReadiness !== JSON.stringify(state.readiness)
      )
        flush();
    },
    async finish(phase) {
      if (phase === 'failed') {
        if (inFlight) await inFlight;
        else await capture(true);
      } else if (inFlight) {
        state.capture.unavailable = true;
      }
      finished = true;
      state.phase = phase;
      flush();
    },
  };
}
import protocol from '../../src/main/platform/etw-file-protocol.js';

const PHASES = ['starting', 'running', 'failed', 'recovering', 'recovered', 'stopped', 'disabled'];
const TERMINAL = ['failed', 'recovered', 'stopped'];
const STOP_REASONS = ['operator-stop', 'pause', 'suspend', 'restart', 'shutdown', 'duration-limit'];
const SUMMARY_REASONS = [
  ...protocol.ERROR_CODES,
  'experimental-correlation',
  'counter-time-regressed',
  'unmeasured-interval',
  'counter-regressed',
  'mapping-uncertain',
  'identity-uncertain',
  'population-unavailable',
  'schema-gap',
  'recovery-consent-pending',
  'stage-loss-unmeasured',
  'eventsLost',
  'realTimeBuffersLost',
  'logBuffersLost',
  'dropped',
  'ingressDropped',
  'outputDropped',
  'outputOverflowDropped',
  'outputInvalidatedDropped',
  'decoderErrors',
  'mapResets',
  'mapConflicts',
];

/** Project only preparation conditions and a closed latest-ended-summary subset.
 * A latest summary is descriptive; it is not attributed to an identity or native cause.
 * @param {object|null} value Actual supervisor diagnostics.
 * @param {{pid:number,birth:string}} witness Independent fixture identity.
 * @returns {object} Immutable bounded conditions, with no raw identities or diagnostics.
 * @since v0.20.1
 */
export function projectIssuerPreparationReadiness(value, witness) {
  const prepared = value?.issuerPreparation?.prepared;
  const rows = Array.isArray(prepared) ? prepared.slice(0, 16) : [];
  const validRow = (row) =>
    row !== null &&
    typeof row === 'object' &&
    !Array.isArray(row) &&
    Number.isInteger(row.pid) &&
    row.pid > 0 &&
    row.pid < 0xffffffff &&
    typeof row.createTime100ns === 'string' &&
    /^[1-9]\d{0,19}$/.test(row.createTime100ns) &&
    BigInt(row.createTime100ns) <= 0xffffffffffffffffn;
  const preparedEntriesValid =
    Array.isArray(prepared) && prepared.length <= 16 && rows.every(validRow);
  const actorExactMatch = rows.some(
    (row) => validRow(row) && row.pid === witness.pid && row.createTime100ns === witness.birth,
  );
  const captureRunning = value?.phase === 'running';
  const summaries = Array.isArray(value?.summaries) ? value.summaries : [];
  const rawSummary = summaries.at(-1);
  const summaryAvailable =
    rawSummary !== null && typeof rawSummary === 'object' && !Array.isArray(rawSummary);
  let latestSummary = null;
  if (summaryAvailable) {
    const reasons = rawSummary.reasons;
    const boundedReasons =
      Array.isArray(reasons) && reasons.length <= SUMMARY_REASONS.length ? reasons : [];
    const reasonsKnown =
      Array.isArray(reasons) &&
      reasons.length <= SUMMARY_REASONS.length &&
      reasons.every((reason) => SUMMARY_REASONS.includes(reason));
    const stopReasonKnown =
      rawSummary.stopReason === null || STOP_REASONS.includes(rawSummary.stopReason);
    const exitCodeKnown =
      Number.isInteger(rawSummary.exitCode) &&
      rawSummary.exitCode >= -2147483648 &&
      rawSummary.exitCode <= 4294967295;
    const terminalAccounting =
      rawSummary.phase === 'stopped'
        ? rawSummary.exitCode === 0 &&
          rawSummary.stopVerified === true &&
          rawSummary.recoveryVerified === false
        : rawSummary.phase === 'recovered'
          ? rawSummary.exitCode === 4 &&
            rawSummary.recoveryVerified === true &&
            rawSummary.stopVerified === false
          : rawSummary.phase === 'failed' &&
            rawSummary.stopVerified === false &&
            rawSummary.recoveryVerified === false;
    latestSummary = Object.freeze({
      phase: PHASES.includes(rawSummary.phase) ? rawSummary.phase : 'unknown',
      reasons: Object.freeze(SUMMARY_REASONS.filter((reason) => boundedReasons.includes(reason))),
      reasonsKnown,
      stopReason: stopReasonKnown ? rawSummary.stopReason : null,
      stopReasonKnown,
      exitCode: exitCodeKnown ? rawSummary.exitCode : null,
      exitCodeKnown,
      valid: terminalAccounting && reasonsKnown && stopReasonKnown && exitCodeKnown,
    });
  }
  const captureEnded =
    TERMINAL.includes(value?.phase) &&
    value?.recoveryPending === false &&
    value?.cleanupConsentPending === false &&
    latestSummary?.valid === true &&
    latestSummary.phase === value.phase;
  const flag = (name) => (typeof value?.[name] === 'boolean' ? value[name] : null);
  return Object.freeze({
    accepted: captureRunning && preparedEntriesValid && actorExactMatch,
    projectionAvailable: value != null,
    capturePhase: PHASES.includes(value?.phase) ? value.phase : 'unknown',
    captureRunning,
    preparationAvailable: value?.issuerPreparation != null,
    preparedArrayAvailable: Array.isArray(prepared),
    preparedEntriesValid,
    preparedCount: Math.min(rows.length, 16),
    actorPidObserved: rows.some((row) => validRow(row) && row.pid === witness.pid),
    actorBirthMatched: rows.some((row) => validRow(row) && row.createTime100ns === witness.birth),
    actorExactMatch,
    restartBlocked: flag('restartBlocked'),
    recoveryPending: flag('recoveryPending'),
    cleanupConsentPending: flag('cleanupConsentPending'),
    latestSummary,
    captureEnded,
  });
}

/** Retain the actual first/latest conditions before refusing an already ended capture.
 * @param {object|null} value Actual supervisor diagnostics.
 * @param {{pid:number,birth:string}} witness Independent fixture identity.
 * @param {{samples:number,first:object|null,last:object|null}} observation Owned receipt.
 * @returns {boolean} The strict current-phase/exact-identity preparation decision.
 * @since v0.20.1
 */
export function recordIssuerPreparationReadiness(value, witness, observation) {
  observation.last = projectIssuerPreparationReadiness(value, witness);
  observation.first ??= observation.last;
  observation.samples = Math.min(observation.samples + 1, 512);
  if (observation.last.captureEnded)
    throw new Error('Native issuer preparation refused: capture-ended');
  return observation.last.accepted;
}

const ADMISSION_CONDITIONS = [
  'qualified',
  'revoked',
  'scopePresent',
  'contextPresent',
  'contextActive',
  'continuous',
  'exactProfile',
];
const CONTINUITY_CONDITIONS = [
  'telemetryAvailable',
  'operational',
  'querySucceeded',
  'eventsLostZero',
  'realTimeBuffersLostZero',
  'logBuffersLostZero',
  'droppedZero',
  'decoderErrorsZero',
  'mapEpochZero',
  'mapResetsZero',
  'mapConflictsZero',
  'stickyClear',
];
const REVOCATION_CAUSES = ['explicit', 'continuity', 'profile', 'both'];
const exactKeys = (value, keys) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const booleans = (value, keys) =>
  exactKeys(value, keys) && keys.every((key) => typeof value[key] === 'boolean')
    ? Object.freeze(Object.fromEntries(keys.map((key) => [key, value[key]])))
    : null;
const consistentConditions = (value) =>
  value !== null &&
  value.qualified ===
    (!value.revoked &&
      value.scopePresent &&
      value.contextActive &&
      value.continuous &&
      value.exactProfile) &&
  (value.contextPresent || (!value.contextActive && !value.continuous && !value.exactProfile));

/** Copy only the complete closed operational-admission diagnostic contract.
 * Continuity detail is evidence, not a replacement for the existing qualified predicate.
 * @param {object|null} view Actual fileReadDiagnostics projection.
 * @returns {object} Immutable metadata-only qualification snapshot and closed refusal code.
 * @since v0.20.1
 */
export function projectOperationalAdmission(view) {
  const admission = view?.admission;
  const source = admission?.qualification;
  const admissionAvailable =
    admission !== null && typeof admission === 'object' && !Array.isArray(admission);
  const qualified = typeof admission?.qualified === 'boolean' ? admission.qualified : null;
  const conditions = booleans(source?.conditions, ADMISSION_CONDITIONS);
  const continuity = booleans(source?.continuity, CONTINUITY_CONDITIONS);
  let firstRevocation = null;
  let firstValid = source?.firstRevocation === null;
  if (exactKeys(source?.firstRevocation, ['cause', 'conditions', 'continuity'])) {
    const first = source.firstRevocation;
    const firstConditions = booleans(first.conditions, ADMISSION_CONDITIONS);
    const firstContinuity = booleans(first.continuity, CONTINUITY_CONDITIONS);
    firstValid =
      REVOCATION_CAUSES.includes(first.cause) &&
      firstConditions !== null &&
      firstContinuity !== null;
    if (firstValid)
      firstRevocation = Object.freeze({
        cause: first.cause,
        conditions: firstConditions,
        continuity: firstContinuity,
      });
  }
  const shapeValid =
    exactKeys(source, ['schema', 'conditions', 'continuity', 'firstRevocation']) &&
    source.schema === 'aegis-etw-object-qualification/1' &&
    conditions !== null &&
    continuity !== null &&
    firstValid;
  const qualification = shapeValid
    ? Object.freeze({ schema: source.schema, conditions, continuity, firstRevocation })
    : null;
  const firstConsistent =
    firstRevocation === null ||
    (consistentConditions(firstRevocation.conditions) &&
      firstRevocation.conditions.revoked &&
      !firstRevocation.conditions.qualified &&
      (firstRevocation.cause === 'explicit' ||
        (firstRevocation.conditions.contextActive &&
          firstRevocation.conditions.continuous === (firstRevocation.cause === 'profile') &&
          firstRevocation.conditions.exactProfile === (firstRevocation.cause === 'continuity'))));
  const qualificationValid =
    shapeValid &&
    qualified !== null &&
    conditions.qualified === qualified &&
    consistentConditions(conditions) &&
    firstConsistent &&
    conditions.revoked === (firstRevocation !== null);
  const accepted = qualified === true && qualificationValid;
  let refusalCode = null;
  if (!accepted) {
    refusalCode = !qualificationValid
      ? 'invalid-qualification'
      : conditions.revoked
        ? 'revoked-' + firstRevocation.cause
        : !conditions.scopePresent
          ? 'scope-unavailable'
          : !conditions.contextPresent
            ? 'context-unavailable'
            : !conditions.contextActive
              ? 'capture-inactive'
              : !conditions.continuous
                ? 'capture-discontinuous'
                : !conditions.exactProfile
                  ? 'profile-unqualified'
                  : 'invalid-qualification';
  }
  return Object.freeze({
    schema: 'aegis-native-object-admission/1',
    admissionAvailable,
    qualified,
    qualificationValid,
    accepted,
    refusalCode,
    qualification,
  });
}

/** Preserve complete conditions before enforcing the immediate strict qualification guard.
 * @param {object|null} view Actual fileReadDiagnostics projection.
 * @param {object} receipt Owned scenario receipt, before cleanup.
 * @returns {object} The accepted closed operational snapshot.
 * @since v0.20.1
 */
export function recordOperationalAdmission(view, receipt) {
  receipt.operationalAdmission = projectOperationalAdmission(view);
  if (!receipt.operationalAdmission.accepted)
    throw new Error(
      'Native object admission unavailable: ' + receipt.operationalAdmission.refusalCode,
    );
  return receipt.operationalAdmission;
}
