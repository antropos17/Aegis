import { describe, it, expect, vi } from 'vitest';
import protocol from '../../../src/main/platform/etw-file-protocol.js';
import { message, observation, telemetry, rawFrame } from './etw-file-fixtures.js';

const { createFrameDecoder, encodeFrame, validateMessage, MAX_FRAME_BYTES } = protocol;
function decoder(onMessage = () => {}) {
  return createFrameDecoder({ launchId: 'launch-1', sessionId: 'session-1', onMessage });
}

describe('offline ETW envelope', () => {
  it.each([
    'hello',
    'start',
    'ready',
    'observations',
    'health',
    'heartbeat',
    'stop',
    'stopped',
    'error',
  ])('accepts the closed %s contract', (t) => {
    const frames = [];
    decoder((m) => {
      frames.push(m);
    }).push(encodeFrame(message(t)));
    expect(frames).toEqual([message(t)]);
  });

  it.each(['0', '01', '-1', '1.5', '1e3', '18446744073709551616', 1, null])(
    'rejects invalid transport sequence %s',
    (seq) => {
      expect(() => validateMessage(message('hello', seq))).toThrow('etw-file:invalid-message');
    },
  );

  it('preserves uint64 witnesses beyond JS precision and the maximum uint64', () => {
    const rec = observation({
      generationStatus: 'candidate',
      generationWitness: '134333333333333337',
      generationSource: 'createTime100ns',
      generationInterval: { fromQpc: '9007199254740993', toQpc: '18446744073709551615' },
    });
    const original = message('observations', '18446744073709551615', { records: [rec] });
    const sink = vi.fn();
    decoder(sink).push(rawFrame(original));
    expect(sink.mock.calls[0][0]).toEqual(original);
  });

  it.each([
    { proto: 'etw-file/1' },
    { proto: 'etw-file/4' },
    { proto: 'etw-file/6' },
    { sessionId: '' },
    { launchId: 'x'.repeat(65) },
    { t: '__proto__' },
    { content: 'must-not-leak' },
  ])('rejects unknown versions, IDs and extra fields: %j', (patch) => {
    expect(() => validateMessage({ ...message(), ...patch })).toThrow();
  });

  it.each([
    { agent: 'Claude' },
    { instanceId: '71:1' },
    { issuerStatus: 'confirmed' },
    { generationStatus: 'candidate' },
    { generationWitness: '1' },
    { headerPid: -1 },
    { issuingTid: 4294967296 },
    { qpc: 9007199254740992 },
    { path: 'X:/fixture.txt' },
    { pathEvidence: 'candidate-object' },
    { path: 'X:/fixture.txt', pathEvidence: 'observed-name' },
    { path: 'X:/fixture.txt', pathEvidence: 'conflict' },
    { path: '\ud800', pathEvidence: 'candidate-key' },
    { path: 'a'.repeat(32769), pathEvidence: 'candidate-key' },
    { version: 2 },
    { eventId: 99 },
    { fileObject: '0xffff0123456789ab' },
  ])('rejects inconsistent or unsupported observation %j', (patch) => {
    expect(() =>
      validateMessage(message('observations', '1', { records: [observation(patch)] })),
    ).toThrow();
  });

  it('accepts naming and candidate paths without giving them an agent', () => {
    for (const patch of [
      { eventId: 10, version: 0, path: 'X:/тест.txt', pathEvidence: 'observed-name' },
      { path: 'X:/fixture.txt', pathEvidence: 'candidate-object' },
    ])
      expect(
        validateMessage(message('observations', '1', { records: [observation(patch)] })).data
          .records[0].agent,
      ).toBeNull();
  });

  it('rejects oversized batches and repeated event sequences', () => {
    for (const records of [
      Array.from({ length: 129 }, (_, i) => observation({ eventSeq: String(i + 1) })),
      [observation(), observation()],
    ]) {
      expect(() => validateMessage(message('observations', '1', { records }))).toThrow();
    }
  });

  it('validates clock ranges, required counters and queue limits', () => {
    const invalid = [
      {
        ...telemetry(),
        queues: { records: 4097, bytes: 1, highWaterRecords: 4097, highWaterBytes: 1 },
      },
      { ...telemetry(), counters: { ...telemetry().counters, eventsLost: undefined } },
      { ...telemetry(), totals: { ...telemetry().totals, dropped: '18446744073709551616' } },
    ];
    for (const sample of invalid)
      expect(() => validateMessage(message('health', '1', sample))).toThrow();
    const ready = message('ready');
    ready.data.frequency = '0';
    expect(() => validateMessage(ready)).toThrow();
  });
});

