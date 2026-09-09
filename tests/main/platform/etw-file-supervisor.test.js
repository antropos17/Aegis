import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import supervisor from '../../../src/main/platform/etw-file-supervisor.js';
import runtime from '../../../src/main/platform/etw-file-runtime.js';
import { message, observation, rawFrame, telemetry } from './etw-file-fixtures.js';

const sensors = [];
afterEach(() => {
  for (const sensor of sensors.splice(0)) sensor.dispose();
  vi.useRealTimers();
});
function harness() {
  vi.useFakeTimers();
  let time = 0,
    nextId = 0;
  const children = [];
  const spawnBroker = vi.fn((launchId, sessionId) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdin.destroy = vi.fn();
    child.stdin.end = vi.fn();
    child.kill = vi.fn();
    child.writes = [];
    child.callbacks = [];
    child.stdin.write = vi.fn((bytes, callback) => {
      child.writes.push(JSON.parse(bytes.subarray(4).toString()));
      child.callbacks.push(callback);
      return false;
    });
    child.flush = () => {
      while (child.callbacks.length) child.callbacks.shift()();
    };
    child.message = (type, seq, data) => {
      const value = { ...message(type, String(seq), data), launchId, sessionId };
      child.stdout.emit('data', rawFrame(value));
    };
    children.push(child);
    return child;
  });
  const sensor = supervisor.createSupervisor({
    spawnBroker,
    now: () => time,
    mono: () => time,
    id: () => `id-${++nextId}`,
  });
  sensors.push(sensor);
  function running() {
    sensor.start();
    const child = children.at(-1);
    child.message('hello', 1);
    child.flush();
    const ready = message('ready').data;
    ready.requestId = child.writes[0].data.requestId;
    child.message('ready', 2, ready);
    return child;
  }
  function stop(child, seq = 3) {
    sensor.stop();
    child.flush();
    const stopped = message('stopped').data;
    stopped.requestId = child.writes.at(-1).data.requestId;
    stopped.finalEventSeq = '999999';
    child.message('stopped', seq, stopped);
    child.stdout.emit('end');
    child.emit('close', 0);
  }
  return {
    sensor,
    spawnBroker,
    children,
    running,
    stop,
    advance: (ms) => {
      time += ms;
      sensor.tick();
    },
  };
}

