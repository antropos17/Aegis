import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createNativeFileIngress } = require('../../src/main/native-file-ingress');

function fixture() {
  const actor = {
    pid: 320,
    instanceId: '320:1720000000000',
    instanceIdSource: 'os',
    createTime100ns: '133644736000000000',
    agent: 'Claude Code',
    category: 'ai',
    parentEditor: null,
    cwd: 'C:\\work',
  };
  // The label was inspected and policy-classified before eligibility was ACKed.
  // It identifies an object; it makes no claim about the alias used by the read.
  const object = Object.freeze({
    bindingId: 'binding-1',
    label: 'C:\\owned-fixture\\.ssh\\id_ed25519',
    scopeGeneration: 'scope-1',
    policyGeneration: 'policy-1',
    volumeSerial: '1234',
    fileId128: '0123456789abcdef0123456789abcdef',
    provenance: 'issuer-handle-file-id',
    policy: Object.freeze({
      sensitive: true,
      reason: 'SSH private key',
      classification: 'ssh-aws',
    }),
  });
  const claim = {
    observationId: 'etw:0123456789abcdef:1',
    actor,
    object,
    timestamp: 1720000000123,
    createTime100ns: actor.createTime100ns,
  };
  const observation = Object.freeze({});
  const admissions = new WeakMap([[observation, claim]]);
  const calls = [];
  const received = {};
  const deps = {
    takeAdmission: vi.fn((value) => {
      const admitted = admissions.get(value);
      admissions.delete(value);
      return admitted ?? null;
    }),
    isReady: vi.fn(() => true),
    getPolicyGeneration: vi.fn(() => 'policy-1'),
    classifySensitive: vi.fn(() => 'SSH private key'),
    // A path-based exemption must never be applied to a bound-object label.
    isSelfAccess: vi.fn(() => true),
    acceptAudit: vi.fn((record) => {
      calls.push('audit');
      received.audit = record;
      return true;
    }),
    dedupLive: vi.fn((event) => event),
    recordActivity: vi.fn((event) => {
      calls.push('activity');
      received.activity = event;
    }),
    recordBaseline: vi.fn((event) => {
      calls.push('baseline');
      received.baseline = event;
    }),
    publishLive: vi.fn((event) => {
      calls.push('live');
      received.live = event;
    }),
    onLoss: vi.fn(),
  };
  return { actor, claim, observation, admissions, deps, calls, received };
}

describe('closed bound-object read ingress', () => {
  it('takes custody before one object-policy read reaches activity, baseline and live consumers', () => {
    const state = fixture();
    const ingress = createNativeFileIngress(state.deps);

    expect(ingress.offer(state.observation)).toBe(true);
    expect(state.calls).toEqual(['audit', 'activity', 'baseline', 'live']);
    expect(state.received.live).toMatchObject({
      observationKind: 'bound-object-read',
      instanceId: state.actor.instanceId,
      pid: state.actor.pid,
      agent: 'Claude Code',
      object: state.claim.object,
      timestamp: state.claim.timestamp,
      sensitive: true,
      selfAccess: false,
      action: 'accessed',
      attribution: { status: 'confirmed', evidence: ['etw-file-object'] },
    });
    expect(state.received.live).not.toHaveProperty('file');
    expect(state.deps.classifySensitive).not.toHaveBeenCalled();
    expect(state.deps.isSelfAccess).not.toHaveBeenCalled();
    expect(state.received.activity).toBe(state.received.live);
    expect(state.received.baseline).toBe(state.received.live);
    expect(state.received.audit).toMatchObject({
      type: 'file-access',
      sensor: 'other',
      timestamp: state.claim.timestamp,
      details: {
        instanceId: state.actor.instanceId,
        path: '',
        boundObject: state.claim.object,
      },
    });
    expect(ingress.offer(state.observation)).toBe(false);
    expect(state.deps.acceptAudit).toHaveBeenCalledTimes(1);
    expect(state.deps.publishLive).toHaveBeenCalledTimes(1);
  });
});
