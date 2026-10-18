import { etwOrphanPassed } from './etw-orphan-contract.mjs';

export const DURABLE_MODES = [
  'orphan-total-before-start',
  'orphan-total-before-arm',
  'orphan-total-running',
  'orphan-total-denial',
];

/** Require six original object exits and recovery in a fresh packaged main.
 * @param {object} c Private receipt. @returns {boolean} @since v0.19.2
 */
export function etwDurableCasePassed(c) {
  const pid = (v) => Number.isInteger(v) && v > 0 && v <= 0x7fffffff;
  return Boolean(
    c?.status === 'PASS' &&
    DURABLE_MODES.includes(c.mode) &&
    c.productionAdmission === false &&
    [
      'packaged',
      'diagnosticBuild',
      'windowInputIsolated',
      'originalObjectsObserved',
      'allSixExited',
      'closureConfirmed',
      'contentExcluded',
      'noDiagnosticAudit',
      'journalWriteAccessDenied',
      'recoveryBeforeNewTrace',
      'recoveryMainWasFresh',
      'observationGap',
    ].every((key) => c[key] === true) &&
    c.finalTotals === null &&
    c.before?.status === 4201 &&
    c.before.present === false &&
    c.beforeRecovery?.status === (c.mode === 'orphan-total-before-start' ? 4201 : 0) &&
    c.beforeRecovery.present === (c.mode !== 'orphan-total-before-start') &&
    c.after?.status === 4201 &&
    c.after.present === false &&
    c.reserved?.originalPids?.length === 5 &&
    new Set([...c.reserved.originalPids, c.reserved.custodianPid]).size === 6 &&
    [...c.reserved.originalPids, c.reserved.custodianPid].every(pid) &&
    c.mainPid === c.reserved.originalPids[0] &&
    c.appExitCode === 73 &&
    c.peerExit?.custodianExit === 76 &&
    c.peerExit.originalExits?.[0] === 73 &&
    [0, 75].includes(c.peerExit.originalExits?.[1]) &&
    JSON.stringify(c.peerExit.originalExits?.slice(2)) === '[70,71,74]' &&
    c.recovery?.mainPid !== c.mainPid &&
    pid(c.recovery?.mainPid) &&
    c.recovery?.journalRecovered === true &&
    c.recovery?.presence?.status === 4201 &&
    c.recovery.presence.present === false &&
    c.recovery.terminal?.custodianExit === 4 &&
    c.recovery.terminal.receipt?.absent === true &&
    c.recovery.terminal.receipt.finalTotals === null &&
    c.recovery.terminal.receipt.observationGap === true &&
    c.recovery.restrictedProbeStatus === (c.mode === 'orphan-total-denial' ? 5 : null) &&
    (c.mode !== 'orphan-total-running' ||
      (c.liveOwnerBlocked === true && c.liveOwnerUnaffected === true)),
  );
}

/** Require four durable-recovery cases plus all twenty-eight earlier captures.
 * @param {object} r Private combined receipt. @returns {boolean} @since v0.19.2
 */
export function etwDurablePassed(r) {
  return Boolean(
    etwOrphanPassed(r) && DURABLE_MODES.every((mode) => etwDurableCasePassed(r.cases?.[mode])),
  );
}
