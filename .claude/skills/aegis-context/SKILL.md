---
name: aegis-context
description: Aegis project context — 106 agents, Electron 33, Svelte 5 + TypeScript, 507 tests. Auto-invoked on any Aegis task.
---

# AEGIS Context

## Project
AEGIS — Independent AI Oversight Layer (Electron desktop)
Repo: github.com/antropos17/Aegis | Version: 0.5.0-alpha
Current Focus: Fancy UI Redesign (feat/fancy-ui branch)

## Stack
Read package.json for exact versions. NEVER hardcode.
Electron 33, Svelte 5, Vite 7, TypeScript (incremental, allowJs:true, checkJs:true), chokidar.

## Architecture
- Main process (Node.js): src/main/ — 21 CJS modules (scanners, watchers, IPC, scoring, logging)
- Renderer (Svelte 5): src/renderer/ — ~41 components + 6 stores via IPC bridge
- Bridge: src/main/preload.js — contextBridge, 43 invoke + 10 push channels
- Data: src/shared/agent-database.json (106 agent signatures)
- Config: src/shared/constants.js (70+ sensitive patterns)
- Types: src/shared/types/ — 7 .ts files, 39 type definitions
- Tests: 507 pass, 4 skip across 29 files (Vitest, all ESM)

## Key Files
- FANCY-AEGIS-MASTER-PLAN.md — UI redesign spec (current focus)
- design/mockup-shield.html — visual reference
- src/renderer/lib/styles/tokens.css — design tokens
- src/shared/constants.js — ~70 SENSITIVE_RULES

## MCP
- Context7: fresh docs for any library (append "use context7")
- Svelte MCP: list-sections, get-documentation, svelte-autofixer

## Commands
- /fancy-ui F#.# — run UI phase via ui-designer agent
- /audit — full health check via auditor agent
- /ship v#.#.# — release workflow via shipper agent
- /research "query" — explore codebase (read-only)
