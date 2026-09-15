import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { inventoryProject, inventoryProfile } = require('../../src/main/agent-inventory');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const declared = { name: '@example/skill', version: '1.2.3' };
let root;

function put(name, value) {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    typeof value === 'object' && !Buffer.isBuffer(value) ? JSON.stringify(value) : value,
  );
  return target;
}
function lock(entry = declared, extra = {}) {
  return { ...declared, lockfileVersion: 3, packages: { '': entry }, ...extra };
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-package-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('bounded local package evidence', () => {
  it.each([2, 3])(
    'links contained files to a v%s lock without asserting installation or publisher trust',
    async (version) => {
      put('package.json', declared);
      put('package-lock.json', lock(declared, { lockfileVersion: version }));
      put('AGENTS.md', 'instructions');
      const result = await inventoryProject(root);
      expect(result.complete).toBe(true);
      expect(result.packages).toHaveLength(1);
      expect(result.packages[0]).toMatchObject({
        manifest: 'package.json',
        declaration: 'self-declared',
        identity: {
          nameSha256: hash(declared.name),
          version: { core: '1.2.3', prerelease: false, buildMetadata: false },
        },
        lockfile: { status: 'consistent-local-metadata' },
        git: { status: 'not-observed' },
        publisher: 'not-verified',
        installation: 'not-established',
      });
      expect(result.components[0]).toMatchObject({
        path: 'AGENTS.md',
        provenance: {
          packageIdentity: 'contained-in-local-package',
          packageRef: 'package.json',
          agentVersion: null,
        },
      });
    },
  );

  it('redacts metadata values and never executes package scripts through the real CLI', () => {
    const secret = 'CANARY-PRIVATE-235';
    const marker = path.join(root, 'executed');
    put(
      'record-execution.cjs',
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed')`,
    );
    const value = {
      name: secret,
      version: `1.2.3-${secret}+${secret}`,
      scripts: { preinstall: 'node ./record-execution.cjs' },
    };
    put('package.json', value);
    put(
      'package-lock.json',
      lock(
        { ...value, resolved: `https://u:${secret}@example.invalid/a.tgz`, integrity: secret },
        value,
      ),
    );
    const cli = spawnSync(
      process.execPath,
      [path.resolve(import.meta.dirname, '../../src/main/main.js'), '--inventory-json', root],
      { encoding: 'utf8', timeout: 10000 },
    );
    expect(cli.status).toBe(0);
    expect(cli.stderr).toBe('');
    expect(cli.stdout).not.toContain(secret);
    const evidence = JSON.parse(cli.stdout).packages[0];
    expect(evidence.identity.version).toEqual({
      core: '1.2.3',
      prerelease: true,
      buildMetadata: true,
      sha256: hash(value.version),
    });
    expect(evidence.lockfile.source).toEqual({
      type: 'http-artifact',
      integrityDeclared: true,
      artifactIntegrity: 'not-verified',
      publisher: 'not-verified',
    });
    expect(fs.existsSync(marker)).toBe(false);
  });

  it.each(['1.2.4', '1.2.3+different', '1.2.3-prerelease'])(
    'detects exact version disagreement with %s',
    async (version) => {
      put('package.json', declared);
      put('package-lock.json', lock({ ...declared, version }));
      const result = await inventoryProject(root);
      expect(result.packages[0].lockfile.status).toBe('mismatch');
      expect(result.issues).toContainEqual({
        path: 'package-lock.json',
        reason: 'package-lock-mismatch',
      });
      expect(result.complete).toBe(false);
    },
  );

  it.each([{ name: 'different' }, { version: '2.0.0' }])(
    'checks top-level lock metadata too: %j',
    async (extra) => {
      put('package.json', declared);
      put('package-lock.json', lock(declared, extra));
      expect((await inventoryProject(root)).packages[0].lockfile.status).toBe('mismatch');
    },
  );

  it('honors shrinkwrap precedence even when it is malformed', async () => {
    put('package.json', declared);
    put('npm-shrinkwrap.json', '{"name":"one","name":"CANARY_TWO"}');
    put('package-lock.json', lock());
    const result = await inventoryProject(root);
    expect(result.packages[0].lockfile).toMatchObject({
      path: 'npm-shrinkwrap.json',
      status: 'invalid',
    });
    expect(result.issues).toContainEqual({ path: 'npm-shrinkwrap.json', reason: 'duplicate-key' });
    expect(JSON.stringify(result)).not.toContain('CANARY_TWO');
  });

  it.each([
    [lock(declared, { lockfileVersion: 1 }), 'unsupported-lock-version'],
    [lock(declared, { packages: [] }), 'invalid'],
    [lock(declared, { packages: {} }), 'not-listed'],
    [lock({ link: true, resolved: '../CANARY' }), 'link-not-followed'],
    [lock({ name: declared.name }), 'identity-incomplete'],
  ])('preserves incomplete or unsupported lock evidence', async (metadata, status) => {
    put('package.json', declared);
    put('package-lock.json', metadata);
    const result = await inventoryProject(root);
    expect(result.packages[0].lockfile.status).toBe(status);
    expect(JSON.stringify(result)).not.toContain('CANARY');
  });

  it.each([{ name: declared.name }, { version: '1.2.3' }, { ...declared, version: 'latest' }])(
    'does not invent a package identity from %j',
    async (value) => {
      put('package.json', value);
      put('package-lock.json', lock());
      const evidence = (await inventoryProject(root)).packages[0];
      expect(evidence.declaration).toBe('identity-incomplete');
      expect(evidence.lockfile.status).toBe('identity-incomplete');
    },
  );

  it('does not turn invalid UTF-8 into parsed package evidence', async () => {
    put('package.json', Buffer.from([0x7b, 0xff, 0x7d]));
    const result = await inventoryProject(root);
    expect(result.packages[0].declaration).toBe('invalid');
    expect(result.issues).toContainEqual({ path: 'package.json', reason: 'invalid-encoding' });
  });

  it('uses the nearest observed manifest and lock entry, including npm aliases', async () => {
    const base = '.agents/skills/demo';
    put('package.json', { name: 'container', version: '5.0.0' });
    put(`${base}/package.json`, declared);
    put(`${base}/SKILL.md`, 'skill');
    put('package-lock.json', lock(declared, { packages: { [base]: declared } }));
    const result = await inventoryProject(root);
    const child = result.packages.find((entry) => entry.manifest.startsWith(base));
    expect(child.lockfile.status).toBe('consistent-local-metadata');
    expect(
      result.components.find((entry) => entry.path.endsWith('SKILL.md')).provenance.packageRef,
    ).toBe(`${base}/package.json`);
  });

  it.each(['node_modules/@example/skill', 'node_modules/alias', 'notnode_modules/@example/skill'])(
    'only infers npm names from exact node_modules segments: %s',
    async (location) => {
      const base = `skills/demo/${location}`;
      put(`${base}/package.json`, declared);
      const entry = location.endsWith('alias') ? declared : { version: declared.version };
      put('skills/demo/package-lock.json', lock(declared, { packages: { [location]: entry } }));
      const result = await inventoryProfile('codex-user', root);
      expect(result.packages[0].lockfile.status).toBe(
        location.startsWith('notnode_modules')
          ? 'identity-incomplete'
          : 'consistent-local-metadata',
      );
    },
  );

  it('does not read a home manifest or bind user configs to a skill package', async () => {
    put('package.json', declared);
    put('package-lock.json', lock());
    put('config.toml', '[mcp_servers]');
    put('skills/demo/package.json', declared);
    const result = await inventoryProfile('codex-user', root);
    expect(result.packages.map((entry) => entry.manifest)).toEqual(['skills/demo/package.json']);
    expect(result.packages[0].lockfile.status).toBe('not-observed');
    expect(
      result.components.find((entry) => entry.path === 'config.toml').provenance.packageIdentity,
    ).toBe('not-resolved');
  });

  it('does not bind files to an ancestor when their own manifest exceeded the package budget', async () => {
    put('package.json', declared);
    for (let i = 0; i < 65; i++) {
      const base = `.agents/skills/s${String(i).padStart(3, '0')}`;
      put(`${base}/package.json`, declared);
      put(`${base}/SKILL.md`, 'skill');
    }
    const result = await inventoryProject(root);
    expect(result.packages).toHaveLength(64);
    expect(result.issues.some((issue) => issue.reason === 'package-limit')).toBe(true);
    const processed = new Set(result.packages.map((entry) => entry.manifest));
    const skipped = result.components.filter(
      (entry) =>
        entry.path.endsWith('SKILL.md') &&
        !processed.has(entry.path.replace('SKILL.md', 'package.json')),
    );
    expect(skipped).toHaveLength(2);
    expect(skipped.every((entry) => entry.provenance.packageIdentity === 'not-resolved')).toBe(
      true,
    );
  });
});
