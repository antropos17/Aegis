import { describe, expect, it } from 'vitest';
import { fileActivityLabel, shortenPath } from '../../src/renderer/lib/utils/path-utils.ts';

describe('skill event labels', () => {
  it('shows names for old events carrying only a path', () => {
    expect(fileActivityLabel('C:\\Users\\u\\.codex\\skills\\testing\\SKILL.md', 'accessed')).toBe(
      'Skill: testing · SKILL.md',
    );
    expect(fileActivityLabel('/home/u/.agents/skills/pdf/references/api.md', 'modified')).toBe(
      'Skill: pdf · references/api.md',
    );
  });
  it('keeps directory-only holding observations and ordinary files unchanged', () => {
    const directory = '/home/u/.codex/skills/testing/references';
    expect(fileActivityLabel(directory, 'holding')).toBe(shortenPath(directory));
    expect(fileActivityLabel('/work/src/main.js')).toBe('/work/src/main.js');
    expect(fileActivityLabel(undefined)).toBe('');
  });
});
