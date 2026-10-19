import fs from 'node:fs';

/** Reject unsupported Node runtimes before Electron preparation or test workers.
 * @returns {void} Throws with an upgrade instruction for an unsupported runtime.
 * @since 0.19.2
 */
export default function checkTestNode() {
  const minimum = fs.readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8').trim();
  const [requiredMajor, requiredMinor, requiredPatch] = minimum.split('.').map(Number);
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  if (
    major !== requiredMajor ||
    minor < requiredMinor ||
    (minor === requiredMinor && patch < requiredPatch)
  ) {
    throw new Error(
      `Tests require Node.js >=${minimum} <${requiredMajor + 1}; found ${process.version}. ` +
        'Upgrade Node.js before retrying. Older Node 24 builds have a Windows libuv TCP crash ' +
        '(https://github.com/nodejs/node/issues/63620).',
    );
  }
}
