import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { generateKeyPairSync, createHash, sign } from 'node:crypto';
const require = createRequire(import.meta.url);
const {
  createHelperArtifactAuthority,
  LIMITS,
} = require('../../src/main/helper-artifact-admission');
const expected = {
  helper: 'dummy-helper',
  version: '1.0.0',
  protocol: 1,
  platform: 'win32',
  architecture: 'x64',
};
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function fixture(extra = {}) {
  const owner = generateKeyPairSync('ed25519'),
    artifact = Buffer.from('inert dummy artifact');
  const manifest = Buffer.from(
    JSON.stringify({
      schema: 'aegis-helper-artifact/v1',
      keyId: 'owner',
      ...expected,
      bytes: artifact.length,
      sha256: sha(artifact),
      ...extra,
    }),
  );
  return {
    owner,
    artifact,
    manifest,
    signature: sign(null, manifest, owner.privateKey),
    keyId: 'owner',
  };
}
const input = (f) => ({
  keyId: f.keyId,
  manifest: f.manifest,
  signature: f.signature,
  artifact: f.artifact,
});
const authority = (f, extra = {}) =>
  createHelperArtifactAuthority({
    expected,
    trustedKeys: new Map([['owner', f.owner.publicKey]]),
    ...extra,
  });
it('rejects an attacker key signing a self-consistent dummy artifact manifest', () => {
  const f = fixture(),
    attacker = generateKeyPairSync('ed25519');
  f.keyId = 'attacker';
  f.manifest = Buffer.from(f.manifest.toString().replace('owner', 'attacker'));
  f.signature = sign(null, f.manifest, attacker.privateKey);
  expect(() => authority(f).admit(input(f))).toThrow('helper-artifact-refused');
});
it('authenticates exact bytes and returns an opaque one-attempt offline snapshot, never launch authority', () => {
  const f = fixture(),
    owner = authority(f),
    ticket = owner.admit(input(f));
  expect(ticket.launchAllowed).toBe(false);
  expect(Object.isFrozen(ticket)).toBe(true);
  const result = owner.consume(ticket, owner.status().revision);
  expect(result.artifact.equals(f.artifact)).toBe(true);
  result.artifact.fill(0);
  expect(() => owner.consume(ticket, 1)).toThrow('helper-artifact-stale');
  expect(owner.status()).toMatchObject({ tickets: 0, bytesRetained: 0 });
});
it('owns copied imported bytes and owner key/tuple selection across mutation', () => {
  const f = fixture(),
    selected = { ...expected },
    keys = new Map([['owner', f.owner.publicKey]]),
    owner = createHelperArtifactAuthority({ expected: selected, trustedKeys: keys });
  const ticket = owner.admit(input(f));
  selected.version = '9.0.0';
  keys.clear();
  f.artifact.fill(0);
  f.manifest.fill(0);
  f.signature.fill(0);
  expect(owner.consume(ticket, 1).artifact.toString()).toBe('inert dummy artifact');
});
it.each(['helper', 'version', 'protocol', 'platform', 'architecture'])(
  'rejects signed %s compatibility drift',
  (key) => {
    const bad = {
      helper: 'other-helper',
      version: '2.0.0',
      protocol: 2,
      platform: 'linux',
      architecture: 'arm64',
    };
    const f = fixture({ [key]: bad[key] });
    expect(() => authority(f).admit(input(f))).toThrow('helper-artifact-refused');
  },
);
it('rejects legitimate-key signature substitution, altered signed bytes, truncated and wrong-length artifacts', () => {
  const f = fixture(),
    other = fixture({ bytes: 1 });
  for (const patch of [
    { signature: other.signature },
    { manifest: Buffer.concat([f.manifest, Buffer.from(' ')]) },
    { artifact: f.artifact.subarray(0, 3) },
    { signature: f.signature.subarray(0, 63) },
    { artifact: Buffer.alloc(0) },
  ])
    expect(() => authority(f).admit({ ...input(f), ...patch })).toThrow('helper-artifact-refused');
});
it('rejects correctly signed same-version binary replacement against a retained baseline and downgrades', () => {
  const f = fixture(),
    baseline = { version: '1.0.0', bytes: f.artifact.length, sha256: sha(f.artifact) };
  expect(authority(f, { baseline }).admit(input(f)).version).toBe('1.0.0');
  f.artifact = Buffer.from('same version other bytes');
  f.manifest = Buffer.from(
    JSON.stringify({
      schema: 'aegis-helper-artifact/v1',
      keyId: 'owner',
      ...expected,
      bytes: f.artifact.length,
      sha256: sha(f.artifact),
    }),
  );
  f.signature = sign(null, f.manifest, f.owner.privateKey);
  expect(() => authority(f, { baseline }).admit(input(f))).toThrow('helper-artifact-refused');
  expect(() =>
    authority(f, { baseline: { ...baseline, version: '2.0.0' } }).admit(input(f)),
  ).toThrow('helper-artifact-refused');
});
it.each([require('../../package.json').version, '0.19.2-beta.2'])(
  'admits the exact signed beta helper %s and preserves one-attempt byte retention',
  (version) => {
    const f = fixture({ version });
    const owner = authority(f, { expected: { ...expected, version } });
    const ticket = owner.admit(input(f));
    expect(ticket).toMatchObject({ version, launchAllowed: false });
    expect(owner.consume(ticket, 1).artifact.equals(f.artifact)).toBe(true);
    expect(() => owner.consume(ticket, 1)).toThrow('helper-artifact-stale');
  },
);
it.each([
  ['0.19.2-beta', '0.19.2-alpha'],
  ['0.19.2-beta.10', '0.19.2-beta.2'],
  ['0.19.2', '0.19.2-beta'],
])('admits the owner-selected signed upgrade %s over %s', (version, prior) => {
  const f = fixture({ version });
  const owner = authority(f, {
    expected: { ...expected, version },
    baseline: { version: prior, bytes: f.artifact.length, sha256: sha(f.artifact) },
  });
  expect(owner.admit(input(f))).toMatchObject({ version, launchAllowed: false });
});
it.each([
  ['0.19.2-alpha', '0.19.2-beta'],
  ['0.19.2-beta', '0.19.2-beta.1'],
  ['0.19.2-beta.2', '0.19.2-beta.10'],
  ['0.19.2-beta', '0.19.2'],
])('refuses a signed downgrade from %s relative to retained %s', (version, prior) => {
  const f = fixture({ version });
  const owner = authority(f, {
    expected: { ...expected, version },
    baseline: { version: prior, bytes: f.artifact.length, sha256: sha(f.artifact) },
  });
  expect(() => owner.admit(input(f))).toThrow('helper-artifact-refused');
  expect(owner.status()).toMatchObject({ tickets: 0, bytesRetained: 0 });
});
it('preserves exact beta version and binary identity against signed substitution', () => {
  const version = '0.19.2-beta';
  const f = fixture({ version });
  const baseline = { version, bytes: f.artifact.length, sha256: sha(f.artifact) };
  expect(
    authority(f, { expected: { ...expected, version }, baseline }).admit(input(f)).version,
  ).toBe(version);
  const changed = fixture({ version });
  changed.artifact = Buffer.from('other signed beta bytes');
  changed.manifest = Buffer.from(
    JSON.stringify({
      ...JSON.parse(changed.manifest),
      bytes: changed.artifact.length,
      sha256: sha(changed.artifact),
    }),
  );
  changed.signature = sign(null, changed.manifest, changed.owner.privateKey);
  expect(() =>
    authority(changed, { expected: { ...expected, version }, baseline }).admit(input(changed)),
  ).toThrow('helper-artifact-refused');
  const differentVersion = fixture({ version: '0.19.2-beta.1' });
  expect(() =>
    authority(differentVersion, { expected: { ...expected, version } }).admit(
      input(differentVersion),
    ),
  ).toThrow('helper-artifact-refused');
});
it.each([
  'v0.19.2-beta',
  '0.19.2-beta.01',
  '0.19.2-beta+build',
  '0.19.2-BETA',
  '0.19.2-rc',
  '0.19.2-beta\n',
])('refuses a noncanonical or unsupported helper version %j', (version) => {
  const f = fixture();
  expect(() => authority(f, { expected: { ...expected, version } })).toThrow(
    'helper-owner-invalid',
  );
  expect(() =>
    authority(f, { baseline: { version, bytes: f.artifact.length, sha256: sha(f.artifact) } }),
  ).toThrow('helper-owner-invalid');
});
it('strictly parses signed UTF-8 with duplicate decoded keys, unknown schema/extra fields and malformed JSON', () => {
  const f = fixture();
  for (const raw of [
    Buffer.from([255]),
    Buffer.from('{"schema":"aegis-helper-artifact/v1","schema":"aegis-helper-artifact/v1"}'),
    Buffer.from(f.manifest.toString().replace('"bytes":', '"bytes":1,"bytes":')),
    fixture({ extra: true }).manifest,
    fixture({ schema: 'aegis-helper-artifact/v2' }).manifest,
  ])
    expect(() =>
      authority(f).admit({
        ...input(f),
        manifest: raw,
        signature: sign(null, raw, f.owner.privateKey),
      }),
    ).toThrow('helper-artifact-refused');
});
it('allows a signed UTF-8 BOM without normalizing signed bytes', () => {
  const f = fixture();
  f.manifest = Buffer.concat([Buffer.from([239, 187, 191]), f.manifest]);
  f.signature = sign(null, f.manifest, f.owner.privateKey);
  expect(authority(f).admit(input(f)).version).toBe('1.0.0');
});
it('rejects serialized/cross-owner acceptances, revocation, expiry and wrong revision without replay', () => {
  const f = fixture();
  let stamp = 1000;
  const owner = authority(f, { now: () => stamp }),
    ticket = owner.admit(input(f));
  expect(() => owner.consume(JSON.parse(JSON.stringify(ticket)), 1)).toThrow(
    'helper-artifact-stale',
  );
  expect(() => authority(f).consume(ticket, 1)).toThrow('helper-artifact-stale');
  expect(() => owner.consume(ticket, 2)).toThrow('helper-artifact-stale');
  expect(() => owner.consume(ticket, 1)).toThrow('helper-artifact-stale');
  const expired = owner.admit(input(f));
  stamp += LIMITS.lifetimeMs;
  expect(() => owner.consume(expired, 1)).toThrow('helper-artifact-stale');
  const revoked = owner.admit(input(f));
  owner.revoke();
  expect(() => owner.consume(revoked, 2)).toThrow('helper-artifact-stale');
  owner.close();
  expect(() => owner.admit(input(f))).toThrow('helper-artifact-stale');
});
it('bounds input, retained ticket quota and retained bytes, and releases capacity on close', () => {
  const f = fixture(),
    owner = authority(f);
  expect(() =>
    owner.admit({ ...input(f), manifest: Buffer.alloc(LIMITS.manifestBytes + 1) }),
  ).toThrow('helper-artifact-refused');
  expect(() =>
    owner.admit({ ...input(f), artifact: Buffer.alloc(LIMITS.artifactBytes + 1) }),
  ).toThrow('helper-artifact-refused');
  for (let i = 0; i < LIMITS.tickets; i++) owner.admit(input(f));
  expect(() => owner.admit(input(f))).toThrow('helper-artifact-quota');
  owner.close();
  expect(owner.status().bytesRetained).toBe(0);
});

it('enforces aggregate retained byte quota independently of the ticket-count limit', () => {
  const f = fixture();
  f.artifact = Buffer.alloc(LIMITS.artifactBytes, 65);
  f.manifest = Buffer.from(
    JSON.stringify({
      schema: 'aegis-helper-artifact/v1',
      keyId: 'owner',
      ...expected,
      bytes: f.artifact.length,
      sha256: sha(f.artifact),
    }),
  );
  f.signature = sign(null, f.manifest, f.owner.privateKey);
  const owner = authority(f);
  owner.admit(input(f));
  owner.admit(input(f));
  expect(owner.status()).toMatchObject({ tickets: 2, bytesRetained: LIMITS.retainedBytes });
  expect(() => owner.admit(input(f))).toThrow('helper-artifact-quota');
  owner.close();
});
