import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { createHash, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SUBJECT =
  process.env.AEGIS_WINDOWS_CANDIDATE_TEST_SUBJECT ||
  path.join(ROOT, 'scripts/lib/windows-candidate.js');
const CLI = path.join(ROOT, 'scripts/verify-windows-candidate.cjs');
const gate = require(SUBJECT);
const auth = require(path.join(ROOT, 'scripts/lib/authenticode.js'));
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const signer = 'b'.repeat(64);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
let root, options, manifest, observed, spawn, child;

function payload(last = 0) {
  const bytes = Buffer.alloc(128);
  bytes.write('MZ');
  bytes.writeUInt32LE(64, 60);
  bytes.write('PE\0\0', 64);
  bytes[127] = last;
  return bytes;
}

function save() {
  const bytes = Buffer.from(JSON.stringify(manifest));
  fs.writeFileSync(options.manifest, bytes);
  fs.writeFileSync(options.signature, sign(null, bytes, privateKey).toString('base64'));
}

function model(
  action = (proc) => {
    proc.stdout.write(JSON.stringify(observed));
    proc.emit('exit', 0, null);
    proc.emit('close', 0, null);
  },
) {
  spawn = vi.fn(() => {
    child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn(() => {
      queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
      return true;
    });
    child.unref = vi.fn();
    child.stdin.on('finish', () => queueMicrotask(() => action(child)));
    return child;
  });
  auth._setDepsForTest({
    spawn,
    platform: 'win32',
    executable: process.execPath,
    timeoutMs: 50,
    drainMs: 20,
  });
}

const run = () => gate._verifyForTest(options, { publicKey });
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function early(code) {
  return run().then((result) => {
    expect(result).toMatchObject({ verdict: 'refused', code, launchAllowed: false });
    expect(spawn).not.toHaveBeenCalled();
    expect(fs.existsSync(options.output)).toBe(false);
    expect(fs.existsSync(options.authenticodeOutput)).toBe(false);
    return result;
  });
}

function childFixture(key = publicKey) {
  const driver = path.join(root, 'fixture.cjs');
  const input = path.join(root, 'fixture-input.json');
  fs.writeFileSync(
    input,
    JSON.stringify({ options, key: key.export({ type: 'spki', format: 'pem' }) }),
  );
  fs.writeFileSync(
    driver,
    `const fs = require('node:fs');
const crypto = require('node:crypto');
const input = JSON.parse(fs.readFileSync(process.argv[2]));
require(${JSON.stringify(SUBJECT)})._verifyForTest(input.options,
  { publicKey: crypto.createPublicKey(input.key) }).then(result => {
  console.log(JSON.stringify(result)); process.exitCode = result.verdict === 'pass' ? 0 : 1;
});\n`,
  );
  return spawnSync(process.execPath, [driver, input], {
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 65536,
  });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-windows-candidate-'));
  options = {
    manifest: path.join(root, 'manifest.json'),
    signature: path.join(root, 'manifest.json.sig'),
    asset: 'AEGIS-Setup.exe',
    tag: 'aegis-v1.2.3-beta',
    repository: 'example/aegis-fixture',
    artifact: path.join(root, 'renamed.exe'),
    artifactSha256: hash(payload()),
    signerSha256: signer,
    authenticodeOutput: path.join(root, 'auth.json'),
    output: path.join(root, 'combined.json'),
  };
  fs.writeFileSync(options.artifact, payload());
  manifest = {
    schema: 'aegis-release-manifest/v1',
    algorithm: 'sha256',
    tag: options.tag,
    repository: options.repository,
    files: [{ filename: options.asset, sha256: options.artifactSha256, bytes: 128 }],
  };
  save();
  observed = {
    schemaVersion: 1,
    code: 'OBSERVED',
    artifactSha256: options.artifactSha256,
    bytes: 128,
    status: 'Valid',
    signatureType: 'Authenticode',
    signerCertificateSha256: signer,
    timestampPresent: true,
  };
  model();
});

afterEach(() => {
  auth._resetForTest();
  vi.restoreAllMocks();
  if (
    root &&
    path.dirname(root) === os.tmpdir() &&
    path.basename(root).startsWith('aegis-windows-candidate-')
  )
    fs.rmSync(root, { recursive: true, force: true });
});

