'use strict';

/** @file Local npm metadata evidence. Agreement never authenticates a publisher or installation. */
const crypto = require('node:crypto');
const path = require('node:path').posix;
const semver = require('semver');
const { parseInventoryConfig } = require('./inventory-config');
const { createInventoryGit } = require('./inventory-git');

const PACKAGE_FILES = ['package.json', 'npm-shrinkwrap.json', 'package-lock.json'];
const PACKAGE_LIMIT = 64;
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const join = (directory, name) => (directory ? `${directory}/${name}` : name);
const parent = (name) => (path.dirname(name) === '.' ? '' : path.dirname(name));

function identity(value) {
  const name =
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    value.name.length <= 214 &&
    !Array.from(value.name).some((character) => character.charCodeAt(0) <= 32)
      ? value.name
      : null;
  const version =
    typeof value.version === 'string' &&
    value.version === value.version.trim() &&
    /^\d/.test(value.version)
      ? semver.parse(value.version)
      : null;
  return {
    name,
    exactVersion: version && version.raw === value.version ? value.version : null,
    summary: {
      nameSha256: name ? digest(name) : null,
      version: version
        ? {
            core: `${version.major}.${version.minor}.${version.patch}`,
            prerelease: version.prerelease.length > 0,
            buildMetadata: version.build.length > 0,
            sha256: digest(value.version),
          }
        : null,
    },
  };
}

function sourceSummary(entry) {
  const resolved = typeof entry.resolved === 'string' ? entry.resolved : '';
  let type = 'unspecified';
  if (/^https?:\/\//i.test(resolved)) type = 'http-artifact';
  else if (/^(?:git\+|git:|git@)/i.test(resolved)) type = 'git-reference';
  else if (/^file:/i.test(resolved)) type = 'local-reference';
  else if (resolved) type = 'other-reference';
  return {
    type,
    integrityDeclared: typeof entry.integrity === 'string' && entry.integrity.length > 0,
    artifactIntegrity: 'not-verified',
    publisher: 'not-verified',
  };
}

/**
 * Collect metadata already read in an inventory, then link contained files to it.
 * @param {object} reader The inventory's shared bounded reader.
 * @returns {object} Internal observe/finish methods; raw metadata never leaves finish().
 * @since v0.15.1
 */
function createPackageInventory(reader) {
  const files = new Map();
  const manifests = [];
  const git = createInventoryGit(reader);
  let limitReported = false;

  function observe(name, file, boundary) {
    if (boundary === null || !PACKAGE_FILES.includes(path.basename(name))) return;
    const parsed = parseInventoryConfig(file.data, 'json');
    const entry = { path: name, sha256: file.sha256, boundary, parsed };
    files.set(name, entry);
    if (parsed.parseStatus !== 'parsed')
      reader.issues.push({ path: name, reason: parsed.parseStatus });
    if (path.basename(name) !== 'package.json') return;
    if (manifests.length >= PACKAGE_LIMIT) {
      if (!limitReported) reader.issues.push({ path: name, reason: 'package-limit' });
      limitReported = true;
      return;
    }
    entry.root = parent(name);
    entry.blobs = Object.fromEntries(
      ['sha1', 'sha256'].map((algorithm) => [
        algorithm,
        crypto
          .createHash(algorithm)
          .update(`blob ${file.data.length}\0`)
          .update(file.data)
          .digest('hex'),
      ]),
    );
    manifests.push(entry);
  }

  function findLock(manifest) {
    let directory = manifest.root;
    while (true) {
      for (const base of PACKAGE_FILES.slice(1)) {
        const name = join(directory, base);
        if (files.has(name)) return files.get(name);
        if (reader.issues.some((issue) => issue.path === name)) return { path: name };
      }
      if (directory === manifest.boundary || !directory) return null;
      directory = parent(directory);
    }
  }

  function lockEvidence(manifest, subject) {
    const lock = findLock(manifest);
    if (reader.isStopped()) return { status: 'inventory-incomplete' };
    if (!lock) return { status: 'not-observed' };
    const evidence = { path: lock.path, sha256: lock.sha256 || null };
    const result = (status) => ({ ...evidence, status });
    if (!lock.parsed) return result('unavailable');
    if (lock.parsed.parseStatus !== 'parsed') return result('invalid');
    const data = lock.parsed.value;
    if (![2, 3].includes(data.lockfileVersion)) return result('unsupported-lock-version');
    if (!record(data.packages)) return result('invalid');
    const relative = path.relative(parent(lock.path) || '.', manifest.root || '.');
    if (!Object.hasOwn(data.packages, relative)) return result('not-listed');
    const entry = data.packages[relative];
    if (!record(entry)) return result('invalid');
    if (entry.link) return result('link-not-followed');
    evidence.source = sourceSummary(entry);
    if (!subject.name || !subject.exactVersion) return result('identity-incomplete');
    // npm descriptors can omit name for node_modules entries. The location then
    // supplies that comparison; aliases with an explicit name use that name.
    const segments = relative.split('/');
    const moduleIndex = segments.lastIndexOf('node_modules');
    const inferredName = moduleIndex >= 0 ? segments.slice(moduleIndex + 1).join('/') : null;
    const lockedName = Object.hasOwn(entry, 'name')
      ? entry.name
      : relative === ''
        ? data.name
        : inferredName;
    if (lockedName === undefined || lockedName === null || entry.version === undefined)
      return result('identity-incomplete');
    const agrees =
      lockedName === subject.name &&
      entry.version === subject.exactVersion &&
      (relative !== '' ||
        !Object.hasOwn(data, 'version') ||
        data.version === subject.exactVersion) &&
      (relative !== '' || !Object.hasOwn(data, 'name') || data.name === subject.name);
    return result(agrees ? 'consistent-local-metadata' : 'mismatch');
  }

  async function finish(components) {
    const packages = [];
    for (const manifest of manifests.sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    )) {
      const value = manifest.parsed.value;
      const subject = value
        ? identity(value)
        : { name: null, exactVersion: null, summary: { nameSha256: null, version: null } };
      const declaration =
        manifest.parsed.parseStatus !== 'parsed'
          ? 'invalid'
          : subject.name && subject.exactVersion
            ? 'self-declared'
            : 'identity-incomplete';
      const lockfile = lockEvidence(manifest, subject);
      if (['invalid', 'mismatch', 'unsupported-lock-version'].includes(lockfile.status)) {
        reader.issues.push({ path: lockfile.path, reason: `package-lock-${lockfile.status}` });
      }
      const proof = await git.verifyManifest(manifest.path, manifest.boundary, manifest.blobs);
      packages.push({
        manifest: manifest.path,
        sha256: manifest.sha256,
        declaration,
        identity: subject.summary,
        lockfile,
        git: proof,
        publisher: 'not-verified',
        installation: 'not-established',
      });
    }
    const processed = new Set(manifests.map((manifest) => manifest.path));
    for (const component of components) {
      let directory = parent(component.path);
      while (true) {
        const candidate = join(directory, 'package.json');
        if (files.has(candidate) || reader.issues.some((issue) => issue.path === candidate)) {
          if (processed.has(candidate)) {
            component.provenance.packageIdentity = 'contained-in-local-package';
            component.provenance.packageRef = candidate;
          }
          break;
        }
        if (!directory) break;
        directory = parent(directory);
      }
    }
    return { packages, gitUsage: git.usage() };
  }

  return { observe, finish };
}

module.exports = { createPackageInventory, PACKAGE_FILES, PACKAGE_LIMIT };
