import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import protocol from '../../../src/main/platform/etw-file-protocol.js';
import { createDiagnostics } from '../../../src/main/platform/etw-file-diagnostics.js';
import { createSupervisor } from '../../../src/main/platform/etw-file-supervisor.js';
import { message, observation, rawFrame, telemetry } from './etw-file-fixtures.js';

describe('ETW service measurements', () => {
  it('keeps nested wall-time groups separate and records thrown calls', () => {
    let clock = 0n;
    const diagnostics = createDiagnostics(() => clock);
    diagnostics.measure('decodeChunk', () => {
      clock = 5n;
      diagnostics.measure('acceptFrame', () => {
        clock = 15n;
      });
      clock = 20n;
    });
    const failure = new Error('private-error');
    expect(() =>
      diagnostics.measure('decodeChunk', () => {
        clock = 27n;
        throw failure;
      }),
    ).toThrow(failure);
    expect(diagnostics.performance()).toMatchObject({
      frequency: '1000000000',
      decodeChunk: { calls: '2', totalTicks: '27', maxTicks: '20', failed: '1' },
      acceptFrame: { calls: '1', totalTicks: '10', maxTicks: '10', failed: '0' },
    });
    expect(JSON.stringify(diagnostics.performance())).not.toContain('private-error');
  });

  it('retains the ring cap, copy isolation and loss count when clearing records', () => {
    const diagnostics = createDiagnostics(() => 0n);
    const records = Array.from({ length: 300 }, (_, index) =>
      observation({ eventSeq: String(index + 1) }),
    );
    diagnostics.retain(records);
    records.at(-1).headerPid = 900;
    const snapshot = diagnostics.snapshot();
    expect(snapshot.records).toHaveLength(256);
    expect(snapshot.records[0].eventSeq).toBe('45');
    expect(snapshot.records.at(-1).headerPid).toBe(71);
    expect(snapshot.ringDropped).toBe(44);
    snapshot.records[0].headerPid = 800;
    snapshot.mainPerformance.retainBatch.calls = '999';
    expect(diagnostics.snapshot().records[0].headerPid).toBe(71);
    expect(diagnostics.performance().retainBatch.calls).toBe('1');
    diagnostics.clear();
    expect(diagnostics.snapshot()).toMatchObject({ records: [], ringBytes: 0, ringDropped: 44 });
  });

  it('bounds retained large paths by bytes', () => {
    const diagnostics = createDiagnostics(() => 0n);
    diagnostics.retain(
      Array.from({ length: 100 }, (_, index) =>
        observation({
          eventSeq: String(index + 1),
          path: 'x'.repeat(32000),
          pathEvidence: 'candidate-object',
        }),
      ),
    );
    const snapshot = diagnostics.snapshot();
    expect(snapshot.ringBytes).toBeLessThanOrEqual(1024 * 1024);
    expect(snapshot.records.length).toBeLessThan(100);
    expect(snapshot.records.length + snapshot.ringDropped).toBe(100);
  });

  it.each([
    (p) => {
      p.frequency = '0';
    },
    (p) => {
      p.pump.calls = 1;
    },
    (p) => {
      p.pump.totalTicks = '-1';
    },
    (p) => {
      p.pump.totalTicks = '1';
    },
    (p) => {
      p.pump.failed = '1';
    },
    (p) => {
      p.pump.maxTicks = '1';
    },
    (p) => {
      p.pump = { calls: '2', totalTicks: '9', maxTicks: '4', failed: '0' };
    },
    (p) => {
      p.outputWrite.calls = '1';
    },
    (p) => {
      p.outputWrite = { calls: '1', totalTicks: '2', maxTicks: '2', failed: '0' };
    },
    (p) => {
      p.output.highWaterRecords = 4097;
    },
    (p) => {
      p.ingress.highWaterBytes = 4 * 1024 * 1024 + 1;
    },
    (p) => {
      p.output.records = 1;
    },
    (p) => {
      p.pump.path = 'must-not-leak';
    },
  ])('rejects malformed timing/queue telemetry %#', (change) => {
    const sample = telemetry();
    change(sample.performance);
    expect(() => protocol.validateMessage(message('health', '3', sample))).toThrow();
  });

  it('rejects absent profiling instead of inventing measurements', () => {
    const sample = telemetry();
    delete sample.performance;
    expect(() => protocol.validateMessage(message('health', '3', sample))).toThrow();
  });

  it.each([
    (p) => {
      delete p.outputFlow;
    },
    (p) => {
      p.brokerForward = null;
    },
    (p) => {
      p.brokerForward.duration.failed = '1';
    },
    (p) => {
      p.outputFlow.windows = [];
    },
    (p) => {
      p.outputFlow.windowTicks = '0';
    },
    (p) => {
      p.outputFlow.windowTicks = '1';
    },
    (p) => {
      p.outputFlow.asOfQpc = '101';
    },
    (p) => {
      p.outputFlow.windows[0].toQpc = '101';
    },
    (p) => {
      p.outputFlow.windows[0].fromQpc = '1';
    },
    (p) => {
      p.outputFlow.windows[0].enqueued = '1';
    },
    (p) => {
      p.outputFlow.windows[0].highWaterBytes = 4194305;
    },
    (p) => {
      p.outputFlow.windows[0].path = 'private';
    },
    (p) => {
      p.outputFlow.windows.push({ ...p.outputFlow.windows[0] });
    },
    (p) => {
      p.outputFlow.windows = Array(257).fill(p.outputFlow.windows[0]);
    },
  ])('rejects incomplete or inconsistent burst profiles %#', (change) => {
    const sample = telemetry();
    change(sample.performance);
    expect(() => protocol.validateMessage(message('health', '3', sample))).toThrow();
  });

  it('round trips a full bounded profile including quiet gaps and exact counters', () => {
    const sample = telemetry();
    const flow = sample.performance.outputFlow;
    const width = BigInt(flow.windowTicks);
    const base = flow.windows[0];
    flow.windows = Array.from({ length: 256 }, (_, i) => ({
      ...base,
      fromQpc: String(BigInt(i) * 2n * width),
      toQpc: String((BigInt(i) * 2n + 1n) * width),
      enqueued: '9007199254740993',
      dequeued: '9007199254740993',
      overflow: '123',
      highWaterRecords: 1,
      highWaterBytes: 2048,
    }));
    flow.asOfQpc = flow.windows.at(-1).toQpc;
    sample.performance.asOfQpc = flow.asOfQpc;
    const accepted = [];
    const bytes = protocol.encodeFrame(message('health', '3', sample));
    expect(bytes.length).toBeLessThanOrEqual(protocol.MAX_FRAME_BYTES + 4);
    protocol
      .createFrameDecoder({
        launchId: 'launch-1',
        sessionId: 'session-1',
        onMessage: (value) => {
          accepted.push(value);
        },
      })
      .push(bytes);
    expect(accepted[0].data.performance.outputFlow).toEqual(flow);
  });

  it('preserves uint64 measurements beyond Number precision in frames', () => {
    const sample = telemetry();
    sample.performance.pump = {
      calls: '2',
      totalTicks: '18014398509481988',
      maxTicks: '9007199254740995',
      failed: '1',
    };
    sample.performance.outputWrite = {
      calls: '1',
      totalTicks: '9007199254740993',
      maxTicks: '9007199254740993',
      failed: '0',
    };
    const frames = [];
    protocol
      .createFrameDecoder({
        launchId: 'launch-1',
        sessionId: 'session-1',
        onMessage: (v) => {
          frames.push(v);
        },
      })
      .push(protocol.encodeFrame(message('health', '3', sample)));
    expect(frames[0].data.performance).toEqual(sample.performance);
  });

  it('freezes final measurements in ended summaries and resets for the next session', () => {
    let peer,
      time = 0n;
    const sensor = createSupervisor({
      profileClock: () => ++time,
      spawnBroker: (launchId, sessionId) => {
        peer = new EventEmitter();
        peer.stdout = new EventEmitter();
        peer.stdin = new EventEmitter();
        peer.sent = [];
        peer.stdin.write = (bytes, callback) => {
          peer.sent.push(JSON.parse(bytes.subarray(4)));
          callback?.();
          return true;
        };
        peer.stdin.end = () => {};
        peer.kill = () => {};
        peer.send = (t, seq, data) =>
          peer.stdout.emit('data', rawFrame({ ...message(t, seq, data), launchId, sessionId }));
        return peer;
      },
    });
    try {
      sensor.start();
      peer.send('hello', '1');
      const ready = message('ready', '2').data;
      ready.requestId = peer.sent[0].data.requestId;
      peer.send('ready', '2', ready);
      peer.send('observations', '3', { records: [observation()] });
      sensor.getDiagnostics();
      sensor.stop();
      const done = message('stopped', '4').data;
      done.requestId = peer.sent.at(-1).data.requestId;
      done.telemetry.performance.pump = {
        calls: '1',
        totalTicks: '40',
        maxTicks: '40',
        failed: '0',
      };
      peer.send('stopped', '4', done);
      peer.emit('close', 0);
      const final = sensor.getDiagnostics().summaries[0];
      expect(final.collectorPerformance.pump.totalTicks).toBe('40');
      expect(final.mainPerformance.decodeChunk.calls).toBe('4');
      expect(final.mainPerformance.retainBatch.calls).toBe('1');
      expect(final.mainPerformance.snapshot.calls).toBe('1');
      done.telemetry.performance.pump.totalTicks = '999';
      sensor.start();
      expect(sensor.getDiagnostics().mainPerformance.decodeChunk.calls).toBe('0');
      expect(sensor.getDiagnostics().summaries[0]).toEqual(final);
      peer.emit('close', 1);
      const failed = sensor.getDiagnostics().summaries.at(-1);
      expect(failed.collectorPerformance).toBeNull();
      expect(failed.stopVerified).toBe(false);
    } finally {
      sensor.dispose();
    }
  });
});
