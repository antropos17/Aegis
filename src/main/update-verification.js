/** @file Signed release verification used by the Windows updater. @since 0.15.0 */
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const semver = require('semver');

const REPOSITORY = 'antropos17/Aegis';
const MAX_INSTALLER_BYTES = 512 * 1024 * 1024;

/** Validate a release tag without accepting paths or arbitrary channels. @param {string} tag @returns {string|null} @since 0.15.0 */
function releaseVersion(tag) {
  if (typeof tag !== 'string' || !/^aegis-v\d+\.\d+\.\d+(?:-alpha(?:\.\d+)?)?$/.test(tag))
    return null;
  return semver.valid(tag.slice(7));
}

/** Authenticate raw bytes before trusting their fields. @param {Buffer} bytes @param {Buffer} signature @param {string|Buffer} publicKey @param {string} tag @returns {object} @since 0.15.0 */
function verifyManifest(bytes, signature, publicKey, tag) {
  const key = crypto.createPublicKey(publicKey);
  if (
    key.asymmetricKeyType !== 'ed25519' ||
    signature.length !== 64 ||
    !crypto.verify(null, bytes, key, signature)
  ) {
    throw new Error('update-signature-invalid');
  }
  const manifest = JSON.parse(bytes.toString('utf8'));
  const version = releaseVersion(tag);
  if (
    !version ||
    manifest.schema !== 'aegis-release-manifest/v1' ||
    manifest.repository !== REPOSITORY ||
    manifest.tag !== tag ||
    manifest.algorithm !== 'sha256' ||
    !/^[a-f0-9]{40}$/.test(manifest.commit) ||
    !Array.isArray(manifest.files)
  )
    throw new Error('update-manifest-invalid');
  const files = manifest.files.filter(
    (file) => typeof file?.filename === 'string' && file.filename.endsWith('.exe'),
  );
  if (files.length !== 1) throw new Error('update-installer-ambiguous');
  const file = files[0];
  if (
    file.filename !== `AEGIS - AI Monitoring & Threat Detection Setup ${version}.exe` ||
    !/^[a-f0-9]{64}$/.test(file.sha256) ||
    !Number.isSafeInteger(file.bytes) ||
    file.bytes <= 0 ||
    file.bytes > MAX_INSTALLER_BYTES
  )
    throw new Error('update-installer-invalid');
  return { version, tag, sha256: file.sha256, bytes: file.bytes };
}

/** Recheck downloaded bytes, including cached files, immediately before installing. @param {string} file @param {{sha256:string,bytes:number}} expected @returns {Promise<void>} @since 0.15.0 */
async function verifyInstaller(file, expected) {
  const stat = await fs.promises.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expected.bytes)
    throw new Error('update-size-invalid');
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  if (hash.digest('hex') !== expected.sha256) throw new Error('update-hash-invalid');
}

module.exports = { REPOSITORY, releaseVersion, verifyManifest, verifyInstaller };
