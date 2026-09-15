import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { inventoryProject } = require('../../src/main/agent-inventory');
const main = path.resolve(import.meta.dirname, '../../src/main/main.js');
let fixture;
let project;

function put(name, content) {
  const target = path.join(project, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

beforeEach(() => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-inventory-'));
  project = path.join(fixture, 'project space Юникод');
  fs.mkdirSync(project);
});

afterEach(() => {
  vi.restoreAllMocks();
  // Only this fixture's link is removed before recursive cleanup (Windows junction).
  const link = path.join(project, '.claude');
  if (fs.existsSync(link) && fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
  fs.rmSync(fixture, { recursive: true, force: true });
});

describe('static project inventory', () => {
  it('fingerprints declarations without exposing secrets or executing commands', async () => {
    const command = process.execPath;
    const scriptPath = '.agents/skills/demo/scripts/run.js';
    const script = `require('node:fs').writeFileSync(${JSON.stringify(path.join(fixture, 'execution-marker'))}, 'executed')`;
    const secret = 'CANARY_PRIVATE_TOKEN_74';
    const raw = JSON.stringify({
      mcpServers: {
        [secret]: {
          command,
          args: [path.join(project, scriptPath)],
          env: { TOKEN: secret },
          url: `https://u:${secret}@example.invalid`,
        },
      },
    });
    put('.mcp.json', raw);
    put(
      '.claude/settings.json',
      JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ command }] }] } }),
    );
    put('.agents/skills/demo/SKILL.md', '---\nname: demo\n---\nPrivate text ' + secret);
    put(scriptPath, script);
    put('AGENTS.md', 'Instructions ' + secret);
    put('unrelated/.mcp.json', raw);
    put('.env', secret);

    const result = await inventoryProject(project);
    expect(result.complete).toBe(true);
    expect(result.assessment).toBe('not-performed');
    expect(result.components.map((entry) => entry.path)).toEqual([
      '.agents/skills/demo/SKILL.md',
      '.agents/skills/demo/scripts/run.js',
      '.claude/settings.json',
      '.mcp.json',
      'AGENTS.md',
    ]);
    expect(result.components.find((entry) => entry.path === '.mcp.json')).toMatchObject({
      kind: 'mcp',
      declaredEntries: 1,
      parseStatus: 'parsed',
      sha256: createHash('sha256').update(raw).digest('hex'),
    });
    expect(result.components.find((entry) => entry.kind === 'hooks').declaredEntries).toBe(1);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain(command);
    expect(fs.existsSync(path.join(fixture, 'execution-marker'))).toBe(false);
    expect(fs.readFileSync(path.join(project, '.mcp.json'), 'utf8')).toBe(raw);
  });

  it('changes a fingerprint when a bundled script changes, even if SKILL.md does not', async () => {
    put('.agents/skills/demo/SKILL.md', 'same manifest');
    put('.agents/skills/demo/run.js', 'first');
    const first = await inventoryProject(project);
    put('.agents/skills/demo/run.js', 'second');
    const next = await inventoryProject(project);
    expect(first.components[0].sha256).toBe(next.components[0].sha256);
    expect(first.components[1].sha256).not.toBe(next.components[1].sha256);
  });

  it('distinguishes absent paths from malformed JSON, unsupported formats and invalid shapes', async () => {
    expect((await inventoryProject(project)).complete).toBe(true);
    put('.mcp.json', '{ PRIVATE_BROKEN_JSON');
    put('.cursor/mcp.json', '{"mcpServers":[]}');
    put('.codex/config.toml', 'token="PRIVATE_TOML"');
    put('.vscode/mcp.json', '// comment\n{"servers":{}}');
    const result = await inventoryProject(project);
    expect(result.complete).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        { path: '.mcp.json', reason: 'invalid-json' },
        { path: '.cursor/mcp.json', reason: 'invalid-shape' },
        { path: '.codex/config.toml', reason: 'unsupported-format' },
        { path: '.vscode/mcp.json', reason: 'unsupported-format' },
      ]),
    );
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('skips a linked config parent and a linked skills tree without reading their contents', async () => {
    const outside = path.join(fixture, 'outside');
    fs.mkdirSync(path.join(outside, 'skills'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'settings.json'), '{"hooks":{}}');
    fs.writeFileSync(path.join(outside, 'skills', 'SKILL.md'), 'external');
    fs.symlinkSync(
      outside,
      path.join(project, '.claude'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const open = vi.spyOn(fs.promises, 'open');
    const result = await inventoryProject(project);
    expect(result.complete).toBe(false);
    expect(result.components).toEqual([]);
    expect(result.issues).toContainEqual({ path: '.claude/settings.json', reason: 'link-skipped' });
    expect(open).not.toHaveBeenCalled();
  });

  it('bounds each file and total reading and reports skipped data', async () => {
    put('AGENTS.md', 'a'.repeat(50));
    put('CLAUDE.md', 'b'.repeat(8));
    put('.cursorrules', 'c'.repeat(8));
    const result = await inventoryProject(project, { limits: { fileBytes: 20, totalBytes: 12 } });
    expect(result.complete).toBe(false);
    expect(result.usage.bytes).toBeLessThanOrEqual(12);
    expect(result.components.map((entry) => entry.path)).toEqual(['CLAUDE.md']);
    expect(result.issues).toContainEqual({ path: 'AGENTS.md', reason: 'file-size-limit' });
    expect(result.issues).toContainEqual({ path: '.cursorrules', reason: 'total-bytes-limit' });
  });

  it('caps directory traversal and marks incomplete scope', async () => {
    for (let i = 0; i < 20; i++) put(`.agents/skills/demo/file-${i}`, 'x');
    const limited = await inventoryProject(project, { limits: { entries: 15 } });
    expect(limited.complete).toBe(false);
    expect(limited.usage.entries).toBe(15);
    expect(limited.issues.at(-1).reason).toBe('entry-limit');
    const shallow = await inventoryProject(project, { limits: { depth: 1 } });
    expect(shallow.issues).toContainEqual({ path: '.agents/skills/demo', reason: 'depth-limit' });
  });

  it('reports unreadable files without exposing exception messages', async () => {
    put('.mcp.json', '{}');
    vi.spyOn(fs.promises, 'open').mockRejectedValue(
      Object.assign(new Error('PRIVATE OS ERROR'), { code: 'EACCES' }),
    );
    const result = await inventoryProject(project);
    expect(result.components).toEqual([]);
    expect(result.issues).toContainEqual({ path: '.mcp.json', reason: 'unreadable' });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('rejects changed files between stat and open', async () => {
    const target = put('AGENTS.md', 'first');
    const realOpen = fs.promises.open.bind(fs.promises);
    vi.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
      fs.writeFileSync(target, 'changed length');
      return realOpen(...args);
    });
    const result = await inventoryProject(project);
    expect(result.components).toEqual([]);
    expect(result.issues).toContainEqual({ path: 'AGENTS.md', reason: 'file-changed' });
  });

  it('rejects a non-directory root and unbounded overrides', async () => {
    const file = put('AGENTS.md', 'x');
    await expect(inventoryProject(file)).rejects.toThrow();
    await expect(inventoryProject(project, { limits: { entries: Infinity } })).rejects.toThrow(
      'invalid-limits',
    );
  });

  it('marks an observed file disappearing during reading as incomplete', async () => {
    const target = put('AGENTS.md', 'removed after opening');
    const realOpen = fs.promises.open.bind(fs.promises);
    vi.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
      const handle = await realOpen(...args);
      fs.unlinkSync(target);
      return handle;
    });
    const result = await inventoryProject(project);
    expect(result.complete).toBe(false);
    expect(result.components).toEqual([]);
    expect(result.issues).toContainEqual({ path: 'AGENTS.md', reason: 'unreadable' });
  });
});

