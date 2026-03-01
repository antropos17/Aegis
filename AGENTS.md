# AGENTS.md

> Instructions for AI agents contributing to this codebase.

## Project overview

AEGIS is an independent AI oversight layer — a desktop app that monitors AI agents running on a user's local machine. Electron 33 + Svelte 5 + Vitest.

## Architecture

```
src/main/           Electron main process (CommonJS, require/module.exports)
src/renderer/       Svelte 5 dashboard UI (ES modules, runes)
src/shared/         Constants + agent-database.json (106 agent signatures)
tests/              Vitest unit tests with v8 coverage
```

Key modules:
- `src/main/scan-loop.js` — core scanning pipeline (process + file + network + LLM probing)
- `src/main/process-scanner.js` — AI agent detection via process list
- `src/main/anomaly-detector.js` — multi-dimensional anomaly scoring (network/fs/process/baseline)
- `src/main/llm-runtime-detector.js` — local LLM runtime detection (Ollama, LM Studio HTTP probes)
- `src/main/cli.js` — CLI interface (`--scan-json`, `--version`, `--help`)
- `src/main/platform/` — OS abstraction (win32.js, darwin.js, linux.js)
- `src/shared/agent-database.json` — 106 known agent signatures
- `src/shared/constants.js` — sensitive file rules (70+ patterns)

## Build & test

```sh
npm install
npm test              # Vitest — all tests must pass
npm run build:renderer # Vite build — must succeed
npm run format:check  # Prettier — must be clean
```

CI runs all three on every push and PR (`.github/workflows/ci.yml`).

## Code conventions

- **Max 200 lines per file.** Split into focused modules when exceeding.
- **Main process:** CommonJS (`require`/`module.exports`). Never use `import` in `src/main/`.
- **Renderer:** ES modules (`import`/`export`). Never use `require()` in `src/renderer/`.
- **Svelte 5 runes:** `$state`, `$derived`, `$effect`, `$props`. No legacy `let` reactivity.
- **JSDoc** on all exported functions (`@param`, `@returns`, `@since`).
- **DI pattern:** Modules expose `init(deps)` for wiring. Tests use `_setDepsForTest()` / `_resetForTest()`.
- **Paths:** Always split with `/[/\\]/` — never hardcode `/` or `\\` alone.
- **No TypeScript.** This project uses plain JS + JSDoc.
- **Prettier:** semi, singleQuote, trailingComma: all, printWidth: 100, tabWidth: 2.
- **CSS:** Scoped styles in `.svelte` files. Global tokens in `src/renderer/lib/styles/tokens.css`. Use `var()` references, not raw colors.

## Git conventions

- **Conventional commits:** `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `style:`, `test:`
- **Feature branches:** `feat/feature-name` → PR → squash merge to `master`
- **Direct commits to master:** OK for `docs:` and `chore:` only
- **No Co-Authored-By lines.** No "Generated with" attribution in commits or PRs.

## What NOT to do

- Don't use TypeScript — project is plain JS + JSDoc
- Don't use `require()` in `src/renderer/` — ES modules only
- Don't use `import` in `src/main/` — CommonJS only
- Don't hardcode OS paths — use `src/main/platform/` abstraction
- Don't skip tests — every new module needs a test file in `tests/`
- Don't add features not explicitly requested
- Don't modify files not mentioned in the task
- Don't exceed 200 lines per file
