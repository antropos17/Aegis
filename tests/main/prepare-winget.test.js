import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SUBJECT =
  process.env.AEGIS_WINGET_TEST_SUBJECT || path.join(ROOT, 'scripts/prepare-winget.cjs');
const { _prepareCandidateForTest: prepare } = require(SUBJECT);
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const payload = Buffer.from('synthetic NSIS fixture, never executed');
const digest = createHash('sha256').update(payload).digest('hex');
let root;
let options;
let manifest;

function saveManifest() {
  const bytes = Buffer.from(JSON.stringify(manifest));
  fs.writeFileSync(path.join(options.dir, 'manifest.json'), bytes);
  fs.writeFileSync(
    path.join(options.dir, 'manifest.json.sig'),
    sign(null, bytes, privateKey).toString('base64'),
  );
}

function run() {
  return prepare(options, publicKey);
}

function cli(args) {
  return spawnSync(process.execPath, [SUBJECT, ...args], {
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 65536,
  });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-winget-'));
  options = {
    dir: path.join(root, 'release'),
    out: path.join(root, 'candidate'),
    id: 'Example.AegisFixture',
    version: '1.2.3-beta',
    tag: 'aegis-v1.2.3-beta',
    asset: 'AEGIS Setup 1.2.3-beta.exe',
    'installer-url':
      'https://github.com/example/aegis-fixture/releases/download/aegis-v1.2.3-beta/AEGIS%20Setup%201.2.3-beta.exe',
    arch: 'x64',
    locale: 'en-US',
    publisher: 'Fixture Publisher',
    'package-name': 'AEGIS Fixture',
    license: 'MIT',
    description: 'Offline test fixture only.',
  };
  fs.mkdirSync(options.dir);
  fs.writeFileSync(path.join(options.dir, options.asset), payload);
  manifest = {
    schema: 'aegis-release-manifest/v1',
    algorithm: 'sha256',
    tag: options.tag,
    repository: 'example/aegis-fixture',
    files: [{ filename: options.asset, bytes: payload.length, sha256: digest }],
  };
  saveManifest();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // The standalone release verifier deliberately exits on authentication failure.
  vi.spyOn(process, 'exit').mockImplementation(() => {
    throw Error('verifier rejected');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  // A uniquely created disposable root; rm does not follow fixture junctions.
  if (
    root &&
    path.basename(root).startsWith('aegis-winget-') &&
    path.dirname(root) === os.tmpdir()
  ) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('offline WinGet candidate preparation', () => {
  it('writes deterministic three-file YAML bound to the signed installer', () => {
    const result = run();
    expect(result.files).toEqual([
      'Example.AegisFixture.yaml',
      'Example.AegisFixture.locale.en-US.yaml',
      'Example.AegisFixture.installer.yaml',
    ]);
    expect(result.installerSha256).toBe(digest);
    expect(result.manifestSha256).toBe(
      createHash('sha256')
        .update(fs.readFileSync(path.join(options.dir, 'manifest.json')))
        .digest('hex'),
    );
    const installer = fs.readFileSync(path.join(options.out, result.files[2]), 'utf8');
    expect(installer).toBe(
      '# Candidate manifests: local release signature/hash verified; qualification pending.\n' +
        'PackageIdentifier: "Example.AegisFixture"\nPackageVersion: "1.2.3-beta"\nInstallerType: "nullsoft"\nInstallers:\n' +
        '  - Architecture: "x64"\n' +
        `    InstallerUrl: ${JSON.stringify(options['installer-url'])}\n` +
        `    InstallerSha256: "${digest.toUpperCase()}"\nManifestType: "installer"\nManifestVersion: "1.12.0"\n`,
    );
    const original = result.files.map((name) =>
      fs.readFileSync(path.join(options.out, name), 'utf8'),
    );
    options.out = path.join(root, 'second');
    run();
    expect(
      result.files.map((name) => fs.readFileSync(path.join(options.out, name), 'utf8')),
    ).toEqual(original);
    expect(original[0]).toContain('DefaultLocale: "en-US"\nManifestType: "version"');
    expect(original[1]).toContain('Publisher: "Fixture Publisher"\nPackageName: "AEGIS Fixture"');
    expect(original[1]).toContain(
      'License: "MIT"\nShortDescription: "Offline test fixture only."\nManifestType: "defaultLocale"',
    );
    expect(installer).not.toMatch(/Scope|ProductCode|AppsAndFeaturesEntries|SignatureSha256/);
  });

  it('rejects a changed signed manifest before producing output', () => {
    fs.appendFileSync(path.join(options.dir, 'manifest.json'), ' ');
    expect(run).toThrow('verifier rejected');
    // eslint-disable-next-line no-console -- Assert the existing verifier's CLI diagnostic.
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('SIGNATURE CHECK FAILED'));
    expect(fs.existsSync(options.out)).toBe(false);
  });

  it('rejects same-size altered installer bytes', () => {
    const altered = Buffer.from(payload);
    altered[0] ^= 1;
    fs.writeFileSync(path.join(options.dir, options.asset), altered);
    expect(run).toThrow('selected installer bytes differ');
    expect(fs.existsSync(options.out)).toBe(false);
  });

  it('requires exact signed selection and rejects duplicate names or digest aliases', () => {
    options.asset = 'Other Setup 1.2.3-beta.exe';
    expect(run).toThrow('exactly one signed installer');
    options.asset = manifest.files[0].filename;
    manifest.files.push({ ...manifest.files[0] });
    saveManifest();
    expect(run).toThrow('ambiguous signed asset names');
    manifest.files[1].filename = 'Other Setup 1.2.3-beta.exe';
    saveManifest();
    expect(run).toThrow('ambiguous signed installer digest');
    expect(fs.existsSync(options.out)).toBe(false);
  });

  it('accepts an explicitly renamed download by content without guessing its filename', () => {
    options.file = 'AEGIS.Setup.1.2.3-beta.exe';
    fs.renameSync(path.join(options.dir, options.asset), path.join(options.dir, options.file));
    options['installer-url'] = options['installer-url'].replace('AEGIS%20Setup%20', 'AEGIS.Setup.');
    expect(run().installerSha256).toBe(digest);
  });

  it.each([
    ['version', '1.2.4', 'tag must equal'],
    ['tag', 'v1.2.3-beta', 'tag must equal'],
    ['asset', 'AEGIS Setup 1.2.30-beta.exe', 'exact --version'],
    [
      'installer-url',
      'https://github.com/example/aegis-fixture/releases/download/aegis-v1.2.3-beta/wrong.exe',
      'must match',
    ],
    [
      'installer-url',
      'https://github.com/other/aegis-fixture/releases/download/aegis-v1.2.3-beta/AEGIS%20Setup%201.2.3-beta.exe',
      'must match',
    ],
    [
      'installer-url',
      'https://github.com/example/aegis-fixture/releases/download/aegis-v1.2.4/AEGIS%20Setup%201.2.3-beta.exe',
      'must match',
    ],
    [
      'installer-url',
      'https://github.com/example/aegis-fixture/releases/download/aegis-v1.2.3-beta/AEGIS%20Setup%201.2.3-beta.exe?download=1',
      'must match',
    ],
    [
      'installer-url',
      'https://user@github.com/example/aegis-fixture/releases/download/aegis-v1.2.3-beta/AEGIS%20Setup%201.2.3-beta.exe',
      'must match',
    ],
  ])('rejects inconsistent %s: %s', (key, value, reason) => {
    options[key] = value;
    expect(run).toThrow(reason);
    expect(fs.existsSync(options.out)).toBe(false);
  });

  it('rejects a caller tag differing from the signed tag', () => {
    manifest.tag = 'aegis-v9.9.9';
    saveManifest();
    expect(run).toThrow('signed release tag');
  });

  it('rejects encoded path separators rather than treating them as URL route boundaries', () => {
    options['installer-url'] = options['installer-url'].replace(
      'example/aegis-fixture',
      'example%2Faegis-fixture',
    );
    expect(run).toThrow('must match');
    expect(fs.existsSync(options.out)).toBe(false);
  });

  it.each([
    ['publisher', undefined],
    ['publisher', 'x'],
    ['id', '../../bad'],
    ['arch', 'guess'],
    ['locale', '../en'],
    ['description', 'a\nManifestType: singleton'],
    ['publisher', 'text\u0000hidden'],
    ['publisher', 'text\u2028hidden'],
    ['publisher', 'text\u202ehidden'],
    ['license', 'A'.repeat(513)],
    ['scope', 'machine'],
  ])('rejects missing/unsafe/unknown metadata %s', (key, value) => {
    options[key] = value;
    expect(run).toThrow();
    expect(fs.existsSync(options.out)).toBe(false);
  });

  it('quotes YAML-sensitive text without creating additional fields', () => {
    options.publisher = 'Example: "Quoted" # &anchor {publisher}';
    run();
    const locale = fs.readFileSync(
      path.join(options.out, 'Example.AegisFixture.locale.en-US.yaml'),
      'utf8',
    );
    expect(locale).toContain(`Publisher: ${JSON.stringify(options.publisher)}\n`);
    expect(locale.split('\n').filter((line) => line.startsWith('Publisher:'))).toHaveLength(1);
  });

  it('never overwrites an existing output directory', () => {
    fs.mkdirSync(options.out);
    fs.writeFileSync(path.join(options.out, 'keep.txt'), 'keep');
    expect(run).toThrow('already exists');
    expect(fs.readdirSync(options.out)).toEqual(['keep.txt']);
    expect(fs.readFileSync(path.join(options.out, 'keep.txt'), 'utf8')).toBe('keep');
  });

  it('cleans only owned files on a partial write failure and preserves an unknown entry', () => {
    const write = fs.writeFileSync;
    let writes = 0;
    vi.spyOn(fs, 'writeFileSync').mockImplementation((...args) => {
      if (typeof args[0] === 'number' && ++writes === 2) {
        write(path.join(options.out, 'unknown.txt'), 'preserve');
        throw Error('injected write failure');
      }
      return write(...args);
    });
    expect(run).toThrow('injected write failure');
    expect(fs.readdirSync(options.out)).toEqual(['unknown.txt']);
    expect(fs.readFileSync(path.join(options.out, 'unknown.txt'), 'utf8')).toBe('preserve');
  });

  it('removes an empty owned output after a partial write failure', () => {
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw Error('injected write failure');
    });
    expect(run).toThrow('injected write failure');
    expect(fs.existsSync(options.out)).toBe(false);
  });

  it('rejects output ancestor junctions', () => {
    const linked = path.join(root, 'linked');
    fs.symlinkSync(options.dir, linked, 'junction');
    options.out = path.join(linked, 'candidate');
    expect(run).toThrow('symlinks and reparse');
    expect(fs.existsSync(path.join(options.dir, 'candidate'))).toBe(false);
  });

  it('rejects an input directory junction before reading a signed release', () => {
    const linked = path.join(root, 'linked-input');
    fs.symlinkSync(options.dir, linked, 'junction');
    options.dir = linked;
    expect(run).toThrow('symlinks and reparse');
    expect(fs.existsSync(options.out)).toBe(false);
  });

  it('rejects a bounded signed manifest containing too many assets', () => {
    manifest.files = Array.from({ length: 257 }, (_, i) => ({
      ...manifest.files[0],
      filename: `fixture-${i}.exe`,
    }));
    saveManifest();
    expect(run).toThrow('exceeds 256 assets');
    expect(fs.existsSync(options.out)).toBe(false);
  });

  it('does not replace a file injected before an exclusive output-file open', () => {
    const open = fs.openSync;
    const injected = new Set();
    vi.spyOn(fs, 'openSync').mockImplementation((file, flags, ...rest) => {
      if (['wx', 'w'].includes(flags) && file.endsWith('.installer.yaml') && !injected.has(file)) {
        injected.add(file);
        fs.writeFileSync(file, 'foreign');
      }
      return open(file, flags, ...rest);
    });
    expect(run).toThrow();
    expect(fs.readdirSync(options.out)).toEqual(['Example.AegisFixture.installer.yaml']);
    expect(
      fs.readFileSync(path.join(options.out, 'Example.AegisFixture.installer.yaml'), 'utf8'),
    ).toBe('foreign');
  });

  it('preserves a replacement directory and its files after a close failure', () => {
    const close = fs.closeSync;
    let replaced = false;
    vi.spyOn(fs, 'closeSync').mockImplementation((fd) => {
      close(fd);
      if (!replaced && fs.existsSync(options.out)) {
        replaced = true;
        fs.renameSync(options.out, path.join(root, 'moved-owned-output'));
        fs.mkdirSync(options.out);
        fs.writeFileSync(path.join(options.out, 'unknown.txt'), 'foreign');
        throw Error('injected directory replacement');
      }
    });
    expect(run).toThrow('injected directory replacement');
    expect(fs.readdirSync(options.out)).toEqual(['unknown.txt']);
    expect(fs.readFileSync(path.join(options.out, 'unknown.txt'), 'utf8')).toBe('foreign');
  });

  it('CLI provides help and rejects unknown, duplicate and missing flags', () => {
    const help = cli(['--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('candidate manifests');
    expect(help.stdout).toContain('--installer-url');
    expect(cli(['--pubkey', 'untrusted.pub']).stderr).toContain('unknown argument');
    expect(cli(['--id', 'Example.A', '--id', 'Example.B']).stderr).toContain('duplicate --id');
    expect(cli(['--id']).stderr).toContain('needs a value');
    expect(cli([]).status).toBe(1);
  });

  it('CLI pinned trust rejects an otherwise valid self-signed synthetic release', () => {
    const args = Object.entries(options).flatMap(([key, value]) => [`--${key}`, value]);
    const result = cli(args);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SIGNATURE CHECK FAILED');
    expect(fs.existsSync(options.out)).toBe(false);
  });
});
