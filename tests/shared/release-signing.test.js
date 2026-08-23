/**
 * @file release-signing.test.js
 * @description Pins the release signing pair: scripts/release-sign.js and
 *   scripts/release-verify.js.
 *
 *   Every case runs the two scripts as PROCESSES, because the deliverable is a CLI
 *   contract - "exit nonzero with a plain message on any mismatch" - and an in-process
 *   call of an exported function would test neither the exit code nor the message.
 *
 *   The keypair is generated inside the test. Nothing here touches the real release
 *   key, and the committed public key is only read by the one case that proves a
 *   foreign key is rejected.
 *
 *   Two of the cases are deliberately shaped so they can only be caught by the check
 *   they are named after:
 *
 *   - the tampered MANIFEST edits `tag`, a field no asset hash covers, so the hash
 *     comparisons still pass and only the signature can object;
 *   - the tampered ASSET flips a byte without changing the file's length, so the size
 *     comparison still passes and only the SHA-256 can object.
 *
 *   Without that shaping a green run would prove that some check fired, not that the
 *   check under test did (memory-bank/ai-mistakes.md #21).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SIGN = path.join(ROOT, 'scripts', 'release-sign.js');
const VERIFY = path.join(ROOT, 'scripts', 'release-verify.js');
const KEY_ENV = 'AEGIS_RELEASE_SIGNING_KEY';

/** Root for every temp fixture, removed once the file is done. */
let workRoot;
/** PKCS#8 PEM of the throwaway signing key. */
let privatePem;
/** Path to the SPKI PEM matching {@link privatePem}. */
let publicKeyPath;
/** Path to an SPKI PEM from an unrelated keypair. */
let foreignKeyPath;

/**
 * Generates an Ed25519 keypair and writes its public half.
 * @param {string} file - Where to write the SPKI PEM.
 * @returns {string} The PKCS#8 PEM of the private half.
 */
function makeKeypair(file) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  fs.writeFileSync(file, publicKey.export({ type: 'spki', format: 'pem' }), 'utf8');
  return privateKey.export({ type: 'pkcs8', format: 'pem' });
}

/**
 * Runs a script as a child process and reports its outcome without throwing, so a
 * nonzero exit is data rather than an exception.
 * @param {string} script - Absolute path to the script.
 * @param {string[]} args - CLI arguments.
 * @param {{signingKey?: string|null}} [options] - When `signingKey` is null the
 *   variable is removed from the child's environment entirely.
 * @returns {{status: number|null, stdout: string, stderr: string, output: string}}
 */
function run(script, args, options = {}) {
  const env = { ...process.env };
  if ('signingKey' in options) {
    if (options.signingKey === null) delete env[KEY_ENV];
    else env[KEY_ENV] = /** @type {string} */ (options.signingKey);
  } else {
    delete env[KEY_ENV];
  }
  const res = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env });
  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  return { status: res.status, stdout, stderr, output: stdout + stderr };
}

/**
 * Creates a fresh directory holding two assets and signs it with the throwaway key.
 * @param {string} name - Fixture name, used as the directory name.
 * @returns {{dir: string, manifest: string, signature: string, installer: string}}
 */
