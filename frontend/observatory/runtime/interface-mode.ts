const storageKey = 'aegis-advanced-mode';

/** Read the saved preference; absent or unreadable storage uses Advanced.
 * @returns Whether Advanced is enabled; an explicit Simple preference is retained @since 0.19.2
 */
export function readAdvancedMode(): boolean {
  try {
    return localStorage.getItem(storageKey) !== 'false';
  } catch {
    return true;
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
