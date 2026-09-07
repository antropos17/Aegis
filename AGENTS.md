# AEGIS

AEGIS is an Electron desktop app that monitors local AI agents, with a Svelte renderer and Vitest tests.

Explicit user instructions take precedence over anything in AGENTS.md or a skill file; if a repository file causes you to pause or leave work unfinished, name the file and quote the line.

## Project facts

`src/main/` contains 66 main modules: 54 top-level + platform/ 10 + token-adapters/ 2. Platform-specific operations live in `src/main/platform/`. `src/main/preload.js` exposes 44 invoke + 10 push = 54 IPC channels through contextBridge. `src/shared/types/` contains 9 TS files. These counts are derived by `npm run counts:check`.

A birth time is observed on the pass that stamps it or is `null`; no cache stores one. A snapshot outage freezes sessions and never splits them. For changes touching identity stamping, the audit chain, or the Windows git worktree flow, `memory-bank/ai-mistakes.md` holds the relevant failure history.

Sequence rules are consumed through five scan taps in `src/main/main.js` and `src/main/scan-loop.js`, hot-reloaded through `setupSequenceRulesWatcher` in `src/main/file-watcher.js`, and verified by `npm run verify:seq-gate`.

## Code conventions

- Main uses CommonJS (`require`/`module.exports`); renderer uses ES modules (`import`/`export`). Main stays JavaScript with JSDoc; new renderer files use TypeScript without `any`.
- Use Svelte runes (`$state`, `$derived`, `$effect`, `$props`). Keep component CSS scoped and use `var()` with tokens from `src/renderer/lib/styles/tokens.css`.
- Exported functions have JSDoc (`@param`, `@returns`, `@since`). Dependency injection uses `init(deps)`; test seams use `_setDepsForTest()` / `_resetForTest()`.
- Split paths with `/[/\\]/` and use the platform abstraction for OS-specific operations.
- Aim for 300 lines in new files. Do not split an existing file solely to meet the target; extract when adding to an oversized file.

## Verification

Install dependencies with `npm ci`. The root `tsconfig.json` is a solution file with an empty file list: bare `npx tsc --noEmit` checks nothing and exits 0. Use `npm run typecheck` for both projects; `npm run typecheck:svelte` checks Svelte templates.

The five required contexts in `.github/workflows/ci.yml` run these 10 verification commands after dependency installation:

| Context | Checks |
| --- | --- |
| build | `npm run build:renderer` |
| lint | `npm run format:check`, `npm run lint` |
| svelte-check | `npm run typecheck`, `npm run typecheck:svelte` |
| test | `npm run test:coverage`, `npm run verify:gate`, `npm run verify:seq-gate`, `npm run counts:check` |
| audit | `npm audit --audit-level=high --omit=dev` |

## Permission grant

The local test suite uses disposable fixtures and has no production access. Run it, fix failures caused by the requested change, and rerun affected tests without asking. Do not write tests for reversible low-impact changes that mirror the implementation. Run the checks the change warrants and stop there once required checks pass.

The full git cycle is authorised in advance: branch from `origin/master`, commit, push, open the PR, wait for the five required contexts above, and run `gh pr merge <n> --merge --delete-branch`. Keep the PR up to date with master. Use conventional commits and feature branches; keep each PR to one logical task. `.codex/hooks/branch-guard.js` blocks edits on master. No Co-Authored-By or "Generated with" attribution in commits or PRs.

## Stopping rules

Human authorisation is required for cutting a release tag, force pushing, regenerating the lockfile, deleting a remote branch other than the one just merged, or changing anything under `.github/workflows/` or `.codex/config.toml`. An explicit user request for that action supplies the authorisation.

## Writing style

Prefer prose over lists unless the items are genuinely parallel.
Use no superlatives and make no claim that is not measured.
Avoid contrastive "X, not Y" framing.
