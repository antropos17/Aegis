import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHarness } from '../../fixtures/etw-supervisor-harness.js';
import { message } from './etw-file-fixtures.js';
import custody from '../../../src/main/platform/etw-file-custody.js';

const sensors = [];
afterEach(() => {
  for (const sensor of sensors.splice(0)) sensor.dispose();
  vi.useRealTimers();
});
const GUID = 'a147b8e58a6f4b6fb82ee699aa3c149e';
function lease(child) {
  return {
    guid: GUID,
    ownerPid: process.pid,
    ownerBirth: '134000000000000123',
    peers: [0, 1, 2, 3].map((i) => ({
      pid: child.pid + i,
      birth: String(134000000000000200n + BigInt(i)),
      handle: String(701111 + i),
    })),
  };
}
function setup() {
  let h;
  const rescue = vi.fn((launch, session) => h.spawnBroker(launch, session));
  h = createHarness({ spawnRecovery: rescue }, (sensor) => sensors.push(sensor));
  return { ...h, rescue };
}
function begin(h, deferredAck = false) {
  h.sensor.start();
  const c = h.children[0];
  c.message('escrow', 0, lease(c));
  if (!deferredAck) c.flush();
  c.message('hello', 1);
  c.flush();
  const ready = message('ready').data;
  ready.requestId = c.writes.find((m) => m.t === 'start').data.requestId;
  c.message('ready', 2, ready);
  return c;
}
function recovered(code = 75, denied = false) {
  return {
    ...message('recovered').data,
    cause: 'broker-and-all-helpers-exited',
    brokerExit: code,
    peers: {
      guardExit: 71,
      fallbackExit: 74,
      brokerElevated: false,
      cleanupElevated: denied,
      accessDenied: denied,
    },
  };
}
function assertPrivate(h) {
  const text = JSON.stringify(h.sensor.getDiagnostics());
  expect(text).not.toContain(GUID);
  expect(text).not.toContain('134000000000000123');
  for (let i = 0; i < 4; i++) expect(text).not.toContain(String(701111 + i));
}

