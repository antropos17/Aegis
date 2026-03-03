# AEGIS Context

## Project
AEGIS — Independent AI Oversight Layer (Electron desktop)
Repo: github.com/antropos17/Aegis | Version: 0.5.0-alpha

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
- Tests: 553 pass, 4 skip across 33 files (Vitest, all ESM)

## MCP
- Context7: fresh docs for any library (append "use context7")
- Svelte MCP: list-sections, get-documentation, svelte-autofixer

## Rules
- Trust code over docs. Read before changing.
- New files MUST be .ts. Convert JS to TS on touch.
- Svelte 5 runes ($state, $derived, $effect). No legacy syntax.
- Main process: CommonJS (require/module.exports). Renderer: ES modules.
- IPC: all channels through preload.js contextBridge
- Max 200 lines per file (soft limit). Early returns. Named exports.
- npm (not pnpm). Windows: ";" not "&&" in PowerShell.
- Conventional commits (feat/fix/refactor/docs/chore). No Co-Authored-By.
- Run Svelte MCP autofixer on all .svelte files before finishing.
