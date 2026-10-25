import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { createSessionContext } = require('../../src/main/session-context');
const { createSessionContextReader } = require('../../src/main/session-context-reader');
const fixture = readFileSync(new URL('../fixtures/session-context/claude.jsonl', import.meta.url));
const selection = () => ({
  sessionId: 'session-local',
  cwd: '/work',
  platform: 'posix',
  format: 'jsonl',
  headTruncated: false,
  tailTruncated: false,
});

function model(large = false, gate = 'stat') {
  const bytes = large
    ? Buffer.concat([Buffer.alloc(512 * 1024 + 64, 32), Buffer.from('\n'), fixture])
    : fixture;
  const stamp = {
    kind: 'regular',
    symlink: false,
    reparse: false,
    volumeId: '1',
    fileId: '2',
    size: bytes.length,
    mtimeNs: '100',
    ctimeNs: '200',
  };
  let resume;
  const pending = new Promise((resolve) => {
    resume = resolve;
  });
  let reached;
  const entered = new Promise((resolve) => {
    reached = resolve;
  });
  async function pause(operation) {
    if (operation === gate) {
      reached();
      await pending;
    }
  }
  const handle = {
    stat: vi.fn(async () => ({ ...stamp })),
    read: vi.fn(async (target, offset, length, position) => {
      await pause('read');
      return bytes.copy(target, offset, position, Math.min(position + length, bytes.length));
    }),
    close: vi.fn(async () => {
      await pause('close');
    }),
  };
  const files = {
    pathStyle: 'posix',
    statPath: vi.fn(async () => {
      await pause('stat');
      return { ...stamp };
    }),
    openRead: vi.fn(async () => handle),
  };
  const owner = createSessionContext({ digestKey: Buffer.alloc(32, 7) });
  const adapter = { parse: vi.fn((...args) => owner.parse(...args)) };
  return {
    files,
    handle,
    adapter,
    owner,
    resume,
    entered,
    reader: createSessionContextReader({ files, adapter }),
  };
}

const read = (m, method, selected) =>
  m.reader[method]('claude-code', '/owned/PRIVATE_TRANSCRIPT.jsonl', selected);

describe('session reader selection custody across asynchronous IO', () => {
  it.each([
    ...['stat', 'read', 'close'].flatMap((gate) => [
      ['read', false, gate],
      ['readTail', false, gate],
      ['readTail', true, gate],
    ]),
  ])(
    'preserves initial identity, path semantics and format during %s (large=%s, gate=%s)',
    async (method, large, gate) => {
      const m = model(large, gate),
        selected = selection(),
        initial = { ...selected };
      selected.unrelated = { secret: 'PRIVATE_REFERENCE' };
      const pending = read(m, method, selected);
      await m.entered;
      Object.assign(selected, {
        sessionId: 'PRIVATE_OTHER_SESSION',
        cwd: 'X:/PRIVATE_OTHER',
        platform: 'win32',
        format: 'json',
        headTruncated: true,
        tailTruncated: true,
      });
      m.resume();
      const batch = await pending;
      expect(batch.availability).toBe(large ? 'partial' : 'available');
      expect(batch.calls).toHaveLength(1);
      const parsedSelection = m.adapter.parse.mock.calls[0][2];
      expect(parsedSelection).toEqual({ ...initial, headTruncated: large });
      expect(parsedSelection).not.toBe(selected);
      expect(Object.isFrozen(parsedSelection)).toBe(true);
      expect(JSON.stringify({ batch, parsedSelection })).not.toContain('PRIVATE_');
      const startTime = Date.parse('2026-10-19T10:00:00.000Z');
      const process = { pid: 42, startTime, instanceId: `42:${startTime}`, cwd: '/work' };
      const binding = m.owner.bind(batch, process, {
        sessionId: initial.sessionId,
        pid: 42,
        processStartTime: startTime,
        cwd: '/work',
        oneToOne: true,
        provenance: 'verified-local-registry',
      });
      const association = m.owner.correlate(
        {
          instanceId: process.instanceId,
          atMs: startTime + 1200,
          objectKind: 'path',
          objectValue: '/work/private.env',
        },
        [binding],
        { clockSkewMs: 0, missingEndToleranceMs: 1500 },
      );
      expect(binding.strength).toBe(large ? 'inferred' : 'confirmed');
      expect(association.strength).toBe(large ? 'inferred' : 'confirmed');
      expect(JSON.stringify({ batch, binding, association })).not.toMatch(
        /PRIVATE_|\/work|session-local|call-local/,
      );
      expect(m.handle.close).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['read', 'readTail'])(
    'does not accept a different initial session after caller mutation during %s',
    async (method) => {
      const m = model(),
        selected = { ...selection(), sessionId: 'PRIVATE_WRONG_SESSION' };
      const pending = read(m, method, selected);
      selected.sessionId = 'session-local';
      m.resume();
      const batch = await pending;
      expect(batch.availability).toBe('unavailable');
      expect(batch.reasons).toContain('session-mismatch');
      expect(batch.calls).toEqual([]);
      expect(JSON.stringify(batch)).not.toContain('PRIVATE_');
    },
  );

  it.each(['sessionId', 'cwd', 'platform', 'format', 'headTruncated', 'tailTruncated'])(
    'refuses accessor %s before IO without invoking it or exposing its error',
    async (key) => {
      const m = model(),
        selected = selection();
      const get = vi.fn(() => {
        throw Error('PRIVATE_ACCESSOR');
      });
      Object.defineProperty(selected, key, { get });
      const batch = await read(m, 'read', selected);
      expect(batch.availability).toBe('unavailable');
      expect(batch.calls).toEqual([]);
      expect(get).not.toHaveBeenCalled();
      expect(m.files.statPath).not.toHaveBeenCalled();
      expect(JSON.stringify(batch)).not.toContain('PRIVATE_');
    },
  );

  it('retains existing absent, undefined and false optional scalar semantics', async () => {
    for (const option of [
      {},
      { format: undefined },
      { headTruncated: false },
      { tailTruncated: false },
    ]) {
      const m = model(),
        selected = { sessionId: 'session-local', cwd: '/work', platform: 'posix', ...option };
      const pending = read(m, 'read', selected);
      m.resume();
      expect((await pending).availability).toBe('available');
    }
  });
});
