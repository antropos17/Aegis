import { etwPassed } from './etw-package.mjs';
import { matchingRead } from '../../frontend/observatory/tests/etw-support.mjs';

const absent = (v) => v?.status === 4201 && v.present === false;
const yes = (v, keys) => keys.every((key) => v?.[key] === true);
const date = (v) => (typeof v === 'string' ? Date.parse(v) : NaN);
const digest = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);

/** Require the temporary launch authority to close with every launched child accounted for.
 * @param {object} h Host observation. @param {number[]} expectedCodes Ordered expected child exits.
 * @returns {boolean} @since v0.19.2
 */
export function rebootHostClosed(h, expectedCodes) {
  return Boolean(
    h?.exitCode === 0 &&
    h.launches === expectedCodes.length &&
    h.liveChildren === 0 &&
    Array.isArray(h.childExitCodes) &&
    h.childExitCodes.length === expectedCodes.length &&
    expectedCodes.every((code, index) => h.childExitCodes[index] === code),
  );
}

/** Preparation deliberately leaves a bounded owned trace and protected reservation.
 * It is never evidence of a reboot. @param {object} p Private preparation receipt.
 * @returns {boolean} @since v0.19.2
 */
export function rebootPrepared(p) {
  const s = p?.scenario,
    ids = [...(s?.reserved?.originalPids ?? []), s?.reserved?.custodianPid],
    codes = s?.peerExit?.originalExits;
  return Boolean(
    p?.status === 'PREPARED' &&
    p.schemaVersion === 1 &&
    p.phase === 'prepare' &&
    p.productionAdmission === false &&
    /^[a-f0-9]{40}$/.test(p.sourceHead ?? '') &&
    /^[a-f0-9]{64}$/.test(p.packageManifestSha256 ?? '') &&
    Number.isFinite(date(p.boot?.lastBootUtc)) &&
    date(p.completedAt) > date(p.boot.lastBootUtc) &&
    rebootHostClosed(p.host, [70]) &&
    s?.status === 'PREPARED' &&
    digest(s.reserved?.journalDigest) &&
    yes(s, [
      'packaged',
      'diagnosticBuild',
      'windowInputIsolated',
      'originalObjectsObserved',
      'allSixExited',
      'journalWriteAccessDenied',
      'contentExcluded',
      'noDiagnosticAudit',
    ]) &&
    absent(s.before) &&
    s.beforeReboot?.status === 0 &&
    s.beforeReboot.present === true &&
    ids.length === 6 &&
    ids.every((pid) => Number.isSafeInteger(pid) && pid > 0) &&
    new Set(ids).size === 6 &&
    s.appExitCode === 73 &&
    s.peerExit?.custodianExit === 76 &&
    codes?.length === 5 &&
    codes[0] === 73 &&
    [0, 75].includes(codes[1]) &&
    codes[2] === 70 &&
    codes[3] === 71 &&
    codes[4] === 74,
  );
}

/** Observe a later Windows boot after completed preparation; reject inconsistent timestamps.
 * This qualification witness grants no runtime cleanup authority.
 * @param {object} p Preparation. @param {object} boot Fresh fixed CIM observation.
 * @returns {boolean} @since v0.19.2
 */
export function rebootBoundaryObserved(p, boot) {
  return Boolean(
    rebootPrepared(p) &&
    date(boot?.lastBootUtc) > date(p.completedAt) &&
    date(boot.observedAt) >= date(boot.lastBootUtc),
  );
}

/** Require independent absence on both sides of protected journal handling.
 * @param {object} r Resume observation. @returns {boolean} @since v0.19.2
 */
export function rebootRecoveryObserved(r) {
  const terminal = r?.terminal;
  return Boolean(
    yes(r, [
      'journalRecovered',
      'closureConfirmed',
      'contentExcluded',
      'noDiagnosticAudit',
      'observationGap',
    ]) &&
    r.finalTotals === null &&
    digest(r.journalDigest) &&
    digest(r.previousJournalDigest) &&
    r.journalDigest !== r.previousJournalDigest &&
    typeof r.previousSameScope === 'boolean' &&
    absent(r.beforeNewMain) &&
    absent(r.beforeNewTrace) &&
    absent(r.afterRecovery) &&
    [0, 4].includes(terminal?.custodianExit) &&
    terminal.receipt?.absent === true &&
    terminal.receipt.observationGap === true &&
    terminal.receipt.finalTotals === null,
  );
}

/** Require the same frozen package/source, an actual later boot and new real read observations.
 * @param {object} p Preparation receipt. @param {object} r Resume receipt.
 * @returns {boolean} @since v0.19.2
 */
export function rebootPassed(p, r) {
  const normal = r?.scenario?.normal;
  return Boolean(
    rebootBoundaryObserved(p, r?.boot) &&
    r?.status === 'PASS' &&
    r.phase === 'resume' &&
    r.schemaVersion === 1 &&
    r.productionAdmission === false &&
    r.sourceHead === p.sourceHead &&
    r.packageManifestSha256 === p.packageManifestSha256 &&
    /^[a-f0-9]{64}$/.test(r.preparationSha256 ?? '') &&
    rebootHostClosed(r.host, [70, 0]) &&
    r.scenario?.status === 'PASS' &&
    r.scenario?.recovery?.previousJournalDigest === p.scenario.reserved.journalDigest &&
    rebootRecoveryObserved(r.scenario?.recovery) &&
    etwPassed(normal) &&
    ['sync', 'async'].every((mode) => {
      const proof = normal[mode + 'Proof'];
      return (
        proof?.native?.reads === 160 &&
        (mode !== 'async' || proof.native.pending > 0) &&
        matchingRead([proof.record], proof.native) !== undefined
      );
    }),
  );
}
