import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import {
  acknowledgedAgents,
  toggleAcknowledged,
  isAcknowledged,
  clearAcknowledged,
} from '../../src/renderer/lib/stores/acknowledged.js';

describe('acknowledged store', () => {
  // Keys are stamped instanceIds (C4), not display names.
  const ID_A = '100:start-A';
  const ID_B = '200:start-B';

  beforeEach(() => clearAcknowledged());
  afterEach(() => clearAcknowledged());

  it('starts empty', () => {
    expect(get(acknowledgedAgents).size).toBe(0);
    expect(isAcknowledged(ID_A)).toBe(false);
  });

  describe('toggleAcknowledged()', () => {
    it('marks a process instance acknowledged and returns true', () => {
      const result = toggleAcknowledged(ID_A);
      expect(result).toBe(true);
      expect(isAcknowledged(ID_A)).toBe(true);
      expect(get(acknowledgedAgents).has(ID_A)).toBe(true);
    });

    it('un-marks on second toggle and returns false', () => {
      toggleAcknowledged(ID_B);
      const result = toggleAcknowledged(ID_B);
      expect(result).toBe(false);
      expect(isAcknowledged(ID_B)).toBe(false);
    });

    it('tracks multiple instances independently', () => {
      toggleAcknowledged(ID_A);
      toggleAcknowledged(ID_B);
      expect(isAcknowledged(ID_A)).toBe(true);
      expect(isAcknowledged(ID_B)).toBe(true);
      toggleAcknowledged(ID_A);
      expect(isAcknowledged(ID_A)).toBe(false);
      expect(isAcknowledged(ID_B)).toBe(true);
    });

    it('emits a new Set reference for reactivity', () => {
      const before = get(acknowledgedAgents);
      toggleAcknowledged(ID_A);
      const after = get(acknowledgedAgents);
      expect(after).not.toBe(before);
    });
  });

  describe('clearAcknowledged()', () => {
    it('removes all marks', () => {
      toggleAcknowledged(ID_A);
      toggleAcknowledged(ID_B);
      expect(get(acknowledgedAgents).size).toBe(2);
      clearAcknowledged();
      expect(get(acknowledgedAgents).size).toBe(0);
    });
  });
});
