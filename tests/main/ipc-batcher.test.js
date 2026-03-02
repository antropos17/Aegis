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
