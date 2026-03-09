/**
 * @file fuzzy-search.ts — Fuzzy matching and filtering for Command Palette
 * @module renderer/lib/utils/fuzzy-search
 */

import type { CommandItem, ScoredCommand } from '../../../shared/types';

/** Result of matching a query against a single string */
export interface FuzzyResult {
  match: boolean;
  score: number;
  indices: number[];
}

/**
 * Fuzzy-match `query` against `text` using sequential character matching.
 * Scoring: +10 per matched char, +5 consecutive bonus, +3 word-start bonus, -1 per gap.
 */
export function fuzzyMatch(query: string, text: string): FuzzyResult {
  const qLower = query.toLowerCase();
  const tLower = text.toLowerCase();
  const indices: number[] = [];

  let ti = 0;
  for (let qi = 0; qi < qLower.length; qi++) {
    const found = tLower.indexOf(qLower[qi], ti);
    if (found === -1) {
      return { match: false, score: 0, indices: [] };
    }
    indices.push(found);
    ti = found + 1;
  }

  let score = indices.length * 10;

  for (let i = 1; i < indices.length; i++) {
    const gap = indices[i] - indices[i - 1] - 1;
    if (gap === 0) {
      score += 5;
    } else {
      score -= gap;
    }
  }

  for (const idx of indices) {
    if (idx === 0 || tLower[idx - 1] === ' ') {
      score += 3;
    }
  }

  return { match: true, score, indices };
}

/**
 * Filter and rank `items` by fuzzy-matching `query` against label and keywords.
 * Returns scored commands sorted by descending score.
 */
export function filterAndSort(query: string, items: CommandItem[]): ScoredCommand[] {
  if (!query) {
    return items.map((item) => ({ ...item, score: 0, matchIndices: [] }));
  }

  const results: ScoredCommand[] = [];

  for (const item of items) {
    const labelResult = fuzzyMatch(query, item.label);

    let bestScore = labelResult.match ? labelResult.score : -1;
    if (item.keywords) {
      for (const kw of item.keywords) {
        const kwResult = fuzzyMatch(query, kw);
        if (kwResult.match && kwResult.score > bestScore) {
          bestScore = kwResult.score;
        }
      }
    }

    if (bestScore < 0) continue;

    results.push({
      ...item,
      score: bestScore,
      matchIndices: labelResult.match ? labelResult.indices : [],
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}
