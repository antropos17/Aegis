import { describe, it, expect, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import verification from '../../src/main/update-verification.js';
import provider from '../../src/main/update-provider.js';

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const pem = publicKey.export({ type: 'spki', format: 'pem' });
const tag = 'aegis-v0.15.0-alpha';
const data = Buffer.from('synthetic installer');
const digest = crypto.createHash('sha256').update(data).digest('hex');
const fixture = (overrides = {}) => ({
  schema: 'aegis-release-manifest/v1',
  repository: 'antropos17/Aegis',
  tag,
  commit: 'a'.repeat(40),
  algorithm: 'sha256',
  files: [
    {
      filename: 'AEGIS - AI Monitoring & Threat Detection Setup 0.15.0-alpha.exe',
      sha256: digest,
      bytes: data.length,
    },
  ],
  ...overrides,
});
const signed = (manifest) => {
  const bytes = Buffer.from(JSON.stringify(manifest));
  return { bytes, signature: crypto.sign(null, bytes, privateKey) };
};
let temp;
afterEach(() => {
  if (temp) fs.rmSync(temp, { recursive: true, force: true });
  temp = null;
});

describe('signed update boundary', () => {
  it.each(['0.18.0-beta', '0.18.0-beta.1'])('authenticates a beta installer for %s', (version) => {
    const betaTag = `aegis-v${version}`;
    const manifest = fixture({
      tag: betaTag,
      files: [
        {
          ...fixture().files[0],
          filename: `AEGIS - AI Monitoring & Threat Detection Setup ${version}.exe`,
        },
      ],
    });
    const { bytes, signature } = signed(manifest);
    expect(verification.verifyManifest(bytes, signature, pem, betaTag)).toMatchObject({
      version,
      sha256: digest,
    });
    expect(() => verification.verifyManifest(bytes, signature, pem, tag)).toThrow('manifest');
  });
  it.each([
    'aegis-v0.18.0-rc.1',
    'aegis-v0.18.0-beta/../setup',
    'aegis-v0.18.0-beta.01',
    'aegis-v0.18.0-beta+private',
  ])('rejects unsupported or malformed channels: %s', (value) => {
    expect(verification.releaseVersion(value)).toBeNull();
  });
  it('accepts the signed installer and rejects changed manifest bytes', () => {
    const { bytes, signature } = signed(fixture());
    expect(verification.verifyManifest(bytes, signature, pem, tag)).toMatchObject({
      version: '0.15.0-alpha',
      sha256: digest,
      bytes: data.length,
    });
    expect(() =>
      verification.verifyManifest(Buffer.concat([bytes, Buffer.from(' ')]), signature, pem, tag),
    ).toThrow();
  });
  it('rejects a signature from another key', () => {
    const { bytes, signature } = signed(fixture());
    const other = crypto
      .generateKeyPairSync('ed25519')
      .publicKey.export({ type: 'spki', format: 'pem' });
    expect(() => verification.verifyManifest(bytes, signature, other, tag)).toThrow();
  });
  it.each([
    { repository: 'attacker/Aegis' },
    { tag: 'aegis-v0.99.0-alpha' },
    { algorithm: 'sha1' },
    { commit: '../bad' },
    { files: [] },
    { files: [...fixture().files, ...fixture().files] },
    { files: [{ ...fixture().files[0], filename: '../setup.exe' }] },
    { files: [{ ...fixture().files[0], bytes: 1024 ** 3 }] },
  ])('rejects even correctly signed invalid metadata: %j', (overrides) => {
    const { bytes, signature } = signed(fixture(overrides));
    expect(() => verification.verifyManifest(bytes, signature, pem, tag)).toThrow();
  });
  it('checks installer size and hash from the actual file', async () => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-update-'));
    const file = path.join(temp, 'setup.exe');
    fs.writeFileSync(file, data);
    await expect(
      verification.verifyInstaller(file, { sha256: digest, bytes: data.length }),
    ).resolves.toBeUndefined();
    fs.writeFileSync(file, Buffer.alloc(data.length, 1));
    await expect(
      verification.verifyInstaller(file, { sha256: digest, bytes: data.length }),
    ).rejects.toThrow('hash');
    await expect(verification.verifyInstaller(file, { sha256: digest, bytes: 1 })).rejects.toThrow(
      'size',
    );
  });
  it('rejects non-file installer targets', async () => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-update-link-'));
    const directory = path.join(temp, 'directory');
    fs.mkdirSync(directory);
    await expect(
      verification.verifyInstaller(directory, { sha256: digest, bytes: 0 }),
    ).rejects.toThrow('size');
  });
});

