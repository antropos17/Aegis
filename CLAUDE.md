# AEGIS — Independent AI Oversight Layer

Electron 33 + Svelte 5 (runes) + Vite 7. Monitors AI agents on local machines. Privacy-first, no telemetry.

## Commands
npm run build:renderer    # Vite build (MUST pass before commit)
npm run lint              # ESLint
npm run format            # Prettier
npm test                  # Vitest (475 tests, 28 files)
npm run dist              # Electron-builder NSIS installer

## Critical Rules
1. Read memory-bank/ai-mistakes.md before ANY code change
2. Do ONLY what the prompt says — no extra features, no unrequested changes
3. Main = CommonJS (require). Renderer = ES modules (import)
4. Max 200 lines per file. Split if exceeded
5. CSS: var() from tokens.css ONLY. Never hardcode colors
6. Svelte 5 runes: $state, $derived, $effect. No legacy syntax
7. Use Svelte MCP autofixer on all .svelte files before finishing
8. JSDoc on all exported functions
9. Conventional commits: feat/fix/refactor/docs/chore
10. NEVER add "Co-Authored-By" or "Generated with Claude Code" to commits
11. Git: powershell.exe -NoProfile -Command "cd 'X:\Future\ESCAPE\AEGIS'; git ..."

## Key Paths
- src/main/ — 20 CommonJS modules (scanners, watchers, IPC, scoring)
- src/renderer/ — 32 Svelte 5 components + 6 stores + tokens.css/global.css
- src/shared/ — agent-database.json (106 agents), constants.js (70+ rules)
- memory-bank/ — ai-mistakes.md (READ FIRST), progress.md, architecture.md
- .claude/skills/ — orchestrator, context, audit, ship

## IPC Bridge
preload.js — 40 invoke methods + 9 event channels via contextBridge

## MCP Available
- Context7: fresh docs for any library (append "use context7")
- Svelte MCP: list-sections → get-documentation → svelte-autofixer
