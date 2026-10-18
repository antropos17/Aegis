import path from 'node:path';
import schema from '../../src/main/platform/etw-file-schema.js';

/** Require a genuine-agent journey, exact native issuer proof and owned cleanup.
 * Unit vectors for this oracle are modeled and never establish live acceptance.
 * Candidate paths and potential risk labels remain separate from process proof.
 * @param {object} r Private bounded journey receipt.
 * @returns {boolean} Whether all required observations agree. @since v0.19.2
 */
export function agentReadPassed(r) {
  const proof = r?.readProof,
    view = r?.rendererObservation,
    summary = r?.summary;
  const native = proof ? { ...proof, agent: null, instanceId: null } : null;
  const samePath = (a, b) =>
    typeof a === 'string' &&
    typeof b === 'string' &&
    path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase();
  return Boolean(
    r?.status === 'PASS' &&
    r.productionAdmission === false &&
    [
      'packaged',
      'diagnosticBuild',
      'fixtureOnly',
      'liveReady',
      'warmupRead',
      'actualToolRead',
      'onlyRequestedReads',
      'returnedCanary',
      'uiReadAndRisk',
      'appClosed',
      'contentExcluded',
      'noDiagnosticAudit',
    ].every((key) => r[key] === true) &&
    r.realAgent === 'Claude Code' &&
    schema.verifiedIssuer(native) &&
    proof.issuerPid === r.agentPid &&
    proof.agent === 'Claude Code' &&
    r.agentIdentity?.pid === r.agentPid &&
    r.agentIdentity.instanceIdSource === 'os' &&
    proof.generationWitness === r.agentIdentity.createTime100ns &&
    proof.instanceId === r.agentIdentity.instanceId &&
    proof.instanceId ===
      `${r.agentPid}:${(BigInt(proof.generationWitness) - 116444736000000000n) / 10000n}` &&
    samePath(proof.path, r.file) &&
    samePath(view?.path, r.file) &&
    view.agent === 'Claude Code' &&
    view.instanceId === proof.instanceId &&
    view.pid === r.agentPid &&
    view.pathEvidence === proof.pathEvidence &&
    typeof view.sensitiveReason === 'string' &&
    view.sensitiveReason.length > 0 &&
    Number.isSafeInteger(view.reads) &&
    view.reads > 0 &&
    r.agentExit === 0 &&
    r.appExit === 0 &&
    !r.agentTerminationRequested &&
    !r.agentCleanupUnconfirmed &&
    !r.appCleanupUnconfirmed &&
    r.independentAbsence?.status === 4201 &&
    r.independentAbsence.present === false &&
    r.remainingNativeProcesses === 0 &&
    summary?.phase === 'stopped' &&
    summary.exitCode === 0 &&
    summary.stopVerified === true &&
    summary.stopReason === 'shutdown' &&
    summary.finalCounters?.queryStatus === 0 &&
    summary.finalTotals != null,
  );
}
