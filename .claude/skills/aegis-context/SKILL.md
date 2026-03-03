---
name: aegis-context
description: AEGIS project context — 106 agents, Electron 33, Svelte 5 + TypeScript, 479 tests. Triggers on any AEGIS task.
---

# AEGIS Context

## Project
AEGIS — Independent AI Oversight Layer (Electron desktop)
Repo: github.com/antropos17/Aegis | Version: 0.3.1-alpha

## Stack
Read package.json for exact versions. NEVER hardcode.
Electron 33, Svelte 5, Vite 7, TypeScript (incremental, allowJs:true, checkJs:true), chokidar.

## TypeScript Status (P5-B.0 DONE)
- tsconfig.json (base) + tsconfig.main.json (checkJs:true) + tsconfig.renderer.json
- 34 shared type definitions in src/shared/types/ (agent, config, events, ipc, process, risk)
- Main process: .js + JSDoc annotations (CJS, checkJs validates types)
- Renderer: .ts/.svelte (ESM)
- ESLint TS plugin active (@typescript-eslint), zero `any` enforced
- tsc --noEmit: 0 errors

## Architecture
- Main process (Node.js): src/main/ — 21 CommonJS modules (scanners, watchers, IPC, scoring, logging, zip-writer)
- Renderer (Svelte 5): src/renderer/ — 32 components + 5 stores via IPC bridge
- Bridge: src/main/preload.js — contextBridge, 43 invoke methods + 10 event channels
- Data: src/shared/agent-database.json (106 agent signatures)
- Config: src/shared/constants.js (70+ sensitive patterns)
- Types: src/shared/types/ — 7 .ts files, 34 type definitions
- Tests: 489 pass, 4 skip across 28 files (Vitest, all ESM)

## Boot Performance
- Production start: ~439ms (dev server fallback eliminated in dbe466e)
- Deferred file watchers + lazy-loaded modules keep critical path fast

## MCP
- Context7: fresh docs for any library (append "use context7")
- Svelte MCP: list-sections, get-documentation, svelte-autofixer

## Rules
- Trust code over docs. Read before changing.
- New files MUST be .ts. Convert JS to TS on touch.
- Svelte 5 runes ($state, $derived, $effect). No legacy syntax.
- Main process: CommonJS (require/module.exports). Renderer: ES modules.
- IPC: all channels through preload.js contextBridge
- Max 300 lines per file (soft limit). Early returns. Named exports.
- npm (not pnpm). Windows: ";" not "&&" in PowerShell.
- Conventional commits (feat/fix/refactor/docs/chore). No Co-Authored-By.
- Run Svelte MCP autofixer on all .svelte files before finishing.

## Next Priorities
- P2.5: Refactor large modules (main.js, risk-scoring)
- P5-B.1: child_process hardening (spawn → execFile, input validation)
