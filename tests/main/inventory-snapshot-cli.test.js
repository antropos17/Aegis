import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { handleSnapshotCLI } = require('../../src/main/inventory-snapshot-cli');
const {
  resolveSnapshotSubject,
  readSnapshotJson,
  writeSnapshotFile,
} = require('../../src/main/inventory-snapshot-files');
let fixture;
let root;
let store;
function put(name, value) {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof value === 'object' ? JSON.stringify(value) : value);
  return target;
}
async function run(...args) {
  let output;
  const code = await handleSnapshotCLI(args, (text) => {
    output = JSON.parse(text);
  });
  return { code, ...output };
}
const saved = (name = 'observed.json') => path.join(store, name);
async function initial() {
  const result = await run('--inventory-snapshot-json', 'project', root, saved());
  expect(result.code).toBe(0);
  return result;
}
async function trust() {
  const result = await initial();
  const accepted = await run(
    '--inventory-accept-json',
    saved(),
    result.digest,
    root,
    saved('accepted.json'),
  );
  expect(accepted.code).toBe(0);
  return accepted;
}
beforeEach(() => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-snapshot-'));
  root = path.join(fixture, 'project space Юникод');
  store = path.join(fixture, 'snapshots');
  fs.mkdirSync(root);
  fs.mkdirSync(store);
  put('.agents/skills/demo/SKILL.md', 'skill');
  put('.agents/skills/demo/run.js', 'original');
});
afterEach(() => {
  vi.restoreAllMocks();
  const link = path.join(store, 'link');
  if (fs.existsSync(link) && fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
  expect(path.dirname(path.resolve(fixture))).toBe(path.resolve(os.tmpdir()));
  fs.rmSync(fixture, { recursive: true, force: true });
});

describe('snapshot CLI and immutable files', () => {
  it('works through main.js without Electron and stores only content metadata', () => {
    const marker = path.join(fixture, 'executed');
    const script = put(
      'marker.cjs',
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed')`,
    );
    put('.mcp.json', {
      mcpServers: {
        CANARY: { command: process.execPath, args: [script], env: { TOKEN: 'PRIVATE_CANARY' } },
      },
    });
    const result = spawnSync(
      process.execPath,
      [
        path.resolve(import.meta.dirname, '../../src/main/main.js'),
        '--inventory-snapshot-json',
        'project',
        root,
        saved(),
      ],
      { encoding: 'utf8', timeout: 10000 },
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      state: 'observed',
      reviewRequired: true,
      assessment: 'not-performed',
    });
    const contents = fs.readFileSync(saved(), 'utf8');
    expect(contents).not.toContain('CANARY');
    expect(contents).not.toContain(root);
    const digest = JSON.parse(result.stdout).digest;
    for (const args of [
      ['--inventory-accept-json', saved(), digest, root, saved('accepted.json')],
      ['--inventory-diff-json', saved('accepted.json'), 'project', root],
    ]) {
      const next = spawnSync(
        process.execPath,
        [path.resolve(import.meta.dirname, '../../src/main/main.js'), ...args],
        { encoding: 'utf8', timeout: 10000 },
      );
      expect(next.status).toBe(0);
      expect(next.stderr).toBe('');
      expect(JSON.parse(next.stdout).reviewRequired).toBe(false);
    }
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('requires review before acceptance, then detects modifications without replacing the baseline', async () => {
    const result = await initial();
    expect(await run('--inventory-diff-json', saved(), 'project', root)).toMatchObject({
      code: 2,
      status: 'review-required',
    });
    expect(
      await run('--inventory-accept-json', saved(), result.digest, root, saved('accepted.json')),
    ).toMatchObject({ code: 0, state: 'accepted' });
    const original = fs.readFileSync(saved('accepted.json'), 'utf8');
    expect(
      await run('--inventory-diff-json', saved('accepted.json'), 'project', root),
    ).toMatchObject({ code: 0, reviewRequired: false });
    put('.agents/skills/demo/run.js', 'changed');
    const diff = await run('--inventory-diff-json', saved('accepted.json'), 'project', root);
    expect(diff).toMatchObject({ code: 2, status: 'review-required', reviewRequired: true });
    expect(diff.changes.components.changed).toEqual([
      { path: '.agents/skills/demo/run.js', fields: expect.arrayContaining(['content']) },
    ]);
    expect(fs.readFileSync(saved('accepted.json'), 'utf8')).toBe(original);
    expect(
      await run('--inventory-accept-json', saved(), result.digest, root, saved('stale.json')),
    ).toMatchObject({ code: 1, error: 'snapshot-changed-since-review' });
    expect(fs.existsSync(saved('stale.json'))).toBe(false);
  });

  it('requires a new capture and exact approval after an update', async () => {
    await trust();
    put('.agents/skills/demo/run.js', 'update');
    const next = await run('--inventory-snapshot-json', 'project', root, saved('next.json'));
    const accepted = await run(
      '--inventory-accept-json',
      saved('next.json'),
      next.digest,
      root,
      saved('next-accepted.json'),
    );
    expect(accepted.code).toBe(0);
    expect(
      await run('--inventory-diff-json', saved('next-accepted.json'), 'project', root),
    ).toMatchObject({ code: 0, status: 'accepted-content-unchanged' });
    expect(fs.existsSync(saved('accepted.json'))).toBe(true);
  });

  it('rejects an incorrect reviewed digest before creating an accepted file', async () => {
    await initial();
    expect(
      await run('--inventory-accept-json', saved(), '0'.repeat(64), root, saved('accepted.json')),
    ).toMatchObject({ code: 1, error: 'snapshot-digest-mismatch', reviewRequired: true });
    expect(fs.existsSync(saved('accepted.json'))).toBe(false);
  });

  it('refuses acceptance of a partial capture', async () => {
    put('.mcp.json', '{ CANARY_BROKEN');
    const result = await run('--inventory-snapshot-json', 'project', root, saved());
    expect(result).toMatchObject({ code: 2, complete: false, reviewRequired: true });
    expect(
      await run('--inventory-accept-json', saved(), result.digest, root, saved('accepted.json')),
    ).toMatchObject({ code: 1, error: 'snapshot-incomplete' });
    expect(fs.existsSync(saved('accepted.json'))).toBe(false);
  });

  it('treats missing data from an unreadable directory as incomplete rather than deleted', async () => {
    await trust();
    const original = fs.promises.opendir.bind(fs.promises);
    vi.spyOn(fs.promises, 'opendir').mockImplementation((name, ...args) =>
      name.endsWith('demo')
        ? Promise.reject(Object.assign(new Error('CANARY'), { code: 'EACCES' }))
        : original(name, ...args),
    );
    const diff = await run('--inventory-diff-json', saved('accepted.json'), 'project', root);
    expect(diff).toMatchObject({ code: 2, status: 'incomplete', reviewRequired: true });
    expect(diff.changes.components.removed).toEqual([]);
    expect(diff.changes.components.unobserved).toHaveLength(2);
    expect(JSON.stringify(diff)).not.toContain('CANARY');
  });

  it('rejects a baseline copied into the subject and output paths inside it', async () => {
    expect(
      await run('--inventory-snapshot-json', 'project', root, path.join(root, 'snapshot.json')),
    ).toMatchObject({ code: 1, error: 'snapshot-inside-subject' });
    expect(fs.existsSync(path.join(root, 'snapshot.json'))).toBe(false);
    await initial();
    const copied = put('copied.json', fs.readFileSync(saved(), 'utf8'));
    expect(await run('--inventory-diff-json', copied, 'project', root)).toMatchObject({
      code: 1,
      error: 'snapshot-inside-subject',
    });
  });

  it('resolves a junction parent before deciding whether storage is outside the subject', async () => {
    fs.symlinkSync(
      root,
      path.join(store, 'link'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    expect(
      await run(
        '--inventory-snapshot-json',
        'project',
        root,
        path.join(store, 'link/snapshot.json'),
      ),
    ).toMatchObject({ code: 1, error: 'snapshot-inside-subject' });
    expect(fs.existsSync(path.join(root, 'snapshot.json'))).toBe(false);
  });

  it('never overwrites existing files', async () => {
    fs.writeFileSync(saved(), 'EXISTING_CANARY');
    const result = await run('--inventory-snapshot-json', 'project', root, saved());
    expect(result).toMatchObject({ code: 1, error: 'snapshot-exists' });
    expect(fs.readFileSync(saved(), 'utf8')).toBe('EXISTING_CANARY');
    expect(JSON.stringify(result)).not.toContain('CANARY');
  });

  it('rejects alternate-stream output names before opening an output', async () => {
    await initial();
    const subject = await resolveSnapshotSubject(root);
    const snapshot = (await readSnapshotJson(saved(), subject)).value;
    const original = fs.readFileSync(saved(), 'utf8');
    const open = vi.spyOn(fs.promises, 'open');
    await expect(writeSnapshotFile(`${saved()}:stream`, snapshot, subject)).rejects.toThrow(
      'snapshot-unavailable',
    );
    expect(open).not.toHaveBeenCalled();
    expect(fs.readFileSync(saved(), 'utf8')).toBe(original);
    expect(fs.existsSync(`${saved()}:stream`)).toBe(false);
  });

  it('does not write or remove an output whose opened handle is not a regular file', async () => {
    await initial();
    const subject = await resolveSnapshotSubject(root);
    const snapshot = (await readSnapshotJson(saved(), subject)).value;
    const output = saved('nonregular.json');
    const original = fs.promises.open.bind(fs.promises);
    let write;
    vi.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
      const handle = await original(...args);
      const stat = await handle.stat();
      handle.stat = async () => ({ ...stat, isFile: () => false });
      write = vi.spyOn(handle, 'writeFile');
      return handle;
    });
    await expect(writeSnapshotFile(output, snapshot, subject)).rejects.toThrow(
      'snapshot-unavailable',
    );
    expect(write).not.toHaveBeenCalled();
    expect(fs.readFileSync(output, 'utf8')).toBe('');
  });

  it('removes only its own partial output on a failed sync', async () => {
    await initial();
    const subject = await resolveSnapshotSubject(root);
    const snapshot = (await readSnapshotJson(saved(), subject)).value;
    const original = fs.promises.open.bind(fs.promises);
    vi.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
      const handle = await original(...args);
      handle.sync = async () => {
        throw new Error('PRIVATE_CANARY');
      };
      return handle;
    });
    await expect(writeSnapshotFile(saved('partial.json'), snapshot, subject)).rejects.toThrow(
      'snapshot-unavailable',
    );
    expect(fs.existsSync(saved('partial.json'))).toBe(false);
    expect(fs.existsSync(saved())).toBe(true);
  });

  it('preserves another file that replaces a failed output before cleanup', async () => {
    await initial();
    const subject = await resolveSnapshotSubject(root);
    const snapshot = (await readSnapshotJson(saved(), subject)).value;
    const output = saved('replaced.json');
    const original = fs.promises.open.bind(fs.promises);
    vi.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
      const handle = await original(...args);
      handle.sync = async () => {
        fs.unlinkSync(output);
        fs.writeFileSync(output, 'REPLACEMENT_CANARY');
        throw new Error('PRIVATE_FAILURE');
      };
      return handle;
    });
    await expect(writeSnapshotFile(output, snapshot, subject)).rejects.toThrow(
      'snapshot-unavailable',
    );
    expect(fs.readFileSync(output, 'utf8')).toBe('REPLACEMENT_CANARY');
  });

  it.each(['{"format":"CANARY"}', '{"body":{},"body":{"private":"CANARY"}}', 'x'.repeat(1048577)])(
    'rejects invalid or oversized imported snapshots without echoing contents',
    async (contents) => {
      fs.writeFileSync(saved(), contents);
      const result = await run('--inventory-diff-json', saved(), 'project', root);
      expect(result.code).toBe(1);
      expect(result.reviewRequired).toBe(true);
      expect(JSON.stringify(result)).not.toContain('CANARY');
    },
  );

  it('binds an accepted baseline to one canonical project directory', async () => {
    await trust();
    const another = path.join(fixture, 'another');
    fs.mkdirSync(another);
    expect(
      await run('--inventory-diff-json', saved('accepted.json'), 'project', another),
    ).toMatchObject({ code: 2, status: 'incompatible' });
  });

  it('supports explicit profile snapshots', async () => {
    put('config.toml', '[mcp_servers]');
    const result = await run('--inventory-snapshot-json', 'codex-user', root, saved());
    expect(result.code).toBe(0);
    const snapshot = JSON.parse(fs.readFileSync(saved(), 'utf8'));
    expect(snapshot.body.subject.adapter).toBe('codex-user');
    expect(snapshot.body.components.map((entry) => entry.path)).toEqual(['config.toml']);
  });

  it('requires the same explicit offline catalog and detects description replacement', async () => {
    const toolsFile = put('tools-list.json', {
      tools: [{ name: 'demo', description: 'before CANARY', inputSchema: { type: 'object' } }],
    });
    const result = await run(
      '--inventory-snapshot-json',
      'project',
      root,
      saved(),
      '--tools-file',
      toolsFile,
    );
    expect(result.code).toBe(0);
    expect(
      await run(
        '--inventory-accept-json',
        saved(),
        result.digest,
        root,
        saved('accepted.json'),
        '--tools-file',
        toolsFile,
      ),
    ).toMatchObject({ code: 0 });
    expect(
      await run('--inventory-diff-json', saved('accepted.json'), 'project', root),
    ).toMatchObject({ code: 2, status: 'incompatible' });
    put('tools-list.json', {
      tools: [{ name: 'demo', description: 'after CANARY', inputSchema: { type: 'object' } }],
    });
    const diff = await run(
      '--inventory-diff-json',
      saved('accepted.json'),
      'project',
      root,
      '--tools-file',
      toolsFile,
    );
    expect(diff.code).toBe(2);
    expect(diff.changes.tools.changed).toHaveLength(1);
    expect(JSON.stringify(diff)).not.toContain('CANARY');
    expect(fs.readFileSync(saved(), 'utf8')).not.toContain('CANARY');
  });

  it.each([
    ['--inventory-snapshot-json'],
    ['--inventory-diff-json', 'file', 'project'],
    ['--inventory-accept-json', 'file', 'digest', 'root'],
    ['--inventory-snapshot-json', 'project', 'root', 'file', '--tools-file'],
    ['--inventory-snapshot-json', 'project', 'root', 'file', '--unknown', 'value'],
  ])('rejects malformed command arguments', async (...args) => {
    expect(await run(...args)).toMatchObject({
      code: 1,
      error: 'expected-snapshot-arguments',
      reviewRequired: true,
    });
  });
});