function makeSignedFixture(name) {
  const dir = path.join(workRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  const installer = path.join(dir, 'AEGIS-Setup-0.0.0-test.exe');
  fs.writeFileSync(installer, Buffer.from('MZ fake installer payload for the signing test'));
  fs.writeFileSync(path.join(dir, 'checksums.txt'), 'second asset so the manifest is plural\n');

  const signed = run(SIGN, ['--dir', dir, '--tag', 'aegis-v0.0.0-test'], { signingKey: privatePem });
  expect(signed.output).toContain('wrote');
  expect(signed.status).toBe(0);

  return {
    dir,
    installer,
    manifest: path.join(dir, 'manifest.json'),
    signature: path.join(dir, 'manifest.json.sig'),
  };
}

beforeAll(() => {
  workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-release-signing-'));
  publicKeyPath = path.join(workRoot, 'test-pubkey.pub');
  foreignKeyPath = path.join(workRoot, 'foreign-pubkey.pub');
  privatePem = makeKeypair(publicKeyPath);
  makeKeypair(foreignKeyPath);
});

afterAll(() => {
  if (workRoot) fs.rmSync(workRoot, { recursive: true, force: true });
});

describe('release signing roundtrip', () => {
  it('signs a directory and verifies it against the matching public key', () => {
    const fixture = makeSignedFixture('roundtrip');

    const manifest = JSON.parse(fs.readFileSync(fixture.manifest, 'utf8'));
    expect(manifest.schema).toBe('aegis-release-manifest/v1');
    expect(manifest.tag).toBe('aegis-v0.0.0-test');
    expect(manifest.files).toHaveLength(2);
    // Sorted by filename, so the manifest is byte-stable over the same inputs.
    expect(manifest.files.map((f) => f.filename)).toEqual([
      'AEGIS-Setup-0.0.0-test.exe',
      'checksums.txt',
    ]);
    for (const file of manifest.files) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file.bytes).toBe(fs.statSync(path.join(fixture.dir, file.filename)).size);
    }
    // The signature is a raw 64-byte ed25519 signature, base64-encoded.
    const raw = Buffer.from(fs.readFileSync(fixture.signature, 'utf8').trim(), 'base64');
    expect(raw).toHaveLength(64);

    const verified = run(VERIFY, ['--dir', fixture.dir, '--pubkey', publicKeyPath]);
    expect(verified.output).toContain('2 asset(s) match the signed manifest');
    expect(verified.status).toBe(0);
  });

  it('verifies a single named asset out of the signed set', () => {
    const fixture = makeSignedFixture('single-file');
    const verified = run(VERIFY, [
      '--file',
      fixture.installer,
      '--manifest',
      fixture.manifest,
      '--pubkey',
      publicKeyPath,
    ]);
    expect(verified.output).toContain('1 asset(s) match the signed manifest');
    expect(verified.status).toBe(0);
  });

  it('verifies an asset GitHub renamed on upload, matching it by content', () => {
    // Measured, not assumed: the 0.12.0-alpha installer was built as
    // "AEGIS - AI Monitoring & Threat Detection Setup 0.12.0-alpha.exe" and published
    // as "AEGIS.-.AI.Monitoring.Threat.Detection.Setup.0.12.0-alpha.exe". A verifier
    // that matched on filename would call every real download MISSING.
    const fixture = makeSignedFixture('renamed-on-upload');
    const renamed = path.join(fixture.dir, 'AEGIS.Setup.0.0.0.test.exe');
    fs.renameSync(fixture.installer, renamed);
    expect(path.basename(renamed)).not.toBe(path.basename(fixture.installer));

    const verified = run(VERIFY, ['--dir', fixture.dir, '--pubkey', publicKeyPath]);
    expect(verified.output).toContain('present as AEGIS.Setup.0.0.0.test.exe');
    expect(verified.output).toContain('2 asset(s) match the signed manifest');
    expect(verified.status).toBe(0);
  });
});

