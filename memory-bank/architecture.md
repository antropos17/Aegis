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
- src/renderer/lib/stores/ipc.js — IPC bridge as Svelte stores (agents, events, stats, network, anomalies, resourceUsage)
- src/renderer/lib/styles/tokens.css — M3 design tokens (colors, typography, shape, motion)
- src/renderer/lib/components/Header.svelte — fixed top bar: shield score, agents, files, uptime pills (M3 tokens)
- src/renderer/lib/components/Footer.svelte — fixed bottom bar: CPU, memory, heap, scan interval (M3 tokens)
- src/renderer/lib/components/TabBar.svelte — 4-tab pill navigation (Shield/Activity/Rules/Reports)
- src/renderer/lib/components/AgentCard.svelte — individual agent card: name, PID, trust grade badge, risk score, trust bar, parent chain
- src/renderer/lib/components/AgentPanel.svelte — scrollable agent list from agents store, empty state
- src/renderer/lib/components/ShieldTab.svelte — AgentPanel (full width, radar comes later)
- src/renderer/lib/components/ActivityTab.svelte — placeholder
- src/renderer/lib/components/RulesTab.svelte — placeholder
- src/renderer/lib/components/ReportsTab.svelte — placeholder

## Shared (src/shared/)
- constants.js — sensitive rules, ignore patterns
- agent-database.json — 88 agent signatures