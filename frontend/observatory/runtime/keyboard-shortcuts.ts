import { writable } from 'svelte/store';

const storageKey = 'aegis-single-key-shortcuts';
export const singleKeyShortcuts = writable(true);

/** Load and persist the window's single-key preference without changing host settings.
 * @param storage Device preference storage
 * @returns Subscription cleanup
 * @since 0.19.0
 */
export function mountKeyboardPreferences(storage: Storage = localStorage): () => void {
  singleKeyShortcuts.set(storage.getItem(storageKey) !== 'false');
  return singleKeyShortcuts.subscribe((enabled) => storage.setItem(storageKey, String(enabled)));
}
