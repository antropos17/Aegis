import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { inventoryProject } = require('../../src/main/agent-inventory');
let root;
const manifest = Buffer.from('{"name":"fixture","version":"1.2.3"}');
function put(name, content) {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}
function rawObject(data, algorithm = 'sha1', git = '.git') {
  const oid = createHash(algorithm).update(data).digest('hex');
  const file = put(`${git}/objects/${oid.slice(0, 2)}/${oid.slice(2)}`, deflateSync(data));
  return { oid, file, data };
}
function object(type, data, algorithm = 'sha1', git = '.git') {
  data = Buffer.from(data);
  return rawObject(Buffer.concat([Buffer.from(`${type} ${data.length}\0`), data]), algorithm, git);
}
function repo({
  algorithm = 'sha1',
  directory = '',
  file = 'package.json',
  treePayload,
  blobType = 'blob',
  mode = '100644',
} = {}) {
  const git = directory ? `${directory}/.git` : '.git';
  const blob = object(blobType, manifest, algorithm, git);
  let tree = object(
    'tree',
    treePayload ||
      Buffer.concat([
        Buffer.from(`${mode} ${path.posix.basename(file)}\0`),
        Buffer.from(blob.oid, 'hex'),
      ]),
    algorithm,
    git,
  );
  const parents = file.split('/').slice(0, -1).reverse();
  for (const name of parents)
    tree = object(
      'tree',
      Buffer.concat([Buffer.from(`40000 ${name}\0`), Buffer.from(tree.oid, 'hex')]),
      algorithm,
      git,
    );
  const commit = object(
    'commit',
    `tree ${tree.oid}\nauthor Fixture <fixture@example.invalid> 0 +0000\ncommitter Fixture <fixture@example.invalid> 0 +0000\n\nfixture\n`,
    algorithm,
    git,
  );
  put(`${git}/HEAD`, 'ref: refs/heads/main\n');
  put(`${git}/refs/heads/main`, `${commit.oid}\n`);
  put(directory ? `${directory}/${file}` : file, manifest);
  return { blob, tree, commit, git };
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-git-evidence-'));
});
afterEach(() => {
  vi.restoreAllMocks();
  const link = path.join(root, '.git');
  if (fs.existsSync(link) && fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
  fs.rmSync(root, { recursive: true, force: true });
});

describe('local Git object evidence without Git execution', () => {
  it.each(['sha1', 'sha256'])(
    'verifies actual manifest blobs with %s object IDs',
    async (algorithm) => {
      const fixture = repo({ algorithm });
      const result = await inventoryProject(root);
      expect(result.complete).toBe(true);
      expect(result.packages[0].git).toEqual({
        repository: '',
        commit: fixture.commit.oid,
        algorithm,
        scope: 'manifest-only',
        publisher: 'not-verified',
        signature: 'not-verified',
        status: 'matches-local-commit',
      });
      expect(result.usage.gitInflatedBytes).toBe(
        fixture.blob.data.length + fixture.tree.data.length + fixture.commit.data.length,
      );
    },
  );

  it('also reads objects written by Git itself, with a packed symbolic ref', async () => {
    const args = (parameters) => {
      const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...parameters], {
        cwd: root,
        encoding: 'utf8',
        timeout: 10000,
        env: {
          ...process.env,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
        },
      });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim();
    };
    args(['init', '--template=', '--initial-branch=main']);
    put('package.json', manifest);
    args(['-c', 'core.autocrlf=false', 'add', 'package.json']);
    args([
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'fixture',
    ]);
    args(['pack-refs', '--all']);
    const expected = args(['rev-parse', 'HEAD']);
    const result = await inventoryProject(root);
    expect(result.packages[0].git).toMatchObject({
      commit: expected,
      status: 'matches-local-commit',
    });
  });

  it('detects a changed manifest while preserving the original local commit identity', async () => {
    const fixture = repo();
    put('package.json', '{"name":"fixture","version":"9.0.0"}');
    const result = await inventoryProject(root);
    expect(result.packages[0].git).toMatchObject({
      commit: fixture.commit.oid,
      status: 'differs-from-local-commit',
    });
  });

  it('walks nested trees and excludes arbitrary .git contents from skill fingerprints', async () => {
    const directory = '.agents/skills/demo';
    repo({ directory, file: 'nested/package.json' });
    put(`${directory}/.git/config`, 'CANARY credential and filter');
    put(`${directory}/.git/hooks/post-checkout`, 'CANARY command');
    const open = vi.spyOn(fs.promises, 'open');
    const result = await inventoryProject(root);
    expect(result.packages[0].git).toMatchObject({
      repository: directory,
      status: 'matches-local-commit',
    });
    expect(result.components.map((entry) => entry.path)).toEqual([
      `${directory}/nested/package.json`,
    ]);
    expect(open.mock.calls.every(([name]) => !/[/\\](?:config|post-checkout)$/.test(name))).toBe(
      true,
    );
    expect(JSON.stringify(result)).not.toContain('CANARY');
  });

  it.each(['blob', 'tree', 'commit'])(
    'does not accept a missing %s object as proof',
    async (type) => {
      const fixture = repo();
      fs.unlinkSync(fixture[type].file);
      const result = await inventoryProject(root);
      expect(result.complete).toBe(false);
      expect(result.packages[0].git.status).toBe('object-unavailable');
    },
  );

  it.each(['blob', 'tree', 'commit'])(
    'rejects substituted %s bytes under a valid object filename',
    async (type) => {
      const fixture = repo();
      fs.writeFileSync(fixture[type].file, deflateSync(Buffer.from('blob 6\0CANARY')));
      const result = await inventoryProject(root);
      expect(result.packages[0].git.status).toBe('invalid-object');
      expect(JSON.stringify(result)).not.toContain('CANARY');
    },
  );

  it('rejects trailing bytes in a compressed object', async () => {
    const fixture = repo();
    fs.appendFileSync(fixture.blob.file, 'CANARY');
    expect((await inventoryProject(root)).packages[0].git.status).toBe('invalid-object');
  });

  it('does not accept a non-blob object at the manifest path', async () => {
    repo({ blobType: 'tag' });
    expect((await inventoryProject(root)).packages[0].git.status).toBe('invalid-tree');
  });

  it.each(['120000', '160000'])('does not interpret mode %s as a manifest file', async (mode) => {
    repo({ mode });
    expect((await inventoryProject(root)).packages[0].git.status).toBe('not-regular-in-commit');
  });

  it.each([Buffer.from('100644 package.json\0short'), Buffer.from('bad tree')])(
    'rejects malformed tree payloads',
    async (treePayload) => {
      repo({ treePayload });
      expect((await inventoryProject(root)).packages[0].git.status).toBe('invalid-tree');
    },
  );

  it('rejects a malformed commit with no complete tree line', async () => {
    const fixture = repo();
    const commit = object('commit', `tree ${fixture.tree.oid}`);
    put('.git/HEAD', commit.oid);
    expect((await inventoryProject(root)).packages[0].git.status).toBe('invalid-commit');
  });

  it('rejects high-bit bytes that ASCII decoding would disguise as valid headers', async () => {
    const fixture = repo();
    const bytes = Buffer.from(fixture.commit.data);
    bytes[0] |= 0x80;
    const commit = rawObject(bytes);
    put('.git/HEAD', commit.oid);
    expect((await inventoryProject(root)).packages[0].git.status).toBe('invalid-object');
  });

  it('bounds expansion of compressed objects and keeps partial evidence explicit', async () => {
    const fixture = repo();
    fs.writeFileSync(fixture.commit.file, deflateSync(Buffer.alloc(8192, 0x41)));
    const result = await inventoryProject(root, { limits: { fileBytes: 256, totalBytes: 1024 } });
    expect(result.complete).toBe(false);
    expect(result.packages[0].git.status).toBe('invalid-or-oversized-object');
    expect(result.usage.gitInflatedBytes).toBeLessThanOrEqual(1024);
    expect(result.usage.bytes).toBeLessThanOrEqual(1024);
  });

  it('does not follow a .git indirection or report its outside target', async () => {
    put('package.json', manifest);
    put('.git', 'gitdir: ../CANARY_OUTSIDE');
    const open = vi.spyOn(fs.promises, 'open');
    const result = await inventoryProject(root);
    expect(result.packages[0].git.status).toBe('unavailable');
    expect(open.mock.calls).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('CANARY');
  });

  it('rejects reference traversal before opening an attacker-selected path', async () => {
    repo();
    put('.git/HEAD', 'ref: refs/heads/../../CANARY_OUTSIDE\n');
    const open = vi.spyOn(fs.promises, 'open');
    const result = await inventoryProject(root);
    expect(result.packages[0].git.status).toBe('invalid-head');
    expect(open.mock.calls.every(([name]) => !name.includes('CANARY'))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('CANARY');
  });

  it('shares a hard expansion budget across several compressed bombs', async () => {
    for (let i = 0; i < 5; i++) {
      const fixture = repo({ directory: `.agents/skills/s${i}` });
      fs.writeFileSync(fixture.commit.file, deflateSync(Buffer.alloc(8192, 0x41)));
    }
    const result = await inventoryProject(root, { limits: { fileBytes: 256, totalBytes: 1024 } });
    expect(result.packages).toHaveLength(5);
    expect(result.usage.gitInflatedBytes).toBe(1024);
    expect(result.usage.bytes).toBeLessThanOrEqual(1024);
    expect(result.packages.at(-1).git.status).toBe('expanded-bytes-limit');
  });

  it('skips a linked Git directory without opening its objects', async () => {
    repo({ directory: 'outside' });
    put('package.json', manifest);
    fs.symlinkSync(
      path.join(root, 'outside/.git'),
      path.join(root, '.git'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const open = vi.spyOn(fs.promises, 'open');
    const result = await inventoryProject(root);
    expect(result.packages[0].git.status).toBe('unavailable');
    expect(result.issues).toContainEqual({ path: '.git/HEAD', reason: 'link-skipped' });
    expect(open.mock.calls).toHaveLength(1);
  });

  it('does not accept a malformed packed ref with extra fields', async () => {
    const fixture = repo();
    fs.unlinkSync(path.join(root, '.git/refs/heads/main'));
    put('.git/packed-refs', `${fixture.commit.oid} CANARY refs/heads/main\n`);
    const result = await inventoryProject(root);
    expect(result.packages[0].git.status).toBe('invalid-head');
    expect(JSON.stringify(result)).not.toContain('CANARY');
  });

  it('does not interpret a matching manifest as verification of bundled scripts', async () => {
    const directory = '.agents/skills/demo';
    repo({ directory });
    put(`${directory}/run.js`, 'first');
    const first = await inventoryProject(root);
    put(`${directory}/run.js`, 'changed');
    const next = await inventoryProject(root);
    expect(next.packages[0].git).toMatchObject({
      scope: 'manifest-only',
      status: 'matches-local-commit',
    });
    expect(first.components.find((entry) => entry.path.endsWith('run.js')).sha256).not.toBe(
      next.components.find((entry) => entry.path.endsWith('run.js')).sha256,
    );
  });
});