describe('main-held ETW group custody', () => {
  it('retains only copied original native IDs for closure observation and clears them on retry', () => {
    const h = setup(),
      old = begin(h);
    const ids = lease(old).peers.map((p) => p.pid);
    expect(h.sensor.getDiagnostics().nativeProcessIds).toEqual(ids);
    h.sensor.getDiagnostics().nativeProcessIds.push(999999);
    expect(h.sensor.getDiagnostics().nativeProcessIds).toEqual(ids);
    assertPrivate(h);
    old.message('recovered', 3);
    old.emit('close', 4);
    expect(h.sensor.getDiagnostics().nativeProcessIds).toEqual(ids);
    h.sensor.restart();
    expect(h.sensor.getDiagnostics().nativeProcessIds).toEqual([]);
  });
  it('continues cleanup after the original broker and helper transport are lost, without capture retry', () => {
    const h = setup(),
      old = begin(h);
    assertPrivate(h);
    old.stdout.emit('end');
    old.emit('close', 75);
    expect(h.rescue).toHaveBeenCalledOnce();
    const next = h.children[1];
    expect(next.writes[0]).toMatchObject({
      t: 'rescue',
      data: { lease: lease(old), lastSeq: '2' },
    });
    expect(h.sensor.getDiagnostics()).toMatchObject({
      recoveryPending: true,
      restartBlocked: true,
      summaries: [],
    });
    expect(h.sensor.getHealth().state).toBe('FAILED');
    expect(h.sensor.restart()).toBe(false);
    next.flush();
    next.message('recovered', 3, recovered());
    expect(h.sensor.getDiagnostics().restartBlocked).toBe(true);
    next.emit('close', 4);
    expect(h.sensor.getDiagnostics()).toMatchObject({
      restartBlocked: false,
      recoveryPending: false,
      summaries: [
        {
          brokerExit: 75,
          exitCode: 4,
          recoveryVerified: true,
          finalTotals: null,
          observationGap: true,
        },
      ],
    });
    expect(h.rescue).toHaveBeenCalledOnce();
    expect(h.children).toHaveLength(2);
    assertPrivate(h);
  });
  it('waits for a pending escrow ACK write before sending start', () => {
    const h = setup();
    begin(h, true);
    expect(h.children[0].writes.map((m) => m.t)).toEqual(['escrow-ack', 'start']);
    expect(h.sensor.getHealth().state).toBe('DEGRADED');
  });
  it('permits cleanup before hello only through the privately authorized replacement', () => {
    const h = setup();
    h.sensor.start();
    const old = h.children[0];
    old.message('escrow', 0, lease(old));
    old.flush();
    old.emit('close', 2);
    const next = h.children[1];
    next.flush();
    next.message('recovered', 1, recovered(2));
    next.emit('close', 4);
    expect(h.sensor.getDiagnostics().summaries[0]).toMatchObject({
      capture: null,
      brokerExit: 2,
      recoveryVerified: true,
    });
    assertPrivate(h);
  });
  it.each(['owner', 'broker', 'duplicate', 'late'])(
    'rejects %s custody without adopting a replacement tuple',
    (kind) => {
      const h = setup();
      h.sensor.start();
      const c = h.children[0],
        value = lease(c);
      if (kind === 'owner') value.ownerPid++;
      if (kind === 'broker') value.peers[0].pid += 1000;
      if (kind === 'duplicate') {
        c.message('escrow', 0, value);
        c.flush();
      }
      if (kind === 'late') {
        c.message('hello', 1);
        c.flush();
      }
      c.message('escrow', 0, value);
      expect(h.sensor.getHealth().state).toBe('FAILED');
      expect(c.writes.filter((m) => m.t === 'escrow-ack')).toHaveLength(
        kind === 'duplicate' ? 1 : 0,
      );
      assertPrivate(h);
    },
  );
  it.each([0, 2])(
    'keeps retry blocked on replacement exit %s despite a terminal receipt',
    (code) => {
      const h = setup(),
        old = begin(h);
      old.emit('close', 75);
      const next = h.children[1];
      next.flush();
      next.message('recovered', 3, recovered());
      next.emit('close', code);
      expect(h.sensor.getDiagnostics()).toMatchObject({
        restartBlocked: true,
        summaries: [{ recoveryVerified: false, finalTotals: null }],
      });
      expect(h.rescue).toHaveBeenCalledOnce();
      assertPrivate(h);
    },
  );
  it('rejects a receipt for a different original broker exit and never retries the cleanup controller', () => {
    const h = setup(),
      old = begin(h);
    old.emit('close', 75);
    const next = h.children[1];
    next.flush();
    next.message('recovered', 3, recovered(72));
    next.emit('close', 4);
    expect(h.sensor.getDiagnostics().restartBlocked).toBe(true);
    expect(h.rescue).toHaveBeenCalledOnce();
    assertPrivate(h);
  });
  it('normalizes a Windows unsigned high-bit original exit to its native signed int32 representation', () => {
    const h = setup(),
      old = begin(h);
    old.emit('close', 0xc0000005);
    const next = h.children[1];
    next.flush();
    next.message('recovered', 3, recovered(-1073741819));
    next.emit('close', 4);
    expect(h.sensor.getDiagnostics()).toMatchObject({
      restartBlocked: false,
      summaries: [{ brokerExit: -1073741819, recoveryVerified: true }],
    });
  });
  it('never starts a second cleanup controller after the original controller requested consent', () => {
    const h = setup(),
      old = begin(h);
    old.message('recovering', 3);
    old.flush();
    expect(old.writes.filter((m) => m.t === 'consent-ack')).toHaveLength(1);
    old.emit('close', 2);
    expect(h.rescue).not.toHaveBeenCalled();
    expect(h.sensor.getDiagnostics()).toMatchObject({
      restartBlocked: true,
      summaries: [{ recoveryVerified: false, finalCounters: null, finalTotals: null }],
    });
    expect(h.sensor.restart()).toBe(false);
    assertPrivate(h);
  });
  it('does not grant pending consent after the decoder has rejected a duplicate frame', () => {
    const h = setup(),
      old = begin(h);
    h.advance(2000); // Keep a ping write callback pending.
    old.message('recovering', 3);
    old.message('recovering', 4);
    old.flush();
    expect(old.writes.filter((m) => m.t === 'consent-ack')).toHaveLength(0);
    old.emit('close', 2);
    expect(h.rescue).not.toHaveBeenCalled();
    expect(h.sensor.getDiagnostics().restartBlocked).toBe(true);
  });
  it('preserves the bounded cleanup-consent interval without extending it on duplicate pending frames', () => {
    const h = setup(),
      old = begin(h);
    old.emit('close', 75);
    const next = h.children[1];
    next.flush();
    const pending = { ...message('recovering').data, cause: 'broker-and-all-helpers-exited' };
    next.message('recovering', 3, pending);
    h.advance(120000);
    expect(next.kill).not.toHaveBeenCalled();
    next.message('recovering', 4, pending);
    h.advance(25001);
    expect(next.kill).toHaveBeenCalledOnce();
    assertPrivate(h);
  });
  it('accepts consented group cleanup without making failed stage totals known', () => {
    const h = setup(),
      old = begin(h);
    old.emit('close', 75);
    const next = h.children[1];
    next.flush();
    next.message('recovering', 3, {
      ...message('recovering').data,
      cause: 'broker-and-all-helpers-exited',
    });
    expect(h.sensor.getDiagnostics().cleanupConsentPending).toBe(true);
    next.flush();
    expect(next.writes.filter((m) => m.t === 'consent-ack')).toHaveLength(1);
    h.advance(120000);
    next.message('recovered', 4, recovered(75, true));
    expect(h.sensor.getDiagnostics().cleanupConsentPending).toBe(false);
    next.emit('close', 4);
    expect(h.sensor.getDiagnostics()).toMatchObject({
      restartBlocked: false,
      summaries: [{ recoveryVerified: true, finalTotals: null, observationGap: true }],
    });
    assertPrivate(h);
  });
  it('requires distinct canonical references to exactly four original process objects', () => {
    const original = lease({ pid: process.pid + 100 });
    expect(custody.validMainLease(original)).toBe(true);
    const invalid = [
      { ...original, guid: '0'.repeat(32) },
      { ...original, peers: original.peers.slice(0, 3) },
      { ...original, peers: original.peers.map((p) => ({ ...p, handle: '0' })) },
      { ...original, peers: original.peers.map((p) => ({ ...p, birth: '01' })) },
      { ...original, extra: true },
    ];
    for (const value of invalid) expect(custody.validMainLease(value)).toBe(false);
  });
});
