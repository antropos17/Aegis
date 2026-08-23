#!/usr/bin/env node
'use strict';
/**
 * @file scripts/release-sign.js
 * @description Produces the signed manifest that ships with every GitHub Release.
 *
 *   Given a flat directory of release assets it writes two files next to them:
 *
 *     manifest.json      - every asset's filename, SHA-256 and byte length, plus the
 *                          tag/commit/repository this build came from.
 *     manifest.json.sig  - base64 of a raw 64-byte Ed25519 signature over the EXACT
 *                          bytes of manifest.json.
 *
 *   The signature covers the manifest's bytes as written, not a canonicalised form of
 *   its JSON. There is therefore no serialisation contract to get wrong: a verifier
 *   reads the file it was given and checks the signature over those bytes. Anything
 *   that rewrites manifest.json - a formatter, a text-mode checkout, an editor adding
 *   a trailing newline - invalidates the signature, which is the intended behaviour.
 *
 *   The private key arrives only through the AEGIS_RELEASE_SIGNING_KEY environment
 *   variable (PKCS#8 PEM). It is never read from a file, an argument, or the tree.
 *
 *   Dependency-free by construction: Node's built-in crypto only. This file
 *   deliberately duplicates a few helpers with scripts/release-verify.js instead of
 *   sharing a module - the verifier has to stay copyable as ONE file by a third party
 *   who has our public key and no clone. Do not "DRY" them into a common require().
 *
 *   Usage: node scripts/release-sign.js --dir release-assets [--out DIR] [--tag TAG]
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** Name of the manifest written into the asset directory. */
const MANIFEST_NAME = 'manifest.json';
/** Name of the detached signature written next to the manifest. */
const SIGNATURE_NAME = 'manifest.json.sig';
/** Manifest schema identifier; bump on any breaking field change. */
const SCHEMA = 'aegis-release-manifest/v1';
/** The only place the private key is read from. */
const KEY_ENV = 'AEGIS_RELEASE_SIGNING_KEY';

/** Usage error - the invocation was wrong, nothing was signed. */
const EXIT_USAGE = 2;
/** Signing error - the invocation was fine, the work could not be completed. */
const EXIT_FAILED = 1;

/**
 * Prints a one-line reason and exits. No stack trace: the readers of this output are
 * a CI log and a human, and neither is helped by a JS frame list.
 * @param {string} message - Plain-language reason.
 * @param {number} [code] - Process exit code.
 * @returns {never}
 */
function fail(message, code = EXIT_FAILED) {
  console.error('release-sign: ' + message);
  process.exit(code);
}

/**
 * Minimal `--flag value` parser. An unknown flag is an error rather than a no-op, so a
 * typo cannot silently produce a manifest over the wrong directory.
 * @param {string[]} argv - Arguments after the script path.
 * @returns {Record<string, string>}
 */
