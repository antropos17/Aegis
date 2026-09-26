import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { inventoryProfile, inventoryProject } = require('../../src/main/agent-inventory');
const { getInventoryProfile } = require('../../src/main/inventory-profiles');
const main = path.resolve(import.meta.dirname, '../../src/main/main.js');
let fixture;
let root;
let links;

function put(name, contents) {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return target;
}

beforeEach(() => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-profiles-'));
  root = path.join(fixture, 'copied user Юникод');
  fs.mkdirSync(root);
  links = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const link of links) fs.unlinkSync(link);
  fs.rmSync(fixture, { recursive: true, force: true });
});

describe('explicit inventory profiles', () => {
  it('covers user declarations, scripts and named profiles without reading auth/history', async () => {
    const config = '[mcp_servers.demo]\ncommand="DO_NOT_EXECUTE"\n[hooks]\nPreToolUse=[]';
    put('.codex/config.toml', config);
    put('.codex/private-review.config.toml', config);
    put('.codex/auth.json', 'PRIVATE_AUTH');
    put('.codex/history.jsonl', 'PRIVATE_HISTORY');
    put('.claude/settings.json', '{"hooks":{}}');
    put(
      '.claude.json',
      '{"mcpServers":{"global":{}},"projects":{"PRIVATE_PROJECT":{"mcpServers":{"local":{}}}}}',
    );
    put('.cursor/mcp.json', '{"mcpServers":{}}');
    put('.agents/skills/demo/SKILL.md', 'PRIVATE_SKILL');
    put('.agents/skills/demo/run.js', 'DO_NOT_EXECUTE');
    put('.codex/AGENTS.md', 'PRIVATE_INSTRUCTION');
    put('.codex/deeper/ignored.config.toml', config);
    const open = vi.spyOn(fs.promises, 'open');
    const report = await inventoryProfile('user-home', root);
    expect(report).toMatchObject({
      schemaVersion: 3,
      mode: 'profile-inventory',
      complete: true,
      adapter: { id: 'user-home', version: 3 },
      assessment: 'not-performed',
    });
    expect(report.components.map((entry) => entry.path)).toEqual([
      '.agents/skills/demo/SKILL.md',
      '.agents/skills/demo/run.js',
      '.claude.json',
      '.claude/settings.json',
      '.codex/AGENTS.md',
      '.codex/config.toml',
      '.codex/private-review.config.toml',
      '.cursor/mcp.json',
    ]);
    expect(report.components.find((entry) => entry.path === '.codex/config.toml')).toMatchObject({
      declaredSections: { mcp_servers: 1, hooks: 1 },
      sha256: createHash('sha256').update(config).digest('hex'),
      provenance: {
        agent: 'codex',
        scope: 'user',
        basis: 'selected-layout',
        agentVersion: null,
        packageIdentity: 'not-resolved',
      },
    });
    expect(report.components.find((entry) => entry.path === '.claude.json')).toMatchObject({
      declaredEntries: 1,
      projectScopedEntries: 1,
    });
    expect(
      open.mock.calls.map(([name]) => name).some((name) => /auth|history|deeper/.test(name)),
    ).toBe(false);
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE|DO_NOT_EXECUTE/);
    expect(JSON.stringify(report)).not.toContain(root);
  });

  it('parses project TOML/JSONC and records scope without changing original hashes', async () => {
    put('.vscode/mcp.json', '// comment\n{"servers":{"one":{},},}');
    put('.codex/config.toml', '[mcp_servers.one]\ncommand="PRIVATE"');
    put('AGENTS.override.md', 'private instruction override');
    const report = await inventoryProject(root);
    expect(report.complete).toBe(true);
    expect(
      report.components.filter((entry) => entry.parseStatus).map((entry) => entry.declaredEntries),
    ).toEqual([1, 1]);
    expect(report.components.every((entry) => entry.provenance.scope === 'project')).toBe(true);
  });

  it.each([
    ['codex-user', 'config.toml', '[mcp_servers.one]\ncommand="PRIVATE"', 'codex'],
    ['claude-user', 'settings.json', '{"hooks":{"PreToolUse":[]}}', 'claude-code'],
    ['cursor-user', 'mcp.json', '{"mcpServers":{"one":{}}}', 'cursor'],
    ['vscode-user', 'mcp.json', '/* comment */ {"servers":{"one":{},},}', 'vscode'],
    ['gemini-user', 'settings.json', '{"mcpServers":{"one":{}}}', 'gemini-cli'],
    ['gemini-project', 'settings.json', '{"mcpServers":{"one":{}}}', 'gemini-cli'],
    ['gemini-system-windows', 'settings.json', '{"mcpServers":{"one":{}}}', 'gemini-cli'],
    [
      'codex-managed',
      'requirements.toml',
      '[mcp_servers.one]\nidentity={command="PRIVATE"}',
      'codex',
    ],
    ['claude-managed', 'managed-mcp.json', '{"mcpServers":{"one":{}}}', 'claude-code'],
  ])(
    'reads only the selected %s layout from an arbitrary copied directory',
    async (profile, file, content, agent) => {
      put(file, content);
      put('history.jsonl', 'PRIVATE_HISTORY');
      const report = await inventoryProfile(profile, root);
      expect(report.complete).toBe(true);
      expect(report.components).toHaveLength(1);
      expect(report.components[0]).toMatchObject({
        path: file,
        declaredEntries: 1,
        provenance: { agent },
      });
      expect(JSON.stringify(report)).not.toContain('PRIVATE');
    },
  );

  it('reads direct managed drop-ins and reports malformed ones without descending into other state', async () => {
    put('managed-settings.json', '{"hooks":{}}');
    put('managed-settings.d/10-hooks.json', '{"hooks":{"PreToolUse":[]}}');
    put('managed-settings.d/20-broken.json', '{ PRIVATE_BROKEN');
    put('managed-settings.d/.hidden.json', 'PRIVATE_HIDDEN');
    put('managed-settings.d/readme.txt', 'PRIVATE_TEXT');
    put('managed-settings.d/nested/30-ignored.json', '{}');
    const open = vi.spyOn(fs.promises, 'open');
    const report = await inventoryProfile('claude-managed', root);
    expect(report.complete).toBe(false);
    expect(report.components.map((entry) => entry.path)).toEqual([
      'managed-settings.d/10-hooks.json',
      'managed-settings.d/20-broken.json',
      'managed-settings.json',
    ]);
    expect(report.issues).toEqual([
      { path: 'managed-settings.d/20-broken.json', reason: 'invalid-json' },
    ]);
    expect(open).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(report)).not.toContain('PRIVATE');
  });

  it('reads only selected Gemini settings in project and user-home layouts', async () => {
    const script = path.join(fixture, 'must-not-run.js');
    const sentinel = path.join(fixture, 'launched');
    fs.writeFileSync(
      script,
      `require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'ran')`,
    );
    const contents = JSON.stringify({
      mcp: { allowed: ['PRIVATE_SERVER'], excluded: [] },
      mcpServers: {
        PRIVATE_SERVER: {
          command: process.execPath,
          args: [script],
          env: { TOKEN: 'PRIVATE_SECRET' },
          trust: true,
          includeTools: ['PRIVATE_TOOL'],
        },
      },
    });
    put('.gemini/settings.json', `// PRIVATE_COMMENT\n${contents}\n/* another comment */`);
    put('.gemini/oauth_creds.json', 'PRIVATE_OAUTH');
    put('.gemini/history/secret.json', 'PRIVATE_HISTORY');
    const open = vi.spyOn(fs.promises, 'open');
    for (const [id, directory, expectedPath, scope] of [
      ['project', root, '.gemini/settings.json', 'project'],
      ['user-home', root, '.gemini/settings.json', 'user'],
      ['gemini-project', path.join(root, '.gemini'), 'settings.json', 'project'],
      ['gemini-user', path.join(root, '.gemini'), 'settings.json', 'user'],
    ]) {
      const report =
        id === 'project'
          ? await inventoryProject(directory)
          : await inventoryProfile(id, directory);
      expect(report.complete).toBe(true);
      expect(report.components).toHaveLength(1);
      expect(report.components[0]).toMatchObject({
        path: expectedPath,
        format: 'json-comments',
        parseStatus: 'parsed',
        declaredEntries: 1,
        geminiMcpDeclarations: {
          allowed: { present: true, entries: 1 },
          excluded: { present: true, entries: 0 },
          trustTrueServers: 1,
          includeToolsServers: 1,
        },
        provenance: { agent: 'gemini-cli', scope },
      });
      expect(JSON.stringify(report)).not.toMatch(/PRIVATE|must-not-run|launched/);
      expect(report.scope.configurationPrecedence).toBe('not-resolved');
    }
    expect(fs.existsSync(sentinel)).toBe(false);
    expect(open.mock.calls.map(([name]) => String(name))).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/oauth_creds|history|must-not-run/)]),
    );
  });

  it('fingerprints only the declared default Gemini instructions for each selected layout', async () => {
    const projectText = 'PRIVATE_PROJECT_INSTRUCTIONS\n';
    const userText = 'PRIVATE_USER_INSTRUCTIONS\n';
    put('GEMINI.md', projectText);
    put('.gemini/GEMINI.md', userText);
    put('.gemini/settings.json', '{"context":{"fileName":"custom.md"}}');
    put('.gemini/custom.md', 'PRIVATE_CONFIGURED_INSTRUCTIONS');
    put('.gemini/oauth_creds.json', 'PRIVATE_OAUTH');
    put('.gemini/history/session.json', 'PRIVATE_HISTORY');
    const open = vi.spyOn(fs.promises, 'open');
    for (const [id, directory, version, instructionPath, scope, content] of [
      ['project', root, 3, 'GEMINI.md', 'project', projectText],
      ['user-home', root, 3, '.gemini/GEMINI.md', 'user', userText],
      ['gemini-user', path.join(root, '.gemini'), 2, 'GEMINI.md', 'user', userText],
    ]) {
      const report =
        id === 'project'
          ? await inventoryProject(directory)
          : await inventoryProfile(id, directory);
      expect(report).toMatchObject({
        complete: true,
        adapter: { id, version },
        scope: { configurationPrecedence: 'not-resolved' },
      });
      expect(report.scope.instructions).toContain(instructionPath);
      expect(report.components.map((entry) => entry.path)).toEqual(
        [instructionPath, id === 'gemini-user' ? 'settings.json' : '.gemini/settings.json'].sort(),
      );
      expect(report.components.find((entry) => entry.path === instructionPath)).toMatchObject({
        kind: 'instruction',
        size: Buffer.byteLength(content),
        sha256: createHash('sha256').update(content).digest('hex'),
        provenance: {
          agent: 'gemini-cli',
          scope,
          basis: 'selected-layout',
          agentVersion: null,
          packageIdentity: 'not-resolved',
        },
      });
      expect(JSON.stringify(report)).not.toMatch(/PRIVATE|custom\.md/);
    }
    const projectConfig = await inventoryProfile('gemini-project', path.join(root, '.gemini'));
    expect(projectConfig.components.map((entry) => entry.path)).toEqual(['settings.json']);
    expect(projectConfig.scope.instructions).toEqual([]);
    expect(open.mock.calls.map(([name]) => String(name))).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/custom\.md|oauth_creds|history/)]),
    );
  });

  it('keeps Windows Gemini system defaults and overrides distinct without merging them', async () => {
    put('system-defaults.json', '{"mcpServers":{"default":{"trust":true}}}');
    put('settings.json', '{"mcp":{"excluded":["default"]},"mcpServers":{}}');
    put('credentials.json', 'PRIVATE_CREDENTIALS');
    const report = await inventoryProfile('gemini-system-windows', root);
    expect(report.complete).toBe(true);
    expect(report.components.map(({ path: name, provenance }) => [name, provenance.scope])).toEqual(
      [
        ['settings.json', 'system-override'],
        ['system-defaults.json', 'system-defaults'],
      ],
    );
    expect(report.components[0].geminiMcpDeclarations.excluded).toEqual({
      present: true,
      entries: 1,
    });
    expect(report.components[1].geminiMcpDeclarations.trustTrueServers).toBe(1);
    expect(JSON.stringify(report)).not.toContain('PRIVATE_CREDENTIALS');
    expect(report.scope.configurationPrecedence).toBe('not-resolved');
  });

  it('reports malformed Gemini filters without returning their values', async () => {
    put('settings.json', '{"mcp":{"allowed":["PRIVATE",42]}}');
    const report = await inventoryProfile('gemini-user', root);
    expect(report.complete).toBe(false);
    expect(report.issues).toEqual([{ path: 'settings.json', reason: 'invalid-shape' }]);
    expect(JSON.stringify(report)).not.toContain('PRIVATE');
  });

  it('marks malformed Gemini JSON incomplete without parser or content detail', async () => {
    put('settings.json', '{"mcpServers":{"PRIVATE_SERVER":');
    const report = await inventoryProfile('gemini-user', root);
    expect(report.complete).toBe(false);
    expect(report.issues).toEqual([{ path: 'settings.json', reason: 'invalid-json-comments' }]);
    expect(JSON.stringify(report)).not.toContain('PRIVATE_SERVER');
  });

  it('rejects trailing commas in Gemini settings even when comments are present', async () => {
    put('settings.json', '// PRIVATE_COMMENT\n{"mcpServers":{"one":{},}}');
    const report = await inventoryProfile('gemini-user', root);
    expect(report.complete).toBe(false);
    expect(report.issues).toEqual([{ path: 'settings.json', reason: 'invalid-json-comments' }]);
    expect(JSON.stringify(report)).not.toContain('PRIVATE_COMMENT');
  });

  it('does not follow linked Gemini config directories outside the selected project', async () => {
    const outside = path.join(fixture, 'outside-gemini');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'settings.json'), '{"token":"PRIVATE_OAUTH"}');
    const link = path.join(root, '.gemini');
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    links.push(link);
    const open = vi.spyOn(fs.promises, 'open');
    const report = await inventoryProject(root);
    expect(report.issues).toContainEqual({ path: '.gemini/settings.json', reason: 'link-skipped' });
    expect(open).not.toHaveBeenCalled();
    expect(JSON.stringify(report)).not.toContain('PRIVATE_OAUTH');
  });

  it('bounds directory enumeration even when no names match', async () => {
    for (let i = 0; i < 30; i++) put(`history-${i}.jsonl`, 'PRIVATE');
    const open = vi.spyOn(fs.promises, 'open');
    const report = await inventoryProfile('codex-user', root, { limits: { entries: 8 } });
    expect(report.complete).toBe(false);
    expect(report.usage.entries).toBe(8);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0].reason).toBe('entry-limit');
    expect(open).not.toHaveBeenCalled();
  });

  it('skips linked config directories and never reads the external target', async () => {
    const outside = path.join(fixture, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, '10-hooks.json'), '{"hooks":{}}');
    const link = path.join(root, 'managed-settings.d');
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    links.push(link);
    const open = vi.spyOn(fs.promises, 'open');
    const report = await inventoryProfile('claude-managed', root);
    expect(report.issues).toContainEqual({ path: 'managed-settings.d', reason: 'link-skipped' });
    expect(open).not.toHaveBeenCalled();
  });

  it('reports a matching directory as an unsupported file rather than recursively reading it', async () => {
    put('fake.config.toml/config.toml', 'PRIVATE');
    const report = await inventoryProfile('codex-user', root);
    expect(report.issues).toContainEqual({
      path: 'fake.config.toml',
      reason: 'unsupported-file-type',
    });
    expect(report.components).toEqual([]);
  });

  it('reports an unreadable pattern directory with a fixed reason', async () => {
    fs.mkdirSync(path.join(root, 'managed-settings.d'));
    vi.spyOn(fs.promises, 'opendir').mockRejectedValue(new Error('PRIVATE_OS_ERROR'));
    const report = await inventoryProfile('claude-managed', root);
    expect(report.issues).toContainEqual({ path: 'managed-settings.d', reason: 'unreadable' });
    expect(JSON.stringify(report)).not.toContain('PRIVATE');
  });

  it.each(['unknown', '__proto__', 'constructor', 'project'])(
    'rejects %s before filesystem access',
    async (id) => {
      const realpath = vi.spyOn(fs.promises, 'realpath');
      await expect(inventoryProfile(id, root)).rejects.toThrow('unsupported-profile');
      expect(realpath).not.toHaveBeenCalled();
    },
  );

  it('keeps built-in layouts isolated from caller mutation', () => {
    getInventoryProfile('codex-user').configs[0].path = '../auth.json';
    expect(getInventoryProfile('codex-user').configs[0].path).toBe('config.toml');
  });
});

