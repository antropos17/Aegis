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
