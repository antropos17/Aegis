import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncSkills } from '../../scripts/sync-agent-skills.mjs';

const fixtures = [];
const repo = fileURLToPath(new URL('../../', import.meta.url));
const read = (root, relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const write = (root, relative, value) => {
  const filename = path.join(root, relative);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, value);
};
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-skills-'));
  fixtures.push(root);
  fs.cpSync(path.join(repo, 'tools/agent-skills'), path.join(root, 'tools/agent-skills'), {
    recursive: true,
  });
  return root;
}
afterEach(() => {
  for (const root of fixtures.splice(0)) {
    const resolved = path.resolve(root);
    if (
      path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
      !path.basename(resolved).startsWith('aegis-skills-')
    ) {
      throw new Error('Fixture cleanup escaped the selected temporary directory');
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

describe('project skill installation', () => {
  it('previews without creating installations or a receipt', () => {
    const root = fixture();
    expect(syncSkills(root).changed).toContain('.agents/skills/ship/SKILL.md');
    expect(fs.existsSync(path.join(root, '.agents'))).toBe(false);
    expect(fs.existsSync(path.join(root, '.claude'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'out'))).toBe(false);
  });

  it('installs the entire catalog, preserves explicit invocation and becomes idempotent', () => {
    const root = fixture();
    const catalog = JSON.parse(read(root, 'tools/agent-skills/catalog.json'));
    const actual = fs
      .readdirSync(path.join(root, 'tools/agent-skills'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(catalog.skills.map((skill) => skill.name).sort()).toEqual(actual);
    syncSkills(root, { write: true });
    for (const skill of catalog.skills) {
      const source = read(root, `tools/agent-skills/${skill.name}/SKILL.md`);
      expect(read(root, `.agents/skills/${skill.name}/SKILL.md`)).toBe(source);
      const claude = read(root, `.claude/skills/${skill.name}/SKILL.md`);
      expect(claude.replace('disable-model-invocation: true\n', '')).toBe(
        skill.name === 'ship' ? source.replace(/\r\n/g, '\n') : source,
      );
    }
    expect(read(root, '.claude/skills/ship/SKILL.md')).toContain('disable-model-invocation: true');
    expect(read(root, '.agents/skills/ship/agents/openai.yaml')).toContain(
      'allow_implicit_invocation: false',
    );
    expect(fs.existsSync(path.join(root, '.claude/skills/ship/agents/openai.yaml'))).toBe(false);
    expect(syncSkills(root).changed).toEqual([]);
  });

  it('updates an unmodified installation and retains unrelated local files', () => {
    const root = fixture();
    syncSkills(root, { write: true });
    write(root, '.agents/skills/local-only/SKILL.md', 'private instructions');
    const target = 'tools/agent-skills/audit-check/SKILL.md';
    write(root, target, `${read(root, target)}\nAdditional source guidance.\n`);
    expect(syncSkills(root, { write: true }).changed).toHaveLength(2);
    expect(read(root, '.agents/skills/audit-check/SKILL.md')).toBe(read(root, target));
    expect(read(root, '.agents/skills/local-only/SKILL.md')).toBe('private instructions');
  });

  it.each([false, true])(
    'refuses customized files before any write (previous install: %s)',
    (installed) => {
      const root = fixture();
      if (installed) syncSkills(root, { write: true });
      const unrelatedTarget = '.agents/skills/audit-check/SKILL.md';
      const before = installed ? read(root, unrelatedTarget) : null;
      const source = 'tools/agent-skills/audit-check/SKILL.md';
      write(root, source, `${read(root, source)}\nChanged source.\n`);
      write(root, '.claude/skills/testing/SKILL.md', 'user customization');
      expect(() => syncSkills(root, { write: true })).toThrow('Local customization preserved');
      expect(read(root, '.claude/skills/testing/SKILL.md')).toBe('user customization');
      expect(
        installed ? read(root, unrelatedTarget) : fs.existsSync(path.join(root, unrelatedTarget)),
      ).toBe(installed ? before : false);
    },
  );

  it('refuses a destination junction or symlink without touching its owner', () => {
    const root = fixture();
    const outside = fixture();
    fs.symlinkSync(
      outside,
      path.join(root, '.agents'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    try {
      expect(() => syncSkills(root, { write: true })).toThrow('Linked path');
      expect(fs.existsSync(path.join(outside, 'skills'))).toBe(false);
    } finally {
      // Remove the link itself before recursive fixture cleanup.
      fs.unlinkSync(path.join(root, '.agents'));
    }
  });

  it('rejects escaping catalog paths before installation', () => {
    const root = fixture();
    const catalog = JSON.parse(read(root, 'tools/agent-skills/catalog.json'));
    catalog.skills[0].files.push('../../outside.md');
    write(root, 'tools/agent-skills/catalog.json', JSON.stringify(catalog));
    expect(() => syncSkills(root, { write: true })).toThrow('Invalid catalog path');
    expect(fs.existsSync(path.join(root, '.agents'))).toBe(false);
  });

  it('preserves retired installed files until reviewed and manually removed', () => {
    const root = fixture();
    syncSkills(root, { write: true });
    const catalog = JSON.parse(read(root, 'tools/agent-skills/catalog.json'));
    catalog.skills = catalog.skills.filter((skill) => skill.name !== 'testing');
    write(root, 'tools/agent-skills/catalog.json', JSON.stringify(catalog));
    expect(() => syncSkills(root, { write: true })).toThrow('Retired catalog file preserved');
    expect(read(root, '.agents/skills/testing/SKILL.md')).toContain('name: testing');
  });
});
