---
name: aegis-context
description: AEGIS project context — 106 agents, Electron 33, Svelte 5 + TypeScript, 568 tests. Auto-invoked on any AEGIS task.
---

# AEGIS Context

## Project
AEGIS — Independent AI Oversight Layer (Electron desktop)
Repo: github.com/antropos17/Aegis | Version: 0.7.0-alpha
Current Focus: Post-release polish, tech debt cleanup

## Stack
Read package.json for exact versions. NEVER hardcode.
Electron 33, Svelte 5, Vite 7, TypeScript (incremental, allowJs:true, checkJs:true), chokidar.

## Architecture
- Main process (Node.js): src/main/ — 26 CJS modules (scanners, watchers, IPC, scoring, logging)
- Renderer (Svelte 5): src/renderer/ — 40 components + 6 stores + 11 utils via IPC bridge
- Bridge: src/main/preload.js — contextBridge, 43 invoke + 11 push channels
- Data: src/shared/agent-database.json (106 agent signatures)
- Config: src/shared/constants.js (70+ sensitive patterns)
- Types: src/shared/types/ — 7 .ts files, 39 type definitions
- Tests: 568 pass, 4 skip across 34 files (Vitest, all ESM)

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

## Commands
- /audit — full health check via auditor agent
- /ship v#.#.# — release workflow via shipper agent
- /research "query" — explore codebase (read-only)
