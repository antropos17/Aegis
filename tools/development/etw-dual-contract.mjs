import { etwFailuresPassed } from './etw-failure-contract.mjs';

/** Require both loss orders and pre-arm/start loss in the actual packaged host.
 * @param {object} r Private eleven-capture receipt. @returns {boolean} @since v0.19.2
 */
export function etwDualPassed(r) {
  const modes = [
    'dual-before-start',
    'dual-before-arm',
    'dual-guard-first',
    'dual-collector-first',
  ];
  return Boolean(
    etwFailuresPassed(r) &&
    modes.every((mode) => {
      const c = r.cases[mode],
        s = c?.summary;
      const early = mode.startsWith('dual-before-');
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
        s?.recoveryCause === 'collector-and-guard-exited' &&
        s.phase === 'recovered' &&
        s.recoveryVerified === true &&
        s.stopVerified === false &&
        s.exitCode === 4 &&
        s.collectorExit === 70 &&
        s.finalTotals === null &&
        s.observationGap === true &&
        s.finalCounters?.queryStatus === (mode === 'dual-before-start' ? 4201 : 0)
      );
    }),
  );
}
