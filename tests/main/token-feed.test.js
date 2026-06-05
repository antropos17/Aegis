/**
 * @file token-feed.test.js
 * @description Unit suite for the extensible token-feed CORE — a thin registry
 *   that fans a `procs` list out to each registered adapter and concatenates the
 *   measured deltas. Adapters are faked via DI so the core is tested in isolation
 *   from any disk I/O.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import feed from '../../src/main/token-feed.js';

const { readUsageByPid, _setAdaptersForTest, _resetForTest } = feed;

const delta = (pid, inputTokens) => ({
  pid,
  model: 'claude-opus-4-8',
  inputTokens,
  outputTokens: 1,
  estimated: false,
});

const fakeAdapter = (id, impl) => ({
  id,
  readUsage: vi.fn(impl),
  _resetForTest: vi.fn(),
});

beforeEach(() => {
  _resetForTest();
});

describe('token-feed core — default registry', () => {
  it('ships the claude-code adapter and returns [] for empty procs', async () => {
    // default registry, no procs → no adapter does any disk I/O
    expect(await readUsageByPid([])).toEqual([]);
  });
});

describe('token-feed core — fan-out & concatenation', () => {
  it('flattens the deltas returned by a single adapter', async () => {
    _setAdaptersForTest([fakeAdapter('a', async () => [delta(1, 10), delta(2, 20)])]);
    expect(await readUsageByPid([{ pid: 1, startTime: 0 }])).toEqual([delta(1, 10), delta(2, 20)]);
  });

  it('concatenates results from multiple adapters in registration order', async () => {
    _setAdaptersForTest([
      fakeAdapter('a', async () => [delta(1, 10)]),
      fakeAdapter('b', async () => [delta(2, 20)]),
    ]);
    expect(await readUsageByPid([{ pid: 1, startTime: 0 }])).toEqual([delta(1, 10), delta(2, 20)]);
  });

  it('forwards the same procs to every adapter', async () => {
    const a = fakeAdapter('a', async () => []);
    const b = fakeAdapter('b', async () => []);
    _setAdaptersForTest([a, b]);
    const procs = [{ pid: 7, startTime: 123 }];
    await readUsageByPid(procs);
    expect(a.readUsage).toHaveBeenCalledWith(procs);
    expect(b.readUsage).toHaveBeenCalledWith(procs);
  });
});

describe('token-feed core — adapter failure isolation', () => {
  it('isolates a throwing adapter so others still contribute', async () => {
    _setAdaptersForTest([
      fakeAdapter('boom', async () => {
        throw new Error('adapter exploded');
      }),
      fakeAdapter('ok', async () => [delta(3, 30)]),
    ]);
    expect(await readUsageByPid([{ pid: 3, startTime: 0 }])).toEqual([delta(3, 30)]);
  });

  it('ignores a non-array adapter return without crashing', async () => {
    _setAdaptersForTest([
      fakeAdapter('weird', async () => null),
      fakeAdapter('ok', async () => [delta(4, 40)]),
    ]);
    expect(await readUsageByPid([{ pid: 4, startTime: 0 }])).toEqual([delta(4, 40)]);
  });
});

describe('token-feed core — reset', () => {
  it('_resetForTest restores the default registry (fake no longer called)', async () => {
    const fake = fakeAdapter('fake', async () => [delta(9, 99)]);
    _setAdaptersForTest([fake]);
    _resetForTest();
    await readUsageByPid([]);
    expect(fake.readUsage).not.toHaveBeenCalled();
  });
});
