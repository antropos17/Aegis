#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const verifier = require('./release-verify.js');
const VERSION = '1.12.0';
const FLAGS = [
  'dir',
  'out',
  'id',
  'version',
  'tag',
  'asset',
  'installer-url',
  'arch',
  'locale',
  'publisher',
  'package-name',
  'license',
  'description',
];
const HELP = `usage: node scripts/prepare-winget.cjs [options]
Prepare candidate manifests offline from a signed local AEGIS NSIS release.
Required options (each takes one value):
  --dir DIR              Local release containing manifest.json and its signature
  --out NEW_DIR          New output directory; its parent must already exist
  --id PUBLISHER.PACKAGE Explicit WinGet package identifier
  --version VERSION      Exact release version, e.g. 1.2.3-beta
  --tag TAG              Exact signed release tag: aegis-vVERSION
  --asset NAME           Exact installer filename in the signed manifest
  --installer-url URL    Published HTTPS GitHub release URL for this installer
  --arch ARCH            Verified payload architecture: x86, x64, arm, arm64, neutral
  --locale LOCALE        Explicit default locale, e.g. en-US
  --publisher TEXT       Verified publisher name
  --package-name TEXT    Verified installed application name
  --license TEXT         Verified license identifier/name
  --description TEXT     Short description (3..256 characters)
Optional:
  --file NAME            Exact downloaded filename if renamed (default: --asset)
  --help                 Show this help
No downloads, installer execution, submission or signing occur. The CLI trusts
only keys/aegis-release-pubkey.pub. Metadata and architecture are caller inputs.
Success verifies the local manifest signature and selected installer bytes only.
URL availability, metadata, WinGet validation and clean-machine installation,
upgrade and uninstall qualification remain required before submission.
`;

function fail(message) {
  throw new Error(message);
}

function text(value, label, min = 1, max = 256) {
  if (
    typeof value !== 'string' ||
    value.length < min ||
    value.length > max ||
    value.trim() !== value ||
    /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(value)
  ) {
    fail(`invalid --${label}: provide ${min}..${max} printable characters without edge whitespace`);
  }
  return value;
}

function filename(value, label) {
  text(value, label, 1, 240);
  if (
    /[\\/:*?"<>|]/.test(value) ||
    /[. ]$/.test(value) ||
    /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(value)
  ) {
    fail(`invalid --${label}: use a regular filename without a path`);
  }
  return value;
}

// Reject symlinks/junctions in every existing component, including output ancestors.
function plainPath(target, kind, maxBytes = Infinity) {
  let current = path.resolve(target);
  let stat;
  for (;;) {
    const entry = fs.lstatSync(current);
    if (entry.isSymbolicLink()) fail('symlinks and reparse paths are not supported');
    if (!stat) stat = entry;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (
    (kind === 'file' && !stat.isFile()) ||
    (kind === 'dir' && !stat.isDirectory()) ||
    stat.size > maxBytes
  )
    fail(`expected a bounded regular ${kind}`);
  return stat;
}

function sameEntry(left, right) {
  return left.dev === right.dev && left.ino === right.ino && !right.isSymbolicLink();
}

function validate(options) {
  for (const key of Object.keys(options)) {
    if (![...FLAGS, 'file'].includes(key)) fail(`unknown option --${key}`);
  }
  for (const key of FLAGS) text(options[key], key, 1, key === 'installer-url' ? 2048 : 512);
  const o = { ...options, file: Object.hasOwn(options, 'file') ? options.file : options.asset };
  text(o.id, 'id', 3, 128);
  if (!/^[A-Za-z0-9-]{1,32}(?:\.[A-Za-z0-9-]{1,32}){1,7}$/.test(o.id)) {
    fail('invalid --id: use 2..8 dot-separated ASCII publisher/package segments');
  }
  if (
    !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?$/.test(
      o.version,
    ) ||
    o.version.length > 128
  ) {
    fail('invalid --version: use an explicit AEGIS release version');
  }
  if (o.tag !== `aegis-v${o.version}`) fail('--tag must equal aegis-v followed by --version');
  if (
    !/^(?:[a-zA-Z]{2,3}|[iI]-[a-zA-Z]+|[xX]-[a-zA-Z]{1,8})(?:-[a-zA-Z]{1,8})*$/.test(o.locale) ||
    o.locale.length > 20
  )
    fail('invalid --locale');
  if (!['x86', 'x64', 'arm', 'arm64', 'neutral'].includes(o.arch)) fail('invalid --arch');
  text(o.publisher, 'publisher', 2, 256);
  text(o['package-name'], 'package-name', 2, 256);
  text(o.license, 'license', 3, 512);
  text(o.description, 'description', 3, 256);
  for (const key of ['asset', 'file']) {
    filename(o[key], key);
    const escaped = o.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`(?:^|[^A-Za-z0-9])${escaped}\\.exe$`, 'i').test(o[key])) {
      fail(`--${key} must end with the exact --version followed by .exe`);
    }
  }
  o.dir = path.resolve(o.dir);
  o.out = path.resolve(o.out);
  plainPath(o.dir, 'dir');
  plainPath(path.dirname(o.out), 'dir');
  if (fs.existsSync(o.out)) fail('--out already exists; choose a new directory');
  return o;
}

