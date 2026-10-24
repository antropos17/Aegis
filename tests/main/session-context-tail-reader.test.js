import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { createSessionContext } = require('../../src/main/session-context');
const { createSessionContextReader } = require('../../src/main/session-context-reader');
const MAX = 512 * 1024;
const file = '/owned/PRIVATE_TRANSCRIPT.jsonl';
const selection = { sessionId: 'session-local', cwd: '/work', platform: 'posix', format: 'jsonl' };
const fixture = (name = 'claude') =>
  readFileSync(new URL(`../fixtures/session-context/${name}.jsonl`, import.meta.url));

function large(suffix = fixture(), size = MAX + 2048) {
  const bytes = Buffer.alloc(size, 32);
  for (let n = 4095; n < size; n += 4096) bytes[n] = 10;
  suffix.copy(bytes, size - suffix.length);
  return bytes;
}

function model(bytes = large()) {
  const state = {
    kind: 'regular',
    symlink: false,
    reparse: false,
    volumeId: '1',
    fileId: '2',
    size: bytes.length,
    mtimeNs: '100',
    ctimeNs: '200',
  };
  const seen = [];
  const handle = {
    stat: vi.fn(async () => ({ ...state })),
    close: vi.fn(async () => {}),
    read: vi.fn(async (target, offset, length, position) => {
      seen.push(target);
      return bytes.copy(target, offset, position, Math.min(position + length, bytes.length));
    }),
  };
  const files = {
    pathStyle: 'posix',
    statPath: vi.fn(async () => ({ ...state })),
    openRead: vi.fn(async () => handle),
  };
  const owner = createSessionContext({ digestKey: Buffer.alloc(32, 7) });
  const adapter = { parse: vi.fn((...args) => owner.parse(...args)) };
  return {
    bytes,
    state,
    seen,
    files,
    handle,
    adapter,
    owner,
    reader: createSessionContextReader({ adapter, files }),
  };
}

const tail = (m, selected = selection, source = 'claude-code') =>
  m.reader.readTail(source, file, selected);
const wiped = (m) => m.seen.every((b) => b.every((v) => v === 0));

