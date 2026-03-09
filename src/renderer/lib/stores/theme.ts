/**
 * @file theme.ts — Theme + UI scale stores with localStorage persistence
 * @module renderer/stores/theme
 * @since 0.2.0
 */

import { writable } from 'svelte/store';
import type { Writable } from 'svelte/store';

/** Supported theme identifiers */
type ThemeKey = 'dark' | 'light' | 'dark-hc' | 'light-hc';

const KEY = 'aegis-theme';
const initial: ThemeKey =
  ((typeof localStorage !== 'undefined' && localStorage.getItem(KEY)) as ThemeKey | null) || 'dark';

export const theme: Writable<ThemeKey> = writable(initial);

/** All supported theme keys */
const THEMES: readonly ThemeKey[] = ['dark', 'light', 'dark-hc', 'light-hc'] as const;

/**
 * Cycle to the next theme in the list.
 * Persists choice to localStorage.
 */
export function toggleTheme(): void {
  theme.update((current) => {
    const idx = THEMES.indexOf(current);
    const next = THEMES[(idx + 1) % THEMES.length];
    localStorage.setItem(KEY, next);
    return next;
  });
}

/**
 * Set the theme directly.
 * @param value - Theme key to apply
 */
export function setTheme(value: ThemeKey): void {
  theme.set(value);
  localStorage.setItem(KEY, value);
}

const SCALE_KEY = 'aegis-ui-scale';
const OLD_SCALE_KEY = 'aegis-font-scale';
const initialScale: number =
  (typeof localStorage !== 'undefined' &&
    (parseFloat(localStorage.getItem(SCALE_KEY)!) ||
      parseFloat(localStorage.getItem(OLD_SCALE_KEY)!))) ||
  1;

export const uiScale: Writable<number> = writable(initialScale);

/**
 * Set the UI scale factor and persist to localStorage.
 * @param value - Scale factor (0.8 to 1.5)
 */
export function setUiScale(value: number): void {
  uiScale.set(value);
  localStorage.setItem(SCALE_KEY, String(value));
}