function verifyRelease(o, publicKey) {
  const manifestPath = path.join(o.dir, verifier.MANIFEST_NAME);
  const signaturePath = path.join(o.dir, verifier.SIGNATURE_NAME);
  plainPath(manifestPath, 'file', 1024 * 1024);
  plainPath(signaturePath, 'file', 1024);
  const bytes = verifier.verifySignature(manifestPath, signaturePath, publicKey);
  const manifest = verifier.parseManifest(bytes, manifestPath);
  if (manifest.files.length > 256) fail('release manifest exceeds 256 assets');
  const names = manifest.files.map((entry) => entry.filename.toLowerCase());
  if (new Set(names).size !== names.length) fail('ambiguous signed asset names');
  const selected = manifest.files.filter((entry) => entry.filename === o.asset);
  if (selected.length !== 1) fail('--asset must select exactly one signed installer filename');
  const asset = selected[0];
  if (asset.bytes < 1 || asset.bytes > 2 * 1024 ** 3) fail('installer size must be 1 byte..2 GiB');
  if (manifest.files.filter((entry) => entry.sha256 === asset.sha256).length !== 1)
    fail('ambiguous signed installer digest');
  if (manifest.tag !== o.tag) fail('--tag differs from the signed release tag');
  if (
    typeof manifest.repository !== 'string' ||
    !/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(manifest.repository)
  )
    fail('signed manifest needs an explicit GitHub repository');
  let url;
  try {
    url = new URL(o['installer-url']);
  } catch {
    fail('invalid --installer-url');
  }
  const expected = ['', ...manifest.repository.split('/'), 'releases', 'download', o.tag, o.file];
  let pathname;
  try {
    pathname = url.pathname.split('/').map((part) => decodeURIComponent(part));
  } catch {
    fail('invalid --installer-url encoding');
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /[\\\s]/.test(o['installer-url']) ||
    JSON.stringify(pathname) !== JSON.stringify(expected)
  )
    fail('--installer-url must match the signed repository, tag and exact --file name');
  const file = path.join(o.dir, o.file);
  plainPath(file, 'file', 2 * 1024 ** 3);
  const candidates = verifier.digestCandidates([{ label: o.file, file }]);
  const checked = verifier.checkAssets([asset], candidates);
  if (checked.problems.length || checked.unmatched.length)
    fail('selected installer bytes differ from the signed manifest');
  return { asset, manifestSha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

function documents(o, sha256) {
  // JSON quoted strings are a YAML double-quoted scalar subset; controls are rejected above.
  const line = (key, value) => `${key}: ${JSON.stringify(value)}\n`;
  const common = line('PackageIdentifier', o.id) + line('PackageVersion', o.version);
  const tail = (type) => line('ManifestType', type) + line('ManifestVersion', VERSION);
  const header =
    '# Candidate manifests: local release signature/hash verified; qualification pending.\n';
  return {
    [`${o.id}.yaml`]: header + common + line('DefaultLocale', o.locale) + tail('version'),
    [`${o.id}.locale.${o.locale}.yaml`]:
      header +
      common +
      line('PackageLocale', o.locale) +
      line('Publisher', o.publisher) +
      line('PackageName', o['package-name']) +
      line('License', o.license) +
      line('ShortDescription', o.description) +
      tail('defaultLocale'),
    [`${o.id}.installer.yaml`]:
      header +
      common +
      line('InstallerType', 'nullsoft') +
      'Installers:\n' +
      line('  - Architecture', o.arch) +
      line('    InstallerUrl', o['installer-url']) +
      line('    InstallerSha256', sha256.toUpperCase()) +
      tail('installer'),
  };
}

function writeNewDirectory(out, files) {
  fs.mkdirSync(out); // Exclusive ownership; never recursively create or remove directories.
  const directory = fs.lstatSync(out);
  const owned = [];
  try {
    for (const [name, content] of Object.entries(files)) {
      if (!sameEntry(directory, plainPath(out, 'dir')))
        fail('output directory changed during preparation');
      const file = path.join(out, name);
      const fd = fs.openSync(file, 'wx');
      try {
        owned.push({ file, stat: fs.fstatSync(fd) });
        fs.writeFileSync(fd, content, 'utf8');
      } finally {
        fs.closeSync(fd);
      }
    }
    if (
      !sameEntry(directory, plainPath(out, 'dir')) ||
      fs.readdirSync(out).length !== owned.length ||
      owned.some((entry) => !sameEntry(entry.stat, plainPath(entry.file, 'file')))
    ) {
      fail('output entries changed during preparation');
    }
  } catch (error) {
    // Preserve unknown/replaced entries. Remove only our own closed regular files.
    try {
      if (sameEntry(directory, plainPath(out, 'dir'))) {
        for (const entry of owned) {
          try {
            const current = fs.lstatSync(entry.file);
            if (current.isFile() && sameEntry(entry.stat, current)) fs.unlinkSync(entry.file);
          } catch {
            /* Preserve unavailable or replaced entries and inspect the rest. */
          }
        }
        if (fs.readdirSync(out).length === 0) fs.rmdirSync(out);
      }
    } catch {
      /* Preserve anything whose ownership cannot be confirmed. */
    }
    throw error;
  }
}

function prepare(options, publicKey) {
  const o = validate(options);
  const verified = verifyRelease(o, publicKey);
  const files = documents(o, verified.asset.sha256);
  writeNewDirectory(o.out, files);
  return {
    files: Object.keys(files),
    installerSha256: verified.asset.sha256,
    manifestSha256: verified.manifestSha256,
  };
}

/**
 * Prepare candidate WinGet YAML using only the repository's release trust key.
 * @param {Record<string, string>} options Explicit CLI-shaped metadata and local paths.
 * @returns {{files: string[], installerSha256: string, manifestSha256: string}} Local evidence.
 * @since 0.19.2
 */
function prepareCandidate(options) {
  const key = crypto.createPublicKey(
    fs.readFileSync(path.join(__dirname, '../keys/aegis-release-pubkey.pub')),
  );
  if (key.asymmetricKeyType !== 'ed25519') fail('repository release key must be Ed25519');
  return prepare(options, key);
}

/**
 * Private fixture seam; never reachable through CLI flags or environment overrides.
 * @param {Record<string, string>} options Explicit fixture metadata and paths.
 * @param {import('node:crypto').KeyObject} publicKey Ephemeral fixture trust key.
 * @returns {{files: string[], installerSha256: string, manifestSha256: string}} Fixture evidence.
 * @since 0.19.2
 */
function _prepareCandidateForTest(options, publicKey) {
  return prepare(options, publicKey);
}

if (require.main === module) {
  try {
    const argv = process.argv.slice(2);
    if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) {
      console.log(HELP);
    } else {
      const options = Object.create(null);
      for (let i = 0; i < argv.length; i += 2) {
        const key = argv[i].slice(2);
        if (!argv[i].startsWith('--') || ![...FLAGS, 'file'].includes(key))
          fail('unknown argument; use --help');
        if (Object.hasOwn(options, key)) fail(`duplicate --${key}`);
        if (!argv[i + 1] || argv[i + 1].startsWith('--')) fail(`--${key} needs a value`);
        options[key] = argv[i + 1];
      }
      const result = prepareCandidate(options);
      console.log(
        `prepare-winget: wrote ${result.files.length} candidate manifests; local signature/hash verified. Qualification pending.`,
      );
    }
  } catch (error) {
    console.error('prepare-winget: ' + error.message);
    process.exitCode = 1;
  }
}

module.exports = { prepareCandidate, _prepareCandidateForTest };