describe('profile inventory CLI', () => {
  const run = (...args) =>
    spawnSync(process.execPath, [main, '--inventory-profile-json', ...args], {
      encoding: 'utf8',
      timeout: 10000,
    });

  it('runs without Electron and uses the chosen directory, not CODEX_HOME', () => {
    put('config.toml', '[mcp_servers.a]\ncommand="DO_NOT_EXECUTE"');
    const result = spawnSync(
      process.execPath,
      [main, '--inventory-profile-json', 'codex-user', root],
      {
        encoding: 'utf8',
        timeout: 10000,
        env: { ...process.env, CODEX_HOME: path.join(fixture, 'not-selected') },
      },
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({ mode: 'profile-inventory', complete: true });
    expect(JSON.parse(result.stdout).components[0].declaredEntries).toBe(1);
  });

  it('emits a redacted Gemini settings inventory without launching its declared server', () => {
    const marker = path.join(fixture, 'server-launched');
    const script = path.join(fixture, 'server.js');
    fs.writeFileSync(script, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`);
    put(
      'settings.json',
      JSON.stringify({
        mcpServers: {
          PRIVATE_SERVER: {
            command: process.execPath,
            args: [script],
            env: { API_KEY: 'PRIVATE_SECRET' },
            trust: true,
          },
        },
      }),
    );
    const result = run('gemini-user', root);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout).components[0]).toMatchObject({
      path: 'settings.json',
      declaredEntries: 1,
      geminiMcpDeclarations: { trustTrueServers: 1 },
    });
    expect(result.stdout).not.toMatch(/PRIVATE|server\.js|server-launched/);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('distinguishes CLI errors, unsupported profiles, unavailable roots and incomplete data', () => {
    const missing = run('codex-user');
    expect(missing.status).toBe(1);
    expect(JSON.parse(missing.stdout).error).toBe('expected-profile-and-directory');
    expect(JSON.parse(run('unknown', root).stdout).error).toBe('unsupported-profile');
    expect(JSON.parse(run('codex-user', path.join(root, 'absent')).stdout).error).toBe(
      'inventory-unavailable',
    );
    put('config.toml', '[ PRIVATE_BROKEN');
    const incomplete = run('codex-user', root);
    expect(incomplete.status).toBe(2);
    expect(JSON.parse(incomplete.stdout).complete).toBe(false);
    expect(incomplete.stdout).not.toContain('PRIVATE');
    expect(run('codex-user', root, '--scan-json').status).toBe(1);
  });
});
