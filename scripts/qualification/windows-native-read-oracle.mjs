import { matchingRead } from '../../frontend/observatory/tests/etw-support.mjs';

/** Require linked actual native, custody, consumer, renderer and closure evidence.
 * Synthetic workload qualification never establishes installed-agent acceptance.
 * @param {object} receipt Private bounded cloud receipt.
 * @returns {boolean} Whether the complete bounded scenario passed.
 * @since v0.20.1
 */
export function nativeReadPassed(receipt) {
  try {
    const r = receipt,
      event = r.event,
      actor = r.actor;
    if (
      r.status !== 'PASS' ||
      r.failure !== undefined ||
      r.error !== undefined ||
      !/^[a-f0-9]{40}$/.test(r.sourceHead) ||
      r.fixtureOnly !== true ||
      r.realAgent !== false ||
      r.productionAdmission !== false ||
      r.actualAccessPathObserved !== false ||
      r.bindingUnchanged !== true
    )
      return false;
    if (!/^[a-f0-9]{64}$/.test(r.fixtureSourceSha256) || r.witness?.shareDelete !== false)
      return false;
    if (
      r.window?.dpi !== 96 ||
      r.window?.scaleFactor !== 1 ||
      r.window?.packaged !== true ||
      r.window?.isolated !== true
    )
      return false;
    if (
      r.originalCohort?.originalObjectsObserved !== true ||
      r.originalCohort.originalPids?.length !== 5 ||
      new Set(r.originalCohort.originalPids).size !== 5 ||
      !r.originalCohort.originalPids.includes(r.window.mainPid) ||
      !Number.isInteger(r.originalCohort.custodianPid) ||
      r.originalCohort.originalPids.includes(r.originalCohort.custodianPid) ||
      r.peerClosure?.originalExits?.length !== 5 ||
      !r.peerClosure.originalExits.every((code) => code === 0) ||
      r.peerClosure.custodianExit !== 0 ||
      r.observerExit !== 0 ||
      r.observerCleanupUnconfirmed
    )
      return false;
    if (
      !actor ||
      actor.pid !== r.witness?.pid ||
      actor.createTime100ns !== r.witness.birth ||
      actor.instanceIdSource !== 'os' ||
      event?.instanceId !== actor.instanceId ||
      event.pid !== actor.pid ||
      event.createTime100ns !== actor.createTime100ns
    )
      return false;
    if (
      event.observationKind !== 'bound-object-read' ||
      Object.hasOwn(event, 'file') ||
      event.sensitive !== true ||
      event.object?.provenance !== 'issuer-handle-file-id' ||
      event.object.policy?.sensitive !== true ||
      !event.object.objectKey ||
      !event.eventId
    )
      return false;
    if (
      r.reads?.length !== 2 ||
      !['sync', 'async'].every((mode) =>
        r.reads.some(
          (read) =>
            read.mode === mode &&
            read.native?.pid === actor.pid &&
            read.native?.birth === actor.createTime100ns &&
            read.native?.reads === 160 &&
            read.native.shareDelete === false &&
            (mode !== 'async' || read.native.pending > 0) &&
            matchingRead([read.record], read.native) &&
            read.record.instanceId === actor.instanceId &&
            read.event?.instanceId === actor.instanceId &&
            read.event.createTime100ns === actor.createTime100ns &&
            read.event.observationKind === 'bound-object-read' &&
            read.event.object?.bindingId === read.record.objectProof.bindingId &&
            read.event.object.scopeGeneration === read.record.objectProof.scopeGeneration &&
            read.event.object.policyGeneration === read.record.objectProof.policyGeneration &&
            read.event.sensitive === true &&
            read.event.object.policy.sensitive === true &&
            BigInt(read.record.objectProof.fromQpc) < BigInt(read.record.qpc) &&
            BigInt(read.record.qpc) <= BigInt(read.record.objectProof.toQpc),
        ),
      )
    )
      return false;
    if (!r.reads.some((read) => read.record.objectProof.bindingId === event.object.bindingId))
      return false;
    if (
      r.alert?.eventId !== event.eventId ||
      r.alert.observationKind !== 'bound-object-read' ||
      r.alert.labelSemantics !== 'binding-label-access-path-unknown' ||
      r.baseline?.instanceId !== event.instanceId ||
      r.baseline.generationCurrent !== true ||
      !(r.baseline.objectBindings > 0 && r.baseline.sensitiveObjectReads > 0)
    )
      return false;
    if (
      !(
        r.afterRisk?.score > r.beforeRisk?.score &&
        r.afterRisk.score <= 100 &&
        r.beforeRisk.score >= 0
      ) ||
      r.actualPreloadDelivery !== true ||
      r.objectAlertObserved !== true ||
      r.displayedRiskIncreased !== true ||
      r.persistedAuditObserved !== true ||
      r.contentExcluded !== true ||
      r.publicIdentityRedacted !== true ||
      r.noCompetingLegacyFileObservation !== true ||
      r.retainedPathObservationCount !== 0 ||
      r.legacyReadDeliveries !== 0
    )
      return false;
    if (
      r.retention?.released !== true ||
      r.retention.captureContinued !== true ||
      r.retention.sourceShareDelete !== false ||
      !Number.isFinite(r.retention.elapsedMs) ||
      r.retention.elapsedMs < 0 ||
      r.retention.elapsedMs > 15000 ||
      r.retention.deadlineMs !== 15000 ||
      !r.retention.firstAttempt ||
      typeof r.retention.firstAttempt.released !== 'boolean' ||
      !Number.isFinite(r.retention.firstAttempt.elapsedMs)
    )
      return false;
    return (
      r.stopVerified === true &&
      r.fixtureExit === 0 &&
      r.appExit === 0 &&
      !r.fixtureCleanupUnconfirmed &&
      !r.appCleanupUnconfirmed &&
      r.host?.exitCode === 0 &&
      r.host.launches === 1 &&
      r.host.childExitCodes?.length === 1 &&
      r.host.childExitCodes[0] === 0 &&
      r.host.liveChildren === 0 &&
      r.before?.status === 4201 &&
      r.before.present === false &&
      r.after?.status === 4201 &&
      r.after.present === false
    );
  } catch {
    return false;
  }
}
