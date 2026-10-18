import { describe, expect, it } from 'vitest';
import { recoveryReceipt } from '../fixtures/etw-package-receipts.js';
import {
  rebootBoundaryObserved,
  rebootPrepared,
  rebootRecoveryObserved,
  rebootPassed,
} from '../../tools/development/etw-reboot-contract.mjs';

const boot = (iso) => ({ lastBootUtc: iso, observedAt: '2026-10-18T12:03:00.000Z' });
const prepared = () => ({
  status: 'PREPARED',
  schemaVersion: 1,
  phase: 'prepare',
  productionAdmission: false,
  sourceHead: 'a'.repeat(40),
  packageManifestSha256: 'b'.repeat(64),
  boot: boot('2026-10-17T08:00:00.000Z'),
  completedAt: '2026-10-18T12:01:00.000Z',
  host: { exitCode: 0, launches: 1, liveChildren: 0, childExitCodes: [70] },
  scenario: {
    status: 'PREPARED',
    packaged: true,
    diagnosticBuild: true,
    windowInputIsolated: true,
    originalObjectsObserved: true,
    allSixExited: true,
    journalWriteAccessDenied: true,
    contentExcluded: true,
    noDiagnosticAudit: true,
    appExitCode: 73,
    before: { status: 4201, present: false },
    beforeReboot: { status: 0, present: true },
    reserved: {
      originalPids: [11, 12, 13, 14, 15],
      custodianPid: 16,
      journalDigest: 'd'.repeat(64),
    },
    peerExit: { custodianExit: 76, originalExits: [73, 75, 70, 71, 74] },
  },
});
const recovery = () => ({
  journalDigest: 'e'.repeat(64),
  previousJournalDigest: 'd'.repeat(64),
  previousSameScope: false,
  beforeNewMain: { status: 4201, present: false },
  journalRecovered: true,
  beforeNewTrace: { status: 4201, present: false },
  closureConfirmed: true,
  contentExcluded: true,
  noDiagnosticAudit: true,
  observationGap: true,
  finalTotals: null,
  terminal: {
    custodianExit: 4,
    receipt: { absent: true, observationGap: true, finalTotals: null },
  },
  afterRecovery: { status: 4201, present: false },
});

describe('restart-spanning packaged ETW evidence', () => {
  it('never promotes preparation or a same-boot relaunch into reboot evidence', () => {
    const p = prepared();
    expect(rebootPrepared(p)).toBe(true);
    expect(rebootBoundaryObserved(p, p.boot)).toBe(false);
    expect(rebootBoundaryObserved(p, boot('2026-10-18T12:02:00.000Z'))).toBe(true);
  });
  it.each(['2026-10-18T12:00:30.000Z', '2026-10-17T07:59:00.000Z', 'invalid'])(
    'refuses an ambiguous, older or pre-preparation boot: %s',
    (value) => {
      expect(rebootBoundaryObserved(prepared(), boot(value))).toBe(false);
    },
  );
  it.each([
    (p) => (p.scenario.beforeReboot.status = 4201),
    (p) => (p.scenario.peerExit.custodianExit = 4),
    (p) => (p.scenario.peerExit.originalExits[2] = 0),
    (p) => (p.scenario.originalObjectsObserved = false),
    (p) => (p.scenario.reserved.custodianPid = 11),
    (p) => (p.host.liveChildren = 1),
    (p) => (p.host.childExitCodes = []),
    (p) => (p.productionAdmission = true),
  ])('refuses incomplete preparation %#', (mutate) => {
    const p = prepared();
    mutate(p);
    expect(rebootPrepared(p)).toBe(false);
  });
  it('requires journal handling before StartTrace and preserves unavailable old totals', () => {
    expect(rebootRecoveryObserved(recovery())).toBe(true);
    for (const mutate of [
      (r) => (r.journalRecovered = false),
      (r) => (r.beforeNewMain = { status: 0, present: true }),
      (r) => (r.beforeNewTrace.status = 5),
      (r) => (r.terminal.receipt.finalTotals = {}),
      (r) => (r.closureConfirmed = false),
    ]) {
      const r = recovery();
      mutate(r);
      expect(rebootRecoveryObserved(r)).toBe(false);
    }
  });
  it('requires unchanged package/source, host closure and real pending I/O after the reboot', () => {
    const p = prepared();
    const complete = () => ({
      schemaVersion: 1,
      status: 'PASS',
      phase: 'resume',
      productionAdmission: false,
      sourceHead: p.sourceHead,
      packageManifestSha256: p.packageManifestSha256,
      preparationSha256: 'c'.repeat(64),
      boot: boot('2026-10-18T12:02:00.000Z'),
      host: { exitCode: 0, launches: 2, liveChildren: 0, childExitCodes: [70, 0] },
      scenario: { status: 'PASS', recovery: recovery(), normal: recoveryReceipt().normal },
    });
    expect(rebootPassed(p, complete())).toBe(true);
    for (const mutate of [
      (r) => (r.sourceHead = 'd'.repeat(40)),
      (r) => (r.packageManifestSha256 = 'd'.repeat(64)),
      (r) => (r.boot = p.boot),
      (r) => (r.host.exitCode = null),
      (r) => (r.scenario.normal.asyncProof.native.pending = 0),
      (r) => (r.scenario.normal.summary.stopVerified = false),
      (r) => (r.phase = 'cancel'),
      (r) => (r.scenario.recovery.previousJournalDigest = 'f'.repeat(64)),
      (r) => (r.scenario.recovery.previousSameScope = true),
    ]) {
      const r = complete();
      mutate(r);
      expect(rebootPassed(p, r)).toBe(false);
    }
  });
});
