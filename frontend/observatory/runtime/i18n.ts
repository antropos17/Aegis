import { derived, get, writable } from 'svelte/store';
import { language, LANGUAGE_OPTIONS } from '../../../src/renderer/lib/i18n/index.js';
import legacyEnglish from '../../../src/renderer/lib/i18n/translations/en.json';
import legacyPortuguese from '../../../src/renderer/lib/i18n/translations/pt.json';
import portuguese from '../translations/pt-BR.json';

export { language, LANGUAGE_OPTIONS };
type Variables = Record<string, unknown>;
type Dictionary = { [key: string]: string | Dictionary };
const portugueseMessages = new Map<string, string>();

// Reuse the contributor's vocabulary wherever Observatory has the same English copy.
function includeLegacy(english: Dictionary, translated: Dictionary): void {
  for (const [key, value] of Object.entries(english)) {
    const target = translated[key];
    if (typeof value === 'string' && typeof target === 'string')
      portugueseMessages.set(value, target);
    else if (typeof value === 'object' && typeof target === 'object') includeLegacy(value, target);
  }
}
includeLegacy(legacyEnglish, legacyPortuguese);
for (const [key, value] of Object.entries(portuguese)) portugueseMessages.set(key, value);

type Catalog = ReadonlyMap<string, string>;
type CatalogModule = { default: Record<string, string> };

// Other languages ship as separate chunks, fetched the first time someone selects them.
const loaders: Record<string, () => Promise<CatalogModule>> = {
  es: () => import('../translations/es.json'),
  fr: () => import('../translations/fr.json'),
  de: () => import('../translations/de.json'),
  ja: () => import('../translations/ja.json'),
  zh: () => import('../translations/zh-CN.json'),
  ru: () => import('../translations/ru.json'),
};

// English message → translation, per language code; a missing message falls back to English.
const catalogs = writable(new Map<string, Catalog>([['pt', portugueseMessages]]));
const pending = new Map<string, Promise<void>>();

/** Fetch a language's catalog once; until it arrives, and if it fails, copy stays in English.
 * @param locale Saved language @returns Resolves when the catalog is ready @since 0.25.0-beta
 */
export function loadCatalog(locale: string): Promise<void> {
  const load = loaders[locale];
  if (!load || get(catalogs).has(locale)) return Promise.resolve();
  let request = pending.get(locale);
  if (!request) {
    request = load()
      .then(({ default: messages }) =>
        catalogs.update((loaded) => new Map(loaded).set(locale, new Map(Object.entries(messages)))),
      )
      .catch(() => undefined)
      .finally(() => pending.delete(locale));
    pending.set(locale, request);
  }
  return request;
}
language.subscribe((locale) => void loadCatalog(locale));

/** BCP 47 tag for a saved language, for `lang` attributes and date formatting.
 * @param locale Saved language @returns Locale tag, English when unknown @since 0.25.0-beta
 */
export function languageTag(locale: string): string {
  return LANGUAGE_OPTIONS.find((option) => option.code === locale)?.tag ?? 'en';
}

/** Translate UI copy, with English fallback and escaped-by-Svelte variable output.
 * @param locale Saved language @returns Message formatter @since 0.14.1
 */
export function translator(locale: string): (message: string, variables?: Variables) => string {
  const catalog = get(catalogs).get(locale);
  return (message, variables) => {
    const template = catalog?.get(message) ?? message;
    return variables
      ? template.replace(/\{(\w+)\}/g, (original, key: string) =>
          Object.hasOwn(variables, key) ? String(variables[key]) : original,
        )
      : template;
  };
}

/** Reactive UI formatter; changing language updates mounted and newly opened workspaces. */
export const t = derived([language, catalogs], ([$language]) => translator($language));
