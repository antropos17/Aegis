import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import runtime from '../../../src/main/platform/etw-file-runtime.js';
import { createHarness } from '../../fixtures/etw-supervisor-harness.js';
import { message, observation, telemetry } from './etw-file-fixtures.js';

const PROFILE = 'win11-x64-26300.9457-experimental';
const EPOCH = 1788883200000;
const BIRTH = '134000000000001111';
const actor = {
  pid: 71,
  agent: 'fixture-agent',
  category: 'ai',
  createTime100ns: BIRTH,
  instanceIdSource: 'os',
  instanceId: '71:1755526400000',
};
const candidate = {
  bindingId: '1',
  issuerPid: 71,
  createTime100ns: BIRTH,
  label: 'C:\\fixture\\secret.env',
  volumeSerial: '42',
  fileId128: '00112233445566778899aabbccddeeff',
  fromQpc: '150',
};
const owners = [];
afterEach(() => {
  for (const owner of owners.splice(0)) owner.dispose();
  vi.clearAllTimers();
  vi.useRealTimers();
});
function raw(eventSeq, qpc, extra = {}) {
  return observation({
    eventSeq: String(eventSeq),
    qpc: String(qpc),
    path: 'C:\\fixture\\candidate-name.dat',
    pathEvidence: 'candidate-key',
    issuerStatus: 'verified',
    issuerPid: 71,
    issuerInterval: { fromQpc: '100', toQpc: '300' },
    generationStatus: 'verified',
    generationWitness: BIRTH,
    generationSource: 'createTime100ns',
    generationInterval: { fromQpc: '250', toQpc: '300' },
    ...extra,
  });
}
function sample(qpc, mutate = () => {}) {
  const value = telemetry();
  value.counters.asOfQpc = String(qpc);
  mutate(value);
  return value;
}
function make({ consume = true } = {}) {
  const transport = createHarness({}, (owner) => owners.push(owner));
  vi.setSystemTime(EPOCH);
  const power = new EventEmitter(),
    delivered = [],
    claims = [],
    policies = [];
  let currentPolicy = 'policy-1',
    wall = EPOCH;
  const owner = runtime.createRuntime({
    app: { isPackaged: true },
    packageMetadata: {},
    resourcesPath: 'C:\\package\\resources',
    platform: 'win32',
    arch: 'x64',
    argv: [],
    exists: () => true,
    checkRoot: () => true,
    powerMonitor: power,
    now: () => wall,
    mono: () => wall - EPOCH,
    getAgents: () => [actor],
    getPopulationHealth: () => ({ populationReliable: true, identityDegraded: false }),
    spawnProcess: (_executable, args) => transport.spawnBroker(args[1], args[2]),
    onBindingCandidate: (value, context) => {
      policies.push({ value, context });
      return {
        scopeGeneration: context.scopeGeneration,
        policyGeneration: currentPolicy,
        policy: { sensitive: true, classification: 'sensitive', reason: 'Fixture secret object' },
      };
    },
    isPolicyCurrent: (generation) => generation === currentPolicy,
    onOperationalRead: (value) => {
      delivered.push(value);
      if (consume) claims.push(owner.takeAdmission(value));
      return true;
    },
  });
  owners.push(owner);
  let child,
    seq = 0,
    eventSeq = 0,
    binding;
  function send(kind, data) {
    child.message(kind, ++seq, data);
    child.flush();
  }
  function start(action = 'start-object', { mutateReady = () => {}, onStarting = () => {} } = {}) {
    expect(owner.control({ action, root: 'C:\\fixture' })).toEqual({ success: true });
    onStarting();
    child = transport.children.at(-1);
    seq = 0;
    eventSeq = 0;
    send('hello');
    const ready = {
      ...message('ready').data,
      requestId: child.writes[0].data.requestId,
      objectBridge: action === 'start-object' ? PROFILE : null,
    };
    mutateReady(ready);
    send('ready', ready);
    const prime = child.writes.find((value) => value.t === 'prime-issuers');
    if (prime)
      send('issuers-primed', {
        requestId: prime.data.requestId,
        prepared: [{ pid: 71, createTime100ns: BIRTH, threads: 1 }],
        asOfQpc: '120',
      });
    return child;
  }
  function prime({ acknowledge = true } = {}) {
    send('observations', { records: [raw(++eventSeq, 140, { objectCandidate: candidate })] });
    binding = child.writes.findLast((value) => value.t === 'bind-object-policy')?.data;
    if (acknowledge) {
      expect(binding).toBeTruthy();
      send('object-policy-bound', { ...binding, accepted: true, fromQpc: '175' });
    }
    return binding;
  }
  function read(overrides = {}) {
    const value = raw(++eventSeq, 200, {
      objectProof: {
        source: 'issuer-handle-file-id',
        labelSemantics: 'pre-read-object-binding',
        bindingId: '1',
        scopeGeneration: binding?.scopeGeneration ?? 'unbound-scope',
        policyGeneration: binding?.policyGeneration ?? 'policy-1',
        volumeSerial: '42',
        fileId128: candidate.fileId128,
        path: candidate.label,
        fromQpc: '175',
        toQpc: '300',
        clock: { qpc: '300', unixMs: String(EPOCH), uncertaintyQpc: '1' },
      },
      ...overrides,
    });
    send('observations', { records: [value] });
    return value;
  }
  function heartbeat(qpc, mutation) {
    send('heartbeat', sample(qpc, mutation));
  }
  function finish() {
    owner.control({ action: 'stop' });
    child.flush();
    const stop = child.writes.findLast((value) => value.t === 'stop');
    send('stopped', {
      ...message('stopped').data,
      requestId: stop.data.requestId,
      finalEventSeq: String(eventSeq),
      telemetry: sample(400),
    });
    child.stdout.emit('end');
    child.emit('close', 0);
  }
  return {
    owner,
    power,
    delivered,
    claims,
    policies,
    start,
    prime,
    read,
    send,
    heartbeat,
    finish,
    get child() {
      return child;
    },
    policy: (value) => {
      currentPolicy = value;
    },
    time: (value) => {
      wall = value;
      vi.setSystemTime(value);
    },
  };
}
describe('actual ETW runtime transport composition', () => {
  it('qualifies only after real ready while retaining independent issuer preparation', () => {
    const h = make();
    h.start('start-object', {
      onStarting() {
        expect(h.owner.getReadView().admission.qualification).toMatchObject({
          conditions: { qualified: false, revoked: false, contextActive: false },
          continuity: {
            telemetryAvailable: false,
            operational: false,
            querySucceeded: false,
            eventsLostZero: false,
            realTimeBuffersLostZero: false,
            logBuffersLostZero: false,
            droppedZero: false,
            decoderErrorsZero: false,
            mapEpochZero: false,
            mapResetsZero: false,
            mapConflictsZero: false,
            stickyClear: true,
          },
          firstRevocation: null,
        });
      },
    });
    expect(h.owner.getDiagnostics()).toMatchObject({
      phase: 'running',
      issuerPreparation: { prepared: [{ pid: actor.pid, createTime100ns: BIRTH }] },
    });
    const view = h.owner.getReadView();
    expect(view.admission.qualified).toBe(true);
    expect(view.admission.qualification).toEqual({
      schema: 'aegis-etw-object-qualification/1',
      conditions: {
        qualified: true,
        revoked: false,
        scopePresent: true,
        contextPresent: true,
        contextActive: true,
        continuous: true,
        exactProfile: true,
      },
      continuity: {
        telemetryAvailable: true,
        operational: true,
        querySucceeded: true,
        eventsLostZero: true,
        realTimeBuffersLostZero: true,
        logBuffersLostZero: true,
        droppedZero: true,
        decoderErrorsZero: true,
        mapEpochZero: true,
        mapResetsZero: true,
        mapConflictsZero: true,
        stickyClear: true,
      },
      firstRevocation: null,
    });
  });
  it.each([
    [
      'unmeasured native query',
      (ready) => {
        Object.assign(ready.telemetry.counters, {
          queryStatus: 5,
          eventsLost: null,
          realTimeBuffersLost: null,
          logBuffersLost: null,
        });
      },
      'continuity',
      'querySucceeded',
    ],
    [
      'kernel loss',
      (ready) => {
        ready.telemetry.counters.eventsLost = '1';
      },
      'continuity',
      'eventsLostZero',
    ],
    [
      'mapping epoch change',
      (ready) => {
        ready.telemetry.totals.mapEpoch = '1';
      },
      'continuity',
      'mapEpochZero',
    ],
    [
      'missing object bridge',
      (ready) => {
        ready.objectBridge = null;
      },
      'profile',
      null,
    ],
  ])(
    'keeps running preparation separate from refused %s and preserves the first cause',
    (_label, mutateReady, cause, failedCounter) => {
      const h = make();
      h.start('start-object', { mutateReady });
      expect(h.owner.getDiagnostics()).toMatchObject({
        phase: 'running',
        issuerPreparation: { prepared: [{ pid: actor.pid, createTime100ns: BIRTH }] },
      });
      const first = h.owner.getReadView().admission.qualification;
      expect(first.conditions).toEqual({
        qualified: false,
        revoked: true,
        scopePresent: true,
        contextPresent: true,
        contextActive: true,
        continuous: cause === 'profile',
        exactProfile: cause !== 'profile',
      });
      if (failedCounter) expect(first.continuity[failedCounter]).toBe(false);
      expect(first.firstRevocation).toEqual({
        cause,
        conditions: first.conditions,
        continuity: first.continuity,
      });
      h.heartbeat(200);
      const later = h.owner.getReadView().admission;
      expect(later).toMatchObject({
        qualified: false,
        qualification: {
          conditions: { revoked: true },
          firstRevocation: first.firstRevocation,
        },
      });
      if (failedCounter) expect(later.qualification.continuity[failedCounter]).toBe(true);
      h.finish();
      expect(h.owner.getReadView().admission.qualification.firstRevocation).toEqual(
        first.firstRevocation,
      );
      expect(h.delivered).toEqual([]);
    },
  );
  it('resets the first admission refusal only for a new explicit capture', () => {
    const h = make();
    h.start('start-object', {
      mutateReady(ready) {
        ready.telemetry.totals.mapEpoch = '1';
      },
    });
    const first = h.owner.getReadView().admission.qualification.firstRevocation;
    expect(first).toMatchObject({
      cause: 'continuity',
      continuity: { mapEpochZero: false },
    });
    h.heartbeat(200);
    h.finish();
    expect(h.owner.getReadView().admission.qualification.firstRevocation).toEqual(first);
    h.start();
    expect(h.owner.getReadView().admission).toMatchObject({
      qualified: true,
      qualification: { conditions: { revoked: false }, firstRevocation: null },
    });
    expect(h.owner.getDiagnostics()).toMatchObject({
      phase: 'running',
      issuerPreparation: { prepared: [{ pid: actor.pid, createTime100ns: BIRTH }] },
    });
  });
  it.each([
    ['marked explicit object mode', true, true, true, true, true],
    ['ordinary package', false, true, true, true, false],
    ['missing object opt-in', true, false, true, true, false],
    ['unverified root', true, true, false, true, false],
    ['malformed observer', true, true, true, false, false],
  ])(
    'permits the readonly closure observer only in %s',
    (_label, marked, object, root, valid, allowed) => {
      const transport = createHarness({}, (owner) => owners.push(owner));
      const endpoint = valid ? '12345678123456781234567812345678:71:1000' : 'foreign:71:1000';
      const spawnProcess = vi.fn(() => {
        throw new Error('fixture launch failed');
      });
      const owner = runtime.createRuntime({
        app: { isPackaged: true },
        packageMetadata: { aegisEtwDiagnostic: marked },
        resourcesPath: 'C:\\candidate\\resources',
        platform: 'win32',
        arch: 'x64',
        exists: () => true,
        checkRoot: () => root,
        powerMonitor: new EventEmitter(),
        spawnProcess,
        argv: [
          '--etw-file-diagnostic-root=C:\\fixture',
          ...(object ? ['--etw-file-object-policy'] : []),
          '--etw-file-diagnostic-observer=' + endpoint,
        ],
      });
      owners.push(owner);
      owner.start();
      expect(spawnProcess).toHaveBeenCalledTimes(allowed ? 1 : 0);
      expect(transport.children).toHaveLength(0);
    },
  );
  it('joins candidate, policy command, ACK, read and later zero-loss heartbeat into one private claim', () => {
    const h = make();
    h.start();
    const binding = h.prime();
    expect(h.policies).toHaveLength(1);
    expect(h.policies[0].context.actor).toMatchObject(actor);
    expect(binding).toMatchObject({ bindingId: '1', policyGeneration: 'policy-1' });
    expect(h.owner.getReadView().admission.boundObjects).toBe(1);
    h.read();
    expect(h.delivered).toEqual([]);
    h.heartbeat(350);
    expect(h.delivered).toHaveLength(1);
    expect(h.claims).toHaveLength(1);
    expect(h.claims[0]).toMatchObject({
      actor,
      timestamp: EPOCH - 1,
      object: {
        label: candidate.label,
        provenance: 'issuer-handle-file-id',
        policy: { sensitive: true },
      },
    });
    expect(h.claims[0].object.objectKey).toMatch(/^[a-f0-9]{64}$/);
    expect(h.claims[0]).not.toHaveProperty('file');
    expect(h.claims[0].object).not.toHaveProperty('fileId128');
    expect(h.owner.takeAdmission(h.delivered[0])).toBeNull();
    h.heartbeat(400);
    expect(h.delivered).toHaveLength(1);
  });
  it('cannot create custody from a candidate, missing ACK or copied native metadata', () => {
    const h = make();
    h.start();
    h.prime({ acknowledge: false });
    const rawValue = h.read();
    h.heartbeat(350);
    expect(h.delivered).toEqual([]);
    expect(h.owner.takeAdmission(rawValue)).toBeNull();
    expect(h.owner.takeAdmission({ ...rawValue })).toBeNull();
  });
  it.each([
    [
      'kernel loss',
      (value) => {
        value.counters.eventsLost = '1';
      },
    ],
    [
      'realtime buffer loss',
      (value) => {
        value.counters.realTimeBuffersLost = '1';
      },
    ],
    [
      'collector drop',
      (value) => {
        value.totals.dropped = '1';
        value.totals.ingressDropped = '1';
      },
    ],
    [
      'mapping reset',
      (value) => {
        value.totals.mapEpoch = '1';
        value.totals.mapResets = '1';
      },
    ],
    [
      'unknown native query',
      (value) => {
        Object.assign(value.counters, {
          queryStatus: 5,
          eventsLost: null,
          realTimeBuffersLost: null,
          logBuffersLost: null,
        });
      },
    ],
    [
      'regressed cumulative counter',
      (value) => {
        value.totals.delivered = '9';
      },
    ],
    [
      'regressed source watermark',
      (value) => {
        value.counters.asOfQpc = '200';
      },
    ],
  ])('revokes queued reads and old policy after actual %s telemetry', (_label, mutate) => {
    const h = make();
    h.start();
    h.prime();
    const value = h.read();
    h.heartbeat(250);
    expect(h.delivered).toEqual([]);
    h.heartbeat(350, mutate);
    h.heartbeat(400);
    h.read();
    h.heartbeat(450);
    expect(h.delivered).toEqual([]);
    expect(h.owner.takeAdmission(value)).toBeNull();
    expect(h.owner.getReadView().admission.qualified).toBe(false);
  });
  it.each(['pause', 'stop', 'suspend'])(
    'revokes pending and issued tokens immediately on %s',
    (action) => {
      for (const issue of [false, true]) {
        const h = make({ consume: false });
        h.start();
        h.prime();
        h.read();
        if (issue) h.heartbeat(350);
        expect(h.delivered).toHaveLength(issue ? 1 : 0);
        if (action === 'pause') h.owner.setPaused(true);
        else if (action === 'suspend') h.power.emit('suspend');
        else h.owner.control({ action: 'stop' });
        h.child.flush();
        h.heartbeat(400);
        expect(h.delivered).toHaveLength(issue ? 1 : 0);
        expect(h.owner.takeAdmission(h.delivered[0])).toBeNull();
        expect(h.owner.getReadView().admission.qualified).toBe(false);
      }
    },
  );
  it('does not reuse frozen policy after configuration change or a fresh capture', () => {
    const h = make();
    h.start();
    const oldBinding = h.prime();
    h.read();
    h.policy('policy-2');
    h.heartbeat(350);
    expect(h.delivered).toEqual([]);
    h.finish();
    h.start();
    h.send('object-policy-bound', { ...oldBinding, accepted: true, fromQpc: '175' });
    h.read();
    h.heartbeat(350);
    expect(h.delivered).toEqual([]);
    expect(h.owner.getReadView().admission.boundObjects).toBe(0);
  });
  it('keeps ordinary folder capture display-only even when records contain proof-shaped metadata', () => {
    const h = make();
    h.start('start');
    h.prime({ acknowledge: false });
    h.read();
    h.heartbeat(350);
    expect(h.policies).toEqual([]);
    expect(h.delivered).toEqual([]);
    expect(h.child.writes.some((value) => value.t === 'bind-object-policy')).toBe(false);
    expect(h.owner.getReadView().captureMode).toBe('display');
  });
});