describe('ETW diagnostic supervisor', () => {
  it('does not start implicitly and publishes diagnostic degradation after ready', () => {
    const h = harness();
    expect(h.spawnBroker).not.toHaveBeenCalled();
    expect(h.sensor.getHealth().state).toBe('DISABLED');
    h.running();
    expect(h.sensor.getHealth().state).toBe('DEGRADED');
    expect(h.sensor.start()).toBe(false);
  });
  it('requires ready to acknowledge this start request', () => {
    const h = harness();
    h.sensor.start();
    const child = h.children[0];
    child.message('hello', 1);
    child.flush();
    child.message('ready', 2);
    expect(h.sensor.getHealth().state).toBe('FAILED');
  });
  it('requires stopped to acknowledge this stop request', () => {
    const h = harness();
    const child = h.running();
    child.message('stopped', 3);
    expect(h.sensor.getHealth().state).toBe('FAILED');
  });
  it('retains only 256 records and accounts local ring eviction', () => {
    const h = harness();
    const child = h.running();
    for (let i = 0; i < 400; i++)
      child.message('observations', i + 3, { records: [observation({ eventSeq: String(i + 1) })] });
    const data = h.sensor.getDiagnostics();
    expect(data.records).toHaveLength(256);
    expect(data.ringDropped).toBe(144);
    data.records[0].path = 'mutation';
    expect(h.sensor.getDiagnostics().records[0].path).toBeNull();
  });
  it('also bounds long retained UTF-16 paths by bytes', () => {
    const h = harness();
    const child = h.running();
    for (let i = 0; i < 50; i++)
      child.message('observations', i + 3, {
        records: [
          observation({
            eventSeq: String(i + 1),
            path: `C:\\fixture\\${'a'.repeat(32000)}`,
            pathEvidence: 'candidate-object',
          }),
        ],
      });
    const result = h.sensor.getDiagnostics();
    expect(result.ringBytes).toBeLessThanOrEqual(1024 * 1024);
    expect(result.records.length).toBeLessThan(20);
    expect(result.ringDropped).toBeGreaterThan(0);
  });
  it('EOF cannot stand in for stop and erases candidate evidence', () => {
    const h = harness();
    const child = h.running();
    child.message('observations', 3);
    child.stdout.emit('end');
    child.emit('close', 0);
    expect(h.sensor.getHealth().state).toBe('FAILED');
    expect(h.sensor.getDiagnostics().records).toEqual([]);
    expect(h.sensor.start()).toBe(false);
    expect(h.sensor.getDiagnostics().summaries[0].stopVerified).toBe(false);
  });
  it('retains losses in ended summary across a fresh session', () => {
    const h = harness();
    const child = h.running();
    const sample = telemetry();
    sample.counters.eventsLost = '7';
    child.message('health', 3, sample);
    h.stop(child, 4);
    expect(h.sensor.getDiagnostics().summaries[0].maxima.eventsLost).toBe('7');
    h.running();
    expect(h.sensor.getHealth().lossCount).toBe(0);
    expect(h.sensor.getDiagnostics().summaries[0].maxima.eventsLost).toBe('7');
  });
  it('ignores callbacks belonging to a previous broker', () => {
    const h = harness();
    const old = h.running();
    h.stop(old);
    const fresh = h.running();
    old.message('error', 5);
    old.emit('close', 2);
    expect(h.sensor.getHealth().state).toBe('DEGRADED');
    fresh.message('observations', 3);
    expect(h.sensor.getDiagnostics().records).toHaveLength(1);
  });
  it('rejects frames claiming a foreign session even on the current stream', () => {
    const h = harness();
    const child = h.running();
    child.stdout.emit('data', rawFrame(message('observations', '3')));
    expect(h.sensor.getHealth().state).toBe('FAILED');
  });
  it('queues one stop behind a blocked control write without growing promises', () => {
    const h = harness();
    const child = h.running();
    h.advance(2000);
    h.sensor.stop();
    h.sensor.stop();
    expect(child.writes.filter((v) => v.t === 'stop')).toHaveLength(0);
    child.flush();
    expect(child.writes.filter((v) => v.t === 'stop')).toHaveLength(1);
  });
  it('fails a blocked write and only terminates its normal broker after cleanup grace', () => {
    const h = harness();
    const child = h.running();
    h.advance(2000);
    h.advance(5001);
    expect(h.sensor.getHealth().state).toBe('FAILED');
    expect(child.kill).not.toHaveBeenCalled();
    h.advance(15001);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(h.spawnBroker).toHaveBeenCalledTimes(1);
  });
  it('heartbeat expiry is independent of successful outbound pings', () => {
    const h = harness();
    const child = h.running();
    h.advance(2000);
    child.flush();
    h.advance(8001);
    expect(h.sensor.getHealth().lastError).toBe('lease-expired');
  });
  it('launch deadline does not repeat UAC', () => {
    const h = harness();
    h.sensor.start();
    h.advance(130001);
    expect(h.sensor.getHealth().lastError).toBe('launch-failed');
    expect(h.spawnBroker).toHaveBeenCalledTimes(1);
  });
  it('stop timeout blocks restart and clears diagnostic data', () => {
    const h = harness();
    const child = h.running();
    h.sensor.restart();
    child.flush();
    h.advance(10001);
    child.emit('close', 2);
    expect(h.spawnBroker).toHaveBeenCalledTimes(1);
    expect(h.sensor.getDiagnostics().restartBlocked).toBe(true);
  });
  it('explicit restart waits for terminal and successful broker exit', () => {
    const h = harness();
    const child = h.running();
    h.sensor.restart();
    child.flush();
    const data = message('stopped').data;
    data.requestId = child.writes.at(-1).data.requestId;
    child.message('stopped', 3, data);
    expect(h.spawnBroker).toHaveBeenCalledTimes(1);
    child.emit('close', 0);
    expect(h.spawnBroker).toHaveBeenCalledTimes(2);
    expect(h.spawnBroker.mock.calls[0]).not.toEqual(h.spawnBroker.mock.calls[1]);
  });
  it('bounds ended summaries and makes truncation explicit', () => {
    const h = harness();
    for (let i = 0; i < 40; i++) h.stop(h.running());
    expect(h.sensor.getDiagnostics().summaries).toHaveLength(32);
    expect(h.sensor.getDiagnostics().omittedSummaries).toBe(8);
  });
  it('rejects confirmed fields at the only diagnostic ingress', () => {
    const h = harness();
    const child = h.running();
    child.message('observations', 3, {
      records: [observation({ agent: 'invented-agent', instanceId: '71:1000' })],
    });
    expect(h.sensor.getDiagnostics().records).toEqual([]);
    expect(h.sensor.getHealth().state).toBe('FAILED');
  });
});

describe('ETW backend runtime gate', () => {
  function make(options = {}) {
    const powerMonitor = new EventEmitter(),
      spawnProcess = vi.fn();
    const sensor = runtime.createRuntime({
      app: { isPackaged: false },
      powerMonitor,
      platform: 'win32',
      argv: [],
      exists: () => true,
      spawnProcess,
      ...options,
    });
    sensors.push(sensor);
    return { sensor, powerMonitor, spawnProcess };
  }
  it.each([
    [{}, 'DISABLED'],
    [{ platform: 'linux' }, 'UNSUPPORTED'],
    [{ app: { isPackaged: true }, argv: ['--etw-file-diagnostic-root=C:\\fixture'] }, 'DISABLED'],
    [{ argv: ['--etw-file-diagnostic-root=C:\\'] }, 'FAILED'],
    [{ argv: ['--etw-file-diagnostic-root=C:\\fixture'], exists: () => false }, 'FAILED'],
  ])('does not elevate when gates fail (%j)', (options, state) => {
    const { sensor, spawnProcess } = make(options);
    expect(sensor.start()).toBe(false);
    expect(sensor.getHealth().state).toBe(state);
    expect(spawnProcess).not.toHaveBeenCalled();
  });
  it('does not auto-launch on resume or unpause; removes power listeners', () => {
    const { sensor, powerMonitor, spawnProcess } = make({
      argv: ['--etw-file-diagnostic-root=C:\\fixture'],
    });
    powerMonitor.emit('suspend');
    expect(sensor.start()).toBe(false);
    powerMonitor.emit('resume');
    sensor.setPaused(true);
    sensor.setPaused(false);
    expect(spawnProcess).not.toHaveBeenCalled();
    sensor.dispose();
    expect(powerMonitor.listenerCount('suspend')).toBe(0);
    expect(powerMonitor.listenerCount('resume')).toBe(0);
  });
});