describe('combined Windows candidate verification', () => {
  it('binds exact signed bytes/identity/pins to a fresh closed component receipt', async () => {
    const result = await run();
    expect(result).toMatchObject({
      verdict: 'pass',
      code: 'CANDIDATE_VERIFIED',
      launchAllowed: false,
      tag: options.tag,
      repository: options.repository,
      asset: options.asset,
      artifactSha256: options.artifactSha256,
      bytes: 128,
      signerCertificateSha256: signer,
      manifestSha256: hash(fs.readFileSync(options.manifest)),
      authenticodeReceiptSha256: hash(fs.readFileSync(options.authenticodeOutput)),
    });
    expect(read(options.output)).toEqual(result);
    expect(read(options.authenticodeOutput)).toMatchObject({
      verdict: 'pass',
      childCleanup: 'closed',
    });
    expect(spawn).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain(root);
  });

  it.each(['tag', 'repository'])('refuses a different expected %s', async (field) => {
    options[field] = field === 'tag' ? 'aegis-v9.9.9-beta' : 'other/repository';
    await early('RELEASE_IDENTITY');
  });

  it.each(['exact', 'case'])('refuses %s duplicate manifest filenames', async (mode) => {
    manifest.files.push({
      ...manifest.files[0],
      filename: mode === 'case' ? options.asset.toLowerCase() : options.asset,
    });
    save();
    await early('AMBIGUOUS_ASSET');
  });

  it('requires the exact selected signed asset name', async () => {
    options.asset = options.asset.toLowerCase();
    await early('ASSET_MISSING');
  });

  it('refuses an independent artifact pin that differs from the signed asset', async () => {
    options.artifactSha256 = 'a'.repeat(64);
    await early('SIGNED_PIN_MISMATCH');
  });

  it('refuses different valid modeled signed EXE bytes mixed with this release', async () => {
    fs.writeFileSync(options.artifact, payload(1));
    options.artifactSha256 = hash(payload(1));
    observed.artifactSha256 = options.artifactSha256;
    await early('SIGNED_PIN_MISMATCH');
  });

  it('refuses a signed byte count that differs from the actual artifact', async () => {
    manifest.files[0].bytes = 129;
    save();
    await early('SIGNED_SIZE_MISMATCH');
  });

  it.each(['signature', 'wrong-key', 'schema'])(
    'fails %s before receipt reservation in an isolated child',
    (mode) => {
      // Signature verifier intentionally exits; no process.exit monkeypatch is used.
      if (mode.includes('signature'))
        fs.writeFileSync(options.signature, Buffer.alloc(64).toString('base64'));
      if (mode.includes('schema')) {
        manifest.schema = 'wrong';
        save();
      }
      const result = childFixture(
        mode.includes('wrong-key') ? generateKeyPairSync('ed25519').publicKey : publicKey,
      );
      expect(result.status).toBe(1);
      expect(result.error).toBeUndefined();
      expect(fs.existsSync(options.output)).toBe(false);
      expect(fs.existsSync(options.authenticodeOutput)).toBe(false);
    },
  );

  it('requires an Ed25519 key even through the private fixture seam', async () => {
    const wrong = createPublicKey(generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey);
    expect(await gate._verifyForTest(options, { publicKey: wrong })).toMatchObject({
      code: 'RELEASE_KEY_TYPE',
      verdict: 'refused',
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'NotSigned', signatureType: 'None', signerCertificateSha256: null },
    { signatureType: 'Catalog' },
    { status: 'NotTrusted' },
    { signerCertificateSha256: 'c'.repeat(64) },
    { artifactSha256: 'c'.repeat(64) },
    { bytes: 129 },
  ])('never combines an invalid/mismatched fresh observation %j', async (patch) => {
    Object.assign(observed, patch);
    expect(await run()).toMatchObject({ verdict: 'refused', code: 'AUTHENTICODE_REFUSED' });
    expect(read(options.output).verdict).toBe('refused');
    expect(read(options.authenticodeOutput).verdict).toBe('refused');
  });

  it('refuses changed artifact bytes during observation', async () => {
    model((proc) => {
      fs.writeFileSync(options.artifact, payload(1));
      proc.stdout.write(JSON.stringify(observed));
      proc.emit('close', 0, null);
    });
    expect(await run()).toMatchObject({ verdict: 'refused', code: 'AUTHENTICODE_REFUSED' });
    expect(read(options.authenticodeOutput).code).toBe('ARTIFACT_CHANGED');
  });

  it('refuses timed out helpers with unknown close', async () => {
    model((proc) => proc.kill.mockImplementation(() => false));
    expect(await run()).toMatchObject({ verdict: 'refused', code: 'AUTHENTICODE_REFUSED' });
    expect(read(options.authenticodeOutput)).toMatchObject({
      code: 'HELPER_TIMEOUT',
      childCleanup: 'unconfirmed',
    });
  });

  it.each([
    'artifactSha256',
    'bytes',
    'expectedArtifactSha256',
    'signerCertificateSha256',
    'childCleanup',
  ])('independently cross-binds fresh component %s', async (field) => {
    const verify = auth.verify;
    vi.spyOn(auth, 'verify').mockImplementation(async (input) => {
      const value = await verify(input);
      value[field] =
        field === 'bytes' ? 129 : field === 'childCleanup' ? 'unconfirmed' : 'c'.repeat(64);
      fs.writeFileSync(input.output, JSON.stringify(value) + '\n');
      return value;
    });
    expect(await run()).toMatchObject({ verdict: 'refused', code: 'AUTHENTICODE_BINDING' });
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('requires exact receipt bytes from the fresh component result', async () => {
    const verify = auth.verify;
    vi.spyOn(auth, 'verify').mockImplementation(async (input) => {
      const value = await verify(input);
      fs.appendFileSync(input.output, '\n');
      return value;
    });
    expect(await run()).toMatchObject({ verdict: 'refused', code: 'AUTHENTICODE_RECEIPT' });
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('rebinds actual artifact bytes after the component returns', async () => {
    const verify = auth.verify;
    vi.spyOn(auth, 'verify').mockImplementation(async (input) => {
      const value = await verify(input);
      fs.writeFileSync(input.artifact, payload(1));
      return value;
    });
    expect(await run()).toMatchObject({ verdict: 'refused', code: 'ARTIFACT_CHANGED' });
  });

  it.each(['component-flush', 'component-close', 'combined-flush', 'combined-close'])(
    'fails closed on %s even with pass-looking JSON',
    async (mode) => {
      const open = fs.openSync,
        close = fs.closeSync,
        sync = fs.fsyncSync;
      let target;
      vi.spyOn(fs, 'openSync').mockImplementation((file, ...args) => {
        const fd = open(file, ...args);
        if (
          file === (mode.startsWith('component') ? options.authenticodeOutput : options.output) &&
          args[0] === 'wx'
        )
          target = fd;
        return fd;
      });
      if (mode.endsWith('flush'))
        vi.spyOn(fs, 'fsyncSync').mockImplementation((fd) => {
          if (fd === target) throw Error('fixture flush');
          return sync(fd);
        });
      else
        vi.spyOn(fs, 'closeSync').mockImplementation((fd) => {
          close(fd);
          if (fd === target) throw Error('fixture close');
        });
      const result = await run();
      expect(result.verdict).toBe('refused');
      expect(result.code).toBe(
        mode.startsWith('component') ? 'AUTHENTICODE_REFUSED' : 'OUTPUT_WRITE_FAILED',
      );
      expect(
        read(mode.startsWith('component') ? options.authenticodeOutput : options.output).verdict,
      ).toBe('pass');
    },
  );

  it.each(['output', 'authenticodeOutput'])(
    'preserves existing %s and refuses imported authority',
    async (field) => {
      fs.writeFileSync(options[field], 'pre-existing receipt');
      expect(await run()).toMatchObject({ verdict: 'refused', code: 'OUTPUT_UNAVAILABLE' });
      expect(fs.readFileSync(options[field], 'utf8')).toBe('pre-existing receipt');
      expect(spawn).not.toHaveBeenCalled();
    },
  );

  it.each(['artifact', 'manifest', 'signature', 'authenticodeOutput'])(
    'refuses combined-output collision with %s',
    async (field) => {
      options.output = options[field];
      expect(await run()).toMatchObject({ verdict: 'refused', code: 'OUTPUT_COLLISION' });
      expect(spawn).not.toHaveBeenCalled();
    },
  );

  it.each([
    'relative.json',
    'X:\\owned\\..\\receipt.json',
    'X:\\owned\\receipt.json:stream',
    'X:\\owned\\NUL.json',
  ])('refuses unsafe output %s', async (value) => {
    options.output = value;
    expect(await run()).toMatchObject({ verdict: 'refused', code: 'INVALID_PATH' });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('refuses reparse output parents', async () => {
    const dest = path.join(root, 'real');
    const link = path.join(root, 'link');
    fs.mkdirSync(dest);
    fs.symlinkSync(dest, link, process.platform === 'win32' ? 'junction' : 'dir');
    options.output = path.join(link, 'out.json');
    await early('UNSAFE_PATH');
  });

  it('refuses hardlinked input files', async () => {
    fs.linkSync(options.artifact, path.join(root, 'alias.exe'));
    await early('UNSAFE_PATH');
  });

  it('keeps production trust fixed and the CLI flag set closed', () => {
    const args = [
      '--manifest',
      options.manifest,
      '--signature',
      options.signature,
      '--asset',
      options.asset,
      '--tag',
      options.tag,
      '--repository',
      options.repository,
      '--artifact',
      options.artifact,
      '--artifact-sha256',
      options.artifactSha256,
      '--signer-sha256',
      signer,
      '--authenticode-output',
      options.authenticodeOutput,
      '--output',
      options.output,
    ];
    expect(gate.parse(args)).toEqual(options);
    for (const extra of [
      ['--pubkey', options.manifest],
      ['--receipt', options.output],
      ['--output', options.output],
    ])
      expect(gate.parse([...args, ...extra])).toBeNull();
    const result = spawnSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 65536,
      env: {
        ...process.env,
        AEGIS_RELEASE_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }),
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SIGNATURE CHECK FAILED');
    expect(fs.existsSync(options.output)).toBe(false);
    const invalid = spawnSync(process.execPath, [CLI, '--pubkey', options.manifest], {
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(invalid.status).toBe(2);
    expect(JSON.parse(invalid.stdout).code).toBe('INVALID_ARGUMENTS');
    const help = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8', timeout: 10000 });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('launchAllowed remains false');
  });
});
