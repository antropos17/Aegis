import { EventEmitter } from 'node:events';
import { vi } from 'vitest';
import wire from '../../src/main/platform/sensor-protocol.js';
import host from '../../src/main/platform/sensor-host.js';

export const bootId = '11111111-1111-4111-8111-111111111111';
export const context = { bootId, bootTimeSeconds: '1700000000', clockTicks: '100' };
export const identity = {
  birth: '12345',
  witness: { kind: 'linux-start-ticks', bootId, startTicks: '12345' },
  identityError: null,
};
export function hello(pid = 42) {
  return {
    t: 'hello',
    proto: 'sensor/1',
    platform: 'linux',
    mode: 'ebpf',
    modes: ['ebpf', 'procfs'],
    caps: {
      exec: true,
      exit: true,
      fork: true,
      fileOpen: true,
      tcpConnect: true,
      identity: 'bpf-start-boottime-ticks',
      witness: 'boot-id',
    },
    versions: {
      sensor: 'fixture/1',
      kernel: 'fixture-os',
      clockAnchor: {
        clock: 'boottime',
        monotonicUsec: '0',
        unixUsec: '1700000000000000',
      },
    },
    pid,
  };
}
export function event(seq = '1', extra = {}) {
  return {
    seq,
    kind: 'open',
    pid: 73,
    ppid: 1,
    ...structuredClone(identity),
    ts: '1700000000000001',
    path: '/private/fixture',
    access: 'read',
    ...extra,
  };
}
export function batch(...events) {
  return { t: 'evs', from: events[0].seq, to: events.at(-1).seq, events };
}
export function fakeChild(pid = 42) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.messages = [];
  child.callbacks = [];
  child.pressure = false;
  child.deferWrites = false;
  child.closed = false;
  child.stdin.write = vi.fn((bytes, callback) => {
    child.messages.push(JSON.parse(bytes.subarray(4).toString('utf8')));
    if (child.deferWrites) child.callbacks.push(callback);
    else callback();
    return !child.pressure;
  });
  child.stdin.end = vi.fn();
  child.kill = vi.fn();
  child.close = (code = 1) => {
    child.closed = true;
    child.emit('close', code);
  };
  child.send = (message) =>
    child.stdout.emit('data', wire.encodeFrame(message, { direction: 'sensor-to-host' }));
  child.raw = (message) => {
    const body = Buffer.from(JSON.stringify(message));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length);
    child.stdout.emit('data', Buffer.concat([header, body]));
  };
  child.ack = () => child.send({ t: 'ack', id: child.messages.at(-1).id });
  return child;
}
export function fixture(extra = {}) {
  const children = [];
  const sink = vi.fn(() => true);
  const spawn = vi.fn(() => {
    const child = fakeChild(42 + children.length);
    children.push(child);
    return child;
  });
  const api = host.createSensorHost({
    platform: 'linux',
    sink,
    getLinuxContext: () => structuredClone(context),
    _test: { spawn, exists: () => true, now: () => Date.now(), mono: () => Date.now() },
    ...extra,
  });
  return {
    api,
    children,
    spawn,
    sink,
    start() {
      api.start();
      return children.at(-1);
    },
  };
}
export function ready(child) {
  child.send(hello(child.pid));
  child.ack();
  child.ack();
  child.send({ t: 'health', state: 'HEALTHY', detail: 'ready' });
}
