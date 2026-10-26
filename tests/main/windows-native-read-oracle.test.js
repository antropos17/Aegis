import { describe, it, expect } from 'vitest';
import { nativeReadPassed } from '../../scripts/qualification/windows-native-read-oracle.mjs';

function receipt() {
  const birth = '133000000000000000',
    pid = 4242;
  const instanceId = `${pid}:${(BigInt(birth) - 116444736000000000n) / 10000n}`;
  const read = (mode) => ({
    mode,
    native: {
      pid,
      tid: 9,
      birth,
      reads: 160,
      pending: mode === 'async' ? 3 : 0,
      shareDelete: false,
      fromQpc: '190',
      toQpc: '250',
    },
    record: {
      eventId: 15,
      version: 1,
      provider: 'edd08927-9cc4-4e65-b970-c2560fb5c289',
      qpc: '200',
      issuerInterval: { fromQpc: '100', toQpc: '300' },
      generationInterval: { fromQpc: '200', toQpc: '201' },
      generationSource: 'createTime100ns',
      issuerStatus: 'verified',
      generationStatus: 'verified',
      issuerPid: pid,
      issuingTid: 9,
      generationWitness: birth,
      instanceId,
      agent: 'Aider',
      objectProof: {
        bindingId: 'binding-one',
        scopeGeneration: 'scope-one',
        policyGeneration: 'policy-one',
        fromQpc: '180',
        toQpc: '220',
      },
    },
  });
  const value = {
    status: 'PASS',
    sourceHead: 'a'.repeat(40),
    fixtureSourceSha256: 'b'.repeat(64),
    fixtureOnly: true,
    realAgent: false,
    productionAdmission: false,
    actualAccessPathObserved: false,
    bindingUnchanged: true,
    window: { dpi: 96, scaleFactor: 1, packaged: true, isolated: true, mainPid: 111 },
    originalCohort: {
      originalObjectsObserved: true,
      originalPids: [111, 112, 113, 114, 115],
      custodianPid: 116,
    },
    peerClosure: { originalExits: [0, 0, 0, 0, 0], custodianExit: 0 },
    observerExit: 0,
    retention: {
      released: true,
      captureContinued: true,
      elapsedMs: 0.5,
      deadlineMs: 15000,
      firstAttempt: { released: true, elapsedMs: 0.5, win32Error: 0 },
    },
    actor: { pid, instanceId, instanceIdSource: 'os', createTime100ns: birth },
    witness: { pid, birth, shareDelete: false },
    event: {
      eventId: 'event-one',
      pid,
      instanceId,
      createTime100ns: birth,
      observationKind: 'bound-object-read',
      sensitive: true,
      object: {
        bindingId: 'binding-one',
        scopeGeneration: 'scope-one',
        policyGeneration: 'policy-one',
        objectKey: 'opaque',
        provenance: 'issuer-handle-file-id',
        policy: { sensitive: true },
      },
    },
    reads: [read('sync'), read('async')],
    alert: {
      eventId: 'event-one',
      observationKind: 'bound-object-read',
      labelSemantics: 'binding-label-access-path-unknown',
    },
    baseline: { instanceId, generationCurrent: true, objectBindings: 1, sensitiveObjectReads: 1 },
    beforeRisk: {
      score: 0,
      workerCount: 1,
      displayedInstanceId: instanceId,
      displayedPid: pid,
      observedNow: true,
      actorBefore: { pid, instanceId, createTime100ns: birth },
      actorAfter: { pid, instanceId, createTime100ns: birth },
    },
    afterRisk: {
      score: 15,
      workerCount: 1,
      displayedInstanceId: instanceId,
      displayedPid: pid,
      observedNow: true,
      actorBefore: { pid, instanceId, createTime100ns: birth },
      actorAfter: { pid, instanceId, createTime100ns: birth },
    },
    actualPreloadDelivery: true,
    objectAlertObserved: true,
    displayedRiskIncreased: true,
    persistedAuditObserved: true,
    contentExcluded: true,
    publicIdentityRedacted: true,
    noCompetingLegacyFileObservation: true,
    legacyReadDeliveries: 0,
    retainedPathObservationCount: 0,
    stopVerified: true,
    fixtureExit: 0,
    appExit: 0,
    host: { exitCode: 0, liveChildren: 0, launches: 1, childExitCodes: [0] },
    before: { status: 4201, present: false },
    after: { status: 4201, present: false },
  };
  value.retention.sourceShareDelete = false;
  value.retention.observedDelay = false;
  for (const read of value.reads) read.event = structuredClone(value.event);
  return value;
}

