import { etwGroupPassed } from './etw-group-contract.mjs';

export const ORPHAN_MODES = [
  'orphan-before-start',
  'orphan-before-arm',
  'orphan-main-first',
  'orphan-native-first',
  'orphan-access-denied',
  'custodian-exit',
];

/** Require original object proof, actual main loss and a separate read-only witness.
 * @param {object} c Private single-case receipt. @returns {boolean} @since v0.19.2
 */
export function etwOrphanCasePassed(c) {
  const pid = (v) => Number.isInteger(v) && v > 0 && v <= 0x7fffffff;
  if (
    !c ||
    !ORPHAN_MODES.includes(c.mode) ||
    c.status !== 'PASS' ||
    c.productionAdmission !== false ||
    ![
      'packaged',
      'diagnosticBuild',
      'windowInputIsolated',
      'mainCustodyObserved',
      'observerExited',
      'closureConfirmed',
      'contentExcluded',
      'noDiagnosticAudit',
    ].every((k) => c[k] === true) ||
    c.before?.status !== 4201 ||
    c.before.present !== false ||
    c.after?.status !== 4201 ||
    c.after.present !== false ||
    c.reserved?.originalPids?.length !== 5 ||
    new Set(c.reserved.originalPids).size !== 5 ||
    !c.reserved.originalPids.every(pid) ||
    !pid(c.reserved.custodianPid) ||
    c.reserved.originalPids.includes(c.reserved.custodianPid) ||
    c.reserved.originalPids[0] !== c.mainPid ||
    !c.helperPids?.includes(c.reserved.custodianPid) ||
    c.helperPids.length !== 5 ||
    new Set(c.helperPids).size !== 5 ||
    !c.helperPids.every(pid) ||
    !c.reserved.originalPids.slice(1).every((pid) => c.helperPids.includes(pid))
  )
    return false;
  if (c.mode === 'custodian-exit')
    return (
      c.custodianExit === 76 &&
      c.mainSurvived === true &&
      c.failureVisible === true &&
      c.noAutomaticRestart === true &&
      c.appExitCode === 0 &&
      c.summary?.recoveryVerified === true &&
      c.summary.exitCode === 4 &&
      c.summary.finalTotals === null &&
      c.summary.observationGap === true
    );
  const s = c.terminal?.receipt,
    early = c.mode.includes('-before-');
  return Boolean(
    c.appExitCode === 73 &&
    c.abruptAppExit === true &&
    c.terminal?.custodianExit === 4 &&
    c.liveReady === !early &&
    c.presence?.status === (c.mode === 'orphan-before-start' ? 4201 : 0) &&
    c.presence.present === (c.mode !== 'orphan-before-start') &&
    s?.kind === 'terminal' &&
    s.recovered === true &&
    s.absent === true &&
    Array.isArray(s.exits) &&
    s.exits.length === 5 &&
    s.exits[0] === 73 &&
    [0, 75].includes(s.exits[1]) &&
    JSON.stringify(s.exits.slice(2)) === JSON.stringify([70, 71, 74]) &&
    s.queryStatus === (c.mode === 'orphan-before-start' ? 4201 : 0) &&
    s.restrictedProbeStatus === (c.mode === 'orphan-access-denied' ? 5 : null) &&
    s.finalTotals === null &&
    s.observationGap === true &&
    (c.mode !== 'orphan-native-first' || c.mainAndBrokerSurvivedUntilTripleExit === true),
  );
}

/** Require six new real fault cases plus all twenty-two previous regressions.
 * @param {object} r Private twenty-eight-capture receipt. @returns {boolean} @since v0.19.2
 */
export function etwOrphanPassed(r) {
  return Boolean(
    etwGroupPassed(r) && ORPHAN_MODES.every((mode) => etwOrphanCasePassed(r.cases?.[mode])),
  );
}
