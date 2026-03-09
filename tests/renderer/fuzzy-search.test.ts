/**
 * fuzzy-search.test.ts — Tests for fuzzy matching and command filtering
 */
import { describe, it, expect } from 'vitest';
import { fuzzyMatch, filterAndSort } from '../../src/renderer/lib/utils/fuzzy-search';
import type { CommandItem } from '../../src/shared/types';

describe('fuzzyMatch', () => {
  it('matches exact text', () => {
    const result = fuzzyMatch('Shield', 'Shield');
    expect(result.match).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it('matches prefix', () => {
    const result = fuzzyMatch('shi', 'Shield');
    expect(result.match).toBe(true);
    expect(result.indices).toEqual([0, 1, 2]);
  });

  it('matches scattered characters', () => {
    const result = fuzzyMatch('grls', 'Go to Rules');
    expect(result.match).toBe(true);
  });

  it('scores prefix higher than scattered', () => {
    const prefix = fuzzyMatch('shi', 'Shield');
    const scattered = fuzzyMatch('sid', 'Shield');
    expect(prefix.score).toBeGreaterThan(scattered.score);
  });

  it('returns false for non-matching query', () => {
    const result = fuzzyMatch('xyz', 'Shield');
    expect(result.match).toBe(false);
    expect(result.score).toBe(0);
    expect(result.indices).toEqual([]);
  });

  it('is case insensitive', () => {
    const result = fuzzyMatch('SHIELD', 'shield');
    expect(result.match).toBe(true);
  });

  it('returns correct indices for prefix match', () => {
    const result = fuzzyMatch('shi', 'Shield');
    expect(result.indices).toEqual([0, 1, 2]);
  });

  it('gives word-start bonus', () => {
    // "Go to Shield" — 'S' is at word start (index 6, preceded by space)
    const wordStart = fuzzyMatch('S', 'Go to Shield');
    // Score should include word-start bonus (+3)
    expect(wordStart.score).toBeGreaterThanOrEqual(13);
  });

  it('gives consecutive bonus', () => {
    const consecutive = fuzzyMatch('sh', 'Shield');
    const scattered = fuzzyMatch('sd', 'Shield');
    expect(consecutive.score).toBeGreaterThan(scattered.score);
  });
});

describe('filterAndSort', () => {
  const testItems: CommandItem[] = [
    { id: 'nav:shield', label: 'Go to Shield', category: 'navigate', keywords: ['dashboard'] },
    { id: 'nav:rules', label: 'Go to Rules', category: 'navigate', keywords: ['patterns'] },
    { id: 'theme:dark', label: 'Dark Theme', category: 'theme', keywords: ['night'] },
    { id: 'action:test', label: 'Test Notification', category: 'action', keywords: ['alert'] },
  ];

  it('returns all items with score 0 for empty query', () => {
    const results = filterAndSort('', testItems);
    expect(results).toHaveLength(testItems.length);
    expect(results.every((r) => r.score === 0)).toBe(true);
    expect(results.every((r) => r.matchIndices.length === 0)).toBe(true);
  });

  it('filters out non-matching items', () => {
    const results = filterAndSort('xyz', testItems);
    expect(results).toHaveLength(0);
  });

  it('finds items by label', () => {
    const results = filterAndSort('Shield', testItems);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe('nav:shield');
  });

  it('finds items by keyword', () => {
    const results = filterAndSort('night', testItems);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe('theme:dark');
  });

  it('returns ScoredCommand with score and matchIndices', () => {
    const results = filterAndSort('Shield', testItems);
    expect(results[0]).toHaveProperty('score');
    expect(results[0]).toHaveProperty('matchIndices');
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].matchIndices.length).toBeGreaterThan(0);
  });

  it('sorts by score descending', () => {
    const results = filterAndSort('t', testItems);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('ranks exact match above scattered', () => {
    const results = filterAndSort('Shield', testItems);
    expect(results[0].id).toBe('nav:shield');
    // "Shield" should score higher than any scattered matches in other labels
    if (results.length > 1) {
      expect(results[0].score).toBeGreaterThan(results[1].score);
    }
  });
});
