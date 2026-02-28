/**
 * @file theme.js — Theme + UI scale stores with localStorage persistence
 * @module renderer/stores/theme
 * @since 0.2.0
 */

import { writable } from 'svelte/store';

const KEY = 'aegis-theme';
const initial = (typeof localStorage !== 'undefined' && localStorage.getItem(KEY)) || 'dark';

export const theme = writable(initial);

/** All supported theme keys */
export const THEMES = ['dark', 'light', 'dark-hc', 'light-hc'];

/**
 * Cycle to the next theme in the list.
 * Persists choice to localStorage.
 */
export function toggleTheme() {
  theme.update((current) => {
    const idx = THEMES.indexOf(current);
    const next = THEMES[(idx + 1) % THEMES.length];
    localStorage.setItem(KEY, next);
    return next;
  });
}

/**
 * Set the theme directly.
 * @param {'dark'|'light'|'dark-hc'|'light-hc'} value
 */
export function setTheme(value) {
  theme.set(value);
  localStorage.setItem(KEY, value);
}

const SCALE_KEY = 'aegis-ui-scale';
const OLD_SCALE_KEY = 'aegis-font-scale';
const initialScale =
  (typeof localStorage !== 'undefined' &&
    (parseFloat(localStorage.getItem(SCALE_KEY)) ||
      parseFloat(localStorage.getItem(OLD_SCALE_KEY)))) ||
  1;

export const uiScale = writable(initialScale);

/**
 * Set the UI scale factor and persist to localStorage.
 * @param {number} value - Scale factor (0.8 to 1.5)
 */
export function setUiScale(value) {
  uiScale.set(value);
  localStorage.setItem(SCALE_KEY, String(value));
}

// Backward-compat aliases
export const fontScale = uiScale;
export const setFontScale = setUiScale;