function parseArgs(argv) {
  const known = new Set(['--dir', '--out', '--tag', '--commit', '--repository']);
  /** @type {Record<string, string>} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!known.has(flag)) fail('unknown argument ' + flag, EXIT_USAGE);
    const value = argv[i + 1];
    if (value === undefined) fail(flag + ' needs a value', EXIT_USAGE);
    out[flag.slice(2)] = value;
    i += 1;
  }
  return out;
}

/**
 * SHA-256 of a file, read in chunks so a 100 MB installer never lands in one Buffer.
 * @param {string} file - Absolute path.
 * @returns {string} Lowercase hex digest.
 */
function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const read = fs.readSync(fd, buf, 0, buf.length, null);
      if (read === 0) break;
      hash.update(buf.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

/**
 * The assets to be covered, sorted by name so the manifest is byte-stable across runs
 * over the same inputs.
 *
 * A subdirectory is an ERROR, not something to skip: a manifest that quietly omits
 * part of what was in the directory claims a completeness it does not have.
 * @param {string} dir - Absolute path to the staging directory.
 * @returns {string[]} Filenames, without paths.
 */
function collectAssets(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return fail('cannot read --dir ' + dir + ': ' + /** @type {Error} */ (err).message);
  }
  const names = [];
  for (const entry of entries) {
    if (entry.name === MANIFEST_NAME || entry.name === SIGNATURE_NAME) continue;
    if (entry.isDirectory()) {
      fail(dir + ' contains a subdirectory (' + entry.name + '); the asset directory must be flat');
    }
    if (!entry.isFile()) {
      fail(dir + ' contains a non-regular entry (' + entry.name + ')');
    }
    names.push(entry.name);
  }
  if (names.length === 0) fail(dir + ' holds no assets to sign');
  return names.sort();
}

/**
 * Loads the Ed25519 private key from the environment.
 *
 * Both failure modes are loud and distinguishable: an absent secret (the workflow is
 * misconfigured) reads differently from a present-but-wrong one (the secret holds
 * something that is not an Ed25519 PKCS#8 PEM).
 * @returns {crypto.KeyObject}
 */
function loadPrivateKey() {
  const pem = process.env[KEY_ENV];
  if (!pem || pem.trim() === '') {
    fail(KEY_ENV + ' is not set - refusing to publish an unsigned release');
  }
  let key;
  try {
    key = crypto.createPrivateKey(String(pem).replace(/\r\n/g, '\n'));
  } catch (err) {
    return fail(KEY_ENV + ' is not a readable private key: ' + /** @type {Error} */ (err).message);
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    fail(KEY_ENV + ' holds a ' + key.asymmetricKeyType + ' key; this chain signs with ed25519');
  }
  return key;
}

/**
 * Builds the manifest, writes it, signs its bytes and writes the detached signature.
 * @param {object} options - Signing inputs.
 * @param {string} options.dir - Directory holding the assets.
 * @param {string} options.out - Directory the manifest and signature are written to.
 * @param {string|null} options.tag - Release tag this build belongs to.
 * @param {string|null} options.commit - Commit the assets were built from.
 * @param {string|null} options.repository - `owner/name` of the source repository.
 * @returns {{manifestPath: string, signaturePath: string, files: {filename: string, sha256: string, bytes: number}[]}}
 */
function signRelease({ dir, out, tag, commit, repository }) {
  const files = collectAssets(dir).map((filename) => ({
    filename,
    sha256: sha256File(path.join(dir, filename)),
    bytes: fs.statSync(path.join(dir, filename)).size,
  }));

  const manifest = {
    schema: SCHEMA,
    repository,
    tag,
    commit,
    generatedAt: new Date().toISOString(),
    algorithm: 'sha256',
    signature: { algorithm: 'ed25519', encoding: 'base64', file: SIGNATURE_NAME },
    files,
  };

  // These exact bytes are what gets signed and what a verifier must read back.
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  const signature = crypto.sign(null, manifestBytes, loadPrivateKey());

  fs.mkdirSync(out, { recursive: true });
  const manifestPath = path.join(out, MANIFEST_NAME);
  const signaturePath = path.join(out, SIGNATURE_NAME);
  fs.writeFileSync(manifestPath, manifestBytes);
  fs.writeFileSync(signaturePath, signature.toString('base64') + '\n', 'utf8');

  return { manifestPath, signaturePath, files };
}

/**
 * CLI entry point.
 * @returns {void}
 */
function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dir) fail('--dir is required (the directory holding the release assets)', EXIT_USAGE);

  const dir = path.resolve(args.dir);
  const out = path.resolve(args.out || args.dir);
  const result = signRelease({
    dir,
    out,
    tag: args.tag || process.env.GITHUB_REF_NAME || null,
    commit: args.commit || process.env.GITHUB_SHA || null,
    repository: args.repository || process.env.GITHUB_REPOSITORY || null,
  });

  console.log('release-sign: signed ' + result.files.length + ' asset(s) from ' + dir);
  for (const file of result.files) {
    console.log('  ' + file.sha256 + '  ' + String(file.bytes).padStart(12) + '  ' + file.filename);
  }
  console.log('release-sign: wrote ' + result.manifestPath);
  console.log('release-sign: wrote ' + result.signaturePath);
}

if (require.main === module) main();

module.exports = { signRelease, sha256File, MANIFEST_NAME, SIGNATURE_NAME, SCHEMA, KEY_ENV };
