import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createBatcher } from '../../src/main/ipc-batcher.js';

describe('ipc-batcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // ── append mode ──

  describe('append mode', () => {
    it('batches events and flushes after intervalMs', () => {
      const send = vi.fn();
      const b = createBatcher('file-access', send, { intervalMs: 100 });
      b.push({ file: 'a.txt' });
      b.push({ file: 'b.txt' });
      expect(send).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      expect(send).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledWith('file-access', [{ file: 'a.txt' }, { file: 'b.txt' }]);
      b.destroy();
    });

    it('sends flat array, not nested', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, { intervalMs: 50 });
      b.push('ev1');
      b.push('ev2');
      b.push('ev3');
      vi.advanceTimersByTime(50);
      expect(send.mock.calls[0][1]).toEqual(['ev1', 'ev2', 'ev3']);
      b.destroy();
    });

    it('skips send when buffer is empty', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, { intervalMs: 50 });
      b.flush();
      expect(send).not.toHaveBeenCalled();
      b.destroy();
    });

    it('resets buffer after flush so next batch is independent', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, { intervalMs: 100 });
      b.push('a');
      vi.advanceTimersByTime(100);
      b.push('b');
      vi.advanceTimersByTime(100);
      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[0][1]).toEqual(['a']);
      expect(send.mock.calls[1][1]).toEqual(['b']);
      b.destroy();
    });

    it('manual flush sends immediately and cancels timer', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, { intervalMs: 200 });
      b.push('x');
      b.flush();
      expect(send).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(200);
      expect(send).toHaveBeenCalledOnce();
      b.destroy();
    });

    it('handles high-volume pushes correctly', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, { intervalMs: 150 });
      for (let i = 0; i < 500; i++) b.push({ i });
      vi.advanceTimersByTime(150);
      expect(send).toHaveBeenCalledOnce();
      expect(send.mock.calls[0][1]).toHaveLength(500);
      b.destroy();
    });
  });

  // ── latest mode ──

  describe('latest mode', () => {
    it('keeps only the most recent value', () => {
      const send = vi.fn();
      const b = createBatcher('stats', send, { intervalMs: 100, mode: 'latest' });
      b.push({ count: 1 });
      b.push({ count: 2 });
      b.push({ count: 3 });
      vi.advanceTimersByTime(100);
      expect(send).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledWith('stats', { count: 3 });
      b.destroy();
    });

    it('skips send when no value was pushed', () => {
      const send = vi.fn();
      const b = createBatcher('stats', send, { intervalMs: 100, mode: 'latest' });
      b.flush();
      expect(send).not.toHaveBeenCalled();
      b.destroy();
    });

    it('resets after flush', () => {
      const send = vi.fn();
      const b = createBatcher('stats', send, { intervalMs: 100, mode: 'latest' });
      b.push('first');
      vi.advanceTimersByTime(100);
      b.flush();
      expect(send).toHaveBeenCalledOnce();
      b.destroy();
    });
  });

  // ── destroy ──

  describe('destroy', () => {
    it('flushes remaining events on destroy', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, { intervalMs: 500 });
      b.push('a');
      b.push('b');
      b.destroy();
      expect(send).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledWith('ch', ['a', 'b']);
    });

    it('ignores pushes after destroy', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, { intervalMs: 100 });
      b.destroy();
      b.push('late');
      vi.advanceTimersByTime(100);
      expect(send).not.toHaveBeenCalled();
    });

    it('is safe to call destroy multiple times', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, { intervalMs: 100 });
      b.push('x');
      b.destroy();
      b.destroy();
      expect(send).toHaveBeenCalledOnce();
    });
  });

  // ── pushLazy ──

  describe('pushLazy (latest mode)', () => {
    it('ACCEPTANCE: N pushes inside one window build exactly ONE payload', () => {
      // The whole point. `latest` discards every value but the last, so N eager
      // getStats() calls compute N payloads to throw N-1 away. This is the counter that
      // goes red if the call sites revert to push(getStats()).
      const send = vi.fn();
      const produce = vi.fn(() => ({ built: true }));
      const b = createBatcher('stats-update', send, { intervalMs: 1000, mode: 'latest' });

      for (let i = 0; i < 25; i++) b.pushLazy(produce);
      expect(produce).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);
      expect(produce).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledWith('stats-update', { built: true });
      b.destroy();
    });

    it('the eager form still costs one build per push — the contrast the change removes', () => {
      const send = vi.fn();
      const produce = vi.fn(() => ({ built: true }));
      const b = createBatcher('stats-update', send, { intervalMs: 1000, mode: 'latest' });

      for (let i = 0; i < 25; i++) b.push(produce());
      expect(produce).toHaveBeenCalledTimes(25);

      vi.advanceTimersByTime(1000);
      expect(send).toHaveBeenCalledOnce();
      b.destroy();
    });

    it('resolves at flush, never at push', () => {
      const send = vi.fn();
      let n = 0;
      const b = createBatcher('ch', send, { intervalMs: 100, mode: 'latest' });
      b.pushLazy(() => ++n);
      vi.advanceTimersByTime(99);
      expect(n).toBe(0);
      vi.advanceTimersByTime(1);
      expect(n).toBe(1);
      expect(send).toHaveBeenCalledWith('ch', 1);
      b.destroy();
    });

    it('is NOT a cache: the next window resolves the producer again', () => {
      const send = vi.fn();
      const produce = vi.fn(() => ({ tick: produce.mock.calls.length }));
      const b = createBatcher('ch', send, { intervalMs: 100, mode: 'latest' });

      b.pushLazy(produce);
      vi.advanceTimersByTime(100);
      b.pushLazy(produce);
      vi.advanceTimersByTime(100);

      expect(produce).toHaveBeenCalledTimes(2);
      expect(send).toHaveBeenCalledTimes(2);
      b.destroy();
    });

    it('an idle window after a flush sends nothing — no retained payload', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, { intervalMs: 100, mode: 'latest' });
      b.pushLazy(() => 'once');
      vi.advanceTimersByTime(100);
      expect(send).toHaveBeenCalledOnce();

      vi.advanceTimersByTime(1000);
      expect(send).toHaveBeenCalledOnce();
      b.destroy();
    });

    it('push after pushLazy wins, and the producer is never called', () => {
      const send = vi.fn();
      const produce = vi.fn(() => 'lazy');
      const b = createBatcher('ch', send, { intervalMs: 100, mode: 'latest' });
      b.pushLazy(produce);
      b.push('eager');
      vi.advanceTimersByTime(100);
      expect(produce).not.toHaveBeenCalled();
      expect(send).toHaveBeenCalledWith('ch', 'eager');
      b.destroy();
    });

    it('pushLazy after push wins', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, { intervalMs: 100, mode: 'latest' });
      b.push('eager');
      b.pushLazy(() => 'lazy');
      vi.advanceTimersByTime(100);
      expect(send).toHaveBeenCalledWith('ch', 'lazy');
      b.destroy();
    });

    it('destroy() flushes a pending producer exactly once', () => {
      const send = vi.fn();
      const produce = vi.fn(() => 'final');
      const b = createBatcher('ch', send, { intervalMs: 100, mode: 'latest' });
      b.pushLazy(produce);
      b.destroy();
      expect(produce).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledWith('ch', 'final');
      b.destroy();
      expect(send).toHaveBeenCalledOnce();
    });

    it('a producer pushed after destroy is dropped, like push', () => {
      const send = vi.fn();
      const produce = vi.fn();
      const b = createBatcher('ch', send, { intervalMs: 100, mode: 'latest' });
      b.destroy();
      b.pushLazy(produce);
      vi.advanceTimersByTime(1000);
      expect(produce).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    });

    it('refuses append mode: "last one wins" is what makes deferral free', () => {
      const b = createBatcher('file-access', vi.fn(), { intervalMs: 100 });
      expect(() => b.pushLazy(() => 1)).toThrow(/mode 'latest'/);
      b.destroy();
    });

    it('refuses a non-function producer', () => {
      const b = createBatcher('ch', vi.fn(), { intervalMs: 100, mode: 'latest' });
      expect(() => b.pushLazy(/** @type {never} */ ({ not: 'a function' }))).toThrow(/producer/);
      b.destroy();
    });

    it('a payload that IS a function still travels as a payload via push', () => {
      // The producer lives in its own slot, so `push` of a function value is unchanged.
      const send = vi.fn();
      const payload = () => 'i am data';
      const b = createBatcher('ch', send, { intervalMs: 100, mode: 'latest' });
      b.push(payload);
      vi.advanceTimersByTime(100);
      expect(send).toHaveBeenCalledWith('ch', payload);
      b.destroy();
    });
  });

  // ── capacity (append mode) ──

  describe('capacity (append mode)', () => {
    it('bounds the buffer under a burst and counts exactly what it dropped', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, { intervalMs: 150, capacity: 3 });

      for (let i = 1; i <= 10; i++) b.push(i);

      expect(b.getStats()).toEqual({
        pushed: 10,
        coalesced: 0,
        evicted: 7,
        evictedSinceFlush: 7,
        retainedEvicted: 0,
        highWater: 3,
        buffered: 3,
      });

      vi.advanceTimersByTime(150);
      expect(send).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledWith('ch', [8, 9, 10]);
      b.destroy();
    });

    it('evicts oldest-first: the pushed value always enters', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, { intervalMs: 100, capacity: 1 });
      b.push('a');
      b.push('b');
      b.push('c');
      vi.advanceTimersByTime(100);
      expect(send).toHaveBeenCalledWith('ch', ['c']);
      expect(b.getStats()).toMatchObject({ pushed: 3, evicted: 2, highWater: 1 });
      b.destroy();
    });

    it('the flushed payload stays a FLAT array — the wire format is unchanged', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, { intervalMs: 50, capacity: 2 });
      b.push('ev1');
      b.push('ev2');
      b.push('ev3');
      vi.advanceTimersByTime(50);
      expect(send.mock.calls[0][1]).toEqual(['ev2', 'ev3']);
      expect(Array.isArray(send.mock.calls[0][1])).toBe(true);
      b.destroy();
    });

    it('absent capacity is UNBOUNDED — today’s behaviour, pinned', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, { intervalMs: 150 });

      for (let i = 0; i < 5000; i++) b.push(i);

      expect(b.getStats()).toMatchObject({ pushed: 5000, evicted: 0, buffered: 5000 });
      vi.advanceTimersByTime(150);
      expect(send.mock.calls[0][1]).toHaveLength(5000);
      b.destroy();
    });

    it('highWater is a LIFETIME maximum and does not fall back on flush', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, { intervalMs: 100 });

      for (let i = 0; i < 5; i++) b.push(i);
      vi.advanceTimersByTime(100);
      expect(b.getStats()).toMatchObject({ highWater: 5, buffered: 0 });

      b.push('x');
      b.push('y');
      vi.advanceTimersByTime(100);
      expect(b.getStats()).toMatchObject({ highWater: 5, buffered: 0 });
      b.destroy();
    });

    it('highWater never exceeds capacity when one is set', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, { intervalMs: 100, capacity: 4 });
      for (let i = 0; i < 200; i++) b.push(i);
      expect(b.getStats().highWater).toBe(4);
      b.destroy();
    });

    it('evictedSinceFlush resets on a flush that SENT; evicted keeps counting', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, { intervalMs: 100, capacity: 2 });

      b.push(1);
      b.push(2);
      b.push(3); // 1 eviction
      expect(b.getStats()).toMatchObject({ evicted: 1, evictedSinceFlush: 1 });

      vi.advanceTimersByTime(100);
      expect(b.getStats()).toMatchObject({ evicted: 1, evictedSinceFlush: 0 });

      b.push(4);
      b.push(5);
      b.push(6);
      b.push(7); // 2 more evictions
      expect(b.getStats()).toMatchObject({ evicted: 3, evictedSinceFlush: 2 });

      vi.advanceTimersByTime(100);
      expect(b.getStats()).toMatchObject({ evicted: 3, evictedSinceFlush: 0 });
      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[0][1]).toEqual([2, 3]);
      expect(send.mock.calls[1][1]).toEqual([6, 7]);
      b.destroy();
    });

    it('a manual flush resets evictedSinceFlush exactly as the timer does', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, { intervalMs: 100, capacity: 2 });
      b.push(1);
      b.push(2);
      b.push(3);
      b.flush();
      expect(send).toHaveBeenCalledWith('ch', [2, 3]);
      expect(b.getStats()).toMatchObject({ evicted: 1, evictedSinceFlush: 0 });

      // A second flush finds an empty buffer, sends nothing, and moves no counter.
      b.flush();
      expect(send).toHaveBeenCalledOnce();
      expect(b.getStats()).toMatchObject({ pushed: 3, evicted: 1, evictedSinceFlush: 0 });
      b.destroy();
    });

    it('counters survive many flush cycles', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, { intervalMs: 100, capacity: 2 });
      for (let cycle = 0; cycle < 4; cycle++) {
        b.push('a');
        b.push('b');
        b.push('c'); // 1 eviction per cycle
        vi.advanceTimersByTime(100);
      }
      expect(send).toHaveBeenCalledTimes(4);
      expect(b.getStats()).toEqual({
        pushed: 12,
        coalesced: 0,
        evicted: 4,
        evictedSinceFlush: 0,
        retainedEvicted: 0,
        highWater: 2,
        buffered: 0,
      });
      b.destroy();
    });
  });

  // ── coalescing (append mode) ──

  describe('coalesceKey (append mode)', () => {
    it('replaces the same-key entry IN PLACE — position preserved, last value wins', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, { intervalMs: 100, coalesceKey: (v) => v.path });

      b.push({ path: 'a.txt', n: 1 });
      b.push({ path: 'b.txt', n: 2 });
      b.push({ path: 'a.txt', n: 3 });

      expect(b.getStats()).toMatchObject({ pushed: 3, coalesced: 1, buffered: 2, highWater: 2 });
      vi.advanceTimersByTime(100);
      expect(send).toHaveBeenCalledWith('ch', [
        { path: 'a.txt', n: 3 },
        { path: 'b.txt', n: 2 },
      ]);
      b.destroy();
    });

    it('a coalesced push is still a push: coalesced is a SUBSET of pushed', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, { intervalMs: 100, coalesceKey: () => 'same' });
      b.push(1);
      b.push(2);
      b.push(3);
      expect(b.getStats()).toMatchObject({ pushed: 3, coalesced: 2, buffered: 1, highWater: 1 });
      vi.advanceTimersByTime(100);
      expect(send).toHaveBeenCalledWith('ch', [3]);
      b.destroy();
    });

    it('a null key NEVER merges — two of them both travel', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, { intervalMs: 100, coalesceKey: () => null });
      b.push('x');
      b.push('x');
      b.push('x');
      expect(b.getStats()).toMatchObject({ pushed: 3, coalesced: 0, buffered: 3 });
      vi.advanceTimersByTime(100);
      expect(send).toHaveBeenCalledWith('ch', ['x', 'x', 'x']);
      b.destroy();
    });

    it('mixes merging and non-merging values in one window', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, {
        intervalMs: 100,
        coalesceKey: (v) => (v.merge ? v.id : null),
      });

      b.push({ id: 'k', merge: true, n: 1 });
      b.push({ id: 'k', merge: false, n: 2 });
      b.push({ id: 'k', merge: true, n: 3 });

      expect(b.getStats()).toMatchObject({ pushed: 3, coalesced: 1, buffered: 2 });
      vi.advanceTimersByTime(100);
      expect(send).toHaveBeenCalledWith('ch', [
        { id: 'k', merge: true, n: 3 },
        { id: 'k', merge: false, n: 2 },
      ]);
      b.destroy();
    });

    it('a non-string key never merges either — undefined and a number both stay apart', () => {
      const send = vi.fn();
      const undef = createBatcher('ch', send, { intervalMs: 100, coalesceKey: () => undefined });
      undef.push('a');
      undef.push('a');
      expect(undef.getStats()).toMatchObject({ coalesced: 0, buffered: 2 });
      undef.destroy();

      const numeric = createBatcher('ch', send, { intervalMs: 100, coalesceKey: () => 7 });
      numeric.push('a');
      numeric.push('a');
      expect(numeric.getStats()).toMatchObject({ coalesced: 0, buffered: 2 });
      numeric.destroy();
    });

    it('the key table resets with the buffer — a key from the last batch does not merge', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, { intervalMs: 100, coalesceKey: (v) => v.path });
      b.push({ path: 'a', n: 1 });
      vi.advanceTimersByTime(100);
      b.push({ path: 'a', n: 2 });
      vi.advanceTimersByTime(100);

      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[0][1]).toEqual([{ path: 'a', n: 1 }]);
      expect(send.mock.calls[1][1]).toEqual([{ path: 'a', n: 2 }]);
      expect(b.getStats()).toMatchObject({ pushed: 2, coalesced: 0 });
      b.destroy();
    });

    it('a throwing coalesceKey leaves the batcher exactly as it found it', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, {
        intervalMs: 100,
        coalesceKey: (v) => {
          if (v === 'boom') throw new Error('key exploded');
          return String(v);
        },
      });

      b.push('ok');
      expect(() => b.push('boom')).toThrow(/key exploded/);
      expect(b.getStats()).toMatchObject({ pushed: 1, coalesced: 0, evicted: 0, buffered: 1 });

      vi.advanceTimersByTime(100);
      expect(send).toHaveBeenCalledWith('ch', ['ok']);
      b.destroy();
    });
  });

  // ── coalescing × capacity ──

  describe('coalescing and capacity together', () => {
    it('a coalesced push does NOT evict, even at full capacity', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, {
        intervalMs: 100,
        capacity: 2,
        coalesceKey: (v) => v.k,
      });

      b.push({ k: 'a', n: 1 });
      b.push({ k: 'b', n: 2 }); // buffer is now full
      b.push({ k: 'a', n: 3 }); // merges instead of overflowing

      expect(b.getStats()).toEqual({
        pushed: 3,
        coalesced: 1,
        evicted: 0,
        evictedSinceFlush: 0,
        retainedEvicted: 0,
        highWater: 2,
        buffered: 2,
      });
      vi.advanceTimersByTime(100);
      expect(send).toHaveBeenCalledWith('ch', [
        { k: 'a', n: 3 },
        { k: 'b', n: 2 },
      ]);
      b.destroy();
    });

    it('an eviction shifts the key table in step with the buffer', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, {
        intervalMs: 100,
        capacity: 2,
        coalesceKey: (v) => v.k,
      });

      b.push({ k: 'a', n: 1 });
      b.push({ k: 'b', n: 2 });
      b.push({ k: 'c', n: 3 }); // evicts a → [b, c]
      b.push({ k: 'b', n: 4 }); // must land on slot 0, not slot 1

      expect(b.getStats()).toMatchObject({ pushed: 4, coalesced: 1, evicted: 1, buffered: 2 });
      vi.advanceTimersByTime(100);
      expect(send).toHaveBeenCalledWith('ch', [
        { k: 'b', n: 4 },
        { k: 'c', n: 3 },
      ]);
      b.destroy();
    });

    it('an evicted key frees its slot: the same key returns as a NEW entry', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, {
        intervalMs: 100,
        capacity: 2,
        coalesceKey: (v) => v.k,
      });

      b.push({ k: 'a', n: 1 });
      b.push({ k: 'b', n: 2 });
      b.push({ k: 'c', n: 3 }); // evicts a → [b, c]
      b.push({ k: 'a', n: 4 }); // a is gone, so this appends and evicts b → [c, a]

      expect(b.getStats()).toMatchObject({ pushed: 4, coalesced: 0, evicted: 2, buffered: 2 });
      vi.advanceTimersByTime(100);
      expect(send).toHaveBeenCalledWith('ch', [
        { k: 'c', n: 3 },
        { k: 'a', n: 4 },
      ]);
      b.destroy();
    });

    it('coalescing keeps a bounded buffer inside its bound under a keyed burst', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, {
        intervalMs: 150,
        capacity: 4,
        coalesceKey: (v) => `k${v % 3}`,
      });

      for (let i = 0; i < 300; i++) b.push(i);

      // Three distinct keys, so the buffer never reaches capacity and nothing is evicted.
      expect(b.getStats()).toEqual({
        pushed: 300,
        coalesced: 297,
        evicted: 0,
        evictedSinceFlush: 0,
        retainedEvicted: 0,
        highWater: 3,
        buffered: 3,
      });
      vi.advanceTimersByTime(150);
      expect(send).toHaveBeenCalledWith('ch', [297, 298, 299]);
      b.destroy();
    });
  });

  // ── retain (append mode) ──

  describe('retain (append mode)', () => {
    it('evicts the oldest NON-retained entry first — the retained one keeps its place', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, {
        intervalMs: 100,
        capacity: 3,
        retain: (v) => v.keep === true,
      });

      b.push({ id: 'r1', keep: true });
      b.push({ id: 'n1', keep: false });
      b.push({ id: 'n2', keep: false }); // full
      b.push({ id: 'n3', keep: false }); // evicts n1, the oldest non-retained — not r1

      expect(b.getStats()).toMatchObject({
        pushed: 4,
        evicted: 1,
        retainedEvicted: 0,
        buffered: 3,
      });
      vi.advanceTimersByTime(100);
      expect(send).toHaveBeenCalledWith('ch', [
        { id: 'r1', keep: true },
        { id: 'n2', keep: false },
        { id: 'n3', keep: false },
      ]);
      b.destroy();
    });

    it('a buffer that is ALL retained evicts its oldest entry, and counts it as retainedEvicted', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, { intervalMs: 100, capacity: 2, retain: () => true });
      b.push('a');
      b.push('b');
      b.push('c'); // nothing non-retained to take, so the oldest retained goes
      expect(b.getStats()).toMatchObject({
        pushed: 3,
        evicted: 1,
        retainedEvicted: 1,
        buffered: 2,
      });
      vi.advanceTimersByTime(100);
      expect(send).toHaveBeenCalledWith('ch', ['b', 'c']);
      b.destroy();
    });

    it('ACCEPTANCE: retained entries at the head survive a non-retained burst three times the capacity', () => {
      // The discriminating case. Plain oldest-first eviction drops r1 and r2 on the first
      // two overflows; retention takes the oldest NON-retained entry every time instead,
      // so the two retained entries are still there after twelve pushes into four slots.
      // Restore an unconditional `buf.shift()` and this case goes red.
      const send = vi.fn();
      const b = createBatcher('ch', send, {
        intervalMs: 100,
        capacity: 4,
        retain: (v) => v.keep === true,
      });

      b.push({ id: 'r1', keep: true });
      b.push({ id: 'r2', keep: true });
      for (let i = 1; i <= 12; i += 1) b.push({ id: `n${i}`, keep: false });

      expect(b.getStats()).toMatchObject({
        pushed: 14,
        evicted: 10,
        retainedEvicted: 0,
        buffered: 4,
        highWater: 4,
      });
      vi.advanceTimersByTime(100);
      expect(send).toHaveBeenCalledWith('ch', [
        { id: 'r1', keep: true },
        { id: 'r2', keep: true },
        { id: 'n11', keep: false },
        { id: 'n12', keep: false },
      ]);
      b.destroy();
    });

    it('an eviction from the MIDDLE keeps the key table in step with the buffer', () => {
      // With retention the evicted slot is no longer always slot 0, so the key table must
      // lose the same index the buffer lost, or a later merge lands on the wrong entry.
      const send = vi.fn();
      const b = createBatcher('ch', send, {
        intervalMs: 100,
        capacity: 3,
        coalesceKey: (v) => v.k,
        retain: (v) => v.keep === true,
      });

      b.push({ k: 'a', keep: true, n: 1 });
      b.push({ k: 'b', keep: false, n: 2 });
      b.push({ k: 'c', keep: false, n: 3 }); // full: [a, b, c]
      b.push({ k: 'd', keep: false, n: 4 }); // evicts b (slot 1): [a, c, d]
      b.push({ k: 'c', keep: false, n: 5 }); // must merge onto slot 1 (c), not slot 2 (d)

      expect(b.getStats()).toMatchObject({ pushed: 5, coalesced: 1, evicted: 1, buffered: 3 });

      b.push({ k: 'e', keep: false, n: 6 }); // evicts c (slot 1, the oldest non-retained): [a, d, e]
      vi.advanceTimersByTime(100);
      expect(send).toHaveBeenCalledWith('ch', [
        { k: 'a', keep: true, n: 1 },
        { k: 'd', keep: false, n: 4 },
        { k: 'e', keep: false, n: 6 },
      ]);
      b.destroy();
    });

    it('a merge re-evaluates retain on the replacement value', () => {
      // A retained entry replaced by a non-retained value of the same key must become
      // evictable: the flag describes the value that is buffered NOW, not the first one.
      const send = vi.fn();
      const b = createBatcher('ch', send, {
        intervalMs: 100,
        capacity: 2,
        coalesceKey: (v) => v.k,
        retain: (v) => v.keep === true,
      });

      b.push({ k: 'a', keep: true, n: 1 });
      b.push({ k: 'b', keep: false, n: 2 }); // full: [a, b]
      b.push({ k: 'a', keep: false, n: 3 }); // merge: a is no longer retained
      b.push({ k: 'c', keep: false, n: 4 }); // evicts slot 0 (a), the oldest non-retained: [b, c]

      expect(b.getStats()).toMatchObject({
        pushed: 4,
        coalesced: 1,
        evicted: 1,
        retainedEvicted: 0,
        buffered: 2,
      });
      vi.advanceTimersByTime(100);
      expect(send).toHaveBeenCalledWith('ch', [
        { k: 'b', keep: false, n: 2 },
        { k: 'c', keep: false, n: 4 },
      ]);
      b.destroy();
    });

    it('a throwing retain leaves the batcher exactly as it found it', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, {
        intervalMs: 100,
        capacity: 2,
        retain: (v) => {
          if (v === 'boom') throw new Error('retain exploded');
          return false;
        },
      });

      b.push('ok');
      expect(() => b.push('boom')).toThrow(/retain exploded/);
      expect(b.getStats()).toMatchObject({
        pushed: 1,
        evicted: 0,
        retainedEvicted: 0,
        buffered: 1,
      });

      vi.advanceTimersByTime(100);
      expect(send).toHaveBeenCalledWith('ch', ['ok']);
      b.destroy();
    });

    it('without capacity, retain never fires and changes nothing', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, { intervalMs: 100, retain: () => false });
      for (let i = 0; i < 50; i += 1) b.push(i);
      expect(b.getStats()).toMatchObject({
        pushed: 50,
        evicted: 0,
        retainedEvicted: 0,
        buffered: 50,
      });
      b.destroy();
    });
  });

  // ── getStats ──

  describe('getStats', () => {
    it('exposes exactly the seven documented fields', () => {
      const b = createBatcher('ch', vi.fn(), { intervalMs: 100 });
      expect(Object.keys(b.getStats()).sort()).toEqual([
        'buffered',
        'coalesced',
        'evicted',
        'evictedSinceFlush',
        'highWater',
        'pushed',
        'retainedEvicted',
      ]);
      b.destroy();
    });

    it('a fresh batcher reports all zeros', () => {
      const b = createBatcher('ch', vi.fn(), { intervalMs: 100 });
      expect(b.getStats()).toEqual({
        pushed: 0,
        coalesced: 0,
        evicted: 0,
        evictedSinceFlush: 0,
        retainedEvicted: 0,
        highWater: 0,
        buffered: 0,
      });
      b.destroy();
    });

    it('counts pushes and highWater even with no new options passed', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, { intervalMs: 100 });
      b.push('a');
      b.push('b');
      expect(b.getStats()).toEqual({
        pushed: 2,
        coalesced: 0,
        evicted: 0,
        evictedSinceFlush: 0,
        retainedEvicted: 0,
        highWater: 2,
        buffered: 2,
      });
      b.destroy();
    });

    it('stays readable after destroy, with the lifetime totals standing', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, { intervalMs: 100, capacity: 2 });
      b.push(1);
      b.push(2);
      b.push(3);
      b.destroy();

      expect(send).toHaveBeenCalledWith('ch', [2, 3]);
      expect(b.getStats()).toEqual({
        pushed: 3,
        coalesced: 0,
        evicted: 1,
        evictedSinceFlush: 0,
        retainedEvicted: 0,
        highWater: 2,
        buffered: 0,
      });
    });

    it('a push refused because the batcher is destroyed is counted nowhere', () => {
      const b = createBatcher('ch', vi.fn(), { intervalMs: 100, capacity: 1 });
      b.destroy();
      b.push('late');
      expect(b.getStats()).toEqual({
        pushed: 0,
        coalesced: 0,
        evicted: 0,
        evictedSinceFlush: 0,
        retainedEvicted: 0,
        highWater: 0,
        buffered: 0,
      });
    });

    it('returns a snapshot, not a live view', () => {
      const b = createBatcher('ch', vi.fn(), { intervalMs: 100 });
      const before = b.getStats();
      b.push('x');
      expect(before).toMatchObject({ pushed: 0, buffered: 0 });
      expect(b.getStats()).toMatchObject({ pushed: 1, buffered: 1 });
      b.destroy();
    });
  });

  // ── latest mode stats ──

  describe('getStats (latest mode)', () => {
    it('reports the same seven fields with only the counters that can apply', () => {
      const send = vi.fn();
      const b = createBatcher('stats', send, { intervalMs: 100, mode: 'latest' });

      expect(b.getStats()).toEqual({
        pushed: 0,
        coalesced: 0,
        evicted: 0,
        evictedSinceFlush: 0,
        retainedEvicted: 0,
        highWater: 0,
        buffered: 0,
      });

      b.push({ n: 1 });
      b.push({ n: 2 });
      expect(b.getStats()).toEqual({
        pushed: 2,
        coalesced: 0,
        evicted: 0,
        evictedSinceFlush: 0,
        retainedEvicted: 0,
        highWater: 1,
        buffered: 1,
      });

      vi.advanceTimersByTime(100);
      expect(send).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledWith('stats', { n: 2 });
      expect(b.getStats()).toEqual({
        pushed: 2,
        coalesced: 0,
        evicted: 0,
        evictedSinceFlush: 0,
        retainedEvicted: 0,
        highWater: 1,
        buffered: 0,
      });
      b.destroy();
    });

    it('a pending pushLazy producer moves no counter and reads buffered 0', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send, { intervalMs: 100, mode: 'latest' });
      b.pushLazy(() => 'built');
      expect(b.getStats()).toEqual({
        pushed: 0,
        coalesced: 0,
        evicted: 0,
        evictedSinceFlush: 0,
        retainedEvicted: 0,
        highWater: 0,
        buffered: 0,
      });

      vi.advanceTimersByTime(100);
      expect(send).toHaveBeenCalledWith('ch', 'built');
      expect(b.getStats().pushed).toBe(0);
      b.destroy();
    });
  });

  // ── option validation ──

  describe('option validation', () => {
    it('refuses a capacity that is not a positive integer', () => {
      for (const bad of [0, -1, 1.5, '5', NaN, Infinity, null]) {
        expect(() => createBatcher('ch', vi.fn(), { capacity: bad })).toThrow(
          /capacity must be a positive integer/,
        );
      }
    });

    it('accepts capacity 1 — the smallest useful bound', () => {
      const b = createBatcher('ch', vi.fn(), { intervalMs: 100, capacity: 1 });
      expect(b.getStats().buffered).toBe(0);
      b.destroy();
    });

    it('refuses a coalesceKey that is not a function', () => {
      for (const bad of ['path', 42, {}, null]) {
        expect(() => createBatcher('ch', vi.fn(), { coalesceKey: bad })).toThrow(
          /coalesceKey must be a function/,
        );
      }
    });

    it('refuses capacity in latest mode: a one-slot buffer cannot overflow', () => {
      expect(() => createBatcher('ch', vi.fn(), { mode: 'latest', capacity: 5 })).toThrow(
        /capacity requires mode 'append'/,
      );
    });

    it('refuses coalesceKey in latest mode: a one-slot buffer cannot merge', () => {
      expect(() =>
        createBatcher('ch', vi.fn(), { mode: 'latest', coalesceKey: () => 'k' }),
      ).toThrow(/coalesceKey requires mode 'append'/);
    });

    it('refuses a retain that is not a function', () => {
      for (const bad of ['sensitive', 42, {}, null]) {
        expect(() => createBatcher('ch', vi.fn(), { retain: bad })).toThrow(
          /retain must be a function/,
        );
      }
    });

    it('refuses retain in latest mode: a one-slot buffer never chooses what to evict', () => {
      expect(() => createBatcher('ch', vi.fn(), { mode: 'latest', retain: () => true })).toThrow(
        /retain requires mode 'append'/,
      );
    });
  });

  // ── defaults ──

  describe('defaults', () => {
    it('defaults to append mode and 150ms interval', () => {
      const send = vi.fn();
      const b = createBatcher('ch', send);
      b.push('a');
      vi.advanceTimersByTime(149);
      expect(send).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(send).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledWith('ch', ['a']);
      b.destroy();
    });
  });
});
