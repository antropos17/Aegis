import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import protocol from '../../../src/main/platform/sensor-protocol.js';

const directory = path.resolve('tests/fixtures/sensor-wire');
const cases = JSON.parse(fs.readFileSync(path.join(directory, 'cases.json'), 'utf8'));
describe('sensor/1 independent binary goldens', () => {
  it.each(cases)('$name agrees with independent bytes and literal expected JSON', (entry) => {
    const expected = JSON.parse(entry.json);
    const bytes = fs.readFileSync(path.join(directory, `${entry.name}.bin`));
    expect(bytes.readUInt32LE(0)).toBe(Buffer.byteLength(entry.json));
    expect(bytes.subarray(4).toString('utf8')).toBe(entry.json);
    expect(protocol.encodeFrame(expected, { direction: entry.direction })).toEqual(bytes);
    const delivered = [];
    const decoder = protocol.createFrameDecoder({
      direction: entry.direction,
      onMessage: (value) => delivered.push(value),
    });
    expect(decoder.push(bytes)).toEqual({ decodedCount: 1, errorCode: null, fatal: false });
    expect(delivered).toEqual([expected]);
    expect(decoder.finish()).toEqual({ decodedCount: 0, errorCode: null, fatal: false });
  });

  it('exports exactly the three public functions', () => {
    expect(Object.keys(protocol).sort()).toEqual([
      'createFrameDecoder',
      'encodeFrame',
      'validateMessage',
    ]);
  });

  it('returns fresh projections of all mutable nested values', () => {
    for (const entry of cases) {
      const input = JSON.parse(entry.json);
      const output = protocol.validateMessage(input, { direction: entry.direction });
      function distinct(a, b) {
        if (a && typeof a === 'object') {
          expect(a).not.toBe(b);
          for (const key of Object.keys(a)) distinct(a[key], b[key]);
        }
      }
      expect(output).toEqual(input);
      distinct(input, output);
    }
  });
});

