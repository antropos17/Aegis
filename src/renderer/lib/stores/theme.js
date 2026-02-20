/**
 * @file theme.js — Theme store with localStorage persistence
 * @module renderer/stores/theme
 * @since 0.2.0
 */

import { writable } from 'svelte/store';

const KEY = 'aegis-theme';
const initial = (typeof localStorage !== 'undefined' && localStorage.getItem(KEY)) || 'dark';

export const theme = writable(initial);

/**
 * Toggle between 'dark' and 'light' themes.
 * Persists choice to localStorage.
 */
export function toggleTheme() {
  theme.update((current) => {
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem(KEY, next);
    return next;
  });
}
