import { describe, expect, it } from 'vitest';
import admission from '../../../src/main/platform/etw-file-admission.js';
import { observation } from './etw-file-fixtures.js';

const birth = '134000000000001111';
const actor = {
  pid: 71,
  agent: 'fixture-agent',
  category: 'cli',
  createTime100ns: birth,
  instanceIdSource: 'os',
  instanceId: '71:1755526400000',
};
const identity = {
  bindingId: '1',
  issuerPid: 71,
  createTime100ns: birth,
  label: 'C:\\fixture\\secret.env',
  volumeSerial: '42',
  fileId128: '00112233445566778899aabbccddeeff',
  fromQpc: '1000',
};
function record(overrides = {}) {
  return observation({
    eventSeq: '2',
    qpc: '1100',
    path: 'C:\\fixture\\display-candidate',
    pathEvidence: 'candidate-key',
    issuerStatus: 'verified',
    issuerPid: 71,
    issuerInterval: { fromQpc: '800', toQpc: '1200' },
    generationStatus: 'verified',
    generationWitness: birth,
    generationSource: 'createTime100ns',
    generationInterval: { fromQpc: '1150', toQpc: '1200' },
    objectProof: {
      source: 'issuer-handle-file-id',
      labelSemantics: 'pre-read-object-binding',
      bindingId: '1',
      scopeGeneration: 'scope-1',
      policyGeneration: 'policy-1',
      volumeSerial: '42',
      fileId128: identity.fileId128,
      path: identity.label,
      fromQpc: '1050',
      toQpc: '1200',
      clock: { qpc: '1200', unixMs: '2000200', uncertaintyQpc: '1' },
    },
    ...overrides,
  });
}
function context(overrides = {}) {
  return {
    sessionId: 'session-1',
    active: true,
    continuous: true,
    watermarkQpc: '1000',
    frequency: '1000',
    clock: { qpc: '1000', unixMs: '2000000', uncertaintyQpc: '1' },
    objectBridge: 'win11-x64-26300.9457-experimental',
    ...overrides,
  };
}
function make(options = {}) {
  let time = 2000300,
    current = true;
  const delivered = [],
    requests = [];
  const owner = admission.createAdmission({
    now: () => time,
    getAgents: () => [actor],
    getHealth: () => ({ populationReliable: true }),
    getRoot: () => 'C:\\fixture',
    onRead: (r) => {
      delivered.push(r);
      return true;
    },
    onBindingCandidate: (_candidate, { scopeGeneration }) => ({
      scopeGeneration,
      policyGeneration: 'policy-1',
      policy: { sensitive: true, reason: 'Fixture secret object', classification: 'sensitive' },
    }),
    isPolicyCurrent: () => current,
    sendBinding: (r) => {
      requests.push(r);
      return true;
    },
    ...options,
  });
  owner.begin('scope-1');
  owner.update(context());
  function bind() {
    const priming = record({ eventSeq: '1', qpc: '900', objectCandidate: identity });
    delete priming.objectProof;
    owner.accept([priming]);
    expect(requests).toHaveLength(1);
    owner.bound({ ...requests[0], accepted: true, fromQpc: '1050' });
  }
  return {
    owner,
    delivered,
    requests,
    bind,
    time: (v) => {
      time = v;
    },
    obsolete: () => {
      current = false;
    },
  };
}
describe('raw ETW object-policy admission custody', () => {
  it('requires pre-read policy ACK and later source watermark, then admits correct actor once', () => {
    const h = make();
    h.bind();
    const r = record();
    h.owner.accept([r]);
    expect(h.delivered).toEqual([]);
    h.owner.update(context({ watermarkQpc: '1250' }));
    expect(h.delivered).toEqual([r]);
    expect(h.owner.take({ ...r })).toBeNull();
    const claim = h.owner.take(r);
    expect(claim).toMatchObject({
      observationId: 'session-1:2',
      actor,
      timestamp: 2000100,
      createTime100ns: birth,
      object: {
        label: identity.label,
        bindingId: '1',
        policy: { sensitive: true, classification: 'sensitive' },
      },
    });
    expect(claim.object.objectKey).toMatch(/^[a-f0-9]{64}$/);
    expect(claim).not.toHaveProperty('file');
    expect(JSON.stringify(claim)).not.toContain(identity.fileId128);
    expect(claim.object).not.toHaveProperty('volumeSerial');
    expect(Object.isFrozen(claim.object.policy)).toBe(true);
    expect(h.owner.take(r)).toBeNull();
  });
  it('never promotes candidate path, priming read, unacknowledged or post-event binding', () => {
    const h = make();
    const raw = record();
    h.owner.accept([raw]);
    expect(h.delivered).toHaveLength(0);
    expect(h.owner.take(raw)).toBeNull();
    for (const override of [
      null,
      { ...record().objectProof, fromQpc: '1100' },
      { ...record().objectProof, fromQpc: '1000' },
      { ...record().objectProof, path: 'C:\\outside\\secret.env' },
    ]) {
      const bound = make();
      bound.bind();
      const r = record();
      if (override) r.objectProof = override;
      else delete r.objectProof;
      bound.owner.accept([r]);
      bound.owner.update(context({ watermarkQpc: '1250' }));
      expect(bound.delivered).toEqual([]);
    }
  });
  it('revokes pending and issued ownership on pause, source loss and session change', () => {
    for (const change of [{ active: false }, { continuous: false }, { sessionId: 'session-2' }]) {
      const h = make();
      h.bind();
      h.owner.update(context({ watermarkQpc: '1250' }));
      const r = record();
      h.owner.accept([r]);
      expect(h.delivered).toHaveLength(1);
      h.owner.update(context(change));
      expect(h.owner.take(r)).toBeNull();
      h.owner.update(context({ watermarkQpc: '1250' }));
      expect(h.owner.take(r)).toBeNull();
    }
  });
  it('rejects obsolete frozen policies, clock jumps, uncertainty and same-ms process reuse', () => {
    for (const clock of [
      { qpc: '1200', unixMs: '2001200', uncertaintyQpc: '1' },
      { qpc: '1200', unixMs: '2000200', uncertaintyQpc: '11' },
    ]) {
      const h = make();
      h.bind();
      h.owner.update(context({ watermarkQpc: '1250' }));
      h.owner.accept([record({ objectProof: { ...record().objectProof, clock } })]);
      expect(h.delivered).toHaveLength(0);
    }
    let rows = [actor];
    const reused = make({ getAgents: () => rows });
    reused.bind();
    rows = [{ ...actor, createTime100ns: '134000000000001112' }];
    reused.owner.update(context({ watermarkQpc: '1250' }));
    reused.owner.accept([record()]);
    expect(reused.delivered).toHaveLength(0);
    const old = make();
    old.bind();
    old.owner.update(context({ watermarkQpc: '1250' }));
    const r = record();
    old.owner.accept([r]);
    old.obsolete();
    expect(old.owner.take(r)).toBeNull();
  });
  it('counts consumer rejection once, and does not replay its live effects', () => {
    const h = make({ onRead: () => false });
    h.bind();
    h.owner.update(context({ watermarkQpc: '1250' }));
    const r = record();
    h.owner.accept([r]);
    expect(h.owner.take(r)).toBeNull();
    expect(h.owner.snapshot().consumerRejected).toBe(1);
    h.owner.accept([r]);
    expect(h.owner.snapshot().consumerRejected).toBe(1);
  });
  it('retires expired bindings so a long capture can bind later objects', () => {
    const h = make();
    h.bind();
    for (let index = 2; index <= 65; index++) {
      const candidate = record({
        eventSeq: String(index),
        qpc: '900',
        objectCandidate: { ...identity, bindingId: String(index) },
      });
      delete candidate.objectProof;
      h.owner.accept([candidate]);
    }
    expect(h.requests).toHaveLength(64);
    expect(h.owner.snapshot().bindingDropped).toBe(1);
    h.time(2010401);
    h.owner.update(context());
    const next = record({
      eventSeq: '66',
      qpc: '900',
      objectCandidate: { ...identity, bindingId: '66' },
    });
    delete next.objectProof;
    h.owner.accept([next]);
    expect(h.requests).toHaveLength(65);
  });
  it('does not collapse separate held lifetimes with the same reusable filesystem ID', () => {
    const h = make();
    h.bind();
    h.owner.update(context({ watermarkQpc: '1250' }));
    const first = record();
    h.owner.accept([first]);
    const key = h.owner.take(first).object.objectKey;
    const next = record({
      eventSeq: '3',
      qpc: '900',
      objectCandidate: { ...identity, bindingId: '2' },
    });
    delete next.objectProof;
    h.owner.accept([next]);
    h.owner.bound({ ...h.requests.at(-1), accepted: true, fromQpc: '1050' });
    const second = record({
      eventSeq: '4',
      objectProof: { ...record().objectProof, bindingId: '2' },
    });
    h.owner.accept([second]);
    expect(h.owner.take(second).object.objectKey).not.toBe(key);
  });
});
