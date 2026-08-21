---
name: aegis-context
description: >-
  AEGIS project context — Electron desktop app for AI agent monitoring with Svelte 5 renderer.
  Provides architecture map, module locations, IPC channels, component inventory, and coding conventions.
  MUST be invoked before working on any AEGIS source file: editing scanners, watchers, or scoring in src/main/;
  modifying Svelte components, stores, or utils in src/renderer/; updating agent-database.json, constants.js,
  or types in src/shared/; adding IPC channels to preload.js; debugging anomaly-detector, rule-loader,
  network-monitor, or process-scanner; writing tests; or asking how AEGIS architecture works.
  Skip only for trivial one-line fixes (typos, renames) and bare git/npm commands.
---

# AEGIS Context

## Project
AEGIS — Independent AI Oversight Layer (Electron desktop)
Repo: github.com/antropos17/Aegis | Version: 0.10.0-alpha
Current Focus: read `memory-bank/progress.md` — it is the live record. Do not restate it here; a copy goes stale silently.

## Stack
Read package.json for exact versions. NEVER hardcode.
Electron 33, Svelte 5, Vite 7, chokidar. TypeScript: `allowJs: true`, **`checkJs: false`** — `src/main/*.js` bodies are NOT type-checked, their JSDoc is documentation. Two projects (`tsconfig.main.json` CommonJS / `tsconfig.renderer.json` ESM) share `tsconfig.base.json`; root `tsconfig.json` is a solution file, so gate with `npm run typecheck`, never a bare `npx tsc --noEmit`.

## Architecture
- Main process (Node.js): src/main/ — 51 CJS modules (39 top-level + 10 platform/ + 2 token-adapters/)
- Renderer (Svelte 5): src/renderer/ — 47 components + 13 stores + 21 utils via IPC bridge
- Bridge: src/main/preload.js — contextBridge, 40 invoke + 9 push = 49 channels
- Data: src/shared/agent-database.json (110 agents / 262 name signatures)
- Rules: rules/*.yaml — 73 active rules across 8 categories, validated against rules/_schema.json
- Rule loader: src/main/rule-loader.js — loadRules() + categoryIndex Map exposed via getRulesByCategory(); built and tested, but no production caller consumes it yet (C-16)
- Types: src/shared/types/ — 8 .ts files
- Tests: 1075 pass, 4 skip (1079 total) across 68 files (Vitest, all ESM)

## Key Components (Fancy UI — complete)
- ShieldTab: bento grid with SummaryCards, RiskRing, ActivityFeed
- SummaryCards: animated counters + trend arrows
- Sparkline: pure SVG mini charts
- TrustBadge: color-coded trust level indicator
- RiskRing: SVG gauge with glow + pulse animation
- AgentCard: sparkline + badge + spotlight hover
- FooterMiniCharts: CPU/memory sparklines in footer
- TabBar: sliding indicator + tab transitions
- Timeline (+ TimelineCanvas/Controls/Legend/Tooltip), ActivityFeed, GroupedFeed (+ GroupedFeedItem), FeedFilters, AgentPanel, AgentStatsPanel

## Key Files
- src/renderer/lib/styles/tokens.css — 60+ design tokens (Fancy UI)
- src/renderer/lib/styles/global.css — atmosphere, fonts, resets
- src/shared/constants.js — ignore patterns, editor lists, AGENT_CONFIG_PATHS. SENSITIVE_RULES (68) is DEPRECATED and unused at runtime — classifySensitive() reads getAllRules() from rule-loader

## MCP
- Context7: fresh docs for any library (append "use context7")
- Svelte MCP: list-sections, get-documentation, svelte-autofixer

## Skills (.claude/skills/)
- aegis-context — project overview, auto-invoked on any task
- design-system — Fancy UI tokens, typography, glassmorphism, animation rules
- electron-main — CJS modules, platform abstraction, IPC, file watchers
- svelte-patterns — Svelte 5 runes, component patterns, template directives
- testing — Vitest patterns, ESM imports, mocking, test structure
- prompt-craft — prompt formula for Claude Code and Antigravity
- pr-monitor — PR triage, contributor management, /loop monitoring
- ci-monitor — CI watching, repo health, post-launch metrics
- audit-check — pre-push / pre-release repo audit (format, build, lint, counts, git status)
- commit-and-track — post-task gate: verify, stage only touched files, conventional commit, push to feature branch
- ship — full deploy pipeline (manual invocation only)

## Commands
- /audit — full health check via auditor agent
- /ship v#.#.# — release workflow via shipper agent
- /research "query" — explore codebase (read-only)
