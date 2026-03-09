/**
 * @file command-palette.svelte.ts — Reactive store for Command Palette state
 * @module renderer/stores/command-palette
 * @description Uses Svelte 5 runes for reactive state management.
 */

import { getAllCommands } from '../utils/command-registry';
import { filterAndSort } from '../utils/fuzzy-search';
import type { CommandItem, ScoredCommand } from '../../../shared/types';

/** Public API surface of the command palette store */
interface CommandPaletteStore {
  readonly open: boolean;
  readonly query: string;
  readonly selectedIndex: number;
  readonly filteredItems: ScoredCommand[];
  readonly lastExecuted: CommandItem | null;
  toggle(): void;
  close(): void;
  setQuery(q: string): void;
  moveSelection(delta: number): void;
  getSelected(): ScoredCommand | undefined;
  executeSelected(): void;
}

/** Creates a reactive command palette store using Svelte 5 runes */
function createCommandPalette(): CommandPaletteStore {
  let open = $state(false);
  let query = $state('');
  let selectedIndex = $state(0);
  let lastExecuted: CommandItem | null = $state(null);

  const filteredItems: ScoredCommand[] = $derived(
    query ? filterAndSort(query, getAllCommands()) : filterAndSort('', getAllCommands()),
  );

  return {
    get open(): boolean {
      return open;
    },
    get query(): string {
      return query;
    },
    get selectedIndex(): number {
      return selectedIndex;
    },
    get filteredItems(): ScoredCommand[] {
      return filteredItems;
    },
    get lastExecuted(): CommandItem | null {
      return lastExecuted;
    },

    /** Toggle palette open/closed. Resets query and selection on open. */
    toggle(): void {
      open = !open;
      if (open) {
        query = '';
        selectedIndex = 0;
      }
    },

    /** Close palette and reset all state */
    close(): void {
      open = false;
      query = '';
      selectedIndex = 0;
    },

    /** Update the search query and reset selection to top */
    setQuery(q: string): void {
      query = q;
      selectedIndex = 0;
    },

    /** Move selection up/down with wrap-around */
    moveSelection(delta: number): void {
      const len = filteredItems.length;
      if (len === 0) return;
      selectedIndex = (((selectedIndex + delta) % len) + len) % len;
    },

    /** Get the currently selected command, if any */
    getSelected(): ScoredCommand | undefined {
      return filteredItems[selectedIndex];
    },

    /** Execute the currently selected command and close the palette */
    executeSelected(): void {
      const item = filteredItems[selectedIndex];
      if (!item) return;
      lastExecuted = item;
      open = false;
      query = '';
      selectedIndex = 0;
    },
  };
}

export const commandPalette: CommandPaletteStore = createCommandPalette();
