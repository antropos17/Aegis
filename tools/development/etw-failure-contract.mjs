import { etwRecoveryPassed } from './etw-package.mjs';

/** Require actual packaged boundary failures with independent session queries.
 * @param {object} r Private seven-capture receipt. @returns {boolean} @since v0.19.2
 */
export function etwFailuresPassed(r) {
  const modes = [
    'collector-before-start',
    'collector-before-arm',
    'guard-exit',
    'broker-exit',
    'app-exit',
  ];
  const cases = r?.cases;
  return Boolean(
    r?.status === 'PASS' &&
    r.productionAdmission === false &&
    cases &&
    etwRecoveryPassed(r.regression) &&
    modes.every((mode) => {
      const c = cases[mode];
      if (
        !c ||
        c.status !== 'PASS' ||
        c.mode !== mode ||
        c.packaged !== true ||
        c.diagnosticBuild !== true ||
        c.windowInputIsolated !== true ||
        c.closureConfirmed !== true ||
        c.contentExcluded !== true ||
        c.noDiagnosticAudit !== true ||
        c.before?.status !== 4201 ||
        c.before.present !== false ||
        c.after?.status !== 4201 ||
        c.after.present !== false
      )
        return false;
      if (mode === 'app-exit')
        return (
          c.abruptAppExit === true &&
          c.appExitCode === 73 &&
          c.presence?.status === 0 &&
          c.presence.present === true
        );
      if (
        c.failureVisible !== true ||
        c.noAutomaticRestart !== true ||
        c.summary?.finalTotals !== null ||
        c.summary.observationGap !== true
      )
        return false;
      if (mode.startsWith('collector-before-'))
        return (
          c.summary.recoveryVerified === true &&
          c.summary.exitCode === 4 &&
          c.summary.collectorExit === 70 &&
          c.summary.capture === null &&
          c.summary.finalCounters?.queryStatus === (mode === 'collector-before-start' ? 4201 : 0) &&
          c.restartBlocked !== true
        );
      return (
        c.restartBlocked === true &&
        c.summary.recoveryVerified === false &&
        c.summary.finalCounters === null &&
        c.summary.exitCode === (mode === 'broker-exit' ? 72 : 2) &&
        c.presence?.status === 0 &&
        c.presence.present === true
      );
    }),
  );
}
