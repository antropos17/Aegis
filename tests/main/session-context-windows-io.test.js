import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import {
  fixture,
  selected,
  selection,
  options,
  state,
  model,
} from './helpers/windows-session-context-model.js';
const require = createRequire(import.meta.url);

describe('private Windows explicit-file reader admission', () => {
  it('rejects absent asset pins before admitting private input', () => {
    const {
      createWindowsSessionContextReader,
    } = require('../../src/main/session-context-windows-reader');
    expect(() => createWindowsSessionContextReader({ adapter: { parse() {} } })).toThrow(
      'session-windows-io-failed',
    );
  });

  it('keeps lazy admission and exact existing-reader IO shape', () => {
    const m = model(),
      io = m.io();
    expect(m.spawn).not.toHaveBeenCalled();
    expect(Object.keys(io.files)).toEqual(['pathStyle', 'statPath', 'openRead']);
    expect(io.files.pathStyle).toBe('win32');
    expect(io.status()).toEqual({ started: false, closed: true, unknown: false });
  });

  it('parses synchronously after native-close acknowledgement and child cleanup', async () => {
    const m = model(),
      reader = m.reader();
    const result = await reader.read('claude-code', selected, selection);
    expect(result).toBe(m.adapter.parse.mock.results[0].value);
    expect(m.events).toEqual([
      'open',
      'stat',
      'read',
      'read',
      'stat',
      'stat',
      'close',
      'cleanup',
      'parse',
      'cleanup',
    ]);
    expect(m.adapter.parse.mock.calls[0][1]).toEqual(Buffer.alloc(fixture.length));
    expect(result.available).toBe(true);
    await expect(reader.read('claude-code', selected, selection)).rejects.toThrow(
      'session-windows-io-failed',
    );
    expect(m.adapter.parse).toHaveBeenCalledTimes(1);
  });

  it.each([
    { size: 512 * 1024 + 1 },
    { size: -1 },
    { fileId: '0' },
    { reparse: true },
    { mtimeNs: '1.5' },
    { ctimeNs: '18446744073709551616' },
  ])('awaits cleanup before null parse on rejected initial path proof %j', async (bad) => {
    const m = model({ response: async (_body, id) => ({ id, ok: true, ...state, ...bad }) });
    const result = await m.reader().read('claude-code', selected, selection);
    expect(result.available).toBe(false);
    expect(m.events.indexOf('cleanup')).toBeLessThan(m.events.indexOf('parse'));
    expect(m.adapter.parse.mock.calls[0][1]).toBeNull();
  });

  it('suppresses parse on unknown pre-open cleanup, including a later confirmed event', async () => {
    let release;
    const m = model({
      response: async () => {
        throw Error('PRIVATE_PATH');
      },
      cleanup: async () => {
        if (release) await release;
      },
    });
    m.status.exit = 'unknown';
    const reader = m.reader();
    await expect(reader.read('claude-code', selected, selection)).rejects.toThrow(
      'session-windows-io-failed',
    );
    expect(m.adapter.parse).not.toHaveBeenCalled();
    m.status.exit = 'confirmed';
    release = Promise.resolve();
    await expect(reader.read('claude-code', selected, selection)).rejects.toThrow(
      'session-windows-io-failed',
    );
    expect(m.adapter.parse).not.toHaveBeenCalled();
  });

  it('waits for original cleanup before propagating pre-open failure', async () => {
    let finish;
    const waiting = new Promise((resolve) => {
      finish = resolve;
    });
    const m = model({
      response: async () => {
        throw Error('private-canary');
      },
      cleanup: () => waiting,
    });
    const io = m.io();
    let settled = false;
    const operation = io.files.statPath(selected).catch(() => {
      settled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    finish();
    await operation;
    expect(io.status().closed).toBe(true);
  });

  it('does not parse successful bytes before unknown close resolves', async () => {
    const m = model();
    m.status.streams = 'unknown';
    await expect(m.reader().read('claude-code', selected, selection)).rejects.toThrow();
    expect(m.adapter.parse).not.toHaveBeenCalled();
  });

  it('keeps unknown sticky after a cleanup exception followed by confirmation', async () => {
    const m = model({
      cleanup: async (calls) => {
        if (calls === 1) throw Error('private-cleanup');
      },
    });
    const io = m.io();
    await io.files.statPath(selected);
    await expect(io.close()).rejects.toThrow('session-windows-io-failed');
    await expect(io.close()).rejects.toThrow('session-windows-io-failed');
    expect(io.status().unknown).toBe(true);
    expect(io.status().closed).toBe(false);
  });

  it('keeps unavailable owner batch for a lexical refusal without spawning', async () => {
    const m = model();
    const result = await m.reader().read('claude-code', '../bad', selection);
    expect(result.available).toBe(false);
    expect(m.spawn).not.toHaveBeenCalled();
    expect(m.adapter.parse).toHaveBeenCalledTimes(1);
  });

  it('refuses diagnostics enabled after open and awaits cleanup', async () => {
    const m = model(),
      io = m.io();
    await io.files.statPath(selected);
    m.guard.mockImplementation(() => {
      throw Error('debug-enabled');
    });
    await expect(io.files.openRead(selected)).rejects.toThrow('session-windows-io-failed');
    expect(io.status().closed).toBe(true);
    expect(m.pipe.request).toHaveBeenCalledTimes(1);
  });

  it('refuses mismatched selected path and closes retained lease', async () => {
    const m = model(),
      io = m.io();
    await io.files.statPath(selected);
    await expect(io.files.openRead('X:\\other')).rejects.toThrow();
    expect(io.status().closed).toBe(true);
  });

  it('validates buffer bounds and call admission before sending read', async () => {
    const m = model(),
      io = m.io();
    await io.files.statPath(selected);
    const handle = await io.files.openRead(selected);
    await handle.stat();
    await expect(handle.read(Buffer.alloc(1), 0, 65537, 0)).rejects.toThrow();
    expect(m.events).toEqual(['open', 'stat', 'cleanup']);
  });

  it('rejects a deferred Promise parser and suppresses result', async () => {
    const m = model();
    m.adapter.parse.mockImplementation(() => Promise.resolve({ available: true }));
    await expect(m.reader().read('claude-code', selected, selection)).rejects.toThrow();
    expect(m.pipe.close).toHaveBeenCalled();
  });

  it('pins original parsing owner and function across caller mutations', async () => {
    const m = model();
    const supplied = { ...options, adapter: m.adapter };
    const originalOwner = m.adapter;
    const originalParser = vi.fn(function (_source, raw) {
      expect(this).toBe(originalOwner);
      return Object.freeze({ available: raw !== null });
    });
    supplied.adapter.parse = originalParser;
    const reader = m.reader(supplied);
    const replacement = vi.fn(() => ({ available: false }));
    supplied.adapter = { parse: replacement };
    originalOwner.parse = replacement;
    const result = await reader.read('claude-code', selected, selection);
    expect(result.available).toBe(true);
    expect(originalParser).toHaveBeenCalledTimes(1);
    expect(replacement).not.toHaveBeenCalled();
  });
});