describe('explicit bounded JSONL session tail preparation', () => {
  it('retains a recent Claude call with incomplete source and exactly inferred association', async () => {
    const m = model(),
      batch = await tail(m, { ...selection, headTruncated: false });
    expect(batch).toMatchObject({ availability: 'partial', reasons: ['truncated-input'] });
    expect(batch.calls).toHaveLength(1);
    expect(batch.calls[0].toolName).toBe('Read');
    const startTime = Date.parse('2026-10-19T10:00:00.000Z');
    const proc = { pid: 42, startTime, instanceId: `42:${startTime}`, cwd: '/work' };
    const binding = m.owner.bind(batch, proc, {
      sessionId: selection.sessionId,
      pid: 42,
      processStartTime: startTime,
      cwd: '/work',
      oneToOne: true,
      provenance: 'verified-local-registry',
    });
    expect(binding.strength).toBe('inferred');
    const result = m.owner.correlate(
      {
        instanceId: proc.instanceId,
        atMs: startTime + 1200,
        objectKind: 'path',
        objectValue: '/work/private.env',
      },
      [binding],
      { clockSkewMs: 0, missingEndToleranceMs: 1500 },
    );
    expect(result.strength).toBe('inferred');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      toolName: 'Read',
      callRef: batch.calls[0].callRef,
    });
    expect(JSON.stringify({ batch, binding, result })).not.toMatch(
      /PRIVATE_|\/work|session-local|call-local/,
    );
    expect(m.handle.read.mock.calls[0][3]).toBe(m.bytes.length - MAX);
    expect(m.handle.read.mock.calls.at(-1).slice(1)).toEqual([0, 1, m.bytes.length]);
    expect(m.handle.read).toHaveBeenCalledTimes(9);
    expect(m.handle.read.mock.calls.every((c) => c[2] <= 64 * 1024)).toBe(true);
    expect(new Set(m.seen.map((b) => b.buffer)).size).toBe(2);
    expect(Math.max(...m.seen.map((b) => b.length))).toBe(MAX);
    expect(m.handle.close).toHaveBeenCalledTimes(1);
    expect(wiped(m)).toBe(true);
  });

  it('keeps complete-file semantics through the exact512KiB boundary and leaves read() capped', async () => {
    for (const bytes of [fixture(), large(fixture(), MAX)]) {
      const m = model(bytes),
        batch = await tail(m);
      expect(batch.availability).toBe('available');
      expect(batch.calls).toHaveLength(1);
      expect(batch.reasons).not.toContain('truncated-input');
      expect(m.handle.read.mock.calls[0][3]).toBe(0);
    }
    const m = model();
    expect((await m.reader.read('claude-code', file, selection)).availability).toBe('unavailable');
    expect(m.files.openRead).not.toHaveBeenCalled();
  });

  it('drops a split leading UTF8 byte line before decoding and retains the first full row once', async () => {
    const bytes = Buffer.alloc(MAX + 2048, 32);
    Buffer.from([0x82, 0xac, 10]).copy(bytes, 2048);
    fixture().copy(bytes, 2051);
    bytes[bytes.length - 1] = 10;
    const m = model(bytes),
      batch = await tail(m);
    expect(bytes[bytes.length - MAX]).toBe(0x82);
    expect(batch.reasons).toEqual(['truncated-input']);
    expect(batch.calls).toHaveLength(1);
    expect(batch.calls[0].endMs).toBe(Date.parse('2026-10-19T10:00:01.600Z'));
    expect(m.adapter.parse.mock.calls[0][2].headTruncated).toBe(true);
    expect(wiped(m)).toBe(true);
    const invalid = large(Buffer.concat([Buffer.from([255, 10]), fixture()]));
    const rejected = await tail(model(invalid));
    expect(rejected.availability).toBe('unavailable');
    expect(rejected.reasons).toContain('invalid-encoding-or-json');
    expect(rejected.calls).toEqual([]);
  });

  it('does not invent records for a tail without LF and drops an incomplete final record', async () => {
    const empty = await tail(model(Buffer.alloc(MAX + 1, 32)));
    expect(empty.availability).toBe('unavailable');
    expect(empty.calls).toEqual([]);
    expect(empty.reasons).toContain('truncated-input');
    const partial = await tail(
      model(large(Buffer.concat([fixture(), Buffer.from('{"PRIVATE_PARTIAL":')]))),
    );
    expect(partial.availability).toBe('partial');
    expect(partial.calls).toHaveLength(1);
    expect(partial.reasons).toEqual(['truncated-input']);
  });

  it.each([
    ['codex', 'codex'],
    ['gemini-cli', 'gemini'],
  ])('never synthesizes missing %s session metadata', async (source, name) => {
    const rows = fixture(name).toString().split('\n').slice(1).join('\n');
    const batch = await tail(model(large(Buffer.from(rows))), selection, source);
    expect(batch.availability).toBe('unavailable');
    expect(batch.reasons).toContain('session-metadata-unavailable');
    expect(batch.calls).toEqual([]);
  });

  it.each([
    { format: 'json' },
    { format: undefined },
    { headTruncated: true },
    { tailTruncated: true },
  ])('requires an explicit whole JSONL selection before IO: %j', async (patch) => {
    const m = model(),
      batch = await tail(m, { ...selection, ...patch });
    expect(batch.availability).toBe('unavailable');
    expect(m.files.statPath).not.toHaveBeenCalled();
  });

  it.each(['opened-id', 'post-id', 'post-size', 'post-mtime', 'post-ctime', 'path-id'])(
    'refuses changed full-file metadata before parsing: %s',
    async (race) => {
      const m = model();
      const patch = race.endsWith('id')
        ? { fileId: '3' }
        : race === 'post-size'
          ? { size: m.state.size + 1 }
          : race === 'post-mtime'
            ? { mtimeNs: '101' }
            : { ctimeNs: '201' };
      if (race === 'opened-id') m.handle.stat.mockResolvedValue({ ...m.state, ...patch });
      else if (race === 'path-id')
        m.files.statPath
          .mockResolvedValueOnce({ ...m.state })
          .mockResolvedValue({ ...m.state, ...patch });
      else
        m.handle.stat
          .mockResolvedValueOnce({ ...m.state })
          .mockResolvedValue({ ...m.state, ...patch });
      const batch = await tail(m);
      expect(batch).toMatchObject({ availability: 'unavailable', calls: [] });
      expect(m.adapter.parse.mock.calls[0][1]).toBeNull();
      expect(m.handle.close).toHaveBeenCalledTimes(1);
      expect(wiped(m)).toBe(true);
    },
  );

  it('rejects EOF growth even with unchanged metadata, and bounds hostile short read counts', async () => {
    for (const mode of ['growth', 'zero', 'too-many', 'invalid']) {
      const m = model(),
        original = m.handle.read.getMockImplementation();
      m.handle.read.mockImplementation(async (target, offset, length, position) => {
        if (mode === 'growth' && position === m.bytes.length) {
          target[0] = 7;
          m.seen.push(target);
          return 1;
        }
        if (mode === 'zero') return 0;
        if (mode === 'invalid') return length + 1;
        return original(target, offset, mode === 'too-many' ? 1 : length, position);
      });
      const batch = await tail(m);
      expect(batch.availability).toBe('unavailable');
      expect(m.adapter.parse.mock.calls[0][1]).toBeNull();
      expect(m.handle.read.mock.calls.length).toBeLessThanOrEqual(17);
      expect(m.handle.close).toHaveBeenCalledTimes(1);
      expect(wiped(m)).toBe(true);
    }
    const m = model(),
      original = m.handle.read.getMockImplementation();
    m.handle.read.mockImplementation((target, offset, length, position) =>
      original(target, offset, Math.min(length, 32 * 1024), position),
    );
    expect((await tail(m)).calls).toHaveLength(1);
    expect(m.handle.read).toHaveBeenCalledTimes(17);
  });

  it.each(['statPath', 'openRead', 'stat', 'read', 'close'])(
    'sanitizes %s errors, wipes owned bytes and closes an acquired handle once',
    async (op) => {
      const m = model(),
        fail = async () => {
          throw Error('PRIVATE_IO ' + file);
        };
      (['statPath', 'openRead'].includes(op) ? m.files[op] : m.handle[op]).mockImplementation(fail);
      const batch = await tail(m);
      expect(batch).toMatchObject({ availability: 'unavailable', calls: [] });
      expect(JSON.stringify(batch)).not.toMatch(/PRIVATE_|\/owned/);
      expect(m.handle.close).toHaveBeenCalledTimes(['statPath', 'openRead'].includes(op) ? 0 : 1);
      expect(wiped(m)).toBe(true);
    },
  );

  it('sanitizes parser errors and clears its retained buffer view on rejection', async () => {
    const m = model();
    m.adapter.parse.mockImplementation(() => {
      throw Error('PRIVATE_PARSE ' + file);
    });
    await expect(tail(m)).rejects.toThrow(/^session-reader-unavailable$/);
    expect(wiped(m)).toBe(true);
    expect(m.handle.close).toHaveBeenCalledTimes(1);
  });
});
