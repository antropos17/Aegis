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
