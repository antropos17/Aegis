# CRITICAL RULES (Always read before ANY code change)

1. Always read memory-bank/ai-mistakes.md before making changes
2. Always read memory-bank/architecture.md before writing code in unfamiliar files
3. After completing a step, update memory-bank/progress.md
4. After adding/removing files, update memory-bank/architecture.md
5. Do NOT change anything I did not ask for. Do ONLY what the prompt says.
6. Do NOT add features I did not request
7. Keep files under 200 lines
8. Use Svelte MCP autofixer before finishing any .svelte file
9. Main process = CommonJS (require/module.exports). Renderer = ES modules (import/export)
10. CSS: scoped styles in .svelte files. No global CSS modifications without explicit request.
11. NEVER add "Co-Authored-By" or "Generated with Claude Code" to commits or PR bodies

---

# AEGIS — Independent AI Oversight Layer

Consumer desktop app monitoring AI agents on local PC. Electron 33 + Svelte 5 + Vite 7. 106 agents in database. 429 tests. All data stays local — no telemetry.

## Tech Stack
Electron 33 | Svelte 5 (runes) | Vite 7 | chokidar@3 | PowerShell (process/network scanning) | JSONL audit logs

## Key Architecture
- **Main process:** 17 CommonJS modules (main.js orchestrator, process-scanner, file-watcher, network-monitor, anomaly-detector, audit-logger, ai-analysis, scan-loop, config-manager, baselines, exports, tray-icon, cli, preload, ipc-handlers, process-utils, llm-runtime-detector)
- **Renderer:** 22 Svelte 5 components, 3 stores (ipc, risk, theme), scoped CSS + tokens.css/global.css
- **Shared:** constants.js (70+ sensitive file rules), agent-database.json (106 agents)
- **IPC:** preload.js bridge — 26 invoke methods + 8 event listeners

## Code Conventions
- Main = CommonJS (`require`/`module.exports`), Renderer = ES modules (`import`/`export`)
- `const` > `let`, never `var`. Template literals for HTML generation
- IPC channels: kebab-case. CSS classes: `component-element`. JSDoc on all exports
- Section comments: `// ═══ SECTION ═══` (major), `// ── sub ──` (minor)
- 200-line soft limit per file. Fonts: Plus Jakarta Sans / DM Sans / DM Mono

## Risk Scoring
Weighted time-decay: sensitive×10, config×5, network×3, unknownDomain×15, files×0.1 (cap 10). Trusted agents get 0.5x. Trust = baseTrust − risk×0.8, graded A+ through F.

## Important Notes
- App MONITORS only — no OS-level enforcement. Permission states affect UI display only.
- Windows-focused (tasklist + PowerShell). Mac/Linux planned.
- `agent-database.json` at `src/shared/`, read by process-scanner and network-monitor.
- AI analysis calls Anthropic API only on explicit user action. No background API calls.

## Positioning
Consumer: free open-source desktop monitor (MIT). Government: Canadian AI Agent Audit Platform. No competitors monitor what agents DO on local machines.
