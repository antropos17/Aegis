import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { fixture, ready, hello, event, batch, context } from './sensor-host-fixtures.js';
const require = createRequire(import.meta.url);
const { createSession } = require('../../src/main/platform/sensor-host-session');

const hosts = [];
const start = (options = {}) => {
  const f = fixture(options);
  hosts.push(f);
  const child = f.start();
  return { ...f, child };
};
afterEach(async () => {
  for (const f of hosts.splice(0)) {
    const done = f.api.dispose();
    const child = f.children.at(-1);
    if (child && !child.closed) {
      if (child.messages.at(-1)?.t === 'stop') child.ack();
      child.close(0);
    }
    await done;
  }
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('sensor host observation metadata forwarding', () => {
  it('forwards the actual session BASE_EVENT, pinned D1 and hello anchor as closed detached metadata', () => {
    const f = start();
    ready(f.child);
    f.child.send(batch(event()));
    const envelope = f.sink.mock.calls[0][0];
    expect(envelope.nativeObservation).toMatchObject({
      version: 'native-observation/1',
      state: 'recorded',
      source: { ownerEpoch: expect.stringMatching(/^[a-f0-9-]{36}$/), generation: 1 },
      platform: 'linux',
      mode: 'ebpf',
      birthContext: context,
      clockAnchor: hello().versions.clockAnchor,
      identity: envelope.identity,
      normalizationError: null,
      capture: { epochMs: 1700000000000, reason: null, calibrated: false },
    });
    expect(envelope.nativeObservation.observation).toEqual({
      seq: '1',
      kind: 'open',
      pid: 73,
      ppid: 1,
      birth: '12345',
      witness: event().witness,
      identityError: null,
      ts: '1700000000000001',
    });
    expect(envelope.event).toEqual(event());
    expect(JSON.stringify(envelope.nativeObservation)).not.toContain('/private/fixture');
  });
  it('keeps the owner epoch across child restarts and separates new owners', () => {
    vi.useFakeTimers();
    const f = start();
    ready(f.child);
    f.child.send(batch(event()));
    const first = f.sink.mock.calls[0][0].nativeObservation;
    f.child.close();
    vi.advanceTimersByTime(600);
    const second = f.children[1];
    ready(second);
    second.send(batch(event()));
    const restarted = f.sink.mock.calls[1][0].nativeObservation;
    expect(restarted.source.ownerEpoch).toBe(first.source.ownerEpoch);
    expect(restarted.source.generation).toBe(2);
    expect(restarted.observation.seq).toBe('1');
    const g = start();
    ready(g.child);
    g.child.send(batch(event()));
    const other = g.sink.mock.calls[0][0].nativeObservation;
    expect(other.source.ownerEpoch).not.toBe(first.source.ownerEpoch);
    expect(other.source.generation).toBe(1);
  });
  it('pins decoded session context and anchor before external or prior sink metadata mutations', () => {
    const supplied = structuredClone(context);
    const announcement = hello();
    const originalAnchor = structuredClone(announcement.versions.clockAnchor);
    const sink = vi.fn(() => true);
    const session = createSession({
      ownerEpoch: '22222222-2222-4222-8222-222222222222',
      platform: 'linux',
      pid: 42,
      generation: 3,
      linuxContext: supplied,
      sink,
      onHello() {},
      onHealth() {},
      onLoss() {},
      reply: () => true,
      active: () => true,
    });
    session.accept(announcement);
    supplied.clockTicks = '1';
    announcement.versions.clockAnchor.unixUsec = '1';
    session.accept(batch(event()));
    const first = sink.mock.calls[0][0];
    expect(first.identity.startTime).toBe(1700000123450);
    expect(first.nativeObservation.birthContext).toEqual(context);
    expect(first.nativeObservation.clockAnchor).toEqual(originalAnchor);
    first.nativeObservation.birthContext.clockTicks = '2';
    first.nativeObservation.clockAnchor.unixUsec = '2';
    first.event.witness.startTicks = '999';
    expect(first.nativeObservation.observation.witness.startTicks).toBe('12345');
    session.accept({
      t: 'mode',
      mode: 'procfs',
      caps: { ...announcement.caps, identity: 'procfs-ticks' },
      reason: 'requested',
      seq: '2',
    });
    session.accept(batch(event('2')));
    expect(sink.mock.calls[1][0].nativeObservation).toMatchObject({
      mode: 'procfs',
      birthContext: context,
      clockAnchor: originalAnchor,
      identity: { startTime: 1700000123450 },
      source: { generation: 3 },
    });
  });
  it('preserves actual u64 sequence, birth and capture strings beyond Number precision', () => {
    const pinned = { ...context, clockTicks: '1000000000' };
    const f = start({ getLinuxContext: () => pinned });
    ready(f.child);
    f.child.send({
      t: 'loss',
      from: '1',
      to: '9007199254740992',
      count: '9007199254740992',
      reason: 'queue-full',
    });
    f.child.send(
      batch(
        event('9007199254740993', {
          birth: '9007199254740993',
          witness: {
            kind: 'linux-start-ticks',
            bootId: context.bootId,
            startTicks: '9007199254740993',
          },
          ts: '8000000000000000999',
        }),
      ),
    );
    const native = f.sink.mock.calls[0][0].nativeObservation;
    expect(native.observation.seq).toBe('9007199254740993');
    expect(native.observation.birth).toBe('9007199254740993');
    expect(native.observation.ts).toBe('8000000000000000999');
    expect(native.identity).toMatchObject({
      startTime: 1709007199254,
      rawBirth: '9007199254740993',
    });
    expect(native.capture).toEqual({ epochMs: 8000000000000000, reason: null, calibrated: false });
    expect(f.api.getHealth().state).toBe('DEGRADED');
  });
  it('keeps unavailable exit identity and excludes operation paths and executable metadata', () => {
    const f = start();
    ready(f.child);
    f.child.send(batch(event('1', { path: '/private/SECRET_PATH' })));
    const base = {
      seq: '2',
      kind: 'exec',
      pid: 73,
      ppid: 1,
      birth: '12345',
      witness: event().witness,
      identityError: null,
      ts: '1700000000000002',
    };
    f.child.send(batch({ ...base, exe: '/private/SECRET_EXEC', argc: 2 }));
    f.child.send(
      batch({
        ...base,
        seq: '3',
        kind: 'exit',
        birth: null,
        witness: null,
        identityError: 'process-gone',
      }),
    );
    const metadata = f.sink.mock.calls.map(([row]) => row.nativeObservation);
    expect(metadata.every((value) => value.state === 'recorded')).toBe(true);
    expect(JSON.stringify(metadata)).not.toMatch(/SECRET_PATH|SECRET_EXEC|"argc"|"exe"|"path"/);
    expect(metadata[2]).toMatchObject({
      observation: { birth: null, witness: null, identityError: 'process-gone' },
      identity: { startTime: null, rawBirth: null, witness: null, witnessSource: null },
      normalizationError: 'process-gone',
    });
  });
  it('keeps mandatory hello anchor validation and original full-batch D1 preflight', () => {
    const missing = start();
    const announcement = hello(missing.child.pid);
    delete announcement.versions.clockAnchor;
    missing.child.raw(announcement);
    expect(missing.sink).not.toHaveBeenCalled();
    expect(missing.api.getHealth().state).toBe('FAILED');
    const f = start();
    ready(f.child);
    f.child.send(
      batch(
        event(),
        event('2', {
          witness: {
            kind: 'linux-start-ticks',
            bootId: '22222222-2222-4222-8222-222222222222',
            startTicks: '12345',
          },
        }),
      ),
    );
    expect(f.sink).not.toHaveBeenCalled();
    expect(f.api.getStatus().reason).toBe('session-invalid');
  });
  it('preserves legacy exact-true acknowledgement and counts the rejected suffix', () => {
    const sink = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(1);
    const f = start({ sink });
    ready(f.child);
    f.child.send(batch(event(), event('2'), event('3')));
    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink.mock.calls.map(([row]) => row.event.seq)).toEqual(['1', '2']);
    expect(sink.mock.calls.map(([row]) => row.nativeObservation.observation.seq)).toEqual([
      '1',
      '2',
    ]);
    expect(f.api.getHealth()).toMatchObject({ state: 'FAILED', lossCount: 2 });
    expect(f.api.getStatus().reason).toBe('sink-rejected');
  });
});
