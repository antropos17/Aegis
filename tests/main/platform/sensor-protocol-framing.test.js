import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import protocol from '../../../src/main/platform/sensor-protocol.js';

const MAX = 8 * 1024 * 1024;
const good = { decodedCount: 0, errorCode: null, fatal: false };
function frame(value, advertised) {
  const payload = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const header = Buffer.alloc(4);
  header.writeUInt32LE(advertised ?? payload.length);
  return Buffer.concat([header, payload]);
}
function decoder(onMessage = () => {}) {
  return protocol.createFrameDecoder({ direction: 'sensor-to-host', onMessage });
}
afterEach(() => vi.restoreAllMocks());

describe('incremental framing without output accumulation', () => {
  it('decodes every split of a representative multibyte golden, including its header', () => {
    const bytes = fs.readFileSync(path.resolve('tests/fixtures/sensor-wire/events-darwin.bin'));
    const expected = JSON.parse(bytes.subarray(4).toString('utf8'));
    for (let split = 0; split <= bytes.length; split++) {
      const delivered = [];
      const d = decoder((v) => delivered.push(v));
      const first = d.push(bytes.subarray(0, split));
      expect(first.fatal).toBe(false);
      expect(d.pendingBytes()).toBe(split === bytes.length ? 0 : split);
      const second = d.push(bytes.subarray(split));
      expect(first.decodedCount + second.decodedCount).toBe(1);
      expect(delivered).toEqual([expected]);
      expect(d.finish()).toEqual(good);
    }
    const bytewise = [];
    const d = decoder((message) => bytewise.push(message));
    for (const byte of bytes) expect(d.push(Buffer.from([byte])).fatal).toBe(false);
    expect(d.finish()).toEqual(good);
    expect(bytewise).toEqual([expected]);
  });

  it('delivers concatenated frames, retains only a partial tail and finishes it', () => {
    const first = frame('{"t":"ack","id":1}');
    const second = frame('{"t":"ack","id":2}');
    const third = frame('{"t":"ack","id":3}');
    const delivered = [];
    const d = decoder((v) => delivered.push(v));
    expect(d.push(Buffer.concat([first, second, third.subarray(0, 7)]))).toEqual({
      ...good,
      decodedCount: 2,
    });
    expect(d.pendingBytes()).toBe(7);
    expect(delivered).toEqual([
      { t: 'ack', id: 1 },
      { t: 'ack', id: 2 },
    ]);
    expect(d.push(third.subarray(7))).toEqual({ ...good, decodedCount: 1 });
    expect(delivered).toEqual([
      { t: 'ack', id: 1 },
      { t: 'ack', id: 2 },
      { t: 'ack', id: 3 },
    ]);
    expect(d.finish()).toEqual(good);
  });

  it('delivers many frames without retaining/concatenating the entire supplied chunk', () => {
    const bytes = frame('{"t":"ack","id":1}');
    const chunk = Buffer.concat(Array(5000).fill(bytes));
    let delivered = 0;
    const d = decoder(() => {
      delivered++;
    });
    const concat = vi.spyOn(Buffer, 'concat');
    const from = vi.spyOn(Buffer, 'from');
    const alloc = vi.spyOn(Buffer, 'allocUnsafe');
    expect(d.push(chunk)).toEqual({ ...good, decodedCount: 5000 });
    expect(delivered).toBe(5000);
    expect(concat).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(alloc.mock.calls.every(([size]) => size === bytes.length - 4)).toBe(true);
    expect(d.pendingBytes()).toBe(0);
  });

  it('accepts exactly 8 MiB padded JSON and rejects oversized/zero length before allocating a body', () => {
    const json = '{"t":"ack","id":1}';
    const bytes = frame(json + ' '.repeat(MAX - Buffer.byteLength(json)));
    expect(decoder().push(bytes)).toEqual({ ...good, decodedCount: 1 });
    const allocate = Buffer.allocUnsafe;
    for (const length of [0, MAX + 1, 4294967295]) {
      const d = decoder();
      const header = Buffer.alloc(4);
      header.writeUInt32LE(length);
      const alloc = vi.spyOn(Buffer, 'allocUnsafe').mockImplementation((size) => {
        if (size > MAX) throw Error('Test-only oversized allocation blocked');
        return allocate(size);
      });
      expect(d.push(header)).toEqual({
        decodedCount: 0,
        errorCode: 'frame-length-invalid',
        fatal: true,
      });
      expect(alloc).not.toHaveBeenCalled();
      alloc.mockRestore();
      expect(d.pendingBytes()).toBe(0);
    }
    const roots = Array.from({ length: 1024 }, (_, i) => `/fixture/${i}/${'x'.repeat(4080)}`);
    // A schema-valid message can still exceed framing limits (4096 event rows).
    const event = {
      seq: '1',
      kind: 'open',
      pid: 1,
      ppid: 0,
      birth: null,
      witness: null,
      identityError: 'read-failed',
      ts: '0',
      path: roots[0],
      access: 'read',
    };
    const events = Array.from({ length: 4096 }, (_, i) => ({ ...event, seq: String(i + 1) }));
    expect(() =>
      protocol.encodeFrame(
        { t: 'evs', from: '1', to: '4096', events },
        { direction: 'sensor-to-host' },
      ),
    ).toThrowError('frame-length-invalid');
  });

  it('reports EOF truncation, successful close and invalid chunks with permanent original errors', () => {
    const bytes = frame('{"t":"ack","id":1}');
    for (const size of [1, 2, 3, 4, bytes.length - 1]) {
      const d = decoder();
      d.push(bytes.subarray(0, size));
      expect(d.finish()).toEqual({ decodedCount: 0, errorCode: 'frame-truncated', fatal: true });
      expect(d.push(bytes).errorCode).toBe('frame-truncated');
      expect(d.pendingBytes()).toBe(0);
    }
    const d = decoder();
    expect(d.push(Buffer.alloc(0))).toEqual(good);
    expect(d.finish()).toEqual(good);
    expect(d.finish()).toEqual(good);
    expect(d.push(Buffer.alloc(0)).errorCode).toBe('decoder-closed');
    for (const input of ['x', new Uint8Array([1]), null, undefined]) {
      const bad = decoder();
      bad.push(Buffer.from([1]));
      expect(bad.push(input).errorCode).toBe('chunk-invalid');
      expect(bad.pendingBytes()).toBe(0);
      expect(bad.isFatal()).toBe(true);
      expect(bad.finish().errorCode).toBe('chunk-invalid');
    }
    const trap = vi.fn(() => {
      throw Error('Buffer proxy trap must not run');
    });
    const proxy = new Proxy(Buffer.from([1]), { get: trap, getPrototypeOf: trap });
    const proxied = decoder();
    let result;
    expect(() => {
      result = proxied.push(proxy);
    }).not.toThrow();
    expect(result).toEqual({ decodedCount: 0, errorCode: 'chunk-invalid', fatal: true });
    expect(trap).not.toHaveBeenCalled();
  });

  it('keeps earlier delivery and never guesses synchronization after a later error', () => {
    const bytes = frame('{"t":"ack","id":1}');
    const observed = [];
    const d = decoder((v) => observed.push(v));
    expect(
      d.push(
        Buffer.concat([
          bytes,
          frame(
            '{"t":"hello","proto":"future","platform":"linux","mode":"procfs","modes":[],"caps":{},"versions":{},"pid":1}',
          ),
          bytes,
        ]),
      ),
    ).toEqual({ decodedCount: 1, errorCode: 'protocol-unsupported', fatal: true });
    expect(observed).toEqual([{ t: 'ack', id: 1 }]);
    expect(d.push(Buffer.from('private')).errorCode).toBe('protocol-unsupported');
    expect(d.pendingBytes()).toBe(0);
    const malformed = decoder((message) => observed.push(message));
    expect(
      malformed.push(
        Buffer.concat([frame('{"t":"ack","id":2}'), frame('{'), frame('{"t":"ack","id":3}')]),
      ),
    ).toEqual({ decodedCount: 1, errorCode: 'json-invalid', fatal: true });
    expect(malformed.push(frame('{"t":"ack","id":4}')).errorCode).toBe('json-invalid');
    expect(observed).toEqual([
      { t: 'ack', id: 1 },
      { t: 'ack', id: 2 },
    ]);
  });
});