describe('bounded streaming ETW decoder', () => {
  it('decodes every two-chunk split of an independent UTF-8 frame identically', () => {
    const original = message('observations', '1', {
      records: [observation({ path: 'X:/кириллица.txt', pathEvidence: 'candidate-key' })],
    });
    const bytes = rawFrame(original);
    for (let split = 0; split <= bytes.length; split++) {
      const sink = vi.fn();
      const d = decoder(sink);
      d.push(bytes.subarray(0, split));
      d.push(bytes.subarray(split));
      d.end();
      expect(sink).toHaveBeenCalledExactlyOnceWith(original);
      expect(d.pendingBytes()).toBe(0);
    }
  });

  it('streams a coalesced chunk larger than its cap without retaining a frame array', () => {
    const bytes = Buffer.concat(
      Array.from({ length: 1500 }, (_, i) => rawFrame(message('heartbeat', String(i + 1)))),
    );
    let calls = 0;
    const d = decoder(() => {
      calls++;
    });
    expect(bytes.length).toBeGreaterThan(MAX_FRAME_BYTES);
    expect(d.push(bytes)).toBe(1500);
    expect(calls).toBe(1500);
    expect(d.allocatedBytes()).toBe(4);
  });

  it('copies fragmented bytes and retains at most a single validated allocation', () => {
    const bytes = rawFrame(message());
    const d = decoder();
    for (const byte of bytes) d.push(Buffer.from([byte]));
    expect(d.pendingBytes()).toBe(0);
    const header = Buffer.alloc(4);
    header.writeUInt32LE(MAX_FRAME_BYTES);
    d.push(header);
    header.fill(0);
    expect(d.allocatedBytes()).toBe(MAX_FRAME_BYTES + 4);
    expect(() => d.end()).toThrow('truncated-frame');
    expect(d.allocatedBytes()).toBe(4);
  });

  it.each([0, MAX_FRAME_BYTES + 1, 0xffffffff])(
    'rejects length %s before allocating a payload',
    (size) => {
      const header = Buffer.alloc(4);
      header.writeUInt32LE(size);
      const d = decoder();
      expect(() => d.push(header)).toThrow('frame-length');
      expect(d.allocatedBytes()).toBe(4);
      expect(d.isFatal()).toBe(true);
      expect(() => d.push(rawFrame(message()))).toThrow('decoder-closed');
    },
  );

  it.each([
    Buffer.from([0xff]),
    Buffer.from([0xef, 0xbb, 0xbf, 123, 125]),
    '{"secret":"do-not-log"',
    'null',
    '[]',
    '{"t":"unknown","secret":"do-not-log"}',
  ])('fails closed with static errors for malformed input %#', (body) => {
    const d = decoder();
    try {
      d.push(rawFrame(body));
      throw new Error('accepted');
    } catch (err) {
      expect(err.message).toMatch(/^etw-file:(invalid-json|invalid-message)$/);
    }
    expect(d.isFatal()).toBe(true);
  });

  it('rejects deeply nested and cyclic direct input without recursive exhaustion', () => {
    const deep = { ...message(), extra: JSON.parse('['.repeat(17) + '0' + ']'.repeat(17)) };
    expect(() => validateMessage(deep)).toThrow('structure-limit');
    const cyclic = message();
    cyclic.extra = cyclic;
    expect(() => validateMessage(cyclic)).toThrow('structure-limit');
    expect(() => decoder().push(rawFrame(deep))).toThrow('invalid-message');
  });

  it('rejects foreign launch/session IDs before delivering to the sink', () => {
    for (const patch of [{ launchId: 'old' }, { sessionId: 'old' }]) {
      const sink = vi.fn();
      expect(() => decoder(sink).push(rawFrame({ ...message(), ...patch }))).toThrow(
        'invalid-message',
      );
      expect(sink).not.toHaveBeenCalled();
    }
  });

  it.each([
    () => false,
    () => {
      throw new Error('private-path');
    },
    () => Promise.resolve(),
  ])('stops on failed or asynchronous consumption %#', (sink) => {
    const d = decoder(sink);
    expect(() => d.push(Buffer.concat([rawFrame(message()), rawFrame(message())]))).toThrow(
      'consumer-failed',
    );
    expect(d.isFatal()).toBe(true);
  });

  it('rejects reentrant pushes and partial EOF; clean byte EOF closes decoding', () => {
    const d = decoder(() => {
      d.push(rawFrame(message()));
    });
    expect(() => d.push(rawFrame(message()))).toThrow('consumer-failed');
    const partial = decoder();
    partial.push(Buffer.from([1]));
    expect(() => partial.end()).toThrow('truncated-frame');
    const clean = decoder();
    clean.push(rawFrame(message()));
    clean.end();
    clean.end();
    expect(() => clean.push(Buffer.alloc(0))).toThrow('decoder-closed');
  });
});