describe('release signing rejects tampering', () => {
  it('fails when an asset was modified without changing its length', () => {
    const fixture = makeSignedFixture('tampered-asset');
    const before = fs.readFileSync(fixture.installer);
    const after = Buffer.from(before);
    after[0] ^= 0xff;
    fs.writeFileSync(fixture.installer, after);
    // Same length, so the size comparison cannot be what catches this.
    expect(fs.statSync(fixture.installer).size).toBe(before.length);

    const verified = run(VERIFY, ['--dir', fixture.dir, '--pubkey', publicKeyPath]);
    expect(verified.output).toContain('HASH MISMATCH');
    expect(verified.output).toContain('AEGIS-Setup-0.0.0-test.exe');
    expect(verified.status).not.toBe(0);
  });

  it('names the length, not the digest, when an asset was truncated', () => {
    // The recorded `bytes` is not decoration: a truncated download is caught by the
    // hash too, but the message a user reads should say which property broke.
    const fixture = makeSignedFixture('truncated-asset');
    const before = fs.readFileSync(fixture.installer);
    fs.writeFileSync(fixture.installer, before.subarray(0, before.length - 4));

    const verified = run(VERIFY, ['--dir', fixture.dir, '--pubkey', publicKeyPath]);
    expect(verified.output).toContain('SIZE MISMATCH');
    expect(verified.output).toContain('manifest says ' + before.length);
    expect(verified.status).not.toBe(0);
  });

  it('fails when the manifest was modified in a field no asset hash covers', () => {
    const fixture = makeSignedFixture('tampered-manifest');
    const text = fs.readFileSync(fixture.manifest, 'utf8');
    const tampered = text.replace('aegis-v0.0.0-test', 'aegis-v9.9.9-fake');
    expect(tampered).not.toBe(text);
    fs.writeFileSync(fixture.manifest, tampered);

    const verified = run(VERIFY, ['--dir', fixture.dir, '--pubkey', publicKeyPath]);
    expect(verified.output).toContain('SIGNATURE CHECK FAILED');
    expect(verified.status).not.toBe(0);
  });

  it('fails when the manifest is checked against a different public key', () => {
    const fixture = makeSignedFixture('wrong-key');
    const verified = run(VERIFY, ['--dir', fixture.dir, '--pubkey', foreignKeyPath]);
    expect(verified.output).toContain('SIGNATURE CHECK FAILED');
    expect(verified.status).not.toBe(0);

    // ...and the same bytes still verify under the right key, so the failure above is
    // a property of the key and not of the fixture.
    const control = run(VERIFY, ['--dir', fixture.dir, '--pubkey', publicKeyPath]);
    expect(control.status).toBe(0);
  });

  it('fails when an asset named in the manifest is missing from the set', () => {
    const fixture = makeSignedFixture('missing-asset');
    fs.rmSync(fixture.installer);

    const verified = run(VERIFY, ['--dir', fixture.dir, '--pubkey', publicKeyPath]);
    expect(verified.output).toContain('MISSING');
    expect(verified.output).toContain('AEGIS-Setup-0.0.0-test.exe');
    expect(verified.status).not.toBe(0);
  });

  it('fails when --file is pointed at something the manifest does not cover', () => {
    const fixture = makeSignedFixture('unsigned-file');
    const stray = path.join(fixture.dir, 'not-ours.exe');
    fs.writeFileSync(stray, 'an installer from somewhere else\n');

    const verified = run(VERIFY, [
      '--file',
      stray,
      '--manifest',
      fixture.manifest,
      '--pubkey',
      publicKeyPath,
    ]);
    expect(verified.output).toContain('UNSIGNED');
    expect(verified.output).toContain('matches no entry in the signed manifest');
    expect(verified.status).not.toBe(0);
  });

  it('reports an unsigned extra file without failing the run', () => {
    const fixture = makeSignedFixture('extra-file');
    fs.writeFileSync(path.join(fixture.dir, 'Source code.zip'), 'github attaches this itself\n');

    const verified = run(VERIFY, ['--dir', fixture.dir, '--pubkey', publicKeyPath]);
    expect(verified.output).toContain('NOT covered by the manifest');
    expect(verified.status).toBe(0);
  });
});

describe('release signing refuses to run without a key', () => {
  it('fails loudly when the signing secret is absent', () => {
    const dir = path.join(workRoot, 'no-secret');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'asset.bin'), 'payload');

    const signed = run(SIGN, ['--dir', dir], { signingKey: null });
    expect(signed.output).toContain('AEGIS_RELEASE_SIGNING_KEY is not set');
    expect(signed.output).toContain('refusing to publish an unsigned release');
    expect(signed.status).not.toBe(0);
    expect(fs.existsSync(path.join(dir, 'manifest.json'))).toBe(false);
  });

  it('fails when the signing secret is not an ed25519 key', () => {
    const dir = path.join(workRoot, 'wrong-key-type');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'asset.bin'), 'payload');

    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rsaPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

    const signed = run(SIGN, ['--dir', dir], { signingKey: /** @type {string} */ (rsaPem) });
    expect(signed.output).toContain('ed25519');
    expect(signed.status).not.toBe(0);
  });
});

describe('the committed release public key', () => {
  it('is a parseable ed25519 SPKI PEM that release-verify loads by default', () => {
    const committed = path.join(ROOT, 'keys', 'aegis-release-pubkey.pub');
    expect(fs.existsSync(committed)).toBe(true);

    const fixture = makeSignedFixture('committed-key');
    // The throwaway key did not sign for the committed one, so this must be a
    // SIGNATURE failure - which is only reachable once the committed key PARSED.
    const verified = run(VERIFY, ['--dir', fixture.dir]);
    expect(verified.output).toContain('SIGNATURE CHECK FAILED');
    expect(verified.output).not.toContain('is not a readable public key');
    expect(verified.status).not.toBe(0);
  });
});
