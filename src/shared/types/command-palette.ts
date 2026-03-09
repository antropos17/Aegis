/**
 * @file command-palette.ts — Command Palette type definitions
 * @module shared/types/command-palette
 */

/** Command categories for grouping in the palette UI */
export type CommandCategory = 'navigate' | 'agent' | 'theme' | 'export' | 'action';

/** A single command entry in the palette */
export interface CommandItem {
  id: string;
  label: string;
  category: CommandCategory;
  /** Emoji or symbol displayed next to the label */
  icon?: string;
  /** Keyboard shortcut hint, e.g. "Ctrl+1", "T" */
  shortcut?: string;
  /** Extra tokens for fuzzy search matching */
  keywords?: string[];
}

/** Command with fuzzy match scoring for ranked results */
export interface ScoredCommand extends CommandItem {
  /** Fuzzy match score (higher = better match) */
  score: number;
  /** Character positions in `label` that matched the query */
  matchIndices: number[];
}