describe('synchronous callback failure boundaries', () => {
  it('ignores ordinary callback results and counts only successful deliveries', () => {
    const bytes = frame('{"t":"ack","id":1}');
    for (const result of [undefined, 0, false, 'text', {}, []])
      expect(decoder(() => result).push(bytes)).toEqual({ ...good, decodedCount: 1 });
    let calls = 0;
    const d = decoder(() => {
      if (++calls === 2) throw Error('private');
    });
    expect(d.push(Buffer.concat([bytes, bytes, bytes]))).toEqual({
      decodedCount: 1,
      errorCode: 'callback-failed',
      fatal: true,
    });
    expect(calls).toBe(2);
    expect(d.finish().errorCode).toBe('callback-failed');
  });

  it('rejects thenables/promises and observes native rejection without invoking arbitrary thenables', async () => {
    const bytes = frame('{"t":"ack","id":1}');
    const then = vi.fn(() => {
      throw Error('never invoked');
    });
    const rejected = Promise.reject(Error('private rejection'));
    for (const result of [Promise.resolve(1), rejected, { then }]) {
      const d = decoder(() => result);
      expect(d.push(bytes)).toEqual({ decodedCount: 0, errorCode: 'callback-failed', fatal: true });
      expect(d.pendingBytes()).toBe(0);
    }
    expect(then).not.toHaveBeenCalled();
    const accessor = {
      get then() {
        throw Error('private getter');
      },
    };
    expect(decoder(() => accessor).push(bytes).errorCode).toBe('callback-failed');
    await new Promise((resolve) => setImmediate(resolve));
  });

  it.each(['own-then', 'constructor', 'species', 'constructor-shadowed', 'species-shadowed'])(
    'bounds native promise rejection observation for %s in a disposable child',
    (mode) => {
      const script = path.resolve('tests/fixtures/sensor-wire/promise-probe.cjs');
      const subject = fileURLToPath(
        new URL('../../../src/main/platform/sensor-protocol.js', import.meta.url),
      );
      const result = JSON.parse(
        execFileSync(process.execPath, [script, subject, mode], {
          timeout: 5000,
          maxBuffer: 8192,
          encoding: 'utf8',
          windowsHide: true,
          env: process.env,
        }),
      );
      expect(result.result).toEqual({ decodedCount: 0, errorCode: 'callback-failed', fatal: true });
      expect(result.terminal).toEqual(result.result);
      expect(result.unhandled).toBe(mode === 'own-then' ? 0 : 1);
      expect(result.getterCalls).toBe(mode === 'own-then' ? 0 : 1);
      expect(result.descriptorUnchanged).toBe(true);
    },
  );

  it.each(['push', 'finish'])('rejects recursive %s and reports it in the outer call', (method) => {
    const bytes = frame('{"t":"ack","id":1}');
    let nested;
    let attempted = false;
    const d = decoder(() => {
      if (!attempted) {
        attempted = true;
        nested = method === 'push' ? d.push(bytes) : d.finish();
      }
    });
    expect(d.push(Buffer.concat([bytes, bytes]))).toEqual({
      decodedCount: 0,
      errorCode: 'decoder-reentrant',
      fatal: true,
    });
    expect(nested.errorCode).toBe('decoder-reentrant');
    expect(d.pendingBytes()).toBe(0);
    expect(d.push(bytes).errorCode).toBe('decoder-reentrant');
  });
});
