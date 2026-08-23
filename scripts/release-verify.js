#!/usr/bin/env node
'use strict';
/**
 * @file scripts/release-verify.js
 * @description Offline verifier for an AEGIS release. Node and nothing else.
 *
 *   Checks, in this order:
 *
 *     1. manifest.json.sig is a valid Ed25519 signature over the EXACT bytes of
 *        manifest.json, under the public key committed at keys/aegis-release-pubkey.pub.
 *     2. every asset named in that manifest is present and hashes to the recorded
 *        SHA-256 with the recorded byte length.
 *
 *   Order matters. Hashes are only meaningful once the list of hashes is known to be
 *   authentic, so a failed signature stops the run instead of being reported next to a
 *   set of green hash comparisons that prove nothing.
 *
 *   MATCHING IS BY CONTENT, NOT BY NAME, and that is load-bearing rather than lenient.
 *   GitHub rewrites an asset's filename when it is uploaded: the 0.12.0-alpha installer
 *   was built as `AEGIS - AI Monitoring & Threat Detection Setup 0.12.0-alpha.exe` and
 *   published as `AEGIS.-.AI.Monitoring.Threat.Detection.Setup.0.12.0-alpha.exe`. The
 *   exact rewrite rule is undocumented, so this verifier does not reimplement a guess at
 *   it - it looks for the recorded filename first and falls back to finding a file whose
 *   SHA-256 matches, reporting the name it was found under. A renamed download is still
 *   the signed bytes; the name never carried any of the security.
 *
 *   What a pass means is narrow and stated in docs/RELEASE-VERIFICATION.md: the bytes
 *   on disk are the bytes CI published under this key. It says nothing about whether
 *   the code is safe.
 *
 *   This file is deliberately standalone - it duplicates a few helpers with
 *   scripts/release-sign.js so that a third party can copy THIS ONE FILE plus the
 *   public key and verify a download without cloning anything. Do not "DRY" the two
 *   scripts into a shared require().
 *
 *   Usage:
 *     node scripts/release-verify.js --dir DOWNLOADS
 *     node scripts/release-verify.js --file AEGIS-Setup.exe --manifest manifest.json
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** Name of the manifest expected inside the asset directory. */
const MANIFEST_NAME = 'manifest.json';
/** Name of the detached signature expected next to the manifest. */
const SIGNATURE_NAME = 'manifest.json.sig';
/** Manifest schema this verifier understands. */
const SCHEMA = 'aegis-release-manifest/v1';
/** Raw Ed25519 signatures are exactly this long. */
const SIGNATURE_BYTES = 64;

/** Usage error - the invocation was wrong, nothing was verified. */
const EXIT_USAGE = 2;
/** Verification failure - something did not match. */
const EXIT_FAILED = 1;

/**
 * Prints a one-line reason and exits nonzero. No stack trace: a verification failure
 * is a statement about the files, not about this program.
 * @param {string} message - Plain-language reason.
 * @param {number} [code] - Process exit code.
 * @returns {never}
 */
function fail(message, code = EXIT_FAILED) {
  console.error('release-verify: ' + message);
  process.exit(code);
}

/**
 * Minimal argument parser. `--file` may repeat; every other flag takes one value, and
 * an unknown flag is an error so a typo cannot look like a clean run.
 * @param {string[]} argv - Arguments after the script path.
 * @returns {{dir?: string, manifest?: string, signature?: string, pubkey?: string, file: string[]}}
 */
