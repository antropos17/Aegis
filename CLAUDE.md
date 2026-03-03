# AEGIS — Independent AI Oversight Layer

Electron 33 + Svelte 5 (runes) + Vite 7. Monitors AI agents on local machines. Privacy-first, no telemetry.

## Commands
npm run build:renderer    # Vite build (MUST pass before commit)
npm run lint              # ESLint
npm run format            # Prettier
npm test                  # Vitest (553 tests, 33 files)
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
12. TypeScript: new files in .ts, run `npx eslint` + `npx tsc --noEmit` before commit, zero `any`

## Key Paths
- src/main/ — 26 CommonJS modules (scanners, watchers, IPC, scoring, zip-writer)
- src/renderer/ — 40 Svelte 5 components + 6 stores + 11 utils + tokens.css/global.css
- src/shared/ — agent-database.json (106 agents), constants.js (70+ rules), types/ (7 TS files)
- memory-bank/ — ai-mistakes.md (READ FIRST), progress.md, architecture.md
- .claude/skills/ — context, design-system, electron-main, svelte-patterns, testing, ship

## IPC Bridge
preload.js — 43 invoke + 11 push channels via contextBridge

## MCP Available
- Context7: fresh docs for any library (append "use context7")
- Svelte MCP: list-sections → get-documentation → svelte-autofixer

## Skills (ОБЯЗАТЕЛЬНО)
- Читай .claude/skills/ ПЕРЕД каждой задачей
- Логируй [SKILL: name] и [MCP: name] в начале ответа
- Context7 MCP: проверяй доку ПЕРЕД решениями по стеку
- Svelte MCP: используй для runes/component вопросов
- НИКОГДА не угадывай API — всегда проверяй