describe('inventory CLI entrypoint', () => {
  it('runs through main.js with Node, without importing Electron or starting the GUI', () => {
    put('.mcp.json', '{"mcpServers":{"test":{"command":"DO_NOT_EXECUTE"}}}');
    const result = spawnSync(process.execPath, [main, '--inventory-json', project], {
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout).components[0].declaredEntries).toBe(1);
  });

  it('returns JSON and distinct failure/incomplete exit codes', () => {
    const missing = spawnSync(process.execPath, [main, '--inventory-json'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(missing.status).toBe(1);
    expect(JSON.parse(missing.stdout).error).toBe('expected-project-directory');
    put('.mcp.json', '{ invalid PRIVATE_TEXT');
    const incomplete = spawnSync(process.execPath, [main, '--inventory-json', project], {
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(incomplete.status).toBe(2);
    expect(JSON.parse(incomplete.stdout).complete).toBe(false);
    expect(incomplete.stdout).not.toContain('PRIVATE_TEXT');
    const absent = spawnSync(
      process.execPath,
      [main, '--inventory-json', path.join(project, 'absent')],
      { encoding: 'utf8', timeout: 10000 },
    );
    expect(absent.status).toBe(1);
    expect(JSON.parse(absent.stdout)).toEqual({ error: 'inventory-unavailable' });
  });
});
