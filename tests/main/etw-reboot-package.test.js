import { describe, expect, it } from 'vitest';
import { recoveryReceipt } from '../fixtures/etw-package-receipts.js';
import {
  rebootBoundaryObserved,
  rebootPrepared,
  rebootRecoveryObserved,
  rebootPassed,
  rebootIdentity,
  rebootInputsMatch,
  rebootPreflight,
  rebootCancelled,
} from '../../tools/development/etw-reboot-contract.mjs';
import { waitRebootIssuer } from '../../tools/development/etw-reboot-support.mjs';
import { runReadWorkloads } from '../../frontend/observatory/tests/etw-scenario.mjs';

const identity = () => ({
  sourceHead: 'a'.repeat(40),
  sourceTree: 'b'.repeat(40),
  ...Object.fromEntries(
    [
      'lockSha256',
      'packageManifestSha256',
      'nativeExeSha256',
      'nativeDllSha256',
      'runtimeSourcesSha256',
      'archiveSourceSha256',
      'harnessSha256',
      'buildReceiptSha256',
      'configSha256',
    ].map((key) => [key, 'b'.repeat(64)]),
  ),
  publicProtocol: 'etw-file/10',
  observerContract: 'full-record-sha256-v1',
  diagnosticBuild: true,
  nodeVersion: '24.20.0',
  electronVersion: '44.7.2',
  dotnetSdk: '10.0.302',
  platform: 'win32',
  arch: 'x64',
});
const currentNormal = () => ({
  ...recoveryReceipt().normal,
  issuerPreparedBeforeRead: true,
  beforeReadPreparations: Object.fromEntries(
    ['sync', 'async'].map((mode) => [
      mode,
      { pid: 71, createTime100ns: '116444736010000001', threads: 1, asOfQpc: '90' },
    ]),
  ),
});

