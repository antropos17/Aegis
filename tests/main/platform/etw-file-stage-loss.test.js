import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import protocol from '../../../src/main/platform/etw-file-protocol.js';
import model from '../../../src/main/platform/etw-file-health.js';
import supervisor from '../../../src/main/platform/etw-file-supervisor.js';
import { message, rawFrame, telemetry } from './etw-file-fixtures.js';

function stageSample(ingressDropped = '3', outputDropped = '4') {
  const sample = telemetry();
  Object.assign(sample.totals, {
    delivered: '18446744073709551615',
    ingressDropped,
    outputDropped,
    dropped: String(BigInt(ingressDropped) + BigInt(outputDropped)),
  });
  return sample;
}
function running(sample = stageSample()) {
  let state = model.createSession('launch-1', 'session-1');
  state = model.reduceSession(state, message(), 1);
  const ready = message('ready', '2');
  ready.data.telemetry = sample;
  return model.reduceSession(state, ready, 2);
}

describe('ETW stage loss contract', () => {
  it('preserves exact independent uint64 totals through the framed codec', () => {
    const original = message('health', '3', stageSample('9007199254740993', '9007199254740995'));
    const frames = [];
    const reader = protocol.createFrameDecoder({
      launchId: 'launch-1',
      sessionId: 'session-1',
      onMessage: (frame) => {
        frames.push(frame);
      },
    });
    reader.push(protocol.encodeFrame(original));
    expect(frames).toEqual([original]);
    expect(frames[0].data.totals.dropped).toBe('18014398509481988');
  });

  it.each([
    { ingressDropped: undefined },
    { outputDropped: undefined },
    { ingressDropped: null },
    { outputDropped: 4 },
    { ingressDropped: '-1' },
    { outputDropped: '04' },
    { outputDropped: '18446744073709551616' },
    { dropped: '8' },
    { ingressDropped: '18446744073709551615', outputDropped: '1', dropped: '18446744073709551615' },
    { privatePath: 'must-not-leak' },
  ])('rejects missing, malformed or inconsistent split totals %#', (patch) => {
    const sample = stageSample();
    Object.assign(sample.totals, patch);
    expect(() => protocol.validateMessage(message('health', '3', sample))).toThrow(
      'etw-file:invalid-message',
    );
  });

  it('rejects a legacy peer instead of assigning zero to absent stage measurements', () => {
    const old = message('health', '3', stageSample());
    old.proto = 'etw-file/1';
    delete old.data.totals.ingressDropped;
    delete old.data.totals.outputDropped;
    const sink = vi.fn();
    const reader = protocol.createFrameDecoder({
      launchId: 'launch-1',
      sessionId: 'session-1',
      onMessage: sink,
    });
    expect(() => reader.push(rawFrame(old))).toThrow('etw-file:invalid-message');
    expect(sink).not.toHaveBeenCalled();
    expect(reader.isFatal()).toBe(true);
  });

  it('retains each stage maximum, flags regressions, and does not add them to native loss', () => {
    const first = running();
    const sample = stageSample('2', '6');
    sample.counters.eventsLost = '5';
    const next = model.reduceSession(first, message('health', '3', sample), 3);
    expect(next.maxima).toMatchObject({ ingressDropped: '3', outputDropped: '6', dropped: '8' });
    expect(next.latest.totals).toMatchObject({
      ingressDropped: '2',
      outputDropped: '6',
      dropped: '8',
    });
    expect(next.sticky).toEqual(
      expect.arrayContaining(['ingressDropped', 'outputDropped', 'dropped', 'counter-regressed']),
    );
    expect(next.record.lossCount).toBe(5);
    expect(first.maxima).toMatchObject({ ingressDropped: '3', outputDropped: '4', dropped: '7' });
  });

  it('keeps stage evidence on failure and resets it for a new session', () => {
    const state = model.failSession(running(), 3, 'stream-ended');
    expect(state.latest.totals).toMatchObject({ ingressDropped: '3', outputDropped: '4' });
    expect(state.maxima).toMatchObject({ ingressDropped: '3', outputDropped: '4' });
    const fresh = model.createSession('next-launch', 'next-session');
    expect(fresh.latest).toBeNull();
    expect(fresh.maxima).toMatchObject({ ingressDropped: '0', outputDropped: '0' });
  });
});

const sensors = [];
afterEach(() => {
  sensors.splice(0).forEach((sensor) => sensor.dispose());
});

it('retains final split losses in the actual supervisor report across restart', () => {
  let peer;
  const sensor = supervisor.createSupervisor({
    spawnBroker: (launchId, sessionId) => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stdin = new EventEmitter();
      child.controls = [];
      child.stdin.write = (bytes, callback) => {
        child.controls.push(JSON.parse(bytes.subarray(4).toString('utf8')));
        callback?.();
        return true;
      };
      child.stdin.end = () => {};
      child.kill = vi.fn();
      child.send = (type, seq, data) =>
        child.stdout.emit('data', rawFrame({ ...message(type, seq, data), launchId, sessionId }));
      peer = child;
      return child;
    },
  });
  sensors.push(sensor);
  const start = () => {
    expect(sensor.start()).toBe(true);
    peer.send('hello', '1');
    const ready = message('ready', '2').data;
    ready.requestId = peer.controls[0].data.requestId;
    peer.send('ready', '2', ready);
  };
  start();
  peer.send('heartbeat', '3', stageSample());
  sensor.stop();
  const done = message('stopped', '4').data;
  done.requestId = peer.controls.at(-1).data.requestId;
  done.telemetry = stageSample('11', '7');
  peer.send('stopped', '4', done);
  peer.emit('close', 0);
  const summary = sensor.getDiagnostics().summaries[0];
  expect(summary).toMatchObject({
    stopVerified: true,
    maxima: { dropped: '18', ingressDropped: '11', outputDropped: '7' },
    finalTotals: { dropped: '18', ingressDropped: '11', outputDropped: '7' },
  });
  start();
  expect(sensor.getHealth().detail).not.toContain('Dropped');
  expect(sensor.getDiagnostics().summaries[0]).toEqual(summary);
  // Complete the fresh mock peer so its interval is released as well.
  sensor.stop();
  peer.emit('close', 0);
});
