# AEGIS Architecture

## Main Process (src/main/) — 53 CommonJS modules (41 top-level + 10 platform/ + 2 token-adapters/)

Core modules:
- main.js — orchestrator, module wiring, lifecycle
- scan-loop.js — periodic scan intervals, staggered startup, event dedup
- ipc-batcher.js — batches high-frequency IPC events (append/latest modes)
- ipc-handlers.js — all IPC handlers (invoke + listeners)
- preload.js — IPC bridge (window.aegis via contextBridge, 40 invoke + 9 events = 49 channels)
- process-scanner.js — AI agent detection (tasklist + pattern matching)
- process-utils.js — parent chain resolution + editor annotation
- file-watcher.js — chokidar watchers + handle scanning
- network-monitor.js — TCP scanning + DNS + domain classification
- rule-loader.js — YAML rule loading + categoryIndex (Map<category, rules[]>) exposed via getRulesByCategory(); built and tested, but no production caller consumes it yet (C-16)
- config-manager.js — settings persistence + permissions
- baselines.js — session tracking + rolling averages
- anomaly-detector.js — multi-dimensional anomaly scoring (network/fs/process/baseline)
- llm-runtime-detector.js — local LLM runtime detection (Ollama, LM Studio)
- scoring-utils.js — risk scoring utilities
- logger.js — structured logging
- cli.js — CLI interface (--scan-json, --version, --help)
- ai-analysis.js — Anthropic API threat analysis
- audit-logger.js — persistent JSONL audit trail
- exports.js — JSON/CSV/HTML report export
- tray-icon.js — system tray with procedural icon

## Renderer (src/renderer/) — Svelte 5 + Vite 7
48 Svelte components, 14 stores, 21 utils, scoped CSS + tokens.css/global.css

### Components (src/renderer/lib/components/)
- App.svelte — root layout, tab routing, settings modal
- Header.svelte / Footer.svelte — top bar stats, bottom bar metrics
- TabBar.svelte — tab navigation pills
- ShieldTab.svelte — bento grid: radar + agents + timeline + feed
- Radar.svelte — canvas radar with agent dots, sweep animation
- AgentPanel.svelte / AgentCard.svelte / AgentCardDetails.svelte — agent list + cards
- ActivityTab.svelte / ActivityFeed.svelte / GroupedFeed.svelte / FeedFilters.svelte — event feed
- NetworkPanel.svelte — network connections + domain classification
- Timeline.svelte / TimelineCanvas.svelte / TimelineControls.svelte — event timeline
- RulesTab.svelte / ProtectionPresets.svelte / PermissionsGrid.svelte — rules + permissions
- AgentDatabase.svelte / AgentDatabaseCrud.svelte — agent DB management
- ReportsTab.svelte / Reports.svelte / AuditLog.svelte / ThreatAnalysis.svelte — reports
- Settings.svelte / SettingsAppearance.svelte / SettingsMonitoring.svelte / OptionsPanel.svelte
- Toast.svelte / DemoBanner.svelte — notifications + demo mode

### Stores (src/renderer/lib/stores/)
- ipc.js — IPC bridge store (events, agents, network, stats)
- risk.js — derived enriched agents with risk scores
- theme.js — dark/light theme toggle
- toast.js — toast notification queue
- demo-data.js / demo-pools.js — demo mode data (there is no demo-risk.js)

### Utils (src/renderer/lib/utils/)
- format-bytes.ts — human-readable byte formatting
- sparkline-utils.ts, risk-ring-utils.ts, trust-badge-utils.ts — component math
- agent-stats-utils.ts, agent-crud-utils.ts — agent data helpers
- ring-buffer.ts, tab-transitions.ts, timeline-utils.ts — data structures + animation
- grouped-feed-utils.ts — feed grouping logic
- threat-report.js, risk-scoring.js — legacy JS (to convert)

### Styles (src/renderer/lib/styles/)
- tokens.css — M3 design tokens, light + dark themes
- global.css — base styles, scrollbar, body gradients

## Shared (src/shared/)
- constants.js — ignore patterns, editor lists, AGENT_CONFIG_PATHS. SENSITIVE_RULES (68) deprecated, unused at runtime
- rules/*.yaml (repo root, NOT src/shared) — 73 active detection rules across 8 categories, the real source of truth
- src/main/rule-loader.js exports: getAllRules(), getRulesByCategory(category), getRuleById(id), reloadRules(), and loadRules aliased as _loadRules (test seam — not a public API)
- agent-database.json — 110 agents / 262 name signatures

## Key Patterns
- Main process: CommonJS (require/module.exports) with init() dependency injection
- Renderer: Svelte 5 runes ($state, $derived, $effect), ES modules via Vite
- IPC channels: kebab-case (scan-processes, file-access, network-update)
- CSS: scoped in .svelte files, var() from tokens.css, glassmorphism design
- Build: Vite compiles Svelte → dist/renderer/, Electron loads from dist/
