---
name: aegis-context
description: AEGIS project context — 107 agents, Electron 33, Svelte 5 + TypeScript, 593 tests. Auto-invoked on any AEGIS task.
---

# AEGIS Context

## Project
AEGIS — Independent AI Oversight Layer (Electron desktop)
Repo: github.com/antropos17/Aegis | Version: 0.8.2-alpha
Current Focus: Post-release polish, tech debt cleanup

## Stack
Read package.json for exact versions. NEVER hardcode.
Electron 33, Svelte 5, Vite 7, TypeScript (incremental, allowJs:true, checkJs:true), chokidar.

## Architecture
- Main process (Node.js): src/main/ — 26 CJS modules (scanners, watchers, IPC, scoring, logging)
- Renderer (Svelte 5): src/renderer/ — 40 components + 6 stores + 11 utils via IPC bridge
- Bridge: src/main/preload.js — contextBridge, 43 invoke + 11 push channels
- Data: src/shared/agent-database.json (107 agent signatures)
- Config: src/shared/constants.js (70+ sensitive patterns)
- Types: src/shared/types/ — 7 .ts files, 39 type definitions
- Tests: 593 pass, 4 skip across 35 files (Vitest, all ESM)

## Key Components (Fancy UI — complete)
- ShieldTab: bento grid with SummaryCards, RiskRing, ActivityFeed
- SummaryCards: animated counters + trend arrows
- Sparkline: pure SVG mini charts
- TrustBadge: color-coded trust level indicator
- RiskRing: SVG gauge with glow + pulse animation
- AgentCard: sparkline + badge + spotlight hover
- FooterMiniCharts: CPU/memory sparklines in footer
- TabBar: sliding indicator + tab transitions
- VisTimeline, AgentGraph, EventFeed, AgentStatsPanel

## Key Files
- src/renderer/lib/styles/tokens.css — 60+ design tokens (Fancy UI)
- src/renderer/lib/styles/global.css — atmosphere, fonts, resets
- src/shared/constants.js — ~70 SENSITIVE_RULES

## MCP
- Context7: fresh docs for any library (append "use context7")
- Svelte MCP: list-sections, get-documentation, svelte-autofixer

## Skills (.claude/skills/)
- aegis-context — project overview, auto-invoked on any task
- design-system — Fancy UI tokens, typography, glassmorphism, animation rules
- electron-main — CJS modules, platform abstraction, IPC, file watchers
- svelte-patterns — Svelte 5 runes, component patterns, template directives
- testing — Vitest patterns, ESM imports, mocking, test structure
- pr-monitor — PR triage, contributor management, /loop monitoring
- ci-monitor — CI watching, repo health, post-launch metrics

## Commands
- /audit — full health check via auditor agent
- /ship v#.#.# — release workflow via shipper agent
- /research "query" — explore codebase (read-only)
