# AEGIS — Independent AI Oversight Layer
Electron 33 + Svelte 5 (runes) + Vite 7. Privacy-first AI agent monitor. v0.10.0-alpha
Landing: aegisprotect.vercel.app | Demo: aegis-demo-ten.vercel.app

## Commands
npm run build:renderer    # Vite build (MUST pass before commit)
npm run lint              # ESLint
npm run format            # Prettier
npm test                  # Vitest (1399 passed / 4 skipped = 1403, 84 files)
npm run dist              # Electron-builder NSIS installer

## Verification — three different counts, do not merge them
**5 required status contexts** are what GitHub enforces on master. Proven with
`gh api repos/antropos17/Aegis/branches/master/protection --jq '.required_status_checks'`
→ contexts `[build, lint, svelte-check, test, audit]`, `strict: true` (branch must be up to
date before merge). No rulesets add more: `/rulesets` and `/rules/branches/master` return `[]`.
A context is a JOB, not a command — `lint` and `svelte-check` run two commands each.

**7 verification commands** live inside those 5 jobs (`.github/workflows/ci.yml`):

| required context | commands the job runs, after `npm ci` |
|---|---|
| build | `npm run build:renderer` |
| lint | `npm run format:check`, then `npm run lint` |
| svelte-check | `npm run typecheck`, then `npm run typecheck:svelte` |
| test | `npm run test:coverage` |
| audit | `npm audit --audit-level=high --omit=dev` |

`format:check` is a STEP of `lint`, not a job and not a context of its own.

## Local pre-merge set — the same 7 commands
npm run build:renderer
npm run format:check      # the checker; `npm run format` WRITES and is not a gate
npm run lint
npm run typecheck         # ONE command, TWO tsc projects: main.json && renderer.json
npm run typecheck:svelte  # svelte-check; tsc never reads .svelte templates
npm run test:coverage     # what CI runs — `npm test` (vitest run) is NOT the CI command
npm audit --audit-level=high --omit=dev   # production deps only, not your diff
Every job also runs `npm ci`, which is not `npm install` — see ai-mistakes 23 before
regenerating a lockfile.

## Background Tasks (/loop)
- /loop 30m — PR triage (pr-monitor skill)
- /loop 2m — CI watcher post-push (ci-monitor skill)
- /loop 1h — stars/issues tracker post-launch

## Critical Rules
1. Read memory-bank/ai-mistakes.md before ANY code change
2. Do ONLY what the prompt says — no extra features, no unrequested changes
3. Main = CJS (require). Renderer = ESM (import). 300 lines/file is a target for NEW files, not an invariant — 18 existing src files already exceed it (largest: file-watcher.js 654, audit-logger.js 600, ipc-handlers.js 503), tests go up to 734. Don't split an existing file just to hit the number; do extract when adding to one that's already over
4. CSS: var() from tokens.css ONLY. Svelte 5 runes only ($state/$derived/$effect)
5. Svelte MCP autofixer on all .svelte files. JSDoc on all exports
6. Conventional commits. NEVER add "Co-Authored-By" or "Generated with Claude Code"
7. Git: powershell.exe -NoProfile -Command "cd 'X:\Future\ESCAPE\AEGIS'; git ..."
8. TypeScript: new files in .ts, `npx eslint` + `npm run typecheck` + `npm run typecheck:svelte` before commit, zero `any`. Root tsconfig.json is a solution file (`files: []` + references) — a bare `npx tsc --noEmit` checks NOTHING and always exits 0; use `npm run typecheck` (both projects) or `npx tsc -b`

## Key Paths
- src/main/ — 47 CommonJS modules (38 top-level + platform/ 7 + token-adapters/ 2)
- src/renderer/ — 46 Svelte 5 components + 11 stores + 16 utils + tokens.css/global.css
- src/shared/ — agent-database.json (110 agents / 262 signatures), types/ (8 TS files), constants.js (ignore patterns, config paths; SENSITIVE_RULES deprecated)
- rules/ — 73 active detection rules in 8 YAML files, validated by rules/_schema.json
- memory-bank/ — ai-mistakes.md (READ FIRST), progress.md, architecture.md
- .claude/skills/ — 11 skills: aegis-context, design-system, electron-main, svelte-patterns, testing, ship, pr-monitor, ci-monitor, prompt-craft, audit-check, commit-and-track
- IPC: preload.js — 40 invoke + 9 push = 49 channels via contextBridge

## MCP & Skills
- Context7 MCP: проверяй доку ПЕРЕД решениями | Svelte MCP: autofixer на .svelte
- Читай .claude/skills/ ПЕРЕД задачей. Логируй [SKILL: name] и [MCP: name]
- НИКОГДА не угадывай API — всегда проверяй

## Agent Fleet
8 subagents in `.claude/agents/`. "read-only" reflects the **frontmatter**, not the
agent's own prose. **enforced** = no Write/Edit tool AND Bash given as scoped
specifiers (only `auditor`). **prompt-only** = read-only held by prompt text while
`tools:` grants bare `Bash` (a full shell) — the harness will NOT block a write/mutation;
only the project-level settings.json `deny` (rm -rf, git push --force, .env reads) is a hard floor.

| Agent | read-only | Purpose | When to call |
|-------|-----------|---------|--------------|
| auditor | **enforced** (no Write/Edit + 6 scoped Bash) | Full health check: test/build/tsc/lint, files >300 lines, TODO/FIXME, git status → READY verdict | Pre-push / pre-release quality gate (`/audit`) |
| architecture-mapper | prompt-only (bare Bash) | Structural map: main/renderer/preload split, detection pipeline, IPC channels, dead code, JS→TS completeness | Before a refactor or release when you need an architecture map |
| security-reviewer | prompt-only (bare Bash) | Electron hardening, IPC surface, secrets-leak trace, Anthropic key handling, dep CVEs (RED/YELLOW/GREEN) | Before any release, dep bump, or IPC/preload/logging/export change |
| test-auditor | prompt-only (bare Bash) | Coverage matrix, untested monitoring/IPC/cross-platform paths, weak/tautological tests | When you need what is actually tested vs untested |
| consistency-reviewer | prompt-only (bare Bash) | Docs-vs-reality: verify 110 agents / 73 rules / <2s boot / CSP / JS-vs-TS / IPC counts | Before README, grant/investor material, or public release |
| researcher | prompt-only (write-block structural via `agent: Explore`; Bash unscoped) | Explore codebase, answer questions with file:line refs | Quick read-only investigation of how something works (`/research`) |
| shipper | **no** — releases via `Bash(git *)` (push/merge) | Release workflow: verify loop, show diff, push/merge/tag, waits for confirmation | Shipping a version (`/ship`) |
| ui-designer | **no** — has `Edit` | Implements Fancy UI Svelte components from the master plan | Any visual/CSS/Svelte component work (`/fancy-ui`) |
