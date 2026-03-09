# AEGIS — Independent AI Oversight Layer
Electron 33 + Svelte 5 (runes) + Vite 7. Privacy-first AI agent monitor. v0.10.0-alpha
Landing: aegisprotect.vercel.app | Demo: aegis-demo-ten.vercel.app

## Commands
npm run build:renderer    # Vite build (MUST pass before commit)
npm run lint              # ESLint
npm run format            # Prettier
npm test                  # Vitest (707 tests, 44 files)
npm run dist              # Electron-builder NSIS installer

## Background Tasks (/loop)
- /loop 30m — PR triage (pr-monitor skill)
- /loop 2m — CI watcher post-push (ci-monitor skill)
- /loop 1h — stars/issues tracker post-launch

## Critical Rules
1. Read memory-bank/ai-mistakes.md before ANY code change
2. Do ONLY what the prompt says — no extra features, no unrequested changes
3. Main = CJS (require). Renderer = ESM (import). Max 300 lines/file
4. CSS: var() from tokens.css ONLY. Svelte 5 runes only ($state/$derived/$effect)
5. Svelte MCP autofixer on all .svelte files. JSDoc on all exports
6. Conventional commits. NEVER add "Co-Authored-By" or "Generated with Claude Code"
7. Git: powershell.exe -NoProfile -Command "cd 'X:\Future\ESCAPE\AEGIS'; git ..."
8. TypeScript: new files in .ts, `npx eslint` + `npx tsc --noEmit` before commit, zero `any`

## Key Paths
- src/main/ — 23 CommonJS modules (scanners, watchers, IPC, scoring, zip-writer)
- src/renderer/ — 43 Svelte 5 components + 9 stores + 15 utils + tokens.css/global.css
- src/shared/ — agent-database.json (107 agents), constants.js (68 rules), types/ (8 TS files)
- memory-bank/ — ai-mistakes.md (READ FIRST), progress.md, architecture.md
- .claude/skills/ — 9 skills: context, design-system, electron-main, svelte-patterns, testing, ship, pr-monitor, ci-monitor, prompt-craft
- IPC: preload.js — 43 invoke + 6 push channels via contextBridge

## MCP & Skills
- Context7 MCP: проверяй доку ПЕРЕД решениями | Svelte MCP: autofixer на .svelte
- Читай .claude/skills/ ПЕРЕД задачей. Логируй [SKILL: name] и [MCP: name]
- НИКОГДА не угадывай API — всегда проверяй
