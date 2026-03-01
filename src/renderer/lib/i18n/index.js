/**
 * AEGIS i18n — lightweight internationalization
 *
 * Usage:
 *   import { t, language, LANGUAGE_OPTIONS } from '../i18n/index.js';
 *   <h1>{$t('header.brand')}</h1>
 *   <p>{$t('agents.pid', { pid: 1234 })}</p>
 *
 * Adding a new language:
 *   1. Add a translations/xx.json file (copy en.json as template)
 *   2. Add an entry to LANGUAGE_OPTIONS below
 *   3. Import the file in getTranslations()
 */

import { writable, derived } from 'svelte/store';
import en from './translations/en.json';

const STORAGE_KEY = 'aegis.language';
const SUPPORTED = new Set(['en']);

function getStoredLang() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && SUPPORTED.has(v) ? v : 'en';
  } catch {
    return 'en';
  }
}

function getTranslations(lang) {
  // Add additional language imports here as they become available:
  // if (lang === 'es') return es;
  // if (lang === 'fr') return fr;
  return en;
}

/** Writable store for the active language code (e.g. 'en', 'es'). */
export const language = writable(getStoredLang());

language.subscribe((lang) => {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore SSR / sandboxed contexts */
  }
});

/**
 * Resolve a dot-notation key in a translations object.
 * Returns the key string itself if the path does not resolve to a string.
 * @param {Record<string, unknown>} obj
 * @param {string} key
 * @param {Record<string, string|number>} [vars]
 * @returns {string}
 */
function resolve(obj, key, vars) {
  const parts = key.split('.');
  let value = obj;
  for (const part of parts) {
    value = value?.[part];
  }
  if (typeof value !== 'string') return key;
  if (!vars) return value;
  return value.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

/**
 * Derived store that exposes a `t(key, vars?)` translation function.
 * Always falls back to English for missing keys in other languages.
 *
 * @type {import('svelte/store').Readable<(key: string, vars?: Record<string, string|number>) => string>}
 */
export const t = derived(language, ($lang) => {
  const translations = getTranslations($lang);
  return (key, vars) => {
    const result = resolve(translations, key, vars);
    // Fall back to English when the key is missing in the active language
    if (result === key && $lang !== 'en') {
      return resolve(en, key, vars);
    }
    return result;
  };
});

/** Available language options for the Settings language selector. */
export const LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  // Uncomment as translation files are added:
  // { code: 'es', label: 'Español' },
  // { code: 'fr', label: 'Français' },
  // { code: 'de', label: 'Deutsch' },
  // { code: 'ja', label: '日本語' },
  // { code: 'zh', label: '中文' },
  // { code: 'ru', label: 'Русский' },
];
