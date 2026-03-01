import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import {
  toasts,
  addToast,
  removeToast,
  clearAllToasts,
} from '../../src/renderer/lib/stores/toast.js';

describe('toast store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearAllToasts();
  });

  afterEach(() => {
    clearAllToasts();
    vi.useRealTimers();
  });

  describe('addToast()', () => {
    it('adds a toast to the store', () => {
      addToast('Hello', 'success');
      const list = get(toasts);
      expect(list).toHaveLength(1);
      expect(list[0].message).toBe('Hello');
      expect(list[0].type).toBe('success');
      expect(list[0].id).toBe(1);
      expect(list[0].timestamp).toBeGreaterThan(0);
    });

    it('defaults to success type', () => {
      addToast('Test');
      expect(get(toasts)[0].type).toBe('success');
    });

    it('supports warning and error types', () => {
      addToast('Warn', 'warning');
      addToast('Err', 'error');
      const list = get(toasts);
      expect(list[0].type).toBe('warning');
      expect(list[1].type).toBe('error');
    });

    it('assigns incrementing IDs', () => {
      addToast('A');
      addToast('B');
      addToast('C');
      const ids = get(toasts).map((t) => t.id);
      expect(ids[1]).toBeGreaterThan(ids[0]);
      expect(ids[2]).toBeGreaterThan(ids[1]);
    });

    it('returns the toast ID', () => {
      const id = addToast('Test');
      expect(typeof id).toBe('number');
      expect(get(toasts)[0].id).toBe(id);
    });
  });

  describe('auto-remove', () => {
    it('removes toast after duration', () => {
      addToast('Temp', 'success', 3000);
      expect(get(toasts)).toHaveLength(1);
      vi.advanceTimersByTime(3000);
      expect(get(toasts)).toHaveLength(0);
    });

    it('default 5000ms auto-remove', () => {
      addToast('Default');
      vi.advanceTimersByTime(4999);
      expect(get(toasts)).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(get(toasts)).toHaveLength(0);
    });

    it('duration 0 disables auto-remove', () => {
      addToast('Sticky', 'error', 0);
      vi.advanceTimersByTime(60000);
      expect(get(toasts)).toHaveLength(1);
    });
  });

  describe('max 3 toasts', () => {
    it('evicts oldest when exceeding 3', () => {
      addToast('A');
      addToast('B');
      addToast('C');
      expect(get(toasts)).toHaveLength(3);
      addToast('D');
      const list = get(toasts);
      expect(list).toHaveLength(3);
      expect(list.map((t) => t.message)).toEqual(['B', 'C', 'D']);
    });
  });

  describe('removeToast()', () => {
    it('removes by ID', () => {
      const id = addToast('Remove me', 'success', 0);
      expect(get(toasts)).toHaveLength(1);
      removeToast(id);
      expect(get(toasts)).toHaveLength(0);
    });

    it('no-op for unknown ID', () => {
      addToast('Stay');
      removeToast(999);
      expect(get(toasts)).toHaveLength(1);
    });
  });

  describe('clearAllToasts()', () => {
    it('clears everything', () => {
      addToast('A');
      addToast('B');
      clearAllToasts();
      expect(get(toasts)).toHaveLength(0);
    });

    it('resets ID counter', () => {
      addToast('A');
      addToast('B');
      clearAllToasts();
      const id = addToast('Fresh');
      expect(id).toBe(1);
    });
  });

  describe('timer cleanup', () => {
    it('manual remove cancels auto-dismiss timer', () => {
      const id = addToast('Temp', 'success', 3000);
      removeToast(id);
      expect(get(toasts)).toHaveLength(0);
      // Advancing past original duration should not cause errors
      vi.advanceTimersByTime(5000);
      expect(get(toasts)).toHaveLength(0);
    });

    it('eviction cancels evicted toast timer', () => {
      addToast('A', 'success', 10000);
      addToast('B', 'success', 10000);
      addToast('C', 'success', 10000);
      // Adding D evicts A — A's timer should be cleared
      addToast('D', 'success', 10000);
      expect(get(toasts).map((t) => t.message)).toEqual(['B', 'C', 'D']);
      // Advancing past A's original timer should not affect the list
      vi.advanceTimersByTime(10000);
      expect(get(toasts)).toHaveLength(0);
    });

    it('staggered auto-dismiss removes in correct order', () => {
      addToast('Fast', 'success', 1000);
      addToast('Medium', 'warning', 3000);
      addToast('Slow', 'error', 5000);
      expect(get(toasts)).toHaveLength(3);
      vi.advanceTimersByTime(1000);
      expect(get(toasts)).toHaveLength(2);
      expect(get(toasts)[0].message).toBe('Medium');
      vi.advanceTimersByTime(2000);
      expect(get(toasts)).toHaveLength(1);
      expect(get(toasts)[0].message).toBe('Slow');
      vi.advanceTimersByTime(2000);
      expect(get(toasts)).toHaveLength(0);
    });

    it('double remove is a safe no-op', () => {
      const id = addToast('Once', 'success', 0);
      removeToast(id);
      removeToast(id);
      expect(get(toasts)).toHaveLength(0);
    });
  });
});
