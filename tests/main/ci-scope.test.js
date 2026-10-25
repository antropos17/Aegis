import { describe, expect, it } from 'vitest';
import { needsRuntimeChecks, selectScope } from '../../scripts/ci-scope.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

describe('CI verification scope', () => {
  it('checks a Markdown-only change without requiring runtime verification', () => {
    expect(
      needsRuntimeChecks([
        'AGENTS.md',
        'docs/roadmap/completion-plan.md',
        'tools/agent-skills/testing/SKILL.md',
        'memory-bank/progress.md',
      ]),
    ).toBe(false);
  });

  it.each([
    'src/main/main.js',
    'frontend/observatory/App.svelte',
    'sidecar/etw-file/FileObjectLease.cs',
    '.github/workflows/ci.yml',
    '.codex/agents/auditor.toml',
    'package-lock.json',
    'scripts/ci-scope.mjs',
    'docs/example.mjs',
    'tools/agent-skills/catalog.json',
    'unrecognized.md',
    'docs/../src/main/pretend.md',
    'docs/bad\nname.md',
  ])('requires runtime checks for %s even beside documentation', (file) => {
    expect(needsRuntimeChecks(['README.md', file])).toBe(true);
  });

  it('includes the source side of a code-to-docs rename', () => {
    expect(needsRuntimeChecks(['src/main/old.js', 'docs/old.md'])).toBe(true);
  });

  it('does not reuse runtime evidence for an empty or unknown range', () => {
    expect(needsRuntimeChecks([])).toBe(true);
    expect(selectScope({})).toBe(true);
    expect(selectScope({ AEGIS_CI_BASE: '0'.repeat(40) })).toBe(true);
    expect(selectScope({ AEGIS_CI_BASE: '--invalid' })).toBe(true);
  });

  it('selects the exact committed range and reports both documentation and code changes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-ci-scope-'));
    const env = { ...process.env, HUSKY: '0' };
    const git = (...args) =>
      execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: 'pipe' }).trim();
    const commit = () => {
      git('add', '.');
      git(
        '-c',
        'user.name=CI fixture',
        '-c',
        'user.email=fixture@example.invalid',
        'commit',
        '--no-verify',
        '-qm',
        'fixture',
      );
      return git('rev-parse', 'HEAD');
    };
    const run = (base) => {
      const output = path.join(root, 'scope-output');
      fs.writeFileSync(output, '');
      execFileSync(
        process.execPath,
        [fileURLToPath(new URL('../../scripts/ci-scope.mjs', import.meta.url))],
        {
          cwd: root,
          env: { ...env, AEGIS_CI_BASE: base, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: '' },
          stdio: 'pipe',
        },
      );
      return fs.readFileSync(output, 'utf8');
    };
    try {
      git('init', '-q');
      fs.writeFileSync(path.join(root, 'README.md'), 'Baseline\n');
      const base = commit();
      fs.writeFileSync(path.join(root, 'README.md'), 'Updated documentation\n');
      const docs = commit();
      expect(run(base)).toBe('runtime=false\n');
      fs.writeFileSync(path.join(root, 'runtime.js'), 'export const value = 1;\n');
      commit();
      expect(run(docs)).toBe('runtime=true\n');
      expect(run(base)).toBe('runtime=true\n');
    } finally {
      if (
        path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) ||
        !path.basename(root).startsWith('aegis-ci-scope-')
      ) {
        // Preserve an unexpected target rather than deleting outside the fixture root.
        process.stderr.write('Fixture cleanup escaped the selected temporary directory\n');
      } else {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  });
});
