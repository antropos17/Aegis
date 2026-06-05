import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import {
  acknowledgedAgents,
  toggleAcknowledged,
  isAcknowledged,
  clearAcknowledged,
} from '../../src/renderer/lib/stores/acknowledged.js';

describe('acknowledged store', () => {
  beforeEach(() => clearAcknowledged());
  afterEach(() => clearAcknowledged());

  it('starts empty', () => {
    expect(get(acknowledgedAgents).size).toBe(0);
    expect(isAcknowledged('Claude Code')).toBe(false);
  });

  describe('toggleAcknowledged()', () => {
    it('marks an agent acknowledged and returns true', () => {
      const result = toggleAcknowledged('Claude Code');
      expect(result).toBe(true);
      expect(isAcknowledged('Claude Code')).toBe(true);
      expect(get(acknowledgedAgents).has('Claude Code')).toBe(true);
    });

    it('un-marks on second toggle and returns false', () => {
      toggleAcknowledged('Cursor');
      const result = toggleAcknowledged('Cursor');
      expect(result).toBe(false);
      expect(isAcknowledged('Cursor')).toBe(false);
    });

    it('tracks multiple agents independently', () => {
      toggleAcknowledged('A');
      toggleAcknowledged('B');
      expect(isAcknowledged('A')).toBe(true);
      expect(isAcknowledged('B')).toBe(true);
      toggleAcknowledged('A');
      expect(isAcknowledged('A')).toBe(false);
      expect(isAcknowledged('B')).toBe(true);
    });

    it('emits a new Set reference for reactivity', () => {
      const before = get(acknowledgedAgents);
      toggleAcknowledged('X');
      const after = get(acknowledgedAgents);
      expect(after).not.toBe(before);
    });
  });

  describe('clearAcknowledged()', () => {
    it('removes all marks', () => {
      toggleAcknowledged('A');
      toggleAcknowledged('B');
      expect(get(acknowledgedAgents).size).toBe(2);
      clearAcknowledged();
      expect(get(acknowledgedAgents).size).toBe(0);
    });
  });
});
