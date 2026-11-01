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
    objectKey: 'opaque-object-1',
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
    now: () => claim.timestamp + 500,
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

  it('freezes policy before read eligibility, without granting a label-based self exemption', () => {
    const state = fixture();
    const ingress = createNativeFileIngress(state.deps);
    const result = ingress.prepareBinding(
      { label: state.claim.object.label },
      {
        scopeGeneration: 'scope-1',
        actor: state.actor,
      },
    );
    expect(result).toEqual({
      scopeGeneration: 'scope-1',
      policyGeneration: 'policy-1',
      policy: { sensitive: true, reason: 'SSH private key', classification: 'ssh-aws' },
    });
    expect(Object.isFrozen(result.policy)).toBe(true);
    state.deps.classifySensitive.mockReturnValue(null);
    expect(ingress.offer(state.observation)).toBe(true);
    expect(state.received.live.sensitive).toBe(true);
    expect(state.deps.isSelfAccess).not.toHaveBeenCalled();
  });

  it.each([
    [
      'null actor key',
      (s) => {
        s.actor.instanceId = null;
      },
    ],
    [
      'unknown birth',
      (s) => {
        s.actor.createTime100ns = null;
      },
    ],
    [
      'birth mismatch',
      (s) => {
        s.claim.createTime100ns = '133644736000000001';
      },
    ],
    [
      'non-AI actor',
      (s) => {
        s.actor.category = 'other';
      },
    ],
    [
      'missing native identity',
      (s) => {
        s.actor.instanceIdSource = 'synthetic';
      },
    ],
    [
      'stale event',
      (s) => {
        s.claim.timestamp -= 10001;
        s.deps.now = () => 1720000000623;
      },
    ],
    [
      'future event',
      (s) => {
        s.claim.timestamp += 100;
        s.deps.now = () => 1720000000123;
      },
    ],
    [
      'obsolete policy',
      (s) => {
        s.deps.getPolicyGeneration.mockReturnValue('policy-2');
      },
    ],
    [
      'capsule-only claim',
      (s) => {
        delete s.claim.object;
        s.claim.file = 'C:\\candidate';
      },
    ],
    [
      'not ready',
      (s) => {
        s.deps.isReady.mockReturnValue(false);
      },
    ],
  ])('rejects %s before audit, dedup, activity, baseline or live effects', (_label, mutate) => {
    const state = fixture();
    mutate(state);
    const ingress = createNativeFileIngress(state.deps);
    expect(ingress.offer(state.observation)).toBe(false);
    expect(state.deps.acceptAudit).not.toHaveBeenCalled();
    expect(state.deps.dedupLive).not.toHaveBeenCalled();
    expect(state.calls).toEqual([]);
  });

  it('rejects JSON copies, read-view rows and metadata capsules without consuming live authority', () => {
    const state = fixture();
    const ingress = createNativeFileIngress(state.deps);
    for (const value of [
      { ...state.observation },
      state.claim,
      { nativeObservation: state.claim },
      { path: state.claim.object.label, instanceId: state.actor.instanceId },
    ])
      expect(ingress.offer(value)).toBe(false);
    expect(state.calls).toEqual([]);
    expect(ingress.offer(state.observation)).toBe(true);
  });

  it('rejects audit custody before dedup and allows the next independent read of that object', () => {
    const state = fixture();
    state.deps.acceptAudit.mockReturnValueOnce(false);
    const ingress = createNativeFileIngress(state.deps);
    expect(ingress.offer(state.observation)).toBe(false);
    expect(state.deps.dedupLive).not.toHaveBeenCalled();
    expect(state.deps.recordActivity).not.toHaveBeenCalled();
    const next = {};
    state.admissions.set(next, { ...state.claim, observationId: 'etw:0123456789abcdef:2' });
    expect(ingress.offer(next)).toBe(true);
    expect(state.deps.recordActivity).toHaveBeenCalledTimes(1);
    expect(ingress.getHealth()).toMatchObject({ state: 'DEGRADED', lossCount: 1 });
  });

  it('takes one raw audit custody for a live-coalesced read without repeating operational effects', () => {
    const state = fixture();
    state.deps.dedupLive.mockReturnValue(null);
    const ingress = createNativeFileIngress(state.deps);
    expect(ingress.offer(state.observation)).toBe(true);
    expect(state.calls).toEqual(['audit']);
    expect(ingress.getStats()).toMatchObject({ accepted: 1, live: 0, coalesced: 1 });
  });

  it('does not retry partial consumer failure and reports degraded coverage', () => {
    const state = fixture();
    state.deps.recordBaseline.mockImplementation(() => {
      throw new Error('PRIVATE-PATH');
    });
    const ingress = createNativeFileIngress(state.deps);
    expect(ingress.offer(state.observation)).toBe(false);
    expect(ingress.offer(state.observation)).toBe(false);
    expect(state.deps.recordActivity).toHaveBeenCalledTimes(1);
    expect(state.deps.publishLive).not.toHaveBeenCalled();
    expect(ingress.getStats()).toMatchObject({ accepted: 1, live: 0, consumerFailures: 1 });
    expect(ingress.getHealth()).toMatchObject({ state: 'DEGRADED', lossCount: 1 });
    expect(JSON.stringify(ingress.getStats())).not.toContain('PRIVATE-PATH');
  });

  it('projects only closed object/actor fields and refuses replay through a second token', () => {
    const state = fixture();
    state.actor.prompt = 'SECRET-PROMPT';
    state.claim.object = {
      ...state.claim.object,
      volumeSerial: 'RAW-VOLUME',
      fileId128: 'RAW-ID',
      arguments: 'SECRET-ARGS',
    };
    const ingress = createNativeFileIngress(state.deps);
    expect(ingress.offer(state.observation)).toBe(true);
    expect(JSON.stringify(state.received)).not.toMatch(
      /SECRET-PROMPT|RAW-VOLUME|RAW-ID|SECRET-ARGS/,
    );
    const duplicate = {};
    state.admissions.set(duplicate, state.claim);
    expect(ingress.offer(duplicate)).toBe(false);
    expect(state.deps.publishLive).toHaveBeenCalledTimes(1);
  });
});