describe('direct JS inputs admit data without executing caller code', () => {
  it('rejects a wide hostile record within a linear key-membership operation budget', () => {
    const message = { t: 'health', state: 'HEALTHY', detail: 'ready' };
    for (let index = 0; index < 256; index++) message[`extra-${index}`] = index;
    const keyCount = Reflect.ownKeys(message).length;
    const includes = Array.prototype.includes;
    let comparisons = 0;
    let code;
    const membership = vi.spyOn(Array.prototype, 'includes').mockImplementation(function (
      value,
      ...args
    ) {
      // Count actual candidate comparisons only for this hostile key array.
      // Other membership operations retain their ordinary intrinsic behavior.
      if (this.length === keyCount && this[0] === 't' && args.length === 0) {
        for (let index = 0; index < this.length; index++) {
          comparisons++;
          if (this[index] === value) return true;
        }
        return false;
      }
      return includes.call(this, value, ...args);
    });
    try {
      protocol.validateMessage(message, { direction: 'sensor-to-host' });
    } catch (error) {
      code = error.code;
    } finally {
      membership.mockRestore();
    }
    expect(code).toBe('message-invalid');
    expect(comparisons).toBeLessThanOrEqual(keyCount * 2);
  });
  function reject(message, direction = 'sensor-to-host', options = { direction }) {
    for (const fn of [protocol.validateMessage, protocol.encodeFrame])
      expect(() => fn(message, options)).toThrowError('message-invalid');
  }
  function sample(name) {
    return JSON.parse(cases.find((entry) => entry.name === name).json);
  }

  it('rejects changing capability getters before private toJSON can run', () => {
    const message = sample('hello-ebpf');
    const toJSON = vi.fn(() => 'private payload');
    const getter = vi.fn().mockReturnValueOnce(true).mockReturnValue({ toJSON });
    Object.defineProperty(message.caps, 'exec', { enumerable: true, get: getter });
    reject(message);
    expect(getter).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
  });

  it('rejects nested/witness/discriminator/options accessors without invoking them', () => {
    for (const [name, locate, key] of [
      ['hello-ebpf', (v) => v.versions.clockAnchor, 'clock'],
      ['events-linux', (v) => v.events[0], 'kind'],
      ['events-linux', (v) => v.events[0].witness, 'kind'],
      ['hello-ebpf', (v) => v, 'caps'],
    ]) {
      const message = sample(name),
        getter = vi.fn(() => {
          throw Error('private');
        });
      Object.defineProperty(locate(message), key, { enumerable: true, get: getter });
      reject(message);
      expect(getter).not.toHaveBeenCalled();
    }
    const getter = vi.fn(() => 'sensor-to-host');
    const options = Object.defineProperty({}, 'direction', { enumerable: true, get: getter });
    reject(sample('health'), undefined, options);
    expect(() =>
      protocol.createFrameDecoder({
        get direction() {
          return getter();
        },
        onMessage() {},
      }),
    ).toThrowError('message-invalid');
    expect(getter).not.toHaveBeenCalled();
    const callback = vi.fn(() => () => {});
    const callbackOptions = { direction: 'sensor-to-host' };
    Object.defineProperty(callbackOptions, 'onMessage', { enumerable: true, get: callback });
    expect(() => protocol.createFrameDecoder(callbackOptions)).toThrowError('message-invalid');
    expect(callback).not.toHaveBeenCalled();
  });

  it('rejects overridden array methods, hidden/Symbol extras and nonstandard prototypes', () => {
    const message = sample('paths'),
      map = vi.fn(() => ['private payload']);
    Object.defineProperty(message.prefixes, 'map', { value: map });
    reject(message, 'host-to-sensor');
    expect(map).not.toHaveBeenCalled();
    const indexed = sample('paths');
    Object.defineProperty(indexed.prefixes, '0', { get: map });
    reject(indexed, 'host-to-sensor');
    expect(map).not.toHaveBeenCalled();
    for (const key of ['hidden', Symbol('hidden')]) {
      const record = sample('health');
      Object.defineProperty(record, key, { value: 'private' });
      reject(record);
      const arrayMessage = sample('paths');
      Object.defineProperty(arrayMessage.prefixes, key, { value: 1 });
      reject(arrayMessage, 'host-to-sensor');
    }
    const record = Object.assign(Object.create({}), sample('health'));
    reject(record);
    const arrayMessage = sample('paths');
    Object.setPrototypeOf(arrayMessage.prefixes, null);
    reject(arrayMessage, 'host-to-sensor');
    const normal = Object.assign(Object.create(null), sample('health'));
    expect(protocol.validateMessage(normal, { direction: 'sensor-to-host' })).toEqual(
      sample('health'),
    );
  });

  it('rejects proxies before any reflection trap at root, nested, array or options boundaries', () => {
    const trap = vi.fn(() => {
      throw Error('trap must not run');
    });
    const proxied = (value) =>
      new Proxy(value, {
        get: trap,
        ownKeys: trap,
        getPrototypeOf: trap,
        getOwnPropertyDescriptor: trap,
      });
    reject(proxied(sample('health')));
    const nested = sample('hello-ebpf');
    nested.caps = proxied(nested.caps);
    reject(nested);
    const arrayMessage = sample('paths');
    arrayMessage.prefixes = proxied(arrayMessage.prefixes);
    reject(arrayMessage, 'host-to-sensor');
    reject(sample('health'), undefined, proxied({ direction: 'sensor-to-host' }));
    expect(() =>
      protocol.createFrameDecoder(proxied({ direction: 'sensor-to-host', onMessage() {} })),
    ).toThrowError('message-invalid');
    expect(() =>
      protocol.createFrameDecoder({
        direction: 'sensor-to-host',
        onMessage: new Proxy(() => {}, { apply: trap }),
      }),
    ).toThrowError('message-invalid');
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    reject(revoked.proxy);
    expect(trap).not.toHaveBeenCalled();
  });
});
