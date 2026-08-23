# AEGIS — Independent AI Oversight Layer
Electron 33 + Svelte 5 (runes) + Vite 7. Privacy-first AI agent monitor.
Version is not quoted here — it goes stale the moment it is bumped:
`node -p "require('./package.json').version"`
Landing: aegisprotect.vercel.app | Demo: aegis-demo-ten.vercel.app

## Commands
npm run build:renderer    # Vite build (MUST pass before commit)
npm run lint              # ESLint
npm run format            # Prettier
npm test                  # Vitest — the suite prints its own counts; do not copy them here
npm run verify:gate       # Injection proof: 4 mutants (witness gate + birth-time freshness) must go red
npm run counts:check      # Every counted fact derived from the tree; a stale declaration is red
npm run dist              # Electron-builder NSIS installer

## Verification — three different counts, do not merge them
**5 required status contexts** are what GitHub enforces on master. Proven with
`gh api repos/antropos17/Aegis/branches/master/protection --jq '.required_status_checks'`
→ contexts `[build, lint, svelte-check, test, audit]`, `strict: true` (branch must be up to
date before merge). No rulesets add more: `/rulesets` and `/rules/branches/master` return `[]`.
A context is a JOB, not a command — `lint` and `svelte-check` run two commands each.

**9 verification commands** live inside those 5 jobs (`.github/workflows/ci.yml`):

| required context | commands the job runs, after `npm ci` |
|---|---|
| build | `npm run build:renderer` |
| lint | `npm run format:check`, then `npm run lint` |
| svelte-check | `npm run typecheck`, then `npm run typecheck:svelte` |
| test | `npm run test:coverage`, `npm run verify:gate`, then `npm run counts:check` |
| audit | `npm audit --audit-level=high --omit=dev` |

`format:check` is a STEP of `lint`, and `verify:gate` and `counts:check` are STEPS of `test` —
none is a job, and none is a context of its own.

## Local pre-merge set — the same 9 commands
npm run build:renderer
npm run format:check      # the checker; `npm run format` WRITES and is not a gate
npm run lint
npm run typecheck         # ONE command, TWO tsc projects: main.json && renderer.json
npm run typecheck:svelte  # svelte-check; tsc never reads .svelte templates
npm run test:coverage     # what CI runs — `npm test` (vitest run) is NOT the CI command
npm run verify:gate       # a STEP of the `test` job: a surviving mutant fails that context
npm run counts:check      # a STEP of the `test` job: derives every counted fact from the tree
npm audit --audit-level=high --omit=dev   # production deps only, not your diff
Every job also runs `npm ci`, which is not `npm install` — see ai-mistakes 23 before
regenerating a lockfile.

## Background Tasks (/loop)
- /loop 30m — PR triage (pr-monitor skill)
- /loop 2m — CI watcher post-push (ci-monitor skill)
- /loop 1h — stars/issues tracker post-launch

## Identity freshness — structural, do not regress (PR #236–#238, master `b62729f`)
- **A birth time is observed on the pass that stamps it, or it is `null`.** No cache stores one:
  `getParentChains` can answer a full hit without calling the provider, so `_stampFromCachedChains`
  stamps `startTime = null` unconditionally, and that path can only produce the honest `<pid>:u`.
  `git ls-files -z src | xargs -0 grep -nE 'cached[.]startTime|entry[.]startTime'` → no hits under `src/`; that
  emptiness IS the guarantee. Do not reintroduce the field "just for the chain".
- **`verify:gate` is 4 mutants over TWO properties** — m1–m3 the witness comparison (may a cached
  chain or cwd be reused), m4 freshness (did the stamped birth time come from this pass's map). It
  prints each listed suite's role and REFUSES to report at all if no listed suite resolves
  `AEGIS_PU_UNDER_TEST`: a kill by a suite that never loaded the mutant is not a kill.
- **A snapshot outage FREEZES sessions, it never splits them.** `isIdentityDegraded()`
  (process-scanner.js) = `providesStartTime === true && identityQuality === 'unknown'`; scan-loop
  reads it AFTER the identity stamp and `reconcile` treats it exactly like `!reliable` — no enters,
  no exits, no aging, plus a `scan/session-freeze` log line. The CIM fallback (`birth-time`) is NOT
  degradation. linux/darwin are untouched: `<pid>:u` is their steady state, not a fault.

## Critical Rules
1. Read memory-bank/ai-mistakes.md before ANY code change
2. Do ONLY what the prompt says — no extra features, no unrequested changes
3. Main = CJS (require). Renderer = ESM (import). 300 lines/file is a target for NEW files, not an invariant — 30 existing src code files already exceed it (`git ls-files -z src | xargs -0 wc -l`, `.json` excluded; `npm run counts:check` prints the current largest src and test files). Don't split an existing file just to hit the number; do extract when adding to one that's already over
4. CSS: var() from tokens.css ONLY. Svelte 5 runes only ($state/$derived/$effect)
5. Svelte MCP autofixer on all .svelte files. JSDoc on all exports
6. Conventional commits. NEVER add "Co-Authored-By" or "Generated with Claude Code"
7. Git: powershell.exe -NoProfile -Command "cd '<repo-root>'; git ..."
8. TypeScript: new files in .ts, `npx eslint` + `npm run typecheck` + `npm run typecheck:svelte` before commit, zero `any`. Root tsconfig.json is a solution file (`files: []` + references) — a bare `npx tsc --noEmit` checks NOTHING and always exits 0; use `npm run typecheck` (both projects) or `npx tsc -b`

## Key Paths
- src/main/ — 53 CommonJS modules (41 top-level + platform/ 10 + token-adapters/ 2)
- src/renderer/ — Svelte 5 components + stores + utils + tokens.css/global.css
  (count: `git ls-files 'src/renderer/**/*.svelte' | wc -l`)
- src/shared/ — agent-database.json (110 agents / 262 signatures), types/ (9 TS files), constants.js (ignore patterns, config paths)
- rules/ — 73 active detection rules in 8 YAML files, validated by rules/_schema.json
- memory-bank/ — ai-mistakes.md (READ FIRST), progress.md, architecture.md
- .claude/skills/ — 11 skills: aegis-context, design-system, electron-main, svelte-patterns, testing, ship, pr-monitor, ci-monitor, prompt-craft, audit-check, commit-and-track
- IPC: preload.js — 40 invoke + 9 push = 49 channels via contextBridge

## MCP & Skills
- Context7 MCP: check the docs BEFORE deciding | Svelte MCP: autofixer on .svelte
- Read .claude/skills/ BEFORE a task. Log [SKILL: name] and [MCP: name]
- NEVER guess an API — always verify

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
