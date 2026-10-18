import { etwDualPassed } from './etw-dual-contract.mjs';

/** Require all three original elevated helper exits and ordinary-broker cleanup.
 * @param {object} r Private seventeen-capture receipt. @returns {boolean} @since v0.19.2
 */
export function etwTotalPassed(r) {
  return Boolean(
    etwDualPassed(r) &&
    [
      'triple-before-start',
      'triple-before-arm',
      'triple-collector-first',
      'triple-guard-first',
      'triple-fallback-first',
      'triple-access-denied',
    ].every((mode) => {
      const c = r.cases[mode],
        s = c?.summary,
        peers = s?.recoveryPeers;
      const early = mode.includes('-before-');
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
        (early
          ? s?.capture === null
          : c.presence?.status === 0 && c.presence.present === true && c.helperPids?.length >= 4) &&
        s?.phase === 'recovered' &&
        s.recoveryCause === 'all-three-helpers-exited' &&
        s.recoveryVerified === true &&
        s.stopVerified === false &&
        s.exitCode === 4 &&
        s.collectorExit === 70 &&
        peers?.guardExit === 71 &&
        peers.fallbackExit === 74 &&
        peers.brokerElevated === false &&
        peers.cleanupElevated === (mode === 'triple-access-denied') &&
        peers.accessDenied === (mode === 'triple-access-denied') &&
        s.finalTotals === null &&
        s.observationGap === true &&
        s.finalCounters?.queryStatus === (mode === 'triple-before-start' ? 4201 : 0)
      );
    }),
  );
}
