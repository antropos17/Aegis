import { vi } from 'vitest';
import { EventEmitter } from 'node:events';
import supervisor from '../../src/main/platform/etw-file-supervisor.js';
import { message, rawFrame } from '../main/platform/etw-file-fixtures.js';

/** Create a bounded virtual owned child transport for behavioral tests.
 * @param {object} options Supervisor dependencies. @param {function} onSensor Retention hook.
 * @returns {object} Lifecycle, virtual clock and owned child handles. @since v0.19.2
 */
export function createHarness(options = {}, onSensor = () => {}) {
  vi.useFakeTimers();
  let time = 0,
    nextId = 0;
  const children = [];
  const spawnBroker = vi.fn((launchId, sessionId) => {
    const child = new EventEmitter();
    child.pid = process.pid + 100 + children.length * 10;
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
    ...options,
  });
  onSensor(sensor);
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
