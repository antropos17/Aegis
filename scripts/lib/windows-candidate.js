'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const release = require('../release-verify.js');
const authenticode = require('./authenticode.js');
const KEY = path.join(__dirname, '../../keys/aegis-release-pubkey.pub');
const HEX = /^[a-f0-9]{64}$/;
const FLAGS = {
  '--manifest': 'manifest',
  '--signature': 'signature',
  '--asset': 'asset',
  '--tag': 'tag',
  '--repository': 'repository',
  '--artifact': 'artifact',
  '--artifact-sha256': 'artifactSha256',
  '--signer-sha256': 'signerSha256',
  '--authenticode-output': 'authenticodeOutput',
  '--output': 'output',
};

function fail(code) {
  const error = new Error(code);
  error.gateCode = code;
  throw error;
}

function ordinary(value) {
  if (typeof value !== 'string' || value.length > 240 || !path.isAbsolute(value))
    fail('INVALID_PATH');
  const root = path.parse(value).root;
  if (path.sep === '\\' && !/^[a-z]:\\$/i.test(root)) fail('INVALID_PATH');
  if (
    value
      .slice(root.length)
      .split(/[/\\]/)
      .some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          /[. ]$|[:*?"<>|\x00-\x1f\x7f]/.test(part) ||
          /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part),
      )
  )
    fail('INVALID_PATH');
  return path.normalize(value);
}

function plain(target, directory = false, maxBytes = Infinity) {
  const entry = fs.lstatSync(target, { bigint: true });
  if (directory ? !entry.isDirectory() : !entry.isFile() || entry.nlink !== 1n) fail('UNSAFE_PATH');
  if (!directory && entry.size > maxBytes) fail('INPUT_SIZE');
  for (let current = target; ;) {
    if (fs.lstatSync(current).isSymbolicLink()) fail('UNSAFE_PATH');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (fs.realpathSync(target).toLowerCase() !== target.toLowerCase()) fail('UNSAFE_PATH');
  return entry;
}

function same(a, b) {
  return ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'nlink'].every((key) => a[key] === b[key]);
}