describe('cloud native-read acceptance oracle', () => {
  it('accepts a complete linked synthetic OS-read to actual-consumer scenario', () => {
    expect(nativeReadPassed(receipt())).toBe(true);
  });
  it.each(['beforeRisk', 'afterRisk'])('refuses coercible or invalid %s scores', (phase) => {
    for (const score of [null, false, '0', '15', 0.5, NaN, Infinity, -1, 101]) {
      const value = receipt();
      value[phase].score = score;
      expect(nativeReadPassed(value)).toBe(false);
    }
  });
  it.each(['beforeRisk', 'afterRisk'])(
    'refuses %s without both exact displayed actor witnesses',
    (phase) => {
      for (const field of [
        'workerCount',
        'actorBefore',
        'actorAfter',
        'displayedInstanceId',
        'displayedPid',
        'observedNow',
      ]) {
        const value = receipt();
        delete value[phase][field];
        expect(nativeReadPassed(value)).toBe(false);
      }
      for (const witness of ['actorBefore', 'actorAfter']) {
        for (const field of ['pid', 'instanceId', 'createTime100ns']) {
          const value = receipt();
          value[phase][witness][field] = field === 'pid' ? 9999 : value.actor[field] + '1';
          expect(nativeReadPassed(value)).toBe(false);
        }
      }
      const ambiguous = receipt();
      ambiguous[phase].workerCount = 2;
      expect(nativeReadPassed(ambiguous)).toBe(false);
      const wrongSelection = receipt();
      wrongSelection[phase].displayedInstanceId += '-other';
      expect(nativeReadPassed(wrongSelection)).toBe(false);
      const wrongPid = receipt();
      wrongPid[phase].displayedPid += 1;
      expect(nativeReadPassed(wrongPid)).toBe(false);
    },
  );
  it.each([
    [
      'non-load-bearing sharing mode',
      (r) => {
        r.witness.shareDelete = true;
      },
    ],
    [
      'unbound fixture source',
      (r) => {
        delete r.fixtureSourceSha256;
      },
    ],
    [
      'missing issuer exit',
      (r) => {
        delete r.fixtureExit;
      },
    ],
    [
      'release exceeded measured bound',
      (r) => {
        r.retention.elapsedMs = 15001;
      },
    ],
    [
      'release never observed',
      (r) => {
        r.retention.released = false;
      },
    ],
    [
      'capture ended before release',
      (r) => {
        r.retention.captureContinued = false;
      },
    ],
    [
      'missing original process handles',
      (r) => {
        r.originalCohort.originalObjectsObserved = false;
      },
    ],
    [
      'contradictory original exit',
      (r) => {
        r.peerClosure.originalExits[2] = 70;
      },
    ],
    [
      'unknown custodian exit',
      (r) => {
        r.peerClosure.custodianExit = null;
      },
    ],
    [
      'unknown observer closure',
      (r) => {
        r.observerExit = null;
      },
    ],
    [
      'PASS with failure',
      (r) => {
        r.failure = 'Contradictory failed proof';
      },
    ],
    [
      'fully consistent foreign workload',
      (r) => {
        const read = r.reads[0];
        read.native.pid = 5555;
        read.record.issuerPid = 5555;
        read.record.instanceId = '5555:' + r.actor.instanceId.split(':')[1];
      },
    ],
    [
      'missing host cohort',
      (r) => {
        delete r.host.childExitCodes;
      },
    ],
    [
      'contradictory host child exit',
      (r) => {
        r.host.childExitCodes[0] = 70;
      },
    ],
    [
      'wrong displayed DPI',
      (r) => {
        r.window.dpi = 120;
      },
    ],
    [
      'unsupported scale',
      (r) => {
        r.window.scaleFactor = 1.25;
      },
    ],
    [
      'changed source',
      (r) => {
        r.bindingUnchanged = false;
      },
    ],
    [
      'unobserved process birth',
      (r) => {
        r.actor.createTime100ns = null;
      },
    ],
    [
      'same PID wrong issuing thread',
      (r) => {
        r.reads[0].record.issuingTid = 10;
      },
    ],
    [
      'different issuing generation',
      (r) => {
        r.reads[0].record.generationWitness = '133000000000000001';
      },
    ],
    [
      'read outside retained issuer interval',
      (r) => {
        r.reads[0].record.issuerInterval.fromQpc = '201';
      },
    ],
    [
      'pre-ACK read',
      (r) => {
        r.reads[0].record.objectProof.fromQpc = '200';
      },
    ],
    [
      'missing actual pending I/O',
      (r) => {
        r.reads[1].native.pending = 0;
      },
    ],
    [
      'missing second workload',
      (r) => {
        r.reads.pop();
      },
    ],
    [
      'unlinked operational object',
      (r) => {
        r.event.object.bindingId = 'unrelated';
      },
    ],
    [
      'manufactured access pathname',
      (r) => {
        r.event.file = 'C:\\fixture\\.env';
      },
    ],
    [
      'unrelated alert',
      (r) => {
        r.alert.eventId = 'unrelated';
      },
    ],
    [
      'missing baseline mutation',
      (r) => {
        r.baseline.sensitiveObjectReads = 0;
      },
    ],
    [
      'risk did not change',
      (r) => {
        r.afterRisk.score = r.beforeRisk.score;
      },
    ],
    [
      'no renderer delivery',
      (r) => {
        r.actualPreloadDelivery = false;
      },
    ],
    [
      'no persisted custody',
      (r) => {
        r.persistedAuditObserved = false;
      },
    ],
    [
      'unknown stop',
      (r) => {
        r.stopVerified = false;
      },
    ],
    [
      'live child',
      (r) => {
        r.host.liveChildren = 1;
      },
    ],
    [
      'session absence unknown',
      (r) => {
        r.after.status = 5;
      },
    ],
    [
      'contents retained',
      (r) => {
        r.contentExcluded = false;
      },
    ],
    [
      'raw identity retained',
      (r) => {
        r.publicIdentityRedacted = false;
      },
    ],
    [
      'competing legacy file risk',
      (r) => {
        r.legacyReadDeliveries = 1;
      },
    ],
  ])('rejects %s', (_name, mutation) => {
    const value = receipt();
    mutation(value);
    expect(nativeReadPassed(value)).toBe(false);
  });
});
