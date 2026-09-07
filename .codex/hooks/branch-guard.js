#!/usr/bin/env node
// Codex PreToolUse(apply_patch; Edit|Write aliases) branch-guard for AEGIS.
//
// Blocks edits to TRACKED, in-repo files while the project repo is on `master`,
// so all work goes through a feature branch (GitHub-Flow rule).
//
// Two skips run BEFORE the block (the bug this hook fixes):
//   1. OUT-OF-REPO  — the edited path is not under the project repo root
//                     (e.g. ~/.codex/config.toml). The master-branch guard
//                     has no business gating files outside the repo.
//   2. GITIGNORED   — the path is under the repo root but git-ignored
//                     (e.g. memory-bank/ working notes). Ignored files are not
//                     part of the tracked tree, so editing them on master is fine.
//
// Input: a PreToolUse event as JSON on stdin (the only supported mechanism —
//        there are no $TOOL_INPUT_* env vars). Shape:
//        { "hook_event_name": "PreToolUse", "tool_name": "apply_patch",
//          "tool_input": { "command": "*** Begin Patch\n..." }, "cwd": "..." }
// Codex supplies the session cwd in the payload and as the working directory;
// it does not document a project-root environment variable for command hooks.
// Block: exit code 2 + a plain-language message on stderr (the canonical form).
// Allow: exit code 0.
// The Windows hook launcher must end with `exit $LASTEXITCODE`: PowerShell
// otherwise maps a native exit 2 to exit 1, which Codex treats as a hook error
// rather than a blocking decision that prevents the edit.
//
// Registered in .codex/hooks.json beside the project .codex/config.toml.
// Test the logic: require this module and call decide() with mock rows, OR pipe
//                 a mock event:  echo '{...}' | node .codex/hooks/branch-guard.js

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

/**
 * Normalize a filesystem path for cross-platform prefix comparison.
 * Backslashes -> forward slashes; the drive letter is lower-cased (Windows is
 * case-insensitive on the drive). Per spec, only the drive letter is folded —
 * the rest of the path keeps its original case.
 * @param {string} p
 * @returns {string}
 */
function normPath(p) {
  return String(p)
    .replace(/\\/g, '/')
    .replace(/^([a-zA-Z]):/, (_m, drive) => drive.toLowerCase() + ':');
}

/**
 * Run a git subcommand in `dir`. Returns trimmed stdout, or null if git exits
 * non-zero / errors (used both for "not a repo" and for check-ignore's exit 1).
 * @param {string} dir
 * @param {string[]} args
 * @returns {string|null}
 */
function git(dir, args) {
  try {
    return execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Decide whether an Edit/Write should be blocked.
 *
 * Order: not-master -> allow; out-of-repo -> allow; gitignored -> allow;
 * otherwise (tracked/in-repo on master) -> block.
 *
 * `branch` is injectable so the decision can be unit-tested for both master and
 * feature-branch states without checking out master. When omitted, the live
 * branch of the repo at `cwd` is used.
 *
 * @param {string} filePath - absolute path of the file being edited
 * @param {string} cwd - working directory of the session (the project repo)
 * @param {string} [branch] - current branch override (for tests)
 * @returns {{ block: boolean, reason: string }}
 */
function decide(filePath, cwd, branch) {
  if (!filePath || !cwd) return { block: false, reason: 'no path/cwd' };

  const currentBranch = branch != null ? branch : git(cwd, ['branch', '--show-current']);
  if (currentBranch !== 'master') {
    return { block: false, reason: `branch '${currentBranch}' is not master` };
  }

  // Resolve the PROJECT repo root from cwd (not from the edited file's dir —
  // that dir may belong to a different repo or none at all).
  const topLevel = git(cwd, ['rev-parse', '--show-toplevel']);
  if (!topLevel) return { block: false, reason: 'cwd is not a git repo' };

  const root = normPath(topLevel);
  const edited = normPath(path.resolve(cwd, filePath));

  // Skip 1: out-of-repo. Trailing-slash boundary so AEGIS != AEGIS-other.
  if (edited !== root && !edited.startsWith(root + '/')) {
    return { block: false, reason: 'path is outside the repo root' };
  }

  // Skip 2: gitignored inside the repo. check-ignore exits 0 when ignored.
  const rel = edited.slice(root.length + 1);
  const ignored = git(root, ['check-ignore', '-q', '--', rel]) !== null;
  if (ignored) {
    return { block: false, reason: 'path is gitignored' };
  }

  return { block: true, reason: 'tracked file under repo root on master' };
}

/**
 * Hook entry point: read the PreToolUse event from stdin, decide, and signal
 * via exit code (0 allow, 2 block + stderr message).
 */
function main() {
  let raw = '';
  try {
    raw = require('fs').readFileSync(0, 'utf8');
  } catch {
    process.exit(0); // no stdin -> nothing to guard
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    process.exit(0); // unparseable -> fail open (never block on malformed input)
  }

  const cwd = (event && event.cwd) || process.cwd();
  const input = event && event.tool_input;
  const patch = input && input.command;
  const filePaths =
    typeof patch === 'string'
      ? [...patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)\r?$/gm)].map(
          (match) => match[1].replace(/\r$/, ''),
        )
      : [];

  for (const filePath of filePaths) {
    const { block } = decide(filePath, cwd);
    if (block) {
      process.stderr.write(
        `Cannot edit on master: ${filePath}\nCreate a feature branch first (feat/* | fix/* | chore/* | docs/*).`,
      );
      process.exit(2);
    }
  }
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { decide, normPath };
