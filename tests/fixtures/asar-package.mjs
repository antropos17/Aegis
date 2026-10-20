import { createPackage } from '@electron/asar';
import { finished } from 'node:stream/promises';

/** Finish and close the real archive before fixture metadata or reads consume it.
 * @param {string} root Source directory. @param {string} archive Archive path.
 * @returns {Promise<void>} Rejects archive write failures. @since v0.19.2
 */
export async function createFixtureAsar(root, archive) {
  await finished(await createPackage(root, archive), { cleanup: true });
}