function validate(options) {
  if (!options || Object.keys(options).sort().join() !== Object.values(FLAGS).sort().join())
    fail('INVALID_INPUT');
  const o = { ...options };
  if (
    typeof o.artifactSha256 !== 'string' ||
    typeof o.signerSha256 !== 'string' ||
    !HEX.test(o.artifactSha256) ||
    !HEX.test(o.signerSha256)
  )
    fail('INVALID_INPUT');
  if (
    typeof o.tag !== 'string' ||
    !/^aegis-v[0-9A-Za-z][0-9A-Za-z.-]{0,127}$/.test(o.tag) ||
    typeof o.repository !== 'string' ||
    !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(o.repository)
  )
    fail('INVALID_IDENTITY');
  if (typeof o.asset !== 'string' || !o.asset.toLowerCase().endsWith('.exe')) fail('INVALID_ASSET');
  // Reuse the ordinary-path component grammar without resolving a caller filename.
  ordinary(path.join(path.parse(KEY).root, o.asset));
  if (/[\\/]/.test(o.asset)) fail('INVALID_ASSET');
  for (const field of ['manifest', 'signature', 'artifact', 'authenticodeOutput', 'output'])
    o[field] = ordinary(o[field]);
  if (path.extname(o.artifact).toLowerCase() !== '.exe') fail('INVALID_PATH');
  const targets = [o.manifest, o.signature, o.artifact, o.authenticodeOutput, o.output, KEY];
  if (new Set(targets.map((p) => p.toLowerCase())).size !== targets.length)
    fail('OUTPUT_COLLISION');
  plain(o.manifest, false, 2 * 1024 * 1024);
  plain(o.signature, false, 256);
  plain(KEY, false, 16384);
  const artifact = plain(o.artifact, false, 512 * 1024 * 1024);
  if (artifact.size < 68n) fail('ARTIFACT_SIZE');
  for (const dest of [o.output, o.authenticodeOutput]) {
    plain(path.dirname(dest), true);
    try {
      fs.lstatSync(dest);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    fail('OUTPUT_UNAVAILABLE');
  }
  return o;
}

function select(o, publicKey) {
  if (publicKey.asymmetricKeyType !== 'ed25519') fail('RELEASE_KEY_TYPE');
  // The accepted verifier exits on refusal. It runs before any output or child exists.
  const bytes = release.verifySignature(o.manifest, o.signature, publicKey);
  const manifest = release.parseManifest(bytes, o.manifest);
  if (manifest.tag !== o.tag || manifest.repository !== o.repository) fail('RELEASE_IDENTITY');
  const names = manifest.files.map((file) => file.filename.toLowerCase());
  if (new Set(names).size !== names.length) fail('AMBIGUOUS_ASSET');
  const asset = manifest.files.find((file) => file.filename === o.asset);
  if (!asset) fail('ASSET_MISSING');
  if (!Number.isSafeInteger(asset.bytes) || asset.bytes < 68 || asset.bytes > 512 * 1024 * 1024)
    fail('ARTIFACT_SIZE');
  if (asset.sha256 !== o.artifactSha256) fail('SIGNED_PIN_MISMATCH');
  if (plain(o.artifact).size !== BigInt(asset.bytes)) fail('SIGNED_SIZE_MISMATCH');
  return { asset, manifestSha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

async function verifyCandidate(options, fixture) {
  const result = {
    schemaVersion: 1,
    verdict: 'refused',
    code: 'INVALID_INPUT',
    checkedAt: new Date().toISOString(),
    launchAllowed: false,
    tag: null,
    repository: null,
    asset: null,
    manifestSha256: null,
    artifactSha256: null,
    bytes: null,
    signerCertificateSha256: null,
    authenticodeReceiptSha256: null,
  };
  let output;
  let outputStat;
  let o;
  try {
    o = validate(options);
    const key =
      fixture?.publicKey ||
      crypto.createPublicKey(
        fs
          .readFileSync(KEY, 'utf8')
          .replace(/^\uFEFF/, '')
          .replace(/\r\n/g, '\n'),
      );
    const selected = select(o, key);
    Object.assign(result, {
      tag: o.tag,
      repository: o.repository,
      asset: o.asset,
      manifestSha256: selected.manifestSha256,
      artifactSha256: selected.asset.sha256,
      bytes: selected.asset.bytes,
      signerCertificateSha256: o.signerSha256,
    });
    try {
      output = fs.openSync(o.output, 'wx', 0o600);
    } catch {
      fail('OUTPUT_UNAVAILABLE');
    }
    outputStat = fs.fstatSync(output, { bigint: true });
    const auth = await authenticode.verify({
      artifact: o.artifact,
      artifactSha256: o.artifactSha256,
      signerSha256: o.signerSha256,
      output: o.authenticodeOutput,
    });
    if (auth.verdict !== 'pass') fail('AUTHENTICODE_REFUSED');
    if (
      auth.code !== 'VERIFIED' ||
      auth.childCleanup !== 'closed' ||
      auth.status !== 'Valid' ||
      auth.signatureType !== 'Authenticode' ||
      auth.expectedArtifactSha256 !== o.artifactSha256 ||
      auth.expectedSignerCertificateSha256 !== o.signerSha256 ||
      auth.artifactSha256 !== selected.asset.sha256 ||
      auth.bytes !== selected.asset.bytes ||
      auth.signerCertificateSha256 !== o.signerSha256
    )
      fail('AUTHENTICODE_BINDING');
    const receiptStat = plain(o.authenticodeOutput, false, 16384);
    const receiptBytes = fs.readFileSync(o.authenticodeOutput);
    if (
      !same(receiptStat, plain(o.authenticodeOutput)) ||
      !receiptBytes.equals(Buffer.from(JSON.stringify(auth) + '\n'))
    )
      fail('AUTHENTICODE_RECEIPT');
    result.authenticodeReceiptSha256 = crypto
      .createHash('sha256')
      .update(receiptBytes)
      .digest('hex');
    const before = plain(o.artifact, false, 512 * 1024 * 1024);
    if (
      release.sha256File(o.artifact) !== selected.asset.sha256 ||
      before.size !== BigInt(selected.asset.bytes) ||
      !same(before, plain(o.artifact))
    )
      fail('ARTIFACT_CHANGED');
    result.verdict = 'pass';
    result.code = 'CANDIDATE_VERIFIED';
  } catch (error) {
    result.code = error.gateCode || 'VERIFICATION_FAILED';
  }
  if (output !== undefined) {
    try {
      const entry = plain(o.output);
      if (entry.dev !== outputStat.dev || entry.ino !== outputStat.ino) fail('OUTPUT_CHANGED');
      fs.writeFileSync(output, JSON.stringify(result) + '\n');
      fs.fsyncSync(output);
    } catch {
      result.verdict = 'refused';
      result.code = 'OUTPUT_WRITE_FAILED';
    } finally {
      try {
        fs.closeSync(output);
      } catch {
        result.verdict = 'refused';
        result.code = 'OUTPUT_WRITE_FAILED';
      }
    }
  }
  return result;
}

/** Verify a signed manifest and fresh Authenticode evidence for one local candidate.
 * @param {object} options Explicit inputs, identities, pins and new receipt paths.
 * @returns {Promise<object>} Bounded candidate verdict; launchAllowed remains false.
 * @since 0.19.2-beta
 */
function verify(options) {
  return verifyCandidate(options);
}

/** Exercise fixture signatures without changing production CLI trust.
 * @param {object} options Explicit fixture inputs.
 * @param {object} fixture Fixture-only publicKey.
 * @returns {Promise<object>} Modeled candidate verdict.
 * @since 0.19.2-beta
 */
function _verifyForTest(options, fixture) {
  return verifyCandidate(options, fixture);
}

/** Parse the closed argument set without echoing caller inputs.
 * @param {string[]} args CLI arguments.
 * @returns {object|null} Complete options or null.
 * @since 0.19.2-beta
 */
function parse(args) {
  if (args.length !== Object.keys(FLAGS).length * 2) return null;
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const field = Object.hasOwn(FLAGS, args[i]) ? FLAGS[args[i]] : null;
    if (!field || Object.hasOwn(options, field) || !args[i + 1] || args[i + 1].startsWith('--'))
      return null;
    options[field] = args[i + 1];
  }
  return options;
}

module.exports = { verify, parse, _verifyForTest };
