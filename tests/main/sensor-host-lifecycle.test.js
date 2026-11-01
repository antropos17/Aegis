import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import {
  fixture,
  ready,
  hello,
  event,
  batch,
  identity,
  fakeChild,
} from './sensor-host-fixtures.js';
import transport from '../../src/main/platform/sensor-host-transport.js';
const hostWire = createRequire(import.meta.url)('../../src/main/platform/sensor-protocol.js');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1700000000000);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('sensor host cancellation, correlation and finite counters', () => {
  it('does not send an unsupported paths replacement to the procfs snapshot provider', () => {
    const f = fixture();
    f.api.updatePaths(['/fixture/private']);
    const child = f.start();
    const announcement = hello(child.pid);
    child.send({
      ...announcement,
      mode: 'procfs',
      modes: ['procfs'],
      caps: {
        ...announcement.caps,
        exec: false,
        exit: false,
        fork: false,
        fileOpen: false,
        tcpConnect: false,
        identity: 'procfs-ticks',
      },
    });
    child.ack();
    expect(child.messages.map((message) => message.t)).toEqual(['watch']);
    expect(f.api.getStatus().updates.pathsPending).toBe(true);
  });

  it('requests a startup snapshot before a procfs provider reports healthy', () => {
    const f = fixture();
    const child = f.start();
    const announcement = hello(child.pid);
    child.send({
      ...announcement,
      mode: 'procfs',
      modes: ['procfs'],
      caps: {
        ...announcement.caps,
        exec: false,
        exit: false,
        fork: false,
        fileOpen: false,
        tcpConnect: false,
        identity: 'procfs-ticks',
      },
    });
    child.ack();
    // Existing hosts may have queued a paths request; acknowledge it only to
    // isolate the independent startup snapshot requirement in this case.
    if (child.messages.at(-1).t === 'paths') child.ack();
    child.send({ t: 'health', state: 'STARTING', detail: 'starting' });
    vi.advanceTimersByTime(2100);
    expect(child.messages.at(-1).t).toBe('snap');
    child.send({ t: 'snap', id: child.messages.at(-1).id, procs: [] });
    child.send({ t: 'health', state: 'HEALTHY', detail: 'ready' });
    expect(f.api.getStatus()).toMatchObject({ mode: 'procfs', phase: 'running' });
    expect(Object.values(f.api.getStatus().coverage)).toEqual(Array(5).fill('coverage-lost'));
  });

  it('retains paths until an announced event mode can accept them', () => {
    const f = fixture();
    f.api.updatePaths(['/fixture/private']);
    const child = f.start();
    const announcement = hello(child.pid);
    const procfsCaps = {
      ...announcement.caps,
      exec: false,
      exit: false,
      fork: false,
      fileOpen: false,
      tcpConnect: false,
      identity: 'procfs-ticks',
    };
    child.send({ ...announcement, mode: 'procfs', caps: procfsCaps });
    child.ack();
    expect(f.api.getStatus().updates.pathsPending).toBe(true);
    child.send({
      t: 'mode',
      mode: 'ebpf',
      caps: announcement.caps,
      reason: 'recovery',
      seq: '1',
    });
    expect(child.messages.at(-1)).toMatchObject({ t: 'paths', prefixes: ['/fixture/private'] });
    child.ack();
    expect(f.api.getStatus().updates.pathsPending).toBe(false);
  });

  it('replays a path request when the mode changes away and back before its acknowledgement', () => {
    const f = fixture();
    f.api.updatePaths(['/fixture/private']);
    const child = f.start();
    const announcement = hello(child.pid);
    child.send(announcement);
    child.ack();
    const first = child.messages.at(-1);
    expect(first.t).toBe('paths');
    child.send({
      t: 'mode',
      mode: 'procfs',
      caps: {
        ...announcement.caps,
        exec: false,
        exit: false,
        fork: false,
        fileOpen: false,
        tcpConnect: false,
        identity: 'procfs-ticks',
      },
      reason: 'permission-denied',
      seq: '1',
    });
    child.send({
      t: 'mode',
      mode: 'ebpf',
      caps: announcement.caps,
      reason: 'recovery',
      seq: '1',
    });
    child.send({ t: 'ack', id: first.id });
    expect(child.messages.at(-1)).toMatchObject({ t: 'paths', prefixes: ['/fixture/private'] });
    expect(child.messages.at(-1).id).not.toBe(first.id);
    expect(f.api.getStatus().updates.pathsPending).toBe(true);
    child.ack();
    expect(f.api.getStatus().updates.pathsPending).toBe(false);
  });

  it('ignores a path error for the previous mode after a procfs fallback', () => {
    const f = fixture();
    const child = f.start();
    const announcement = hello(child.pid);
    child.send(announcement);
    child.ack();
    const oldRequest = child.messages.at(-1);
    child.send({
      t: 'mode',
      mode: 'procfs',
      caps: {
        ...announcement.caps,
        exec: false,
        exit: false,
        fork: false,
        fileOpen: false,
        tcpConnect: false,
        identity: 'procfs-ticks',
      },
      reason: 'permission-denied',
      seq: '1',
    });
    child.send({ t: 'err', id: oldRequest.id, code: 'unsupported' });
    expect(f.api.getStatus()).toMatchObject({ mode: 'procfs', updates: { pathsPending: true } });
    expect(f.api.getStatus().reason).not.toBe('update-rejected');
    vi.advanceTimersByTime(2100);
    expect(child.messages.at(-1).t).toBe('snap');
  });

  it('replays an in-flight path request after a same-mode recovery announcement', () => {
    const f = fixture();
    const child = f.start();
    const announcement = hello(child.pid);
    child.send(announcement);
    child.ack();
    const first = child.messages.at(-1);
    child.send({ t: 'mode', mode: 'ebpf', caps: announcement.caps, reason: 'recovery', seq: '1' });
    child.send({ t: 'ack', id: first.id });
    expect(child.messages.at(-1)).toMatchObject({ t: 'paths' });
    expect(child.messages.at(-1).id).not.toBe(first.id);
    expect(f.api.getStatus().updates.pathsPending).toBe(true);
  });

  it('contains timer-driven encoding failures in a fixed failure state', () => {
    const f = fixture();
    const child = f.start();
    ready(child);
    const encode = vi.spyOn(hostWire, 'encodeFrame').mockImplementation(() => {
      throw new Error('sensitive encoder failure');
    });
    try {
      expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
      expect(f.api.getHealth()).toMatchObject({
        state: 'FAILED',
        lastError: 'request-encoding-failed',
      });
      expect(f.api.getStatus()).toMatchObject({
        phase: 'closing',
        reason: 'request-encoding-failed',
      });
      expect(JSON.stringify(f.api.getStatus())).not.toContain('sensitive');
      expect(child.messages).toHaveLength(2);
    } finally {
      encode.mockRestore();
    }
  });

  it('contains direct transport encoding rejection before writing or installing a pending request', () => {
    const child = fakeChild();
    const fault = vi.fn();
    const sender = transport.createTransport({
      child,
      current: () => true,
      accept: vi.fn(),
      fault,
      progress: vi.fn(),
      mono: () => Date.now(),
      timeoutMs: 5000,
    });
    let sent;
    expect(() => {
      sent = sender.send({ t: 'paths', id: 1, prefixes: ['/duplicate', '/duplicate'] }, vi.fn());
    }).not.toThrow();
    expect(sent).toBe(false);
    expect(fault).toHaveBeenCalledExactlyOnceWith('request-encoding-failed');
    expect(child.stdin.write).not.toHaveBeenCalled();
    expect(sender.ready()).toBe(true);
    expect(sender.send({ t: 'paths', id: 2, prefixes: ['/valid'] }, vi.fn())).toBe(true);
    sender.cancel();
  });

  it.each(['pid', 'stdin', 'stdout', 'stderr'])(
    'returns false when spawn returns an owned child without valid %s',
    (missing) => {
      const child = fakeChild();
      delete child[missing];
      const spawn = vi.fn(() => child);
      const f = fixture({ _test: { spawn, exists: () => true } });
      expect(f.api.start()).toBe(false);
      expect(spawn).toHaveBeenCalledOnce();
      expect(f.api.getHealth()).toMatchObject({ state: 'FAILED', lastError: 'launch-failed' });
      expect(f.api.getStatus()).toMatchObject({
        phase: 'closing',
        reason: 'launch-failed',
        polling: 'unchanged',
      });
      expect(f.api.start()).toBe(false);
      child.close();
    },
  );
  it('keeps quiet healthy operation alive through correlated snapshot responses', () => {
    const f = fixture();
    const child = f.start();
    ready(child);
    for (let index = 0; index < 8; index++) {
      vi.advanceTimersByTime(2100);
      expect(child.messages.at(-1).t).toBe('snap');
      child.send({ t: 'snap', id: child.messages.at(-1).id, procs: [] });
      expect(f.api.getHealth().state).toBe('HEALTHY');
    }
    expect(f.spawn).toHaveBeenCalledTimes(1);
  });

  it('drains a pending snapshot response during stop without calling its cancelled consumer', async () => {
    const f = fixture();
    const child = f.start();
    ready(child);
    const consumer = vi.fn();
    f.api.requestSnapshot(consumer);
    const id = child.messages.at(-1).id;
    const completion = f.api.stop();
    child.send({ t: 'snap', id, procs: [] });
    expect(consumer).not.toHaveBeenCalled();
    expect(child.messages.at(-1).t).toBe('stop');
    child.ack();
    child.close(0);
    expect(await completion).toBe(true);
    expect(f.api.getHealth().state).toBe('DISABLED');
  });

  it('cancels an admitted batch immediately when its sink synchronously stops the host', () => {
    let f;
    const sink = vi.fn(() => {
      f.api.stop();
      return true;
    });
    f = fixture({ sink });
    const child = f.start();
    ready(child);
    child.send(batch(event(), event('2')));
    expect(sink).toHaveBeenCalledTimes(1);
    expect(f.api.getHealth().state).toBe('DISABLED');
    expect(f.api.getStatus().lossCount).toBe(0);
  });

  it('does not restart after unconfirmed custody even when close arrives later', () => {
    const f = fixture();
    const child = f.start();
    vi.advanceTimersByTime(7000);
    expect(f.api.getStatus().reason).toBe('custody-unconfirmed');
    child.close();
    vi.advanceTimersByTime(10000);
    expect(f.spawn).toHaveBeenCalledTimes(1);
    expect(f.api.getStatus()).toMatchObject({ phase: 'failed', reason: 'custody-unconfirmed' });
  });

  it('stops during automatic backoff without leaving a waiting state or restart timer', async () => {
    const f = fixture();
    const child = f.start();
    child.close();
    expect(f.api.getStatus().phase).toBe('waiting');
    expect(await f.api.stop()).toBe(true);
    vi.advanceTimersByTime(10000);
    expect(f.spawn).toHaveBeenCalledTimes(1);
    expect(f.api.getStatus()).toMatchObject({ phase: 'stopped', reason: 'disabled' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('requires kill-close evidence and resolves false for an unresponsive stop', async () => {
    const f = fixture();
    const child = f.start();
    ready(child);
    const completion = f.api.stop();
    vi.advanceTimersByTime(2000);
    expect(await completion).toBe(false);
    expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
    expect(f.api.getHealth()).toMatchObject({ state: 'FAILED', lastError: 'custody-unconfirmed' });
    expect(f.api.start()).toBe(false);
  });

  it('does not replace root generations or expose watch metadata before an acknowledged replacement', () => {
    const f = fixture();
    const child = f.start();
    ready(child);
    expect(f.api.updateWatch([{ pid: 73, ...identity }])).toBe(true);
    expect(f.api.getStatus().updates.watchPending).toBe(true);
    child.send({ t: 'err', id: child.messages.at(-1).id, code: 'root-mismatch' });
    expect(f.api.getHealth().state).toBe('FAILED');
    expect(f.api.getStatus().reason).toBe('update-rejected');
    expect(JSON.stringify(f.api.getStatus())).not.toContain(identity.witness.bootId);
    expect(f.api.getStatus().coverage.fileOpen).toBe('coverage-lost');
  });

  it('preflights snapshot identity and matches the request kind before calling a consumer', () => {
    const f = fixture();
    const child = f.start();
    ready(child);
    const consumer = vi.fn();
    f.api.requestSnapshot(consumer);
    child.send({ t: 'ack', id: child.messages.at(-1).id });
    expect(consumer).not.toHaveBeenCalled();
    expect(f.api.getHealth().state).toBe('FAILED');
    const g = fixture();
    const peer = g.start();
    ready(peer);
    g.api.requestSnapshot(consumer);
    peer.send({
      t: 'snap',
      id: peer.messages.at(-1).id,
      procs: [
        {
          pid: 73,
          ppid: 1,
          name: 'fixture',
          ...identity,
          witness: { ...identity.witness, bootId: '22222222-2222-4222-8222-222222222222' },
        },
      ],
    });
    expect(consumer).not.toHaveBeenCalled();
    expect(g.api.getHealth().state).toBe('FAILED');
  });

  it('bounds huge native loss counts and preserves them through HEALTHY', () => {
    const f = fixture();
    const child = f.start();
    ready(child);
    child.send({
      t: 'loss',
      from: '1',
      to: '18446744073709551615',
      count: '18446744073709551615',
      reason: 'queue-full',
    });
    expect(f.api.getStatus().lossCount).toBe(Number.MAX_SAFE_INTEGER);
    child.send({ t: 'health', state: 'HEALTHY', detail: 'ready' });
    expect(f.api.getHealth()).toMatchObject({
      state: 'DEGRADED',
      lossCount: Number.MAX_SAFE_INTEGER,
    });
    expect(f.api.getStatus().coverage.fileOpen).toBe('coverage-lost');
  });

  it('rejects truncated stdout and unadvertised modes without a new sink delivery', () => {
    const f = fixture();
    const child = f.start();
    ready(child);
    child.stdout.emit('data', Buffer.from([10, 0, 0, 0, 123]));
    child.stdout.emit('end');
    expect(f.api.getHealth().state).toBe('FAILED');
    expect(f.sink).not.toHaveBeenCalled();
    const g = fixture();
    const peer = g.start();
    ready(peer);
    peer.send({
      t: 'mode',
      mode: 'fanotify',
      caps: { ...hello().caps, identity: 'procfs-ticks' },
      reason: 'recovery',
      seq: '1',
    });
    expect(g.api.getHealth().state).toBe('FAILED');
    expect(g.sink).not.toHaveBeenCalled();
  });

  it('ignores old child streams, write callbacks and close after the replacement starts', () => {
    const f = fixture();
    const first = f.start();
    first.deferWrites = true;
    first.send(hello());
    first.close();
    vi.advanceTimersByTime(600);
    const second = f.children[1];
    ready(second);
    first.callbacks.forEach((callback) => callback(new Error('late')));
    first.send(batch(event()));
    first.close();
    first.stdout.emit('error', new Error('late'));
    expect(f.api.getHealth().state).toBe('HEALTHY');
    expect(f.api.getStatus().generation).toBe(2);
    expect(f.sink).not.toHaveBeenCalled();
    second.send(batch(event()));
    expect(f.sink).toHaveBeenCalledOnce();
  });
});
