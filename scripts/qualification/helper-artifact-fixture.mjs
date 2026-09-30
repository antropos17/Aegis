import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { generateKeyPairSync, createHash, sign } from 'node:crypto';
export const expected = Object.freeze({
  helper: 'dummy-helper',
  version: '2.0.0',
  protocol: 1,
  platform: 'win32',
  architecture: 'x64',
});
export const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const inert = Buffer.from('INERT-DUMMY-ARTIFACT-V2-NOT-EXECUTABLE');
/** Produce disposable signed bytes with explicit fixture-only key material.
 * @param {object} key Generated test key. @param {object} fields Finite negative manifest changes.
 * @param {Buffer} artifact Inert dummy bytes. @returns {object} Owned wire input. @since v0.17.0 */
export function signedArtifact(key, fields = {}, artifact = inert) {
  const manifest = Buffer.from(
    JSON.stringify({
      schema: 'aegis-helper-artifact/v1',
      keyId: 'owner',
      ...expected,
      bytes: artifact.length,
      sha256: sha(artifact),
      ...fields,
    }),
  );
  return {
    keyId: 'owner',
    manifest,
    signature: sign(null, manifest, key.privateKey),
    artifact: Buffer.from(artifact),
  };
}
/** Own one generated source/destination tree and independent retained sentinels.
 * @returns {Promise<object>} Disposable signed input and bounded cleanup/readback. @since v0.17.0 */
export async function createArtifactFixture() {
  const parent = await fs.realpath(os.tmpdir()),
    root = await fs.mkdtemp(path.join(parent, 'aegis-helper-artifacts-'));
  const source = path.join(root, 'source'),
    destination = path.join(root, 'destination'),
    key = generateKeyPairSync('ed25519');
  const retained = Buffer.from('INERT-RETAINED-V1-NOT-EXECUTABLE'),
    unrelated = Buffer.from('UNRELATED-RETAINED-SENTINEL');
  const cleanup = async () => {
    if (path.dirname(root) !== parent || !path.basename(root).startsWith('aegis-helper-artifacts-'))
      throw Error('fixture-cleanup-boundary');
    let count = 0;
    async function visit(directory, depth) {
      if (depth > 2 || (await fs.lstat(directory)).isSymbolicLink())
        throw Error('fixture-cleanup-boundary');
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (++count > 48 || entry.isSymbolicLink()) throw Error('fixture-cleanup-boundary');
        const p = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(p, depth + 1);
        else if (entry.isFile()) await fs.unlink(p);
        else throw Error('fixture-cleanup-boundary');
      }
      await fs.rmdir(directory);
    }
    await visit(root, 0);
  };
  try {
    await fs.mkdir(source);
    await fs.mkdir(destination);
    const input = signedArtifact(key);
    await fs.writeFile(path.join(source, 'manifest.json'), input.manifest, { flag: 'wx' });
    await fs.writeFile(path.join(source, 'signature.bin'), input.signature, { flag: 'wx' });
    await fs.writeFile(path.join(source, 'helper.bin'), input.artifact, { flag: 'wx' });
    await fs.writeFile(path.join(destination, 'retained.bin'), retained, { flag: 'wx' });
    await fs.writeFile(path.join(destination, 'unrelated.txt'), unrelated, { flag: 'wx' });
    return {
      root,
      source,
      destination,
      key,
      input,
      baseline: { version: '1.0.0', bytes: retained.length, sha256: sha(retained) },
      cleanup,
      preserved: async () =>
        (await fs.readFile(path.join(destination, 'retained.bin'))).equals(retained) &&
        (await fs.readFile(path.join(destination, 'unrelated.txt'))).equals(unrelated),
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
