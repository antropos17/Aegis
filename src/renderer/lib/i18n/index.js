/**
 * AEGIS i18n — lightweight internationalization
 *
 * Usage:
 *   import { t, language, LANGUAGE_OPTIONS } from '../i18n/index.js';
 *   <h1>{$t('header.brand')}</h1>
 *   <p>{$t('agents.pid', { pid: 1234 })}</p>
 *
 * Adding a new language:
 *   1. Add frontend/observatory/translations/<tag>.json (English message → translation)
 *   2. Add an entry to LANGUAGE_OPTIONS below
 *   3. Register the file in frontend/observatory/runtime/i18n.ts
 */

import { writable, derived } from 'svelte/store';
import en from './translations/en.json';
import pt from './translations/pt.json';

/** Available language options for the Settings language selector; `tag` is the BCP 47 locale. */
export const LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English', tag: 'en' },
  { code: 'pt', label: 'Português', tag: 'pt-BR' },
  { code: 'es', label: 'Español', tag: 'es' },
  { code: 'fr', label: 'Français', tag: 'fr' },
  { code: 'de', label: 'Deutsch', tag: 'de' },
  { code: 'ja', label: '日本語', tag: 'ja' },
  { code: 'zh', label: '简体中文', tag: 'zh-CN' },
  { code: 'ru', label: 'Русский', tag: 'ru' },
];

const STORAGE_KEY = 'aegis.language';
const SUPPORTED = new Set(LANGUAGE_OPTIONS.map((option) => option.code));

function getStoredLang() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && SUPPORTED.has(v) ? v : 'en';
  } catch {
    return 'en';
  }
}

function getTranslations(_lang) {
  if (_lang === 'pt') return pt;
  return en;
}

/** Writable store for the active language code (e.g. 'en', 'es'). */
export const language = writable(getStoredLang());

/** Whether the selected language was persisted on this device. */
export const languagePersisted = writable(true);

language.subscribe((lang) => {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
    languagePersisted.set(true);
  } catch {
    languagePersisted.set(false);
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
