# AEGIS Architecture

## Main Process (src/main/) — НЕ ТРОГАЕМ при Svelte миграции
- main.js — orchestrator, IPC, lifecycle
- preload.js — IPC bridge (window.aegis)
- process-scanner.js — AI agent detection
- process-utils.js — parent chain resolution
- file-watcher.js — chokidar + sensitive files
- network-monitor.js — TCP + DNS
- config-manager.js — settings persistence
- baselines.js — session averages
- anomaly-detector.js — deviation scoring
- ai-analysis.js — Anthropic API
- audit-logger.js — JSONL logs
- exports.js — JSON/CSV/HTML export
- tray-icon.js — system tray

## Renderer (src/renderer/) — МИГРИРУЕМ НА SVELTE
- Старые файлы: 20 JS + 1 HTML + 9 CSS (будут удалены после миграции)
- Новые: Svelte компоненты + Vite build
- src/renderer/app.html — Vite entry point
- src/renderer/main.js — Svelte mount
- src/renderer/App.svelte — root component
- src/renderer/lib/stores/ipc.js — IPC bridge as Svelte stores (agents, events, stats, network, anomalies)
- src/renderer/lib/components/TabBar.svelte — 4-tab pill navigation (Shield/Activity/Rules/Reports)
- src/renderer/lib/components/ShieldTab.svelte — placeholder
- src/renderer/lib/components/ActivityTab.svelte — placeholder
- src/renderer/lib/components/RulesTab.svelte — placeholder
- src/renderer/lib/components/ReportsTab.svelte — placeholder

## Shared (src/shared/)
- constants.js — sensitive rules, ignore patterns
- agent-database.json — 88 agent signatures