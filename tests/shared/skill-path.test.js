import { describe, expect, it } from 'vitest';
import { skillFromPath } from '../../src/shared/skill-path.js';

describe('skill identity from observed paths', () => {
  it.each([
    ['C:\\Users\\u\\.codex\\skills\\testing\\SKILL.md', 'testing', 'SKILL.md'],
    ['/home/u/.agents/skills/electron-main/SKILL.md', 'electron-main', 'SKILL.md'],
    ['/work/.claude/skills/review/SKILL.md', 'review', 'SKILL.md'],
    ['/home/u/.codex/skills/.system/skill-creator/SKILL.md', 'skill-creator', 'SKILL.md'],
    ['/plugins/cache/provider/pdf/1.2/skills/pdf/SKILL.md', 'pdf', 'SKILL.md'],
    ['//server/share/skills/my skill/SKILL.md', 'my skill', 'SKILL.md'],
    ['/home/u/.agents/skills/pdf/scripts/render.py', 'pdf', 'scripts/render.py'],
    [
      '/home/u/.codex/skills/.system/skill-creator/references/schema.md',
      'skill-creator',
      'references/schema.md',
    ],
    ['/custom/location/my-skill/skill.md', 'my-skill', 'skill.md'],
  ])('recognizes %s', (file, name, relativePath) => {
    const result = skillFromPath(file);
    expect(result).toEqual({
      name,
      rootPath: file.replace(/\\/g, '/').slice(0, -relativePath.length - 1),
      relativePath,
    });
  });

  it.each([
    undefined,
    null,
    42,
    'SKILL.md',
    '/SKILL.md',
    '/skills/SKILL.md',
    '/skills/.system/SKILL.md',
    '/work/not-skills/pdf/script.py',
    '/work/foo/SKILL.md.bak',
    '/skills/foo/../../secret',
    '/skills/foo/./script.py',
    '/skills/foo/SKILL.md\n',
  ])('rejects unknown or ambiguous path %s', (file) => {
    expect(skillFromPath(file)).toBeNull();
  });

  it.each(['C:\\Users\\u\\.claude\\skills\\improve-animations', '/home/u/.codex/skills/pdf/'])(
    'names a skill root event: %s',
    (file) => {
      const rootPath = file.replace(/\\/g, '/').replace(/\/$/, '');
      expect(skillFromPath(file)).toEqual({
        name: rootPath.split('/').at(-1),
        rootPath,
        relativePath: '',
      });
    },
  );
});
