# AGENTS.md

> Instructions for AI agents contributing to this codebase.

## Project overview

AEGIS is an independent AI oversight layer — a desktop app that monitors AI agents running on a user's local machine. Electron 33 + Svelte 5 + Vitest.

## Architecture

```
src/main/           Electron main process (CommonJS, require/module.exports)
src/renderer/       Svelte 5 dashboard UI (ES modules, runes)
src/shared/         Constants + agent-database.json (110 agents, 262 name signatures) + types/ (9 .ts)
rules/              73 detection rules in 8 YAML files + _schema.json
tests/              Vitest unit tests with v8 coverage
```

Key modules:
- `src/main/scan-loop.js` — core scanning pipeline (process + file + network + LLM probing)
- `src/main/process-scanner.js` — AI agent detection via process list
- `src/main/anomaly-detector.js` — multi-dimensional anomaly scoring (network/fs/process/baseline)
- `src/main/llm-runtime-detector.js` — local LLM runtime detection (Ollama, LM Studio HTTP probes)
- `src/main/cli.js` — CLI interface (`--scan-json`, `--version`, `--help`)
- `src/main/platform/` — OS abstraction (win32.js, darwin.js, linux.js)
- `src/shared/agent-database.json` — 110 known agents; their `names` arrays hold 262 process-name signatures in total
- `src/main/rule-loader.js` — loads `rules/*.yaml` (73 rules, 8 categories) against `rules/_schema.json`, hot-reload
- `src/shared/constants.js` — ignore patterns, editor lists, AGENT_CONFIG_PATHS

## Build & test

```sh
npm ci                   # what CI installs with — NOT npm install, see the lockfile note below
npm run build:renderer   # Vite build — must succeed
npm run format:check     # Prettier — must be clean (the WRITING variant is npm run format)
npm run lint             # ESLint — no errors
npm run typecheck        # one command, two tsc projects: tsconfig.main.json && tsconfig.renderer.json
npm run typecheck:svelte # svelte-check — reads .svelte templates, which tsc never does
npm run test:coverage    # vitest run --coverage — this, not npm test, is what CI runs
npm run verify:gate      # injection proof: 4 mutants must turn the witness suite red
npm run counts:check     # derived counts vs the numbers tracked files declare
npm audit --audit-level=high --omit=dev   # production dependencies only
```

Three counts, deliberately kept apart:

- **5 required status contexts** — `build`, `lint`, `svelte-check`, `test`, `audit`. This is
  what GitHub blocks a merge on, proven by
  `gh api repos/antropos17/Aegis/branches/master/protection --jq '.required_status_checks'`
  (`strict: true`, so the branch must also be up to date). `/rulesets` and
  `/rules/branches/master` both return `[]` — nothing else is enforced.
- **9 verification commands** inside those 5 jobs. The counts differ because `lint` runs
  `format:check` then `lint`, `svelte-check` runs `typecheck` then `typecheck:svelte`, and
  `test` runs `test:coverage`, `verify:gate`, then `counts:check`. `format:check` is a step,
  not a job, and has no status context of its own.
- **9 local pre-merge commands** — the block above, one per verification command.

`npm test` (`vitest run`) is a convenience alias, not a gate: CI runs `npm run test:coverage`
(`vitest run --coverage`). Same suite, plus v8 instrumentation and an lcov artifact. No
coverage thresholds are configured in `vitest.config.js`, so coverage cannot fail a run that
`npm test` would pass — but document what CI executes, not what is close to it.

## Code conventions

- 300 lines/file is a target for NEW files, not an invariant — 30 existing src files already exceed it (`npm run counts:check` prints the current largest src and test files). Don't split an existing file just to hit the number; do extract when adding to one that's already over
- **Main process:** CommonJS (`require`/`module.exports`). Never use `import` in `src/main/`.
- **Renderer:** ES modules (`import`/`export`). Never use `require()` in `src/renderer/`.
- **Svelte 5 runes:** `$state`, `$derived`, `$effect`, `$props`. No legacy `let` reactivity.
- **JSDoc** on all exported functions (`@param`, `@returns`, `@since`).
- **DI pattern:** Modules expose `init(deps)` for wiring. Tests use `_setDepsForTest()` / `_resetForTest()`.
- **Paths:** Always split with `/[/\\]/` — never hardcode `/` or `\\` alone.
- **TypeScript:** 31 `.ts` files exist (renderer stores/utils + `src/shared/types/`). New renderer files go in `.ts`, zero `any`, `npm run typecheck` before commit. `src/main/` stays plain JS + JSDoc until the tsc build step lands.
- **Prettier:** semi, singleQuote, trailingComma: all, printWidth: 100, tabWidth: 2.
- **CSS:** Scoped styles in `.svelte` files. Global tokens in `src/renderer/lib/styles/tokens.css`. Use `var()` references, not raw colors.

## Git conventions

- **Conventional commits:** `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `style:`, `test:`
- **Feature branches, always:** `feat/*` | `fix/*` | `chore/*` | `docs/*` → push → PR. One PR = one logical task.
- **Merge commits only.** Squash and rebase are disabled on the repository, so `gh pr merge <n> --merge --delete-branch` is the only available method and every merge lands as a two-parent commit. Squash the noisy commits on your own branch *before* opening the PR — the merge will not do it for you.
- **Direct commits to master are impossible, not merely discouraged.** `master` requires a pull request plus green `audit` / `build` / `lint` / `svelte-check` / `test`, with admin enforcement on, so a local commit on master cannot be pushed at all. `.claude/hooks/branch-guard.js` refuses edits on master before you reach that point.
- **No Co-Authored-By lines.** No "Generated with" attribution in commits or PRs.

## What NOT to do

- Don't convert `src/main/` to TypeScript — main stays plain JS + JSDoc until the tsc build step lands
- Don't use `require()` in `src/renderer/` — ES modules only
- Don't use `import` in `src/main/` — CommonJS only
- Don't hardcode OS paths — use `src/main/platform/` abstraction
- Don't skip tests — every new module needs a test file in `tests/`
- Don't add features not explicitly requested
- Don't modify files not mentioned in the task
- Don't let a new file blow past 300 lines — extract instead
