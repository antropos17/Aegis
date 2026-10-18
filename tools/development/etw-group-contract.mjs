import { etwTotalPassed } from './etw-total-contract.mjs';

/** Require main survival, all four original exits and the seventeen earlier cases.
 * @param {object} r Private twenty-two-capture receipt. @returns {boolean} @since v0.19.2
 */
export function etwGroupPassed(r) {
  const broker = r?.cases?.['broker-exit'];
  return Boolean(
    etwTotalPassed(r) &&
    broker?.summary?.recoveryCause === 'broker-and-all-helpers-exited' &&
    [
      'group-before-start',
      'group-before-arm',
      'group-broker-first',
      'group-triple-first',
      'group-access-denied',
    ].every((mode) => {
      const c = r.cases[mode],
        s = c?.summary,
        p = s?.recoveryPeers,
        early = mode.includes('-before-');
      return (
        c?.status === 'PASS' &&
        c.mode === mode &&
        c.packaged === true &&
        c.diagnosticBuild === true &&
        c.windowInputIsolated === true &&
        c.closureConfirmed === true &&
        c.contentExcluded === true &&
        c.noDiagnosticAudit === true &&
        c.before?.status === 4201 &&
        c.before.present === false &&
        c.after?.status === 4201 &&
        c.after.present === false &&
        c.failureVisible === true &&
        c.noAutomaticRestart === true &&
        c.restartBlocked === false &&
        c.mainSurvived === true &&
        c.mainCustodyObserved === true &&
        (early
          ? s?.capture === null
          : c.liveReady === true &&
            s?.capture?.buffers?.count > 0 &&
            c.presence?.status === 0 &&
            c.presence.present === true &&
            c.helperPids?.length >= 4) &&
        s?.phase === 'recovered' &&
        s.recoveryCause === 'broker-and-all-helpers-exited' &&
        s.recoveryVerified === true &&
        s.stopVerified === false &&
        s.exitCode === 4 &&
        s.brokerExit === 75 &&
        s.collectorExit === 70 &&
        p?.guardExit === 71 &&
        p.fallbackExit === 74 &&
        p.brokerElevated === false &&
        p.cleanupElevated === (mode === 'group-access-denied') &&
        p.accessDenied === (mode === 'group-access-denied') &&
        (mode !== 'group-access-denied' || c.cleanupConsentPendingObserved === true) &&
        s.finalTotals === null &&
        s.observationGap === true &&
        s.finalCounters?.queryStatus === (mode === 'group-before-start' ? 4201 : 0)
      );
    }),
  );
}
