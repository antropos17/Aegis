import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import protocol from '../../../src/main/platform/sensor-protocol.js';

const directory = path.resolve('tests/fixtures/sensor-wire');
const cases = JSON.parse(fs.readFileSync(path.join(directory, 'cases.json'), 'utf8'));
const fixture = (name) => JSON.parse(cases.find((entry) => entry.name === name).json);
const S = 'sensor-to-host',
  H = 'host-to-sensor';
function rejects(message, direction = S, code = 'message-invalid') {
  for (const fn of [protocol.validateMessage, protocol.encodeFrame])
    expect(() => fn(message, { direction })).toThrowError(
      expect.objectContaining({ code, message: code }),
    );
}

describe('message options, roots and private fields', () => {
  it('rejects unknown top-level fields without serializing private content', () => {
    for (const key of ['argv', 'environment', 'prompt', 'content', 'toJSON']) {
      const value = { ...fixture('health'), [key]: 'private metadata' };
      rejects(value);
    }
    const getter = { ...fixture('health') };
    Object.defineProperty(getter, 'state', {
      enumerable: true,
      get() {
        throw Error('private data');
      },
    });
    rejects(getter);
  });

  it('validates directions/options and unknown protocols with fixed errors', () => {
    rejects(fixture('health'), H);
    rejects(fixture('stop'), S);
    rejects(null);
    rejects([]);
    rejects(123);
    for (const options of [
      undefined,
      null,
      {},
      { direction: S, extra: true },
      { direction: 'both' },
    ]) {
      expect(() => protocol.validateMessage(fixture('health'), options)).toThrowError(
        'message-invalid',
      );
      expect(() => protocol.createFrameDecoder(options)).toThrowError('message-invalid');
    }
    for (const onMessage of [undefined, null, 1])
      expect(() => protocol.createFrameDecoder({ direction: S, onMessage })).toThrowError(
        'message-invalid',
      );
    const hello = fixture('hello-ebpf');
    hello.proto = 'sensor/future';
    rejects(hello, S, 'protocol-unsupported');
  });

  it('rejects unavailable, duplicate and cross-platform watch roots', () => {
    const value = fixture('watch-linux');
    for (const change of [
      (v) => {
        v.descendants = false;
      },
      (v) => {
        v.roots[0].identityError = null;
      },
      (v) => {
        v.roots[0].birth = null;
        v.roots[0].witness = null;
      },
      (v) => {
        v.roots.push({ ...v.roots[0] });
      },
      (v) => {
        const root = fixture('watch-darwin').roots[0];
        root.pid = 43;
        v.roots.push(root);
      },
    ]) {
      const input = structuredClone(value);
      change(input);
      rejects(input, H);
    }
  });
});

describe('arithmetic, field boundaries and bounded collections', () => {
  it('rejects direct negative zero in numeric fields that otherwise permit zero', () => {
    for (const [index, key] of [
      [0, 'ppid'],
      [0, 'argc'],
      [2, 'sport'],
    ]) {
      const value = fixture('events-linux');
      value.events[index][key] = -0;
      rejects(value);
    }
  });
  it.each(['0', '00', '01', ' 1', '1e3', '-1', '18446744073709551616', 1])(
    'requires a positive canonical u64 sequence %#',
    (seq) => {
      const value = fixture('mode-procfs');
      value.seq = seq;
      rejects(value);
    },
  );
  it('checks every event sequence and loss count without Number coercion', () => {
    for (const change of [
      (v) => {
        v.to = v.from;
      },
      (v) => {
        v.from = '9007199254740992';
      },
      (v) => {
        v.events[1].seq = v.events[0].seq;
      },
      (v) => {
        v.events = [];
      },
    ]) {
      const value = fixture('events-linux');
      change(value);
      rejects(value);
    }
    for (const count of ['18446744073709551614', '0', '18446744073709551616', 1]) {
      const value = fixture('loss-u64');
      value.count = count;
      rejects(value);
    }
    const reversed = fixture('loss-u64');
    reversed.from = reversed.to;
    reversed.to = '1';
    rejects(reversed);
  });

  it.each([0, -0, -1, 1.5, 4294967296, NaN, Infinity, '1'])(
    'rejects invalid request ID %#',
    (id) => {
      rejects({ t: 'stop', id }, H);
    },
  );

  it('enforces UTF-8 bytes, Unicode scalar validity and NUL exclusion', () => {
    const cases = [
      [
        'paths',
        H,
        (v, text) => {
          v.prefixes = [text];
        },
        4096,
      ],
      [
        'snapshot-linux',
        S,
        (v, text) => {
          v.procs[0].name = text;
        },
        256,
      ],
      [
        'hello-ebpf',
        S,
        (v, text) => {
          v.versions.sensor = text;
        },
        128,
      ],
    ];
    for (const [name, direction, set, limit] of cases) {
      const value = fixture(name);
      set(value, 'x'.repeat(limit));
      expect(protocol.validateMessage(value, { direction })).toEqual(value);
      for (const text of [
        '',
        'x'.repeat(limit + 1),
        'é'.repeat(limit),
        'x\0y',
        '\ud800',
        '\udc00',
      ]) {
        set(value, text);
        rejects(value, direction);
      }
    }
    const value = fixture('events-linux');
    value.events[0].argc = 4294967295;
    expect(protocol.validateMessage(value, { direction: S }).events[0].argc).toBe(4294967295);
    for (const pid of [0, -1, 2147483648, 1.5]) {
      value.events[0].pid = pid;
      rejects(value);
    }
  });

  it('accepts the exact finite collection ceilings and rejects one more', () => {
    const procs = Array.from({ length: 4096 }, (_, i) => ({
      ...fixture('snapshot-linux').procs[0],
      pid: i + 1,
    }));
    const snap = { t: 'snap', id: 1, procs };
    expect(protocol.validateMessage(snap, { direction: S }).procs).toHaveLength(4096);
    procs.push({ ...procs[0], pid: 5000 });
    rejects(snap);
    const roots = procs.slice(0, 4096).map(({ pid, birth, witness }) => ({ pid, birth, witness }));
    const watch = { t: 'watch', id: 1, roots, descendants: true };
    expect(protocol.validateMessage(watch, { direction: H }).roots).toHaveLength(4096);
    roots.push({ ...roots[0], pid: 5000 });
    rejects(watch, H);
    const prefixes = Array.from({ length: 1024 }, (_, i) => `/fixture/${i}`);
    const paths = { t: 'paths', id: 1, prefixes };
    expect(protocol.validateMessage(paths, { direction: H }).prefixes).toHaveLength(1024);
    prefixes.push('/fixture/extra');
    rejects(paths, H);
    paths.prefixes = ['/same', '/same'];
    rejects(paths, H);
    paths.prefixes = Array(1);
    rejects(paths, H);
    const events = Array.from({ length: 4096 }, (_, i) => ({
      ...fixture('events-linux').events[0],
      seq: String(i + 1),
    }));
    const batch = { t: 'evs', from: '1', to: '4096', events };
    expect(protocol.validateMessage(batch, { direction: S }).events).toHaveLength(4096);
    events.push({ ...events[0], seq: '4097' });
    batch.to = '4097';
    rejects(batch);
  });
});
