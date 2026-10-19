import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture, ready, hello, event, batch, context } from './sensor-host-fixtures.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1700000000000);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('sensor host failure, custody and restart boundaries', () => {
  it.each([
    ['first-frame', (child) => child.send({ t: 'health', state: 'HEALTHY', detail: 'ready' })],
    ['wrong-pid', (child) => child.send(hello(99))],
    ['mismatch', (child) => child.raw({ ...hello(), proto: 'sensor/2' })],
    ['garbage', (child) => child.stdout.emit('data', Buffer.from('garbage'))],
    ['wrong-platform', (child) => child.raw({ ...hello(), platform: 'darwin' })],
  ])('keeps polling and explicit failure on %s without logging peer content', (_, corrupt) => {
    const f = fixture();
    const child = f.start();
    child.stderr.emit('data', Buffer.from('SECRET PATH PROMPT TOKEN'));
    corrupt(child);
    expect(f.api.getHealth().state).toBe('FAILED');
    expect(f.api.getStatus()).toMatchObject({
      phase: 'closing',
      polling: 'unchanged',
      coverage: { exec: 'coverage-lost' },
    });
    expect(JSON.stringify(f.api.getStatus()) + JSON.stringify(f.api.getHealth())).not.toContain(
      'SECRET',
    );
    expect(f.sink).not.toHaveBeenCalled();
  });

  it.each([
    ['duplicate hello', (child) => child.send(hello())],
    ['unexplained gap', (child) => child.send(batch(event('2')))],
    [
      'replayed sequence',
      (child) => {
        child.send(batch(event()));
        child.send(batch(event()));
      },
    ],
    ['unmatched ack', (child) => child.send({ t: 'ack', id: 999 })],
    ['unmatched snapshot', (child) => child.send({ t: 'snap', id: 999, procs: [] })],
    [
      'mode boundary gap',
      (child) =>
        child.send({ t: 'mode', mode: 'ebpf', caps: hello().caps, reason: 'requested', seq: '2' }),
    ],
  ])('terminates on %s', (_, corrupt) => {
    const f = fixture();
    const child = f.start();
    ready(child);
    corrupt(child);
    expect(f.api.getHealth().state).toBe('FAILED');
  });

  it('preflights all event capabilities and identities before sink delivery', () => {
    const f = fixture();
    const child = f.start();
    const msg = hello();
    msg.caps.fileOpen = false;
    child.send(msg);
    child.ack();
    child.ack();
    child.send(batch(event()));
    expect(f.sink).not.toHaveBeenCalled();
    expect(f.api.getHealth().state).toBe('FAILED');
    const g = fixture();
    const peer = g.start();
    ready(peer);
    const bad = event('2');
    bad.witness.bootId = '22222222-2222-4222-8222-222222222222';
    peer.send(batch(event(), bad));
    expect(g.sink).not.toHaveBeenCalled();
    expect(g.api.getHealth().state).toBe('FAILED');
  });

  it('waits for observed close before restart, rejects stale callbacks and budgets hello-only crashes', () => {
    const f = fixture();
    for (let attempt = 0; attempt < 4; attempt++) {
      const child = attempt ? f.children.at(-1) : f.start();
      child.send(hello(child.pid));
      child.emit('error', new Error('raw secret'));
      vi.advanceTimersByTime(800);
      expect(f.spawn).toHaveBeenCalledTimes(attempt + 1);
      child.close();
      vi.advanceTimersByTime(600);
      child.send({ t: 'health', state: 'HEALTHY', detail: 'ready' });
      child.callbacks.forEach((callback) => callback());
    }
    expect(f.spawn).toHaveBeenCalledTimes(4);
    expect(f.api.getStatus()).toMatchObject({
      phase: 'failed',
      reason: 'restart-exhausted',
      restart: { used: 3, remaining: 0 },
    });
    expect(f.sink).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100000);
    expect(f.spawn).toHaveBeenCalledTimes(4);
  });

  it('resets the automatic budget only after observed HEALTHY', () => {
    const f = fixture();
    const child = f.start();
    child.close();
    vi.advanceTimersByTime(600);
    const second = f.children[1];
    second.send(hello(second.pid));
    expect(f.api.getStatus().restart.used).toBe(1);
    second.ack();
    second.ack();
    second.send({ t: 'health', state: 'HEALTHY', detail: 'ready' });
    expect(f.api.getStatus().restart.used).toBe(0);
    second.close();
    vi.advanceTimersByTime(600);
    expect(f.api.getStatus().restart.used).toBe(1);
  });

  it.each(['hello', 'health', 'request', 'write'])(
    'enforces a bounded %s hang and kills only its owned child',
    (kind) => {
      const f = fixture();
      const child = f.start();
      if (kind !== 'hello') {
        if (kind === 'write') child.pressure = true;
        child.send(hello());
        if (kind === 'health') {
          child.ack();
          child.ack();
        }
      }
      vi.advanceTimersByTime(5000);
      expect(f.api.getHealth().state).toBe('FAILED');
      vi.advanceTimersByTime(1000);
      expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
      vi.advanceTimersByTime(1000);
      expect(f.api.getStatus()).toMatchObject({ phase: 'failed', reason: 'custody-unconfirmed' });
      expect(f.spawn).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each([
    () => false,
    () => {
      throw new Error('quota path secret');
    },
    () => Promise.reject(new Error('async sink')),
  ])('accounts the unadmitted remainder and terminates sink rejection', async (sink) => {
    const f = fixture({ sink });
    const child = f.start();
    ready(child);
    child.send(batch(event(), event('2')));
    await Promise.resolve();
    expect(f.api.getHealth()).toMatchObject({ state: 'FAILED', lossCount: 2 });
    expect(f.api.getStatus().reason).toBe('sink-rejected');
  });

  it('stops, drains an ack and close, rejects late events and cancels restart timers', async () => {
    const f = fixture();
    const child = f.start();
    ready(child);
    const stopping = f.api.dispose();
    expect(child.messages.at(-1)).toMatchObject({ t: 'stop' });
    child.send(batch(event()));
    expect(f.sink).not.toHaveBeenCalled();
    child.ack();
    expect(child.stdin.end).toHaveBeenCalledOnce();
    child.close(0);
    expect(await stopping).toBe(true);
    vi.advanceTimersByTime(10000);
    expect(f.spawn).toHaveBeenCalledTimes(1);
    expect(f.api.start()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fails unavailable without binary/context and never starts sensor/1 on Windows', () => {
    for (const extra of [
      { getLinuxContext: () => null },
      { _test: { exists: () => false } },
      { platform: 'win32' },
    ]) {
      const f = fixture(extra);
      expect(f.api.start()).toBe(false);
      expect(f.api.getStatus().phase).toBe('unavailable');
      expect(f.spawn).not.toHaveBeenCalled();
      expect(f.api.getStatus().coverage.fileOpen).toBe('coverage-lost');
    }
  });

  it('requires a current D1 context after restart and rejects replacement boot anchors', () => {
    let value = structuredClone(context);
    const f = fixture({ getLinuxContext: () => value });
    const child = f.start();
    ready(child);
    value = { ...context, bootTimeSeconds: '1800000000' };
    child.close();
    vi.advanceTimersByTime(600);
    expect(f.spawn).toHaveBeenCalledTimes(1);
    expect(f.api.getStatus()).toMatchObject({
      phase: 'unavailable',
      reason: 'identity-context-unavailable',
    });
  });
});
