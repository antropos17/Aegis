/** @file electron-updater provider for AEGIS's existing signed GitHub manifests. @since 0.15.0 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const semver = require('semver');
const { REPOSITORY, releaseVersion, verifyManifest } = require('./update-verification');

const API_URL = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=30`;

/** Read bounded public metadata without credentials or disk writes. @param {string} url @param {number} limit @param {Function} fetcher @returns {Promise<Buffer>} @since 0.15.0 */
async function fetchBytes(url, limit, fetcher) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetcher(url, {
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        Accept: url === API_URL ? 'application/vnd.github+json' : 'application/octet-stream',
        'User-Agent': 'AEGIS-updater',
      },
    });
    if (!response.ok || !response.body) throw new Error('update-fetch-failed');
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit) {
        controller.abort();
        throw new Error('update-metadata-too-large');
      }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
  }
}

/** Select the newest complete release in the installed version's channel. @param {unknown} releases @param {string} current @returns {object|null} @since 0.15.0 */
function selectRelease(releases, current) {
  if (!Array.isArray(releases) || !semver.valid(current))
    throw new Error('update-releases-invalid');
  return (
    releases
      .filter((release) => {
        const version = releaseVersion(release?.tag_name);
        return (
          version &&
          !release.draft &&
          (semver.prerelease(current) || !semver.prerelease(version)) &&
          semver.gt(version, current) &&
          Array.isArray(release.assets) &&
          ['manifest.json', 'manifest.json.sig'].every((name) =>
            release.assets.some((a) => a.name === name && a.state === 'uploaded'),
          )
        );
      })
      .sort((a, b) => semver.rcompare(releaseVersion(a.tag_name), releaseVersion(b.tag_name)))[0] ||
    null
  );
}

/** Build authenticated updater metadata; URLs always stay under the fixed repository. @param {object} options @returns {Promise<object>} @since 0.15.0 */
async function loadRelease({ current, fetcher, publicKey }) {
  const releases = JSON.parse(
    (await fetchBytes(API_URL, 2 * 1024 * 1024, fetcher)).toString('utf8'),
  );
  const release = selectRelease(releases, current);
  if (!release) return { version: current, files: [] };
  const base = `https://github.com/${REPOSITORY}/releases/download/${release.tag_name}/`;
  const bytes = await fetchBytes(base + 'manifest.json', 64 * 1024, fetcher);
  const signatureText = (await fetchBytes(base + 'manifest.json.sig', 256, fetcher))
    .toString('ascii')
    .trim();
  if (!/^[A-Za-z0-9+/]{86}==$/.test(signatureText)) throw new Error('update-signature-invalid');
  const verified = verifyManifest(
    bytes,
    Buffer.from(signatureText, 'base64'),
    publicKey,
    release.tag_name,
  );
  const assets = release.assets.filter(
    (a) =>
      typeof a.name === 'string' && /^[A-Za-z0-9._-]+\.exe$/.test(a.name) && a.state === 'uploaded',
  );
  if (assets.length !== 1 || assets[0].size !== verified.bytes)
    throw new Error('update-asset-invalid');
  return {
    version: verified.version,
    releaseNotes: typeof release.body === 'string' ? release.body.slice(0, 12000) : '',
    files: [
      {
        url: base + encodeURIComponent(assets[0].name),
        sha2: verified.sha256,
        size: verified.bytes,
      },
    ],
    verified,
  };
}

/** Custom provider contract supported by electron-updater 6.8.9. @since 0.15.0 */
class SignedReleaseProvider {
  constructor(options, updater) {
    this.updater = updater;
    this.fetcher = options.fetcher || ((...args) => require('electron').net.fetch(...args));
    this.publicKey =
      options.publicKey ||
      fs.readFileSync(path.join(__dirname, '../../keys/aegis-release-pubkey.pub'));
    this.isUseMultipleRangeRequest = false;
    this.fileExtraDownloadHeaders = null;
  }
  setRequestHeaders() {} // Public releases never need renderer or environment credentials.
  async getLatestVersion() {
    return loadRelease({
      current: this.updater.currentVersion.version,
      fetcher: this.fetcher,
      publicKey: this.publicKey,
    });
  }
  resolveFiles(info) {
    return info.files.map((file) => ({ url: new URL(file.url), info: file }));
  }
}

module.exports = { SignedReleaseProvider, loadRelease, selectRelease, fetchBytes };
