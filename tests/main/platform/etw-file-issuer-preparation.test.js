import { afterEach, describe, expect, it, vi } from 'vitest';
import preparation from '../../../src/main/platform/etw-file-issuer-preparation.js';
import protocol from '../../../src/main/platform/etw-file-protocol.js';
import health from '../../../src/main/platform/etw-file-health.js';
import { createHarness } from '../../fixtures/etw-supervisor-harness.js';
import { message } from './etw-file-fixtures.js';

const birth = '134333333333333337';
const agent = {
  pid: 71,
  category: 'ai',
  createTime100ns: birth,
  instanceId: '71:1788859733333',
  instanceIdSource: 'os',
};
const target = { pid: 71, createTime100ns: birth };
const reliable = { populationReliable: true, identityDegraded: false };
const receipt = (requestId = 'prime1', prepared = [{ ...target, threads: 2 }]) => ({
  requestId,
  prepared,
  asOfQpc: '100',
});
const sensors = [];
afterEach(() => {
  for (const sensor of sensors.splice(0)) sensor.dispose();
  vi.useRealTimers();
});

describe('read-only issuer preparation', () => {
  it('requires reliable exact OS identities, excludes ambiguous PIDs and prioritizes new AI processes', () => {
    const select = preparation.selectIssuerTargets;
    expect(select([agent], reliable)).toEqual([target]);
    for (const health of [
      {},
      { populationReliable: false },
      { ...reliable, identityDegraded: true },
    ])
      expect(select([agent], health)).toEqual([]);
    for (const patch of [
      { category: 'other' },
      { pid: 0 },
      { createTime100ns: '01' },
      { instanceId: '71:1' },
      { instanceIdSource: 'estimated' },
    ])
      expect(select([{ ...agent, ...patch }], reliable)).toEqual([]);
    expect(select([agent, agent], reliable)).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => ({
      ...agent,
      pid: i + 1,
      createTime100ns: (BigInt(birth) + BigInt(i) * 10000n).toString(),
      instanceId: `${i + 1}:${1788859733333 + i}`,
    }));
    expect(select(many, reliable)).toHaveLength(16);
    expect(select(many, reliable)[0].pid).toBe(20);
  });
  it('bounds requests and receipts and rejects extra data, duplicates and mismatched directions', () => {
    const request = (data) => ({ ...message('ping'), t: 'prime-issuers', data });
    expect(
      protocol.validateMessage(request({ requestId: 'prime1', issuers: [target] })),
    ).toBeTruthy();
    for (const issuers of [
      [target, target],
      [{ ...target, path: 'PRIVATE' }],
      [{ ...target, pid: 0 }],
      [{ ...target, createTime100ns: '00' }],
      Array(17).fill(target),
    ])
      expect(() => protocol.validateMessage(request({ requestId: 'prime1', issuers }))).toThrow();
    const ack = (data) => ({ ...message('heartbeat'), t: 'issuers-primed', data });
    expect(protocol.validateMessage(ack(receipt()))).toBeTruthy();
    const state = health.createSession('launch-1', 'session-1');
    expect(() =>
      health.reduceSession(state, request({ requestId: 'prime1', issuers: [] }), 0),
    ).toThrow('wrong-direction');
    expect(() => health.reduceSession(state, ack(receipt()), 0)).toThrow('hello-required');
    for (const prepared of [
      [{ ...target, threads: 0 }],
      [{ ...target, threads: 129 }],
      [{ ...target, threads: 2, content: 'PRIVATE' }],
      [
        { ...target, threads: 65 },
        { pid: 72, createTime100ns: birth, threads: 65 },
      ],
    ])
      expect(() => protocol.validateMessage(ack(receipt('prime1', prepared)))).toThrow();
  });
  it('correlates acknowledgements, refreshes before native expiry and withdraws changed scopes', () => {
    let time = 0,
      targets = [target],
      next = 0;
    const send = vi.fn(() => true);
    const owner = preparation.createIssuerPreparation({
      getTargets: () => targets,
      mono: () => time,
      id: () => `prime${++next}`,
      send,
    });
    owner.flush();
    owner.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(() => owner.accept(receipt('wrong'))).toThrow();
    expect(() =>
      owner.accept(receipt('prime1', [{ pid: 72, createTime100ns: birth, threads: 1 }])),
    ).toThrow();
    owner.accept(receipt());
    const snapshot = owner.snapshot();
    snapshot.prepared[0].threads = 100;
    expect(owner.snapshot().prepared[0].threads).toBe(2);
    time = 20000;
    owner.flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(owner.snapshot()).toBeNull();
    owner.accept(receipt('prime2'));
    targets = [];
    expect(owner.snapshot()).toBeNull();
    owner.flush();
    expect(send.mock.calls.at(-1)[1].issuers).toEqual([]);
    owner.reset();
    expect(owner.snapshot()).toBeNull();
  });
  it('retries busy writes and fails bounded missing acknowledgements', () => {
    let time = 0;
    const send = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const owner = preparation.createIssuerPreparation({
      getTargets: () => [target],
      mono: () => time,
      id: () => 'prime1',
      send,
    });
    owner.flush();
    owner.flush();
    expect(send).toHaveBeenCalledTimes(2);
    time = 5001;
    expect(() => owner.flush()).toThrow('preparation-timeout');
  });
  it('delivers the first scope after ready, coalesces writes and gives stop priority', () => {
    let targets = [target];
    const h = createHarness({ getIssuerTargets: () => targets }, (sensor) => sensors.push(sensor));
    const child = h.running();
    expect(child.writes.at(-1).t).toBe('prime-issuers');
    const requestId = child.writes.at(-1).data.requestId;
    child.flush();
    child.message('issuers-primed', 3, receipt(requestId));
    expect(h.sensor.getDiagnostics().issuerPreparation.prepared).toHaveLength(1);
    targets = [];
    h.sensor.refreshIssuers();
    expect(child.writes.at(-1).data.issuers).toEqual([]);
    h.sensor.stop();
    child.flush();
    expect(child.writes.at(-1).t).toBe('stop');
    expect(h.sensor.getDiagnostics().issuerPreparation).toBeNull();
  });
  it('closes the owned transport when preparation times out and sends no later ping', () => {
    const h = createHarness({ getIssuerTargets: () => [target] }, (sensor) => sensors.push(sensor));
    const child = h.running();
    child.flush();
    const count = child.writes.length;
    h.advance(6001);
    expect(h.sensor.getDiagnostics().phase).toBe('failed');
    expect(child.stdin.destroy).toHaveBeenCalled();
    expect(child.writes).toHaveLength(count);
    expect(h.sensor.getDiagnostics().issuerPreparation).toBeNull();
  });
});
