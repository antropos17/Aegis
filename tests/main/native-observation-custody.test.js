import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { projectRecord, replayRecord } = require('../../src/main/security-event-record');
const { createSecurityBatcher } = require('../../src/main/security-event-pipeline');
const { projectNativeObservation, MAX_BYTES } = require('../../src/main/native-observation');
const audit = require('../../src/main/audit-logger');
const bootId = '11111111-1111-4111-8111-111111111111';
const capsule = () => ({
  version: 'native-observation/1',
  state: 'recorded',
  source: { ownerEpoch: '22222222-2222-4222-8222-222222222222', generation: 1 },
  platform: 'linux',
  mode: 'fanotify',
  observation: {
    seq: '9007199254740993',
    kind: 'open',
    pid: 73,
    ppid: 1,
    birth: '12345',
    witness: { kind: 'linux-start-ticks', bootId, startTicks: '12345' },
    identityError: null,
    ts: '1700000000000123',
  },
  identity: {
    startTime: 1700000123450,
    rawBirth: '12345',
    witness: bootId + ':12345',
    witnessSource: 'linuxStartTicks',
  },
  birthContext: { bootId, bootTimeSeconds: '1700000000', clockTicks: '100' },
  clockAnchor: null,
});
const event = () => ({
  sensor: 'file-handle',
  type: 'file-access',
  timestamp: 1700000000000,
  details: {
    agent: '',
    pid: null,
    instanceId: null,
    action: 'open',
    path: '',
    severity: 'normal',
    attribution: null,
    nativeObservation: capsule(),
  },
});
const roots = [];
const pipelines = [];
afterEach(() => {
  for (const p of pipelines.splice(0)) p.destroy();
  audit.shutdown();
  for (const root of roots.splice(0)) {
    const directory = path.resolve(root);
    const temporary = path.resolve(os.tmpdir());
    if (
      path.dirname(directory) !== temporary ||
      !path.basename(directory).startsWith('native-custody-') ||
      fs.lstatSync(directory).isSymbolicLink()
    )
      throw Error('fixture-cleanup-boundary');
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('optional native observation custody', () => {
  it('retains raw Linux identity when D1 context is missing without publishing an unproved normalization', () => {
    const value = capsule();
    value.birthContext = null;
    delete value.clockAnchor;
    const recorded = projectNativeObservation(value);
    expect(recorded).toMatchObject({
      state: 'recorded',
      observation: value.observation,
      identity: null,
      normalizationError: 'identity-context-unavailable',
      birthContext: null,
      clockAnchor: null,
    });
    expect(projectNativeObservation(recorded)).toEqual(recorded);
  });
  it('retains explicit unavailable identity and capture range reasons without filling missing proof', () => {
    const value = capsule();
    value.birthContext = null;
    Object.assign(value.observation, {
      birth: null,
      witness: null,
      identityError: 'process-gone',
      ts: '18446744073709551615',
    });
    value.identity = { startTime: null, rawBirth: null, witness: null, witnessSource: null };
    expect(projectNativeObservation(value)).toMatchObject({
      state: 'recorded',
      observation: value.observation,
      identity: value.identity,
      normalizationError: 'process-gone',
      capture: { epochMs: null, reason: 'capture-out-of-range', calibrated: false },
    });
  });
  it('preserves macOS raw microseconds/unique IDs and exact large capture integer arithmetic', () => {
    const value = capsule();
    value.platform = 'darwin';
    value.mode = 'endpoint-security';
    value.birthContext = null;
    Object.assign(value.observation, {
      birth: '1700000000000123',
      witness: { kind: 'macos-unique-id', bootSessionId: bootId, pUniqueId: '9007199254740993' },
      ts: '9007199254740999999',
    });
    value.identity = {
      startTime: 1700000000000,
      rawBirth: '1700000000000123',
      witness: bootId + ':9007199254740993',
      witnessSource: 'macosUniqueId',
    };
    value.clockAnchor = {
      clock: 'mach-continuous',
      monotonicUsec: '0',
      unixUsec: '1700000000000000',
    };
    const stored = projectNativeObservation(value);
    expect(stored.observation).toEqual(value.observation);
    expect(stored.identity).toEqual(value.identity);
    expect(stored.capture).toEqual({
      epochMs: null,
      reason: 'capture-out-of-range',
      calibrated: false,
    });
    value.observation.ts = '8000000000000000999';
    expect(projectNativeObservation(value).capture.epochMs).toBe(8000000000000000);
    expect(JSON.stringify(stored)).toContain('9007199254740993');
    expect(projectNativeObservation(stored)).toEqual(stored);
  });
  it('keeps raw Linux ticks beyond JS integer precision beside independently checked D1 milliseconds', () => {
    const value = capsule();
    value.observation.birth = '9007199254740993';
    value.observation.witness.startTicks = '9007199254740993';
    value.birthContext.clockTicks = '1000000000';
    value.identity = {
      startTime: 1709007199254,
      rawBirth: '9007199254740993',
      witness: bootId + ':9007199254740993',
      witnessSource: 'linuxStartTicks',
    };
    const result = projectNativeObservation(value);
    expect(result.identity).toEqual(value.identity);
    expect(result.observation.birth).toBe('9007199254740993');
    expect(result.observation.witness.startTicks).toBe('9007199254740993');
    expect(result.observation.seq).toBe('9007199254740993');
  });
  it.each([
    (v) => {
      v.source.generation = Number.MAX_SAFE_INTEGER + 1;
    },
    (v) => {
      v.source.ownerEpoch = '/private/canary';
    },
    (v) => {
      v.observation.seq = '01';
    },
    (v) => {
      v.observation.seq = '18446744073709551616';
    },
    (v) => {
      v.observation.pid = 0;
    },
    (v) => {
      v.observation.ppid = -1;
    },
    (v) => {
      v.observation.birth = '12346';
    },
    (v) => {
      v.identity.startTime++;
    },
    (v) => {
      v.identity.witnessSource = 'macosUniqueId';
    },
    (v) => {
      v.birthContext.bootId = '33333333-3333-4333-8333-333333333333';
    },
    (v) => {
      v.clockAnchor = { clock: 'mach-continuous', monotonicUsec: '0', unixUsec: '0' };
    },
    (v) => {
      v.capture = { epochMs: 1, reason: null, calibrated: false };
    },
    (v) => {
      v.mode = 'endpoint-security';
    },
    (v) => {
      v.observation.path = '/private/SECRET_CANARY';
    },
    (v) => {
      v.prompt = 'SECRET_CANARY';
    },
    (v) => {
      v.source = [];
    },
    (v) => {
      v.clockAnchor = {
        clock: 'boottime',
        monotonicUsec: '0',
        unixUsec: '1'.repeat(MAX_BYTES + 1),
      };
    },
  ])('drops malformed optional proof without losing the old record %#', (mutate) => {
    const input = event();
    mutate(input.details.nativeObservation);
    const record = projectRecord(input);
    expect(JSON.stringify(record)).not.toContain('SECRET_CANARY');
    expect(record.details.extra.nativeObservation).toEqual({
      version: 'native-observation/1',
      state: 'unavailable',
      reason: 'native-observation-invalid',
    });
    expect(record).toMatchObject({
      type: 'file-access',
      timestamp: 1700000000000,
      details: { action: 'open', pid: null, attribution: null },
    });
  });
  it('does not invoke optional metadata accessors, proxies or arbitrary serialization hooks', () => {
    let called = false;
    const input = event();
    Object.defineProperty(input.details, 'nativeObservation', {
      get() {
        called = true;
        throw Error('SECRET_CANARY');
      },
    });
    expect(projectRecord(input).details.extra.nativeObservation.state).toBe('unavailable');
    expect(called).toBe(false);
    for (const value of [
      {
        ...capsule(),
        platform: {
          toString() {
            called = true;
            throw Error('SECRET_CANARY');
          },
        },
      },
      new Proxy(capsule(), {
        get() {
          called = true;
          throw Error('SECRET_CANARY');
        },
      }),
      {
        ...capsule(),
        toJSON() {
          called = true;
          throw Error('SECRET_CANARY');
        },
      },
    ]) {
      expect(projectNativeObservation(value).state).toBe('unavailable');
      expect(called).toBe(false);
    }
  });
  it('keeps historical absence and strips unknown extra metadata during replay', () => {
    const input = event();
    delete input.details.nativeObservation;
    input.details.extra = { prompt: 'SECRET_CANARY' };
    const record = projectRecord(input);
    expect(record.details.extra).toEqual({});
    record.details.extra.commandLine = 'SECRET_CANARY';
    expect(replayRecord(record).details.extra).toEqual({});
    expect(projectNativeObservation(undefined)).toBeUndefined();
  });
  it('drops optional capsule at the record byte ceiling while admitting the same old event', () => {
    const input = event();
    delete input.details.nativeObservation;
    input.details.path = '中'.repeat(21000);
    const base = projectRecord(input);
    const bytes = Buffer.byteLength(JSON.stringify(base));
    input.details.path += 'x'.repeat(65530 - bytes);
    expect(Buffer.byteLength(JSON.stringify(projectRecord(input)))).toBe(65530);
    input.details.nativeObservation = capsule();
    const withMetadata = projectRecord(input);
    expect(withMetadata.details.path).toBe(input.details.path);
    expect(withMetadata.details.extra.nativeObservation).toBeUndefined();
    expect(Buffer.byteLength(JSON.stringify(withMetadata))).toBe(65530);
  });
  it('retains metadata through project/replay, real spill restart and canonical JSONL hash binding', async () => {
    const input = event();
    const projected = projectRecord(input);
    expect(projected.details.extra.nativeObservation).toMatchObject(capsule());
    expect(projected.details.extra.nativeObservation.capture).toEqual({
      epochMs: 1700000000000,
      reason: null,
      calibrated: false,
    });
    const replayed = replayRecord(projected);
    expect(replayed.deliveryId).toBe(projected.deliveryId);
    expect(replayed.details.extra.nativeObservation).toEqual(
      projected.details.extra.nativeObservation,
    );
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-custody-'));
    roots.push(root);
    const directory = path.join(root, 'spill');
    const p = createSecurityBatcher({
      directory,
      capacity: 1,
      intervalMs: 60000,
      consume: () => false,
    });
    pipelines.push(p);
    expect(p.push(input)).toBe(true);
    input.details.nativeObservation.observation.birth = 'PRIVATE_AFTER_ADMISSION';
    p.destroy();
    const spillFile = fs.readdirSync(directory).find((name) => name.endsWith('.spill'));
    const spill = fs.readFileSync(path.join(directory, spillFile), 'utf8');
    expect(spill).not.toContain('PRIVATE_AFTER_ADMISSION');
    expect(spill).toContain('9007199254740993');
    let storedId;
    audit.init({ userDataPath: root });
    await audit._awaitIndexForTest();
    const restarted = createSecurityBatcher({
      directory,
      intervalMs: 60000,
      consume: (records) => {
        storedId = records[0].deliveryId;
        return audit.persistBatch(records);
      },
    });
    pipelines.push(restarted);
    const file = fs.readdirSync(audit.getLogDir()).find((name) => name.endsWith('.json'));
    const journal = path.join(audit.getLogDir(), file);
    const raw = fs.readFileSync(journal, 'utf8');
    const entry = JSON.parse(raw.trim());
    expect(spill).toContain(storedId);
    expect(entry.details.deliveryId).toBe(storedId);
    expect(entry.details.replayed).toBe(true);
    expect(entry.details.nativeObservation).toEqual(projected.details.extra.nativeObservation);
    expect(entry).toMatchObject({ agent: '', pid: null, instanceId: null, attribution: null });
    expect(restarted.getStats().spill.records).toBe(0);
    expect(audit.verifyChain(journal).valid).toBe(true);
    entry.details.nativeObservation.observation.birth = '12346';
    fs.writeFileSync(journal, JSON.stringify(entry) + '\n');
    expect(audit.verifyChain(journal)).toMatchObject({ valid: false, brokenAtSeq: 0 });
  });
});
