import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import wire from '../../src/main/platform/sensor-protocol.js';
import launcher from '../../src/main/platform/sensor-host-launch.js';
import { fixture, ready, hello, identity, context, event, batch } from './sensor-host-fixtures.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1700000000000);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('owned sensor host admission and status', () => {
  it('launches the packaged Linux sensor only from the fixed resources directory', () => {
    const resourcesPath = path.resolve('fixture', 'resources');
    const spawn = vi.fn(() => ({ pid: 42 }));
    const exists = vi.fn(() => true);
    const launch = launcher.createLauncher({
      platform: 'linux',
      packaged: true,
      getLinuxContext: () => structuredClone(context),
      test: { resourcesPath, exists, spawn },
    });
    expect(launch().error).toBeNull();
    const expected = path.join(resourcesPath, 'sensor', 'aegis-sensor-linux');
    expect(exists).toHaveBeenCalledExactlyOnceWith(expected);
    expect(spawn).toHaveBeenCalledExactlyOnceWith(expected, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    });
  });

  it('reports a missing packaged sensor without starting a child', () => {
    const spawn = vi.fn();
    const launch = launcher.createLauncher({
      platform: 'linux',
      packaged: true,
      getLinuxContext: () => structuredClone(context),
      test: { resourcesPath: path.resolve('fixture', 'resources'), exists: () => false, spawn },
    });
    expect(launch()).toEqual({ error: 'binary-missing' });
    expect(spawn).not.toHaveBeenCalled();
  });

  const escapedPaths = (count = 4090) =>
    Array.from(
      { length: 1024 },
      (_, index) => '/' + String(index).padStart(4, '0') + '\u0001'.repeat(count),
    );

  it('rejects escaped JSON frame expansion while idle without replacing the last sendable paths', () => {
    const f = fixture();
    expect(f.api.updatePaths(['/retained/valid'])).toBe(true);
    expect(f.api.updatePaths(escapedPaths())).toBe(false);
    const child = f.start();
    ready(child);
    expect(child.messages[1]).toEqual({ t: 'paths', id: 2, prefixes: ['/retained/valid'] });
    expect(f.api.getHealth().state).toBe('HEALTHY');
  });

  it('rejects an oversized active replacement atomically and leaves timer pumping safe', () => {
    const f = fixture();
    const child = f.start();
    ready(child);
    expect(f.api.updatePaths(['/active/valid'])).toBe(true);
    child.ack();
    const before = child.messages.length;
    expect(f.api.updatePaths(escapedPaths())).toBe(false);
    expect(f.api.getStatus().updates.pathsPending).toBe(false);
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    expect(child.messages).toHaveLength(before);
    expect(f.api.getHealth().state).toBe('HEALTHY');
    expect(f.api.updatePaths(['/next/valid'])).toBe(true);
    expect(child.messages.at(-1).prefixes).toEqual(['/next/valid']);
  });

  it('preserves the latest valid queued replacement when a later oversized update is rejected', () => {
    const f = fixture();
    const child = f.start();
    ready(child);
    f.api.updatePaths(['/inflight/valid']);
    f.api.updatePaths(['/queued/valid']);
    expect(f.api.updatePaths(escapedPaths())).toBe(false);
    child.ack();
    expect(child.messages.at(-1).prefixes).toEqual(['/queued/valid']);
    child.ack();
    expect(f.api.getStatus().updates.pathsPending).toBe(false);
  });

  it('preflights the longest future request ID at the exact escaped frame boundary', () => {
    const prefixes = escapedPaths(1363);
    const request = { t: 'paths', id: 1, prefixes };
    const remaining = 8 * 1024 * 1024 - Buffer.byteLength(JSON.stringify(request));
    expect(remaining).toBeGreaterThan(0);
    prefixes[prefixes.length - 1] +=
      '\u0001'.repeat(Math.floor(remaining / 6)) + 'a'.repeat(remaining % 6);
    expect(wire.encodeFrame(request, { direction: 'host-to-sensor' })).toHaveLength(
      8 * 1024 * 1024 + 4,
    );
    const f = fixture();
    expect(f.api.updatePaths(prefixes)).toBe(false);
    const child = f.start();
    ready(child);
    expect(child.messages[1].prefixes).toEqual([]);
  });
  it('retains macOS microseconds and the composite unique-ID witness without enabling file-open coverage', () => {
    const f = fixture({ platform: 'darwin' });
    const child = f.start();
    child.send({
      t: 'hello',
      proto: 'sensor/1',
      platform: 'darwin',
      mode: 'libproc',
      modes: ['libproc'],
      caps: {
        exec: true,
        exit: true,
        fork: true,
        fileOpen: false,
        tcpConnect: false,
        identity: 'pbi-start-usec',
        witness: 'p-uniqueid',
      },
      versions: {
        sensor: 'fixture/1',
        os: 'fixture-os',
        clockAnchor: {
          clock: 'mach-continuous',
          monotonicUsec: '0',
          unixUsec: '1700000000000000',
        },
      },
      pid: child.pid,
    });
    child.ack();
    child.ack();
    child.send({ t: 'health', state: 'HEALTHY', detail: 'ready' });
    const observed = {
      seq: '1',
      kind: 'exit',
      pid: 73,
      ppid: 1,
      birth: '1700000000000123',
      witness: {
        kind: 'macos-unique-id',
        bootSessionId: '22222222-2222-4222-8222-222222222222',
        pUniqueId: '9007199254740993',
      },
      identityError: null,
      ts: '1700000000000124',
    };
    child.send(batch(observed));
    expect(f.sink.mock.calls[0][0]).toMatchObject({
      platform: 'darwin',
      mode: 'libproc',
      event: observed,
      identity: {
        startTime: 1700000000000,
        rawBirth: '1700000000000123',
        witness: '22222222-2222-4222-8222-222222222222:9007199254740993',
        witnessSource: 'macosUniqueId',
      },
    });
    expect(f.api.getStatus().coverage).toMatchObject({
      exit: 'observed',
      fileOpen: 'coverage-lost',
      tcpConnect: 'coverage-lost',
    });
    expect(f.sink.mock.calls[0][0].nativeObservation).toMatchObject({
      state: 'recorded',
      platform: 'darwin',
      mode: 'libproc',
      birthContext: null,
      observation: observed,
      identity: { rawBirth: '1700000000000123', witnessSource: 'macosUniqueId' },
      clockAnchor: { clock: 'mach-continuous', monotonicUsec: '0', unixUsec: '1700000000000000' },
    });
  });
  it('keeps hello STARTING, binds PID, sends exact replacements and admits fresh D1 identity', () => {
    const f = fixture();
    expect(f.api.updateWatch([{ pid: 73, ...identity }])).toBe(true);
    expect(f.api.updatePaths(['/private/fixture'])).toBe(true);
    const child = f.start();
    expect(f.api.getHealth().state).toBe('STARTING');
    child.send(hello());
    expect(f.api.getHealth().state).toBe('STARTING');
    expect(child.messages).toEqual([
      {
        t: 'watch',
        id: 1,
        roots: [{ pid: 73, birth: '12345', witness: identity.witness }],
        descendants: true,
      },
    ]);
    child.ack();
    expect(child.messages[1]).toEqual({ t: 'paths', id: 2, prefixes: ['/private/fixture'] });
    child.send({ t: 'health', state: 'HEALTHY', detail: 'ready' });
    expect(f.api.getStatus().coverage.fileOpen).toBe('coverage-lost');
    child.ack();
    expect(f.api.getStatus().coverage.fileOpen).toBe('observed');
    child.send(batch(event()));
    expect(f.sink).toHaveBeenCalledExactlyOnceWith({
      generation: 1,
      platform: 'linux',
      mode: 'ebpf',
      event: event(),
      identity: {
        startTime: 1700000123450,
        rawBirth: '12345',
        witness: context.bootId + ':12345',
        witnessSource: 'linuxStartTicks',
      },
      nativeObservation: expect.objectContaining({
        state: 'recorded',
        source: { ownerEpoch: expect.stringMatching(/^[a-f0-9-]{36}$/), generation: 1 },
      }),
    });
    expect(f.api.getStatus()).toMatchObject({
      qualification: 'unverified',
      polling: 'unchanged',
      lossCount: 0,
    });
    expect(f.spawn.mock.calls[0][0]).toBe(
      path.resolve('sensors/target/release/aegis-sensor-linux'),
    );
    expect(f.spawn.mock.calls[0].slice(1)).toEqual([
      [],
      { stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true },
    ]);
  });

  it('normalizes unread exit identity as null without borrowing an earlier birth', () => {
    const f = fixture();
    const child = f.start();
    ready(child);
    child.send(batch(event()));
    child.send(
      batch({
        seq: '2',
        kind: 'exit',
        pid: 73,
        ppid: 1,
        birth: null,
        witness: null,
        identityError: 'process-gone',
        ts: '1700000000000002',
      }),
    );
    expect(f.sink.mock.calls[1][0].identity).toEqual({
      startTime: null,
      rawBirth: null,
      witness: null,
      witnessSource: null,
    });
  });

  it('coalesces updates to the latest complete replacement under backpressure', async () => {
    const f = fixture();
    const child = f.start();
    child.pressure = true;
    child.deferWrites = true;
    child.send(hello());
    for (let index = 0; index < 300; index++)
      expect(f.api.updatePaths(['/scope/' + index])).toBe(true);
    child.ack();
    expect(child.messages).toHaveLength(1);
    child.callbacks.shift()();
    await Promise.resolve();
    expect(child.messages).toHaveLength(1);
    child.pressure = false;
    child.emit('drain');
    child.stdin.emit('drain');
    expect(child.messages).toHaveLength(2);
    expect(child.messages[1]).toEqual({ t: 'paths', id: 2, prefixes: ['/scope/299'] });
  });

  it('rejects invalid update data atomically and copies accepted values', () => {
    const f = fixture();
    const paths = ['/scope/one'];
    expect(f.api.updatePaths(paths)).toBe(true);
    paths[0] = '/mutated';
    expect(f.api.updatePaths(['/duplicate', '/duplicate'])).toBe(false);
    expect(f.api.updatePaths(Array(1025).fill('/oversize'))).toBe(false);
    expect(
      f.api.updateWatch([{ pid: 73, birth: null, witness: null, identityError: 'read-failed' }]),
    ).toBe(false);
    expect(
      f.api.updateWatch([
        { pid: 73, ...identity },
        { pid: 73, ...identity },
      ]),
    ).toBe(false);
    const child = f.start();
    child.send(hello());
    child.ack();
    expect(child.messages[1].prefixes).toEqual(['/scope/one']);
  });

  it('correlates snapshots and preserves an empty successful population without session changes', () => {
    const f = fixture();
    const child = f.start();
    ready(child);
    const receive = vi.fn();
    expect(f.api.requestSnapshot(receive)).toBe(true);
    const id = child.messages.at(-1).id;
    expect(f.api.requestSnapshot(receive)).toBe(false);
    child.send({ t: 'snap', id, procs: [] });
    expect(receive).toHaveBeenCalledExactlyOnceWith([]);
    expect(f.api.getHealth().state).toBe('HEALTHY');
  });

  it('admits an explicit loss interval and retains it through later HEALTHY and restart', () => {
    const f = fixture();
    const child = f.start();
    ready(child);
    child.send({ t: 'loss', from: '1', to: '3', count: '3', reason: 'ring-full' });
    child.send(batch(event('4')));
    child.send({ t: 'health', state: 'HEALTHY', detail: 'ready' });
    expect(f.sink).toHaveBeenCalledTimes(1);
    expect(f.api.getHealth()).toMatchObject({ state: 'DEGRADED', lossCount: 3 });
    expect(f.api.getStatus().coverage.fileOpen).toBe('coverage-lost');
    child.close();
    vi.advanceTimersByTime(600);
    ready(f.children[1]);
    expect(f.api.getHealth()).toMatchObject({ state: 'DEGRADED', lossCount: 3 });
  });

  it('validates mode changes against advertised modes and continuity, preserving sequence', () => {
    const f = fixture();
    const child = f.start();
    ready(child);
    child.send(batch(event()));
    const caps = { ...hello().caps, fileOpen: false, identity: 'procfs-ticks' };
    child.send({ t: 'mode', mode: 'procfs', caps, reason: 'permission-denied', seq: '2' });
    expect(f.api.getStatus()).toMatchObject({
      mode: 'procfs',
      modeReason: 'permission-denied',
      capabilities: { fileOpen: false },
      coverage: { fileOpen: 'coverage-lost' },
    });
    child.send(
      batch({ seq: '2', kind: 'exit', pid: 73, ppid: 1, ...identity, ts: '1700000000000002' }),
    );
    expect(f.sink.mock.calls[1][0]).toMatchObject({ mode: 'procfs', event: { seq: '2' } });
  });
});
