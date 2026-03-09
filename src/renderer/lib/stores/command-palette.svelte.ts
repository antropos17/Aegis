/**
 * @file command-palette.svelte.ts — Reactive store for Command Palette state
 * @module renderer/stores/command-palette
 * @description Uses Svelte 5 runes for reactive state management.
 */

import { getAllCommands } from '../utils/command-registry';
import { filterAndSort } from '../utils/fuzzy-search';
import type { ScoredCommand } from '../../../shared/types';

/** Creates a reactive command palette store using Svelte 5 runes */
function createCommandPalette() {
  let open = $state(false);
  let query = $state('');
  let selectedIndex = $state(0);

  const filteredItems: ScoredCommand[] = $derived(
    query ? filterAndSort(query, getAllCommands()) : filterAndSort('', getAllCommands()),
  );

  return {
    get open() {
      return open;
    },
    get query() {
      return query;
    },
    get selectedIndex() {
      return selectedIndex;
    },
    get filteredItems() {
      return filteredItems;
    },

    /** Toggle palette open/closed. Resets query and selection on open. */
    toggle() {
      open = !open;
      if (open) {
        query = '';
        selectedIndex = 0;
      }
    },

    /** Close palette and reset all state */
    close() {
      open = false;
      query = '';
      selectedIndex = 0;
    },

    /** Update the search query and reset selection to top */
    setQuery(q: string) {
      query = q;
      selectedIndex = 0;
    },

    /** Move selection up/down with wrap-around */
    moveSelection(delta: number) {
      const len = filteredItems.length;
      if (len === 0) return;
      selectedIndex = (((selectedIndex + delta) % len) + len) % len;
    },

    /** Get the currently selected command, if any */
    getSelected(): ScoredCommand | undefined {
      return filteredItems[selectedIndex];
    },
  };
}

export const commandPalette = createCommandPalette();