function parseArgs(argv) {
  const single = new Set(['--dir', '--manifest', '--signature', '--pubkey']);
  /** @type {{dir?: string, manifest?: string, signature?: string, pubkey?: string, file: string[]}} */
  const out = { file: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') {
      console.log(
        'usage: node release-verify.js [--dir DIR] [--file PATH]... ' +
          '[--manifest PATH] [--signature PATH] [--pubkey PATH]',
      );
      process.exit(0);
    }
    const value = argv[i + 1];
    if (flag === '--file') {
      if (value === undefined) fail('--file needs a value', EXIT_USAGE);
      out.file.push(value);
      i += 1;
      continue;
    }
    if (!single.has(flag)) fail('unknown argument ' + flag, EXIT_USAGE);
    if (value === undefined) fail(flag + ' needs a value', EXIT_USAGE);
    out[/** @type {'dir'} */ (flag.slice(2))] = value;
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
 * Reads the committed public key.
 *
 * The PEM is normalised to LF and stripped of a UTF-8 BOM before parsing: the file is
 * committed with LF, but a browser download on Windows or a text-mode checkout can
 * hand a reader CRLF, and a key that fails to parse for that reason would look exactly
 * like a tampered one.
 * @param {string} file - Absolute path to the SPKI PEM.
 * @returns {crypto.KeyObject}
 */
function loadPublicKey(file) {
  let pem;
  try {
    pem = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return fail('cannot read public key ' + file + ': ' + /** @type {Error} */ (err).message);
  }
  // A literal BOM here would be an invisible character in the source, so strip it by
  // code point instead: U+FEFF ahead of "-----BEGIN" makes OpenSSL reject a good key.
  if (pem.charCodeAt(0) === 0xfeff) pem = pem.slice(1);
  pem = pem.replace(/\r\n/g, '\n');
  let key;
  try {
    key = crypto.createPublicKey(pem);
  } catch (err) {
    return fail(file + ' is not a readable public key: ' + /** @type {Error} */ (err).message);
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    fail(file + ' holds a ' + key.asymmetricKeyType + ' key; releases are signed with ed25519');
  }
  return key;
}

/**
 * Checks the detached signature against the manifest's raw bytes.
 *
 * The manifest is read as BYTES and never normalised - unlike the public key, it is a
 * downloaded artifact rather than a repository file, and rewriting it is exactly the
 * tampering this check exists to catch.
 * @param {string} manifestPath - Absolute path to manifest.json.
 * @param {string} signaturePath - Absolute path to manifest.json.sig.
 * @param {crypto.KeyObject} publicKey - The pinned release key.
 * @returns {Buffer} The verified manifest bytes.
 */
function verifySignature(manifestPath, signaturePath, publicKey) {
  let manifestBytes;
  try {
    manifestBytes = fs.readFileSync(manifestPath);
  } catch (err) {
    return fail('cannot read ' + manifestPath + ': ' + /** @type {Error} */ (err).message);
  }
  let signatureText;
  try {
    signatureText = fs.readFileSync(signaturePath, 'utf8');
  } catch (err) {
    return fail('cannot read ' + signaturePath + ': ' + /** @type {Error} */ (err).message);
  }

  const signature = Buffer.from(signatureText.trim(), 'base64');
  if (signature.length !== SIGNATURE_BYTES) {
    fail(
      signaturePath +
        ' does not hold a raw ed25519 signature (' +
        signature.length +
        ' bytes after base64 decode, expected ' +
        SIGNATURE_BYTES +
        ')',
    );
  }

  let ok = false;
  try {
    ok = crypto.verify(null, manifestBytes, publicKey, signature);
  } catch (err) {
    fail('signature check could not run: ' + /** @type {Error} */ (err).message);
  }
  if (!ok) {
    fail(
      'SIGNATURE CHECK FAILED - ' +
        manifestPath +
        ' was not signed by the pinned release key, or its bytes were modified after signing',
    );
  }
  return manifestBytes;
}

/**
 * Parses and shape-checks a manifest whose signature has already been verified.
 *
 * A filename carrying a path separator is rejected: a manifest entry must name a file
 * inside the asset directory and must not be able to point a verifier at anything else.
 * @param {Buffer} manifestBytes - The verified bytes.
 * @param {string} manifestPath - Path, for error messages.
 * @returns {{schema: string, tag: string|null, files: {filename: string, sha256: string, bytes: number}[]}}
 */
function parseManifest(manifestBytes, manifestPath) {
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch (err) {
    return fail(manifestPath + ' is not valid JSON: ' + /** @type {Error} */ (err).message);
  }
  if (manifest.schema !== SCHEMA) {
    fail(manifestPath + ' declares schema ' + manifest.schema + '; this verifier reads ' + SCHEMA);
  }
  if (manifest.algorithm !== 'sha256') {
    fail(manifestPath + ' declares digest algorithm ' + manifest.algorithm + '; expected sha256');
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    fail(manifestPath + ' lists no files');
  }
  for (const entry of manifest.files) {
    if (typeof entry.filename !== 'string' || entry.filename === '') {
      fail(manifestPath + ' has an entry without a filename');
    }
    if (entry.filename !== path.basename(entry.filename) || entry.filename === '..') {
      fail(manifestPath + ' names a path rather than a filename: ' + entry.filename);
    }
    if (!/^[0-9a-f]{64}$/.test(entry.sha256)) {
      fail(manifestPath + ' has a malformed sha256 for ' + entry.filename);
    }
    if (!Number.isInteger(entry.bytes) || entry.bytes < 0) {
      fail(manifestPath + ' has a malformed byte length for ' + entry.filename);
    }
  }
  return manifest;
}

/**
 * Hashes each file that might satisfy a manifest entry.
 * @param {{label: string, file: string}[]} inputs - Display name and path of each candidate.
 * @returns {{label: string, file: string, sha256: string, bytes: number}[]}
 */
function digestCandidates(inputs) {
  return inputs.map((input) => {
    let stat;
    try {
      stat = fs.statSync(input.file);
    } catch (err) {
      return fail('cannot read ' + input.file + ': ' + /** @type {Error} */ (err).message);
    }
    if (!stat.isFile()) fail(input.file + ' is not a regular file');
    return { label: input.label, file: input.file, sha256: sha256File(input.file), bytes: stat.size };
  });
}

/**
 * Matches manifest entries against candidate files: by recorded filename first, then by
 * SHA-256 for a file that was renamed in transit (see the note at the top of this file).
 *
 * Every problem is collected before returning so one run reports the whole picture
 * rather than the first thing that went wrong.
 * @param {{filename: string, sha256: string, bytes: number}[]} entries - Manifest rows.
 * @param {{label: string, file: string, sha256: string, bytes: number}[]} candidates - Hashed files.
 * @returns {{problems: string[], unmatched: {label: string, file: string}[]}}
 */
function checkAssets(entries, candidates) {
  const byName = new Map(candidates.map((c) => [c.label, c]));
  /** @type {Map<string, {label: string, file: string, sha256: string, bytes: number}>} */
  const byHash = new Map();
  for (const candidate of candidates) {
    if (!byHash.has(candidate.sha256)) byHash.set(candidate.sha256, candidate);
  }

  const problems = [];
  const used = new Set();

  for (const entry of entries) {
    const named = byName.get(entry.filename);
    if (named) {
      used.add(named.file);
      if (named.bytes !== entry.bytes) {
        problems.push(
          'SIZE MISMATCH  ' +
            entry.filename +
            ' - ' +
            named.bytes +
            ' bytes on disk, manifest says ' +
            entry.bytes,
        );
      } else if (named.sha256 !== entry.sha256) {
        problems.push(
          'HASH MISMATCH  ' +
            entry.filename +
            '\n    expected ' +
            entry.sha256 +
            '\n    actual   ' +
            named.sha256,
        );
      } else {
        console.log('  OK  ' + entry.sha256 + '  ' + entry.filename);
      }
      continue;
    }

    const renamed = byHash.get(entry.sha256);
    if (renamed && renamed.bytes === entry.bytes) {
      used.add(renamed.file);
      console.log(
        '  OK  ' + entry.sha256 + '  ' + entry.filename + '  (present as ' + renamed.label + ')',
      );
      continue;
    }

    problems.push(
      'MISSING  ' + entry.filename + ' - no file here carries its recorded sha256 ' + entry.sha256,
    );
  }

  return { problems, unmatched: candidates.filter((c) => !used.has(c.file)) };
}

/**
 * CLI entry point.
 * @returns {void}
 */
function main() {
  const args = parseArgs(process.argv.slice(2));

  const manifestPath = path.resolve(
    args.manifest || path.join(args.dir || process.cwd(), MANIFEST_NAME),
  );
  const signaturePath = path.resolve(args.signature || manifestPath + '.sig');
  const pubkeyPath = path.resolve(
    args.pubkey || path.join(__dirname, '..', 'keys', 'aegis-release-pubkey.pub'),
  );
  const dir = path.resolve(args.dir || path.dirname(manifestPath));

  console.log('release-verify: public key  ' + pubkeyPath);
  console.log('release-verify: manifest    ' + manifestPath);
  console.log('release-verify: signature   ' + signaturePath);

  const publicKey = loadPublicKey(pubkeyPath);
  const manifestBytes = verifySignature(manifestPath, signaturePath, publicKey);
  const manifest = parseManifest(manifestBytes, manifestPath);
  console.log('release-verify: signature OK for tag ' + (manifest.tag || '(none recorded)'));

  const explicit = args.file.length > 0;
  /** @type {{label: string, file: string}[]} */
  let inputs;
  if (explicit) {
    inputs = args.file.map((given) => ({
      label: path.basename(given),
      file: path.resolve(given),
    }));
  } else {
    let present;
    try {
      present = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name);
    } catch (err) {
      return fail('cannot read --dir ' + dir + ': ' + /** @type {Error} */ (err).message);
    }
    inputs = present
      .filter((name) => name !== MANIFEST_NAME && name !== SIGNATURE_NAME)
      .map((name) => ({ label: name, file: path.join(dir, name) }));
  }

  const candidates = digestCandidates(inputs);

  // With explicit --file arguments only the named files are checked, so the entries to
  // check are the ones those files claim to be. With --dir the whole signed set must be
  // accounted for, so every entry is checked.
  //
  // A --file argument that resolves to no entry is deliberately NOT rejected here: it
  // falls through as an unmatched candidate and is reported once, below, by the same
  // code path that reports one in --dir mode. A second early-exit here would be a
  // branch no test could reach (memory-bank/ai-mistakes.md #14).
  let entries = manifest.files;
  if (explicit) {
    entries = [];
    for (const candidate of candidates) {
      const entry =
        manifest.files.find((e) => e.filename === candidate.label) ||
        manifest.files.find((e) => e.sha256 === candidate.sha256);
      if (entry && !entries.includes(entry)) entries.push(entry);
    }
  }

  const { problems, unmatched } = checkAssets(entries, candidates);
  const extras = unmatched.map((candidate) => candidate.label);
  /** Context lines printed with the failures but not counted as failures themselves. */
  const notes = [];

  if (explicit) {
    for (const label of extras) {
      problems.push('UNSIGNED  ' + label + ' - matches no entry in the signed manifest');
    }
  } else if (problems.length > 0 && extras.length > 0) {
    // An asset that was renamed on upload AND altered afterwards lands here: its
    // manifest row resolves by neither name nor hash, and the file the reader actually
    // downloaded matches nothing. Reporting only MISSING about a file that is plainly
    // sitting in the directory reads as a verifier bug rather than as tampering.
    notes.push(
      'NOTE  present here but matching no manifest entry: ' +
        extras.join(', ') +
        '. If one of these is your download of an asset reported MISSING above, its bytes differ from what was signed.',
    );
  } else {
    // Not fatal: GitHub attaches auto-generated source archives to every Release and
    // those are not produced or signed by CI.
    for (const label of extras) {
      console.log('  --  ' + label + ' is present but NOT covered by the manifest');
    }
  }

  if (problems.length > 0) {
    console.error('');
    for (const problem of problems) console.error('release-verify: ' + problem);
    for (const note of notes) console.error('release-verify: ' + note);
    fail(problems.length + ' problem(s) against the signed manifest');
  }

  console.log('release-verify: OK - ' + entries.length + ' asset(s) match the signed manifest');
}

if (require.main === module) main();

module.exports = {
  verifySignature,
  parseManifest,
  digestCandidates,
  checkAssets,
  sha256File,
  MANIFEST_NAME,
  SIGNATURE_NAME,
  SCHEMA,
};
