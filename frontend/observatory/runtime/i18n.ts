import { derived } from 'svelte/store';
import { language, LANGUAGE_OPTIONS } from '../../../src/renderer/lib/i18n/index.js';
import legacyEnglish from '../../../src/renderer/lib/i18n/translations/en.json';
import legacyPortuguese from '../../../src/renderer/lib/i18n/translations/pt.json';
import portuguese from '../translations/pt-BR.json';

export { language, LANGUAGE_OPTIONS };
type Variables = Record<string, unknown>;
type Dictionary = { [key: string]: string | Dictionary };
const messages = new Map<string, string>();

// Reuse the contributor's vocabulary wherever Observatory has the same English copy.
function includeLegacy(english: Dictionary, translated: Dictionary): void {
  for (const [key, value] of Object.entries(english)) {
    const target = translated[key];
    if (typeof value === 'string' && typeof target === 'string') messages.set(value, target);
    else if (typeof value === 'object' && typeof target === 'object') includeLegacy(value, target);
  }
}
includeLegacy(legacyEnglish, legacyPortuguese);
for (const [key, value] of Object.entries(portuguese)) messages.set(key, value);

/** Translate UI copy, with English fallback and escaped-by-Svelte variable output.
 * @param locale Saved language @returns Message formatter @since 0.14.1
 */
export function translator(locale: string): (message: string, variables?: Variables) => string {
  return (message, variables) => {
    const template = locale === 'pt' ? (messages.get(message) ?? message) : message;
    return variables
      ? template.replace(/\{(\w+)\}/g, (original, key: string) =>
          Object.hasOwn(variables, key) ? String(variables[key]) : original,
        )
      : template;
  };
}

/** Reactive UI formatter; changing language updates mounted and newly opened workspaces. */
export const t = derived(language, translator);
