import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createArtifactFixture, signedArtifact, expected } from './helper-artifact-fixture.mjs';
import { publishFixtureArtifact } from './helper-artifact-publication.mjs';
const require = createRequire(import.meta.url);
const {
  createHelperArtifactAuthority,
  LIMITS,
} = require('../../src/main/helper-artifact-admission');
const { readHelperArtifactFiles } = require('../../src/main/helper-artifact-reader');
const modes = [
  'valid',
  'unknown-key',
  'signature-substitution',
  'same-version-changed',
  'rollback-version',
  'helper-mismatch',
  'version-mismatch',
  'protocol-mismatch',
  'platform-mismatch',
  'architecture-mismatch',
  'missing',
  'truncated',
  'stale',
  'source-snapshot',
  'interrupted',
  'failed-rollback',
  'quota',
  'hostile-path',
  'linked-source',
];
async function runCase(mode) {
  const f = await createArtifactFixture();
  let authority, linked;
  let publication = 'none',
    refused = false,
    positive = false,
    failure;
  try {
    let input = { ...f.input },
      selected = { ...expected },
      baseline = f.baseline;
    if (mode === 'unknown-key') {
      const attacker = generateKeyPairSync('ed25519');
      input = signedArtifact(attacker);
    }
    if (mode === 'signature-substitution')
      input.signature = sign(null, Buffer.from('different exact manifest'), f.key.privateKey);
    if (mode === 'same-version-changed') baseline = { ...f.baseline, version: expected.version };
    if (mode === 'rollback-version') baseline = { ...f.baseline, version: '3.0.0' };
    const mismatch = {
      'helper-mismatch': { helper: 'different-helper' },
      'version-mismatch': { version: '3.0.0' },
      'protocol-mismatch': { protocol: 2 },
      'platform-mismatch': { platform: 'linux' },
      'architecture-mismatch': { architecture: 'arm64' },
    };
    if (Object.hasOwn(mismatch, mode)) input = signedArtifact(f.key, mismatch[mode]);
    authority = createHelperArtifactAuthority({
      expected: selected,
      trustedKeys: new Map([['owner', f.key.publicKey]]),
      baseline,
    });
    if (mode === 'missing') await fs.unlink(path.join(f.source, 'helper.bin'));
    if (mode === 'truncated') await fs.writeFile(path.join(f.source, 'helper.bin'), 'small');
    if (mode === 'linked-source') {
      await fs.unlink(path.join(f.source, 'helper.bin'));
      linked = path.join(f.source, 'helper.bin');
      await fs.symlink(f.destination, linked, 'junction');
    }
    if (['missing', 'truncated', 'hostile-path', 'linked-source'].includes(mode))
      input = await readHelperArtifactFiles(
        {
          root: f.source,
          keyId: 'owner',
          ...(mode === 'hostile-path' ? { artifact: '../retained.bin' } : {}),
        },
        () => {
          if (authority.status().closed) throw Error('owner-closed');
        },
      );
    if (mode === 'valid' || mode === 'source-snapshot')
      input = await readHelperArtifactFiles({ root: f.source, keyId: 'owner' }, () => {});
    if (mode === 'quota') {
      for (let i = 0; i < LIMITS.tickets; i++) authority.admit(input);
      authority.admit(input);
    }
    const ticket = authority.admit(input);
    if (mode === 'stale') authority.revoke();
    if (mode === 'source-snapshot') {
      input.artifact.fill(0);
      await fs.writeFile(path.join(f.source, 'helper.bin'), 'substituted after captured snapshot');
    }
    const captured = authority.consume(ticket, ticket.revision);
    if (mode === 'failed-rollback') {
      await fs.writeFile(path.join(f.destination, 'upgrade.bundle'), 'RETAINED-PRIOR-PUBLICATION', {
        flag: 'wx',
      });
    }
    try {
      await publishFixtureArtifact(f.destination, captured, mode === 'interrupted');
      publication = 'published';
    } catch (error) {
      failure = error;
    }
    const final = path.join(f.destination, 'upgrade.bundle');
    if (
      failure &&
      mode !== 'failed-rollback' &&
      (await fs.readdir(f.destination)).includes('upgrade.bundle')
    )
      publication = 'outcome-unknown';
    if (mode === 'interrupted')
      positive = !!failure && !(await fs.readdir(f.destination)).includes('upgrade.bundle');
    else if (mode === 'failed-rollback')
      positive = !!failure && (await fs.readFile(final, 'utf8')) === 'RETAINED-PRIOR-PUBLICATION';
    else {
      const bundle = JSON.parse(await fs.readFile(final, 'utf8'));
      positive =
        !failure &&
        bundle.launchAllowed === false &&
        Buffer.from(bundle.artifactBase64, 'base64').equals(f.input.artifact) &&
        Buffer.from(bundle.manifestBase64, 'base64').equals(f.input.manifest) &&
        Buffer.from(bundle.signatureBase64, 'base64').equals(f.input.signature);
    }
  } catch (error) {
    refused = [
      'helper-artifact-refused',
      'helper-artifact-stale',
      'helper-artifact-quota',
      'helper-artifact-unavailable',
    ].includes(error.message);
  } finally {
    authority?.close();
    if (linked) await fs.unlink(linked);
  }
  try {
    const retained = await f.preserved(),
      stageClean = !(await fs.readdir(f.destination)).some((name) => name.startsWith('.stage-'));
    const rejection = !['valid', 'source-snapshot', 'interrupted', 'failed-rollback'].includes(
      mode,
    );
    return {
      mode,
      passed: retained && stageClean && (rejection ? refused && publication === 'none' : positive),
      retainedSentinels: retained,
      stageClean,
      publication,
      admission: refused ? 'refused' : 'offline-accepted',
      launchAllowed: false,
    };
  } finally {
    await f.cleanup();
  }
}
/** Execute finite offline dummy signatures/admission/publication/retention; artifact bytes never run.
 * @returns {Promise<object>} Path-free fixture metadata. @since v0.17.0 */
export async function qualifyHelperArtifacts() {
  const cases = [];
  for (const mode of modes) cases.push(await runCase(mode));
  return {
    schemaVersion: 1,
    passed: cases.every((row) => row.passed),
    scope: 'offline-helper-compatibility-fixture',
    signatureMaterial: 'generated-disposable-test-key',
    cases,
    launchAllowed: false,
    notRun: [
      'real-release-artifacts',
      'protected-key-custody',
      'installer-execution',
      'VM-provisioning',
      'reboot',
      'uninstall-survivors',
      'native-boundary-identity',
      'power-loss',
      'A4',
    ],
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw Error('fixture-arguments');
    const value = await qualifyHelperArtifacts();
    process.stdout.write(JSON.stringify(value) + '\n');
    process.exitCode = value.passed ? 0 : 2;
  } catch {
    process.stdout.write(
      '{"passed":false,"error":"helper-fixture-unavailable","launchAllowed":false}\n',
    );
    process.exitCode = 2;
  }
}
