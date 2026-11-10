import { derived } from 'svelte/store';
import { language, LANGUAGE_OPTIONS } from '../../../src/renderer/lib/i18n/index.js';
import legacyEnglish from '../../../src/renderer/lib/i18n/translations/en.json';
import legacyPortuguese from '../../../src/renderer/lib/i18n/translations/pt.json';
import german from '../translations/de.json';
import spanish from '../translations/es.json';
import french from '../translations/fr.json';
import japanese from '../translations/ja.json';
import portuguese from '../translations/pt-BR.json';
import russian from '../translations/ru.json';
import chinese from '../translations/zh-CN.json';

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

// English message → translation, per language code; a missing message falls back to English.
const catalogs = new Map<string, ReadonlyMap<string, string>>([
  ['pt', portugueseMessages],
  ['es', new Map(Object.entries(spanish))],
  ['fr', new Map(Object.entries(french))],
  ['de', new Map(Object.entries(german))],
  ['ja', new Map(Object.entries(japanese))],
  ['zh', new Map(Object.entries(chinese))],
  ['ru', new Map(Object.entries(russian))],
]);

/** BCP 47 tag for a saved language, for `lang` attributes and date formatting.
 * @param locale Saved language @returns Locale tag, English when unknown @since 0.24.0-beta
 */
export function languageTag(locale: string): string {
  return LANGUAGE_OPTIONS.find((option) => option.code === locale)?.tag ?? 'en';
}

/** Translate UI copy, with English fallback and escaped-by-Svelte variable output.
 * @param locale Saved language @returns Message formatter @since 0.14.1
 */
export function translator(locale: string): (message: string, variables?: Variables) => string {
  const catalog = catalogs.get(locale);
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
export const t = derived(language, translator);
