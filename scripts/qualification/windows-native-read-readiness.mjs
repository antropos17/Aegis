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
