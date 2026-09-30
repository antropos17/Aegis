import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
/** Publish only one self-contained inert fixture bundle, exclusively; never install an executable.
 * @param {string} destination Exact generated fixture directory.
 * @param {object} captured Owner consumed copied bytes. @param {boolean} interrupted Fixed interruption seam.
 * @returns {Promise<void>} Positive readback/exclusive publication. @since v0.17.0 */
export async function publishFixtureArtifact(destination, captured, interrupted = false) {
  const parent = path.dirname(destination),
    root = await fs.lstat(destination);
  if (
    path.basename(destination) !== 'destination' ||
    !path.basename(parent).startsWith('aegis-helper-artifacts-') ||
    path.dirname(parent) !== (await fs.realpath(os.tmpdir())) ||
    !root.isDirectory() ||
    root.isSymbolicLink() ||
    (await fs.realpath(destination)) !== destination ||
    !Buffer.isBuffer(captured.artifact) ||
    captured.artifact.length > 4194304 ||
    !Buffer.isBuffer(captured.manifest) ||
    captured.manifest.length > 8192 ||
    !Buffer.isBuffer(captured.signature) ||
    captured.signature.length !== 64
  )
    throw Error('fixture-publication-bound');
  const bytes = Buffer.from(
    JSON.stringify({
      schema: 'aegis-inert-fixture-bundle/v1',
      manifestBase64: captured.manifest.toString('base64'),
      signatureBase64: captured.signature.toString('base64'),
      artifactBase64: captured.artifact.toString('base64'),
      launchAllowed: false,
    }),
  );
  if (bytes.length > 6000000) throw Error('fixture-publication-bound');
  const stage = path.join(destination, '.stage-' + randomUUID());
  let handle, failure;
  try {
    handle = await fs.open(stage, 'wx');
    await handle.writeFile(bytes);
    await handle.sync();
    if (!(await fs.readFile(stage)).equals(bytes)) throw Error('fixture-stage-changed');
    if (interrupted) throw Error('fixture-interrupted');
    await fs.link(stage, path.join(destination, 'upgrade.bundle'));
  } catch (error) {
    failure = error;
  } finally {
    try {
      await handle?.close();
    } catch (error) {
      failure ||= error;
    }
    try {
      await fs.unlink(stage);
    } catch (error) {
      if (error.code !== 'ENOENT') failure ||= error;
    }
  }
  if (failure) throw failure;
}