const boot = (iso) => ({
  lastBootUtc: iso,
  observedAt: '2026-10-18T12:03:00.000Z',
  version: '10.0.26200',
});
const prepared = () => ({
  status: 'PREPARED',
  schemaVersion: 2,
  phase: 'prepare',
  productionAdmission: false,
  ...identity(),
  boot: { ...boot('2026-10-17T08:00:00.000Z'), observedAt: '2026-10-18T12:00:30.000Z' },
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
  it('refuses protocol-9 preparation before any current owner phase', () => {
    const p = prepared();
    p.publicProtocol = 'etw-file/9';
    expect(rebootPrepared(p)).toBe(false);
  });
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
    (p) => (p.host.childExitCodes = [2]),
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
  it.each([false, undefined])(
    'refuses otherwise valid resumed evidence with preparation flag %s',
    (flag) => {
      const p = prepared();
      const r = {
        schemaVersion: 2,
        status: 'PASS',
        phase: 'resume',
        productionAdmission: false,
        ...identity(),
        preparationSha256: 'c'.repeat(64),
        boot: boot('2026-10-18T12:02:00.000Z'),
        host: { exitCode: 0, launches: 2, liveChildren: 0, childExitCodes: [70, 0] },
        scenario: { status: 'PASS', recovery: recovery(), normal: currentNormal() },
      };
      expect(rebootPassed(p, r, 'c'.repeat(64))).toBe(true);
      if (flag === undefined) delete r.scenario.normal.issuerPreparedBeforeRead;
      else r.scenario.normal.issuerPreparedBeforeRead = flag;
      expect(rebootPassed(p, r, 'c'.repeat(64))).toBe(false);
    },
  );
  it('requires unchanged package/source, host closure and real pending I/O after the reboot', () => {
    const p = prepared();
    const complete = () => ({
      schemaVersion: 2,
      status: 'PASS',
      phase: 'resume',
      productionAdmission: false,
      ...identity(),
      preparationSha256: 'c'.repeat(64),
      boot: boot('2026-10-18T12:02:00.000Z'),
      host: { exitCode: 0, launches: 2, liveChildren: 0, childExitCodes: [70, 0] },
      scenario: { status: 'PASS', recovery: recovery(), normal: currentNormal() },
    });
    expect(rebootPassed(p, complete(), 'c'.repeat(64))).toBe(true);
    const repeatedScope = complete();
    repeatedScope.scenario.recovery.previousSameScope = true;
    expect(rebootPassed(p, repeatedScope, 'c'.repeat(64))).toBe(true);
    repeatedScope.boot = p.boot;
    expect(rebootPassed(p, repeatedScope, 'c'.repeat(64))).toBe(false);
    for (const mutate of [
      (r) => (r.sourceHead = 'd'.repeat(40)),
      (r) => (r.packageManifestSha256 = 'd'.repeat(64)),
      (r) => (r.boot = p.boot),
      (r) => (r.host.exitCode = null),
      (r) => (r.host.childExitCodes = [70, 2]),
      (r) => (r.scenario.normal.asyncProof.native.pending = 0),
      (r) => (r.scenario.normal.summary.stopVerified = false),
      (r) => (r.phase = 'cancel'),
      (r) => (r.scenario.recovery.previousJournalDigest = 'f'.repeat(64)),
      (r) => (r.scenario.recovery.previousSameScope = null),
      (r) => (r.preparationSha256 = 'd'.repeat(64)),
      (r) => (r.scenario.normal.beforeReadPreparations.sync.asOfQpc = '100'),
      (r) =>
        (r.scenario.normal.beforeReadPreparations.async.createTime100ns = '116444736010000002'),
    ]) {
      const r = complete();
      mutate(r);
      expect(rebootPassed(p, r, 'c'.repeat(64))).toBe(false);
    }
  });
  it('rejects every changed immutable input and malformed prior metadata before host consent', () => {
    const p = prepared();
    const b = boot('2026-10-18T12:02:00.000Z');
    expect(rebootIdentity(identity())).toBe(true);
    expect(rebootPreflight('resume', p, b, identity())).toBe(true);
    for (const key of Object.keys(identity())) {
      const changed = { ...identity(), [key]: key.endsWith('Sha256') ? 'e'.repeat(64) : 'changed' };
      expect(rebootInputsMatch(p, changed), key).toBe(false);
      expect(rebootPreflight('resume', p, b, changed), key).toBe(false);
    }
    for (const patch of [{ journalDigest: null }, { journalDigest: 'g'.repeat(64) }]) {
      const bad = prepared();
      Object.assign(bad.scenario.reserved, patch);
      expect(rebootPreflight('resume', bad, b, identity())).toBe(false);
    }
  });
  it('cancellation requires original boot, exact record/hash and full independent closure', () => {
    const p = prepared();
    const r = {
      ...identity(),
      schemaVersion: 2,
      phase: 'cancel',
      status: 'CANCELLED',
      productionAdmission: false,
      preparationSha256: 'c'.repeat(64),
      boot: boot(p.boot.lastBootUtc),
      host: { exitCode: 0, launches: 1, liveChildren: 0, childExitCodes: [70] },
      scenario: {
        status: 'CANCELLED',
        recovery: { ...recovery(), beforeNewMain: { ...p.scenario.beforeReboot } },
      },
    };
    expect(rebootCancelled(p, r, 'c'.repeat(64))).toBe(true);
    for (const mutate of [
      (x) => {
        x.boot = boot('2026-10-18T12:02:00.000Z');
      },
      (x) => {
        x.scenario.recovery.previousJournalDigest = 'f'.repeat(64);
      },
      (x) => {
        x.scenario.recovery.afterRecovery.status = 5;
      },
      (x) => {
        x.host.childExitCodes = [0];
      },
      (x) => {
        x.scenario.recovery.beforeNewMain = { status: 4201, present: false };
      },
      (x) => {
        x.scenario.recovery.beforeNewMain = { status: 5, present: null };
      },
      (x) => {
        x.scenario.recovery.beforeNewMain = { status: 0, present: false };
      },
      (x) => {
        x.scenario.recovery.beforeNewMain = { status: 4201, present: true };
      },
      (x) => {
        delete x.scenario.recovery.beforeNewMain;
      },
      (x) => {
        x.scenario.recovery.beforeNewTrace = { status: 0, present: true };
      },
      (x) => {
        x.scenario.recovery.afterRecovery = { status: 0, present: true };
      },
      (x) => {
        x.host.liveChildren = 1;
      },
    ]) {
      const bad = structuredClone(r);
      mutate(bad);
      expect(rebootCancelled(p, bad, 'c'.repeat(64))).toBe(false);
    }
  });
  it('requires bounded exact full-birth preparation and rejects missing/stopped inventory', async () => {
    const witness = { pid: 71, birth: '116444736010000001' };
    let now = 0,
      calls = 0;
    const options = {
      now: () => now,
      wait: async (ms) => {
        now += ms;
      },
      timeoutMs: 200,
    };
    const ack = {
      phase: 'running',
      issuerPreparation: {
        asOfQpc: '90',
        prepared: [{ pid: 71, createTime100ns: witness.birth, threads: 1 }],
      },
    };
    expect(
      await waitRebootIssuer(
        async () => {
          calls++;
          return calls === 1 ? { phase: 'running' } : ack;
        },
        witness,
        options,
      ),
    ).toEqual({ pid: 71, createTime100ns: witness.birth, threads: 1, asOfQpc: '90' });
    now = 0;
    await expect(
      waitRebootIssuer(
        async () => ({
          phase: 'running',
          issuerPreparation: {
            asOfQpc: '90',
            prepared: [{ pid: 71, createTime100ns: '116444736010000002', threads: 1 }],
          },
        }),
        witness,
        options,
      ),
    ).rejects.toThrow('preparation unavailable');
    await expect(
      waitRebootIssuer(async () => ({ phase: 'stopped' }), witness, options),
    ).rejects.toThrow('Capture stopped');
    await expect(
      waitRebootIssuer(() => new Promise(() => {}), witness, { timeoutMs: 1 }),
    ).rejects.toThrow('preparation unavailable');
    for (const invalid of [
      { ...witness, pid: 2147483648 },
      { ...witness, birth: '18446744073709551616' },
    ])
      await expect(waitRebootIssuer(async () => ack, invalid, options)).rejects.toThrow();
  });
  it('actual read loop preserves old callback-absent behavior and awaits/fails the new barrier', async () => {
    const normal = currentNormal(),
      calls = [],
      witness = { birth: normal.syncProof.native.birth, tid: 81 };
    const fixture = {
      command: async (mode) => {
        calls.push(mode);
        return { ...normal[mode + 'Proof'].native, command: mode };
      },
    };
    const observer = { probe: { records: [normal.syncProof.record] } };
    const old = {};
    await runReadWorkloads({ fixture, witness, observer, receipt: old });
    expect(calls).toEqual(['sync', 'async']);
    expect(old.issuerPreparedBeforeRead).toBeUndefined();
    calls.length = 0;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const current = {};
    const pending = runReadWorkloads({
      fixture,
      witness,
      observer,
      receipt: current,
      beforeRead: async () => {
        await gate;
        return normal.beforeReadPreparations.sync;
      },
    });
    expect(calls).toEqual([]);
    release();
    await pending;
    expect(calls).toEqual(['sync', 'async']);
    expect(current.issuerPreparedBeforeRead).toBe(true);
    calls.length = 0;
    await expect(
      runReadWorkloads({
        fixture,
        witness,
        observer,
        receipt: {},
        beforeRead: async () => {
          throw Error('no preparation');
        },
      }),
    ).rejects.toThrow('no preparation');
    expect(calls).toEqual([]);
  });
});
