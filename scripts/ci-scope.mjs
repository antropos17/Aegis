import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Select runtime verification conservatively; unknown paths always require it.
 * @param {string[]} files Changed paths, including deletions and rename sources.
 * @returns {boolean} Whether runtime checks are required.
 * @since v0.20.1
 */
export function needsRuntimeChecks(files) {
  if (!files.length) return true;
  return files.some(
    (file) =>
      file.split('/').some((part) => part === '..' || part === '.') ||
      (!/^(?:AGENTS|CLAUDE|README|ROADMAP|CODING_STANDARDS|SECURITY|CHANGELOG)\.md$/.test(file) &&
        !/^(?:docs|memory-bank|tools\/agent-skills)\/(?!.*(?:^|\/)\.\.?\/)[^\r\n]+\.md$/.test(
          file,
        )),
  );
}

/**
 * Inspect the exact event range without installing application dependencies.
 * @param {NodeJS.ProcessEnv} env CI environment.
 * @returns {boolean} Whether runtime checks are required.
 * @since v0.20.1
 */
export function selectScope(env = process.env) {
  const base = env.AEGIS_CI_BASE;
  if (!/^[a-f0-9]{40}$/.test(base ?? '') || /^0+$/.test(base)) return true;
  const git = (args) =>
    execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
      windowsHide: true,
    });
  try {
    git(['cat-file', '-e', `${base}^{commit}`]);
  } catch {
    git(['fetch', '--no-tags', '--depth=1', 'origin', base]);
  }
  // Include both sides of a rename so moving code into docs cannot bypass tests.
  const files = git(['diff', '--name-only', '--no-renames', '-z', base, 'HEAD'])
    .split('\0')
    .filter(Boolean);
  git(['diff', '--check', base, 'HEAD']);
  const runtime = needsRuntimeChecks(files);
  console.log(JSON.stringify({ base, changedFiles: files.length, runtimeChecksRequired: runtime }));
  if (env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      runtime
        ? 'Runtime-affecting or unknown inputs: full job verification selected.\n'
        : 'Markdown-only change: diff whitespace checked; runtime build, types, coverage and dependency audit are not re-executed. The test job still checks derived counts.\n',
    );
  }
  return runtime;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runtime = selectScope();
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required');
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `runtime=${runtime}\n`);
}
