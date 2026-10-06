const storageKey = 'aegis-advanced-mode';

/** Read the independently saved interface preference; absent or unreadable means Simple.
 * @returns Whether Advanced was explicitly saved @since 0.19.2
 */
export function readAdvancedMode(): boolean {
  try {
    return localStorage.getItem(storageKey) === 'true';
  } catch {
    return false;
  }
}

/** Save the device interface preference independently of the host settings draft.
 * @param value Whether to show the Advanced interface
 * @returns Nothing; throws when the saved value cannot be verified @since 0.19.2
 */
export function saveAdvancedMode(value: boolean): void {
  const saved = String(value);
  localStorage.setItem(storageKey, saved);
  if (localStorage.getItem(storageKey) !== saved)
    throw new Error('Interface preference could not be saved on this device.');
}