const release = (version = '0.15.0-alpha') => ({
  tag_name: `aegis-v${version}`,
  draft: false,
  body: '<script>untrusted notes</script>',
  assets: [
    { name: 'manifest.json', state: 'uploaded' },
    { name: 'manifest.json.sig', state: 'uploaded' },
    {
      name: 'AEGIS.Setup.exe',
      state: 'uploaded',
      size: data.length,
      browser_download_url: 'https://attacker.invalid/setup.exe',
    },
  ],
});
describe('signed release provider', () => {
  it('allows alpha to advance to beta and keeps beta installations out of later alpha releases', () => {
    const releases = [release('0.18.0-beta.1'), release('0.19.0-alpha'), release('0.17.0')];
    expect(provider.selectRelease(releases, '0.17.0-alpha').tag_name).toBe('aegis-v0.19.0-alpha');
    expect(provider.selectRelease([release('0.18.0-beta.1')], '0.17.0-alpha').tag_name).toBe(
      'aegis-v0.18.0-beta.1',
    );
    expect(provider.selectRelease(releases, '0.18.0-beta').tag_name).toBe('aegis-v0.18.0-beta.1');
    expect(provider.selectRelease([release('0.19.0-alpha')], '0.18.0-beta.1')).toBeNull();
    expect(provider.selectRelease([release('0.18.0')], '0.18.0-beta.1').tag_name).toBe(
      'aegis-v0.18.0',
    );
    expect(provider.selectRelease(releases, '0.17.0')).toBeNull();
  });
  it('uses the newest complete allowed version, never downgrades or crosses stable into alpha', () => {
    const releases = [
      release('0.14.0-alpha'),
      release('0.15.0-alpha'),
      release('0.16.0-alpha'),
      { ...release('0.17.0-alpha'), assets: [] },
    ];
    expect(provider.selectRelease(releases, '0.14.1-alpha').tag_name).toBe('aegis-v0.16.0-alpha');
    expect(provider.selectRelease(releases, '0.20.0-alpha')).toBeNull();
    expect(provider.selectRelease(releases, '0.14.1')).toBeNull();
    expect(provider.selectRelease([release('0.16.0')], '0.15.0-alpha').tag_name).toBe(
      'aegis-v0.16.0',
    );
  });
  it('authenticates the manifest and constructs a fixed-repository URL despite a supplied external URL', async () => {
    const { bytes, signature } = signed(fixture());
    const calls = [];
    const fetcher = async (url, options) => {
      calls.push({ url, options });
      return new Response(
        url.includes('api.github')
          ? JSON.stringify([release()])
          : url.endsWith('.sig')
            ? signature.toString('base64')
            : bytes,
      );
    };
    const info = await provider.loadRelease({ current: '0.14.1-alpha', fetcher, publicKey: pem });
    expect(info.files[0]).toMatchObject({
      url: `https://github.com/antropos17/Aegis/releases/download/${tag}/AEGIS.Setup.exe`,
      sha2: digest,
    });
    expect(info.releaseNotes).toBe('<script>untrusted notes</script>');
    expect(calls.every((c) => c.options.credentials === 'omit')).toBe(true);
    expect(calls[0].options.headers.Accept).toBe('application/vnd.github+json');
    expect(
      calls.slice(1).every((c) => c.options.headers.Accept === 'application/octet-stream'),
    ).toBe(true);
  });
  it('loads a signed beta through the fixed repository and skips incomplete or draft beta releases', async () => {
    const version = '0.18.0-beta.1';
    const betaTag = `aegis-v${version}`;
    const { bytes, signature } = signed(
      fixture({
        tag: betaTag,
        files: [
          {
            ...fixture().files[0],
            filename: `AEGIS - AI Monitoring & Threat Detection Setup ${version}.exe`,
          },
        ],
      }),
    );
    const releases = [
      release(version),
      { ...release('0.18.0-beta.2'), assets: [] },
      { ...release('0.18.0-beta.3'), draft: true },
      release('0.19.0-alpha'),
    ];
    const calls = [];
    const fetcher = async (url) => {
      calls.push(url);
      return new Response(
        url.includes('api.github')
          ? JSON.stringify(releases)
          : url.endsWith('.sig')
            ? signature.toString('base64')
            : bytes,
      );
    };
    const info = await provider.loadRelease({ current: '0.18.0-beta', fetcher, publicKey: pem });
    expect(info).toMatchObject({ version, files: [{ sha2: digest }] });
    expect(calls.slice(1)).toEqual([
      `https://github.com/antropos17/Aegis/releases/download/${betaTag}/manifest.json`,
      `https://github.com/antropos17/Aegis/releases/download/${betaTag}/manifest.json.sig`,
    ]);
    const forged = async (url) =>
      new Response(
        url.includes('api.github')
          ? JSON.stringify(releases)
          : url.endsWith('.sig')
            ? Buffer.alloc(64).toString('base64')
            : bytes,
      );
    await expect(
      provider.loadRelease({ current: '0.18.0-beta', fetcher: forged, publicKey: pem }),
    ).rejects.toThrow('signature');
  });
  it('refuses a release with a forged manifest signature', async () => {
    const { bytes } = signed(fixture());
    const fetcher = async (url) =>
      new Response(
        url.includes('api.github')
          ? JSON.stringify([release()])
          : url.endsWith('.sig')
            ? Buffer.alloc(64).toString('base64')
            : bytes,
      );
    await expect(
      provider.loadRelease({ current: '0.14.1-alpha', fetcher, publicKey: pem }),
    ).rejects.toThrow('signature');
  });
  it('bounds metadata responses and refuses HTTP errors', async () => {
    await expect(
      provider.fetchBytes('https://example.invalid', 4, async () => new Response('12345')),
    ).rejects.toThrow('too-large');
    await expect(
      provider.fetchBytes(
        'https://example.invalid',
        4,
        async () => new Response('', { status: 403 }),
      ),
    ).rejects.toThrow('fetch-failed');
  });
});
