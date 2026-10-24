import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { model, selected, selection, state } from './helpers/windows-session-context-model.js';
const require = createRequire(import.meta.url);
const { createSessionContext } = require('../../src/main/session-context');
const MAX = 512 * 1024;
const tailSelection = { ...selection, sessionId: 'session-local', format: 'jsonl' };
const fixture = (name = 'claude') =>
  readFileSync(new URL(`../fixtures/session-context/${name}.jsonl`, import.meta.url));
function large(suffix = fixture(), size = MAX + 2048) {
  const bytes = Buffer.alloc(size, 32);
  for (let n = 4095; n < size; n += 4096) bytes[n] = 10;
  suffix.copy(bytes, size - suffix.length);
  return bytes;
}
const tail = (m, chosen = tailSelection, source = 'claude-code') =>
  m.reader().readTail(source, selected, chosen);
async function opened(m) {
  const io = m.io();
  await io.tailFiles.statPath(selected);
  const handle = await io.tailFiles.openRead(selected);
  await handle.stat();
  return { io, handle };
}

describe('Windows explicit stable-file JSONL tails', () => {
  it('preserves real owner bytes, incomplete source, privacy and inferred association', async () => {
    const m = model({ bytes: large() });
    const owner = createSessionContext({ digestKey: Buffer.alloc(32, 7) });
    const copies = [];
    m.adapter.parse.mockImplementation((...args) => {
      m.events.push('parse');
      copies.push(args[1] && Buffer.from(args[1]));
      return owner.parse(...args);
    });
    const batch = await tail(m);
    expect(batch).toBe(m.adapter.parse.mock.results[0].value);
    expect(batch).toMatchObject({ availability: 'partial', reasons: ['truncated-input'] });
    expect(batch.calls).toHaveLength(1);
    expect(batch.calls[0].toolName).toBe('Read');
    const cut = m.bytes.length - MAX;
    expect(copies[0]).toEqual(m.bytes.subarray(m.bytes.indexOf(10, cut)));
    expect(m.adapter.parse.mock.calls[0][1].every((byte) => byte === 0)).toBe(true);
    expect(m.events.indexOf('cleanup')).toBeLessThan(m.events.indexOf('parse'));
    expect(m.events[0]).toBe('tail');
    const requests = m.pipe.request.mock.calls.map(([body]) => body);
    const reads = requests.filter((body) => body.op === 'read');
    expect(reads[0].position).toBe(cut);
    expect(reads.at(-1)).toEqual({ op: 'read', length: 1, position: m.bytes.length });
    expect(reads).toHaveLength(9);
    expect(reads.slice(0, -1).reduce((n, body) => n + body.length, 0)).toBe(MAX);
    expect(reads.every((body) => body.length <= 64 * 1024)).toBe(true);
    const startTime = Date.parse('2026-10-19T10:00:00.000Z');
    const proc = { pid: 42, startTime, instanceId: `42:${startTime}`, cwd: '/work' };
    const binding = owner.bind(batch, proc, {
      sessionId: tailSelection.sessionId,
      pid: 42,
      processStartTime: startTime,
      cwd: '/work',
      oneToOne: true,
      provenance: 'verified-local-registry',
    });
    const result = owner.correlate(
      {
        instanceId: proc.instanceId,
        atMs: startTime + 1200,
        objectKind: 'path',
        objectValue: '/work/private.env',
      },
      [binding],
      { clockSkewMs: 0, missingEndToleranceMs: 1500 },
    );
    expect(binding.strength).toBe('inferred');
    expect(result.strength).toBe('inferred');
    expect(result.candidates).toHaveLength(1);
    expect(JSON.stringify({ batch, binding, result })).not.toMatch(
      /PRIVATE_|\/work|session-local|call-local/,
    );
    copies[0].fill(0);
  });

  it('retains whole-file semantics below the boundary and complete-read oversize refusal', async () => {
    for (const bytes of [fixture(), large(fixture(), MAX)]) {
      const m = model({ bytes });
      const owner = createSessionContext({ digestKey: Buffer.alloc(32, 7) });
      m.adapter.parse.mockImplementation((...args) => owner.parse(...args));
      expect((await tail(m)).availability).toBe('available');
      expect(m.pipe.request.mock.calls.find(([body]) => body.op === 'read')[0].position).toBe(0);
    }
    const m = model({ bytes: large() });
    expect((await m.reader().read('claude-code', selected, tailSelection)).available).toBe(false);
    expect(m.events[0]).toBe('open');
    expect(m.pipe.request.mock.calls.some(([body]) => body.op === 'read')).toBe(false);
    expect(m.adapter.parse).toHaveBeenCalledTimes(1);
    expect(m.adapter.parse.mock.calls[0][1]).toBeNull();
    expect(m.events.indexOf('cleanup')).toBeLessThan(m.events.indexOf('parse'));
  });

  it.each([
    ['read', 'readTail'],
    ['readTail', 'read'],
    ['readTail', 'readTail'],
  ])('shares one use between %s and %s', async (first, second) => {
    const m = model({ bytes: fixture() }),
      reader = m.reader();
    await reader[first]('claude-code', selected, tailSelection);
    await expect(reader[second]('claude-code', selected, tailSelection)).rejects.toThrow(
      'session-windows-io-failed',
    );
    expect(m.adapter.parse).toHaveBeenCalledTimes(1);
    expect(m.spawn).toHaveBeenCalledTimes(1);
  });

  it.each([
    { format: 'json' },
    { format: undefined },
    { headTruncated: true },
    { tailTruncated: true },
  ])('refuses an invalid tail selection before spawning: %j', async (patch) => {
    const m = model();
    expect((await tail(m, { ...tailSelection, ...patch })).available).toBe(false);
    expect(m.spawn).not.toHaveBeenCalled();
  });

  it.each([
    { size: Number.MAX_SAFE_INTEGER + 1 },
    { size: -1 },
    { reparse: true },
    { fileId: '0' },
  ])('closes before unavailable parsing on bad full-file proof: %j', async (patch) => {
    const m = model({ state: patch });
    expect((await tail(m)).available).toBe(false);
    expect(m.events.indexOf('cleanup')).toBeLessThan(m.events.indexOf('parse'));
    expect(m.adapter.parse.mock.calls[0][1]).toBeNull();
  });

  it('uses exact safe-integer suffix positions without allocating the full file', async () => {
    const size = Number.MAX_SAFE_INTEGER;
    const m = model({
      state: { size },
      mapResponse: (body, value) =>
        body.op === 'read'
          ? {
              ...value,
              data: body.position === size ? '' : Buffer.alloc(body.length, 10).toString('base64'),
            }
          : value,
    });
    expect((await tail(m)).available).toBe(true);
    const reads = m.pipe.request.mock.calls
      .map(([body]) => body)
      .filter((body) => body.op === 'read');
    expect(reads[0].position).toBe(size - MAX);
    expect(reads.at(-1).position).toBe(size);
    expect(reads.every((body) => Number.isSafeInteger(body.position))).toBe(true);
  });

  it.each([0, 2047, 2049, 2048.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects a first offset outside the fixed suffix: %s',
    async (at) => {
      const m = model({ bytes: large() }),
        { io, handle } = await opened(m);
      await expect(handle.read(Buffer.alloc(1), 0, 1, at)).rejects.toThrow();
      expect(m.pipe.request.mock.calls.filter(([body]) => body.op === 'read')).toHaveLength(0);
      expect(io.status().closed).toBe(true);
    },
  );

  it('refuses rewinds and cross-mode lease mixing', async () => {
    const m = model({ bytes: large() }),
      { io, handle } = await opened(m);
    await handle.read(Buffer.alloc(1), 0, 1, 2048);
    await expect(handle.read(Buffer.alloc(1), 0, 1, 2048)).rejects.toThrow();
    expect(io.status().closed).toBe(true);
    const mixed = model({ bytes: large() }),
      other = mixed.io();
    await other.tailFiles.statPath(selected);
    await expect(other.files.openRead(selected)).rejects.toThrow();
    expect(other.status().closed).toBe(true);
    const reversed = model(),
      full = reversed.io();
    await full.files.statPath(selected);
    await expect(full.tailFiles.openRead(selected)).rejects.toThrow();
    expect(full.status().closed).toBe(true);
  });

  it('independently caps the IO provider at sixteen positive reads', async () => {
    const m = model({ bytes: large() }),
      { io, handle } = await opened(m);
    for (let n = 0; n < 16; n++) await handle.read(Buffer.alloc(1), 0, 1, 2048 + n);
    await expect(handle.read(Buffer.alloc(1), 0, 1, 2064)).rejects.toThrow();
    expect(m.pipe.request.mock.calls.filter(([body]) => body.op === 'read')).toHaveLength(16);
    expect(io.status().closed).toBe(true);
  });

  it('enforces chunk size and refuses repeated EOF after a complete bounded window', async () => {
    const m = model({ bytes: large() }),
      { handle } = await opened(m);
    const buffer = Buffer.alloc(64 * 1024);
    for (let n = 0; n < 8; n++)
      await handle.read(buffer, 0, buffer.length, 2048 + n * buffer.length);
    expect(await handle.read(Buffer.alloc(1), 0, 1, m.bytes.length)).toBe(0);
    await expect(handle.read(Buffer.alloc(1), 0, 1, m.bytes.length)).rejects.toThrow();
    const oversized = model({ bytes: large() }),
      lease = await opened(oversized);
    await expect(lease.handle.read(Buffer.alloc(65537), 0, 65537, 2048)).rejects.toThrow();
  });

  it.each(['eof', 'post-id', 'post-size', 'post-mtime', 'post-ctime', 'path-id'])(
    'does not delegate bytes after failed final proof: %s',
    async (failure) => {
      let handleStats = 0;
      const m = model({
        bytes: large(),
        mapResponse: (body, value) => {
          if (failure === 'eof' && body.op === 'read' && body.position === MAX + 2048)
            return { ...value, data: 'eA==' };
          if (failure === 'path-id' && body.op === 'stat' && body.scope === 'path')
            return { ...value, fileId: state.fileId.slice(0, -1) + '3' };
          if (body.op === 'stat' && body.scope === 'handle' && ++handleStats === 2) {
            const patch = {
              'post-id': { fileId: state.fileId.slice(0, -1) + '3' },
              'post-size': { size: MAX + 2049 },
              'post-mtime': { mtimeNs: '101' },
              'post-ctime': { ctimeNs: '201' },
            }[failure];
            return { ...value, ...patch };
          }
          return value;
        },
      });
      expect((await tail(m)).available).toBe(false);
      expect(m.adapter.parse.mock.calls[0][1]).toBeNull();
      expect(m.events.indexOf('cleanup')).toBeLessThan(m.events.indexOf('parse'));
    },
  );

  it('suppresses parsing entirely on unconfirmed stream closure', async () => {
    const m = model({ bytes: large() });
    m.status.streams = 'unknown';
    await expect(tail(m)).rejects.toThrow('session-windows-io-failed');
    expect(m.adapter.parse).not.toHaveBeenCalled();
  });

  it('preserves byte-line trimming and never invents missing session metadata', async () => {
    const bytes = Buffer.alloc(MAX + 2048, 32);
    Buffer.from([0x82, 0xac, 10]).copy(bytes, 2048);
    fixture().copy(bytes, 2051);
    bytes[bytes.length - 1] = 10;
    const samples = [
      ['claude-code', bytes, 'partial', 1],
      ['claude-code', large(Buffer.concat([Buffer.from([255, 10]), fixture()])), 'unavailable', 0],
      [
        'claude-code',
        large(Buffer.concat([fixture(), Buffer.from('{"PRIVATE_PARTIAL":')])),
        'partial',
        1,
      ],
      [
        'codex',
        large(Buffer.from(fixture('codex').toString().split('\n').slice(1).join('\n'))),
        'unavailable',
        0,
      ],
      [
        'gemini-cli',
        large(Buffer.from(fixture('gemini').toString().split('\n').slice(1).join('\n'))),
        'unavailable',
        0,
      ],
    ];
    for (const [source, input, availability, calls] of samples) {
      const m = model({ bytes: input });
      const owner = createSessionContext({ digestKey: Buffer.alloc(32, 7) });
      m.adapter.parse.mockImplementation((...args) => owner.parse(...args));
      const batch = await tail(m, tailSelection, source);
      expect(batch.availability).toBe(availability);
      expect(batch.calls).toHaveLength(calls);
      expect(JSON.stringify(batch)).not.toMatch(/PRIVATE_|\/work|session-local|call-local/);
    }
  });
});
