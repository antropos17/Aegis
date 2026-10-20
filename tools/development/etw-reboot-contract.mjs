import { etwPassed } from './etw-package.mjs';
import { matchingRead } from '../../frontend/observatory/tests/etw-support.mjs';

const absent = (v) => v?.status === 4201 && v.present === false;
const yes = (v, keys) => keys.every((key) => v?.[key] === true);
const date = (v) => (typeof v === 'string' ? Date.parse(v) : NaN);
const digest = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const identityKeys = [
  'sourceHead',
  'sourceTree',
  'lockSha256',
  'packageManifestSha256',
  'nativeExeSha256',
  'nativeDllSha256',
  'runtimeSourcesSha256',
  'archiveSourceSha256',
  'harnessSha256',
  'buildReceiptSha256',
  'configSha256',
];

/** Validate current immutable source/package/build/harness identity.
 * @param {object} value Binding projection. @returns {boolean} @since v0.19.2
 */
export function rebootIdentity(value) {
  return Boolean(
    value?.publicProtocol === 'etw-file/10' &&
    value.observerContract === 'full-record-sha256-v1' &&
    value.diagnosticBuild === true &&
    identityKeys.every(
      (key) =>
        typeof value[key] === 'string' &&
        (key === 'sourceHead' || key === 'sourceTree'
          ? /^[a-f0-9]{40}$/.test(value[key])
          : digest(value[key])),
    ) &&
    /^24\.(?:1[6-9]|[2-9]\d)\.\d+$/.test(value.nodeVersion ?? '') &&
    /^\d+\.\d+\.\d+$/.test(value.electronVersion ?? '') &&
    /^10\.\d+\.\d+$/.test(value.dotnetSdk ?? '') &&
    value.arch === 'x64' &&
    value.platform === 'win32',
  );
}

/** Match every recorded immutable input across owner phases.
 * @param {object} a Previous binding. @param {object} b Current binding.
 * @returns {boolean} @since v0.19.2
 */
export function rebootInputsMatch(a, b) {
  return (
    rebootIdentity(a) &&
    rebootIdentity(b) &&
    [
      ...identityKeys,
      'publicProtocol',
      'observerContract',
      'diagnosticBuild',
      'nodeVersion',
      'electronVersion',
      'dotnetSdk',
      'platform',
      'arch',
    ].every((key) => a[key] === b[key])
  );
}

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
    p.schemaVersion === 2 &&
    p.phase === 'prepare' &&
    p.productionAdmission === false &&
    rebootIdentity(p) &&
    Number.isFinite(date(p.boot?.lastBootUtc)) &&
    /^10\.\d+\.\d+$/.test(p.boot?.version ?? '') &&
    Number.isFinite(date(p.boot?.observedAt)) &&
    date(p.boot.observedAt) >= date(p.boot.lastBootUtc) &&
    date(p.completedAt) >= date(p.boot.observedAt) &&
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
    boot?.version === p.boot.version &&
    date(boot?.lastBootUtc) > date(p.completedAt) &&
    date(boot.observedAt) >= date(boot.lastBootUtc),
  );
}

/** Require phase-specific initial state and independent absence after protected handling.
 * @param {object} r Recovery observation. @param {string} phase Resume or same-boot cancel.
 * @returns {boolean} @since v0.19.2
 */
export function rebootRecoveryObserved(r, phase = 'resume') {
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
    (phase === 'resume'
      ? absent(r.beforeNewMain)
      : phase === 'cancel' && r.beforeNewMain?.status === 0 && r.beforeNewMain.present === true) &&
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
export function rebootPassed(p, r, preparationSha256) {
  const normal = r?.scenario?.normal;
  return Boolean(
    rebootBoundaryObserved(p, r?.boot) &&
    r?.status === 'PASS' &&
    r.phase === 'resume' &&
    r.schemaVersion === 2 &&
    r.productionAdmission === false &&
    rebootInputsMatch(p, r) &&
    digest(preparationSha256) &&
    r.preparationSha256 === preparationSha256 &&
    rebootHostClosed(r.host, [70, 0]) &&
    r.scenario?.status === 'PASS' &&
    r.scenario?.recovery?.previousJournalDigest === p.scenario.reserved.journalDigest &&
    rebootRecoveryObserved(r.scenario?.recovery) &&
    etwPassed(normal) &&
    normal.issuerPreparedBeforeRead === true &&
    ['sync', 'async'].every((mode) => {
      const proof = normal[mode + 'Proof'];
      const prepared = normal.beforeReadPreparations?.[mode];
      return (
        proof?.native?.reads === 160 &&
        (mode !== 'async' || proof.native.pending > 0) &&
        prepared?.pid === proof.native.pid &&
        prepared.createTime100ns === proof.native.birth &&
        Number.isInteger(prepared.threads) &&
        prepared.threads > 0 &&
        prepared.threads <= 128 &&
        typeof prepared.asOfQpc === 'string' &&
        /^[1-9]\d{0,18}$/.test(prepared.asOfQpc) &&
        typeof proof.native.fromQpc === 'string' &&
        /^\d{1,19}$/.test(proof.native.fromQpc) &&
        BigInt(prepared.asOfQpc) < BigInt(proof.native.fromQpc) &&
        matchingRead([proof.record], proof.native) !== undefined
      );
    }),
  );
}

/** Refuse invalid/cross-input receipts before creating any owner launch host.
 * @param {string} phase Explicit phase. @param {object|null} prior Saved preparation.
 * @param {object} boot Fresh boot observation. @param {object} binding Current inputs.
 * @returns {boolean} @since v0.19.2
 */
export function rebootPreflight(phase, prior, boot, binding) {
  if (
    !rebootIdentity(binding) ||
    !Number.isFinite(date(boot?.lastBootUtc)) ||
    !Number.isFinite(date(boot?.observedAt)) ||
    date(boot.observedAt) < date(boot.lastBootUtc)
  )
    return false;
  if (phase === 'prepare') return prior === null;
  if (!rebootPrepared(prior) || !rebootInputsMatch(prior, binding)) return false;
  if (boot.version !== prior.boot.version) return false;
  return phase === 'resume'
    ? rebootBoundaryObserved(prior, boot)
    : phase === 'cancel' &&
        date(boot.lastBootUtc) === date(prior.boot.lastBootUtc) &&
        date(boot.observedAt) >= date(prior.completedAt);
}

/** Require exact original reservation correlation and closure for cancellation.
 * @param {object} p Prior preparation. @param {object} r Cancellation receipt.
 * @param {string} preparationSha256 Hash of saved preparation bytes.
 * @returns {boolean} @since v0.19.2
 */
export function rebootCancelled(p, r, preparationSha256) {
  return Boolean(
    r?.schemaVersion === 2 &&
    r.status === 'CANCELLED' &&
    r.productionAdmission === false &&
    rebootPreflight('cancel', p, r.boot, r) &&
    r.phase === 'cancel' &&
    digest(preparationSha256) &&
    r.preparationSha256 === preparationSha256 &&
    rebootHostClosed(r.host, [70]) &&
    r.scenario?.status === 'CANCELLED' &&
    rebootRecoveryObserved(r.scenario.recovery, 'cancel') &&
    r.scenario.recovery.previousJournalDigest === p.scenario.reserved.journalDigest,
  );
}
