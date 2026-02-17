# AEGIS Architecture

## Main Process (src/main/) — CommonJS, unchanged during Svelte migration
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

## Renderer (src/renderer/) — Svelte 5 + Vite
- app.html — Vite entry point
- main.js — Svelte mount
- App.svelte — root component (tabs, settings modal, theme $effect)
- lib/stores/ipc.js — IPC bridge as Svelte stores (agents, events, stats, network, anomalies, resourceUsage)
- lib/stores/risk.js — enrichedAgents derived store (agents + events + anomalies + network → riskScore, trustGrade)
- lib/stores/theme.js — theme store (writable, localStorage persistence, toggleTheme)
- lib/utils/risk-scoring.js — calculateRiskScore (log2 curve), getTrustGrade, getTimeDecayWeight
- lib/utils/threat-report.js — printable HTML threat report generator
- lib/styles/global.css — reset, body, scrollbar, selection, focus-visible, Google Fonts import
- lib/styles/tokens.css — M3 design tokens (colors, typography, shape, motion, dark + light themes)
- lib/components/Header.svelte — fixed top bar: shield score, agents, files, uptime pills, theme toggle, settings gear
- lib/components/Footer.svelte — fixed bottom bar: CPU, memory, heap, scan interval
- lib/components/TabBar.svelte — 4-tab pill navigation (Shield/Activity/Rules/Reports)
- lib/components/ShieldTab.svelte — column layout: Radar + AgentPanel top row, Timeline below
- lib/components/Radar.svelte — canvas radar: concentric rings, sweep arm, agent dots by riskScore, 60fps
- lib/components/AgentPanel.svelte — scrollable agent card list from enrichedAgents
- lib/components/AgentCard.svelte — agent card: name, PID, trust grade, risk bar, expand with details + actions
- lib/components/Timeline.svelte — SVG timeline: last 100 events as color-coded dots
- lib/components/ActivityTab.svelte — Feed/Network toggle, FeedFilters + ActivityFeed or NetworkPanel
- lib/components/FeedFilters.svelte — agent dropdown, severity pills, type pills ($bindable)
- lib/components/ActivityFeed.svelte — scrollable event list: file + network events, severity classification
- lib/components/NetworkPanel.svelte — network connections: agent/domain/port/state/classification, filters, sort
- lib/components/RulesTab.svelte — sub-toggle (Permissions | Agent Database), composed layout
- lib/components/ProtectionPresets.svelte — 4 preset pills (Paranoid/Strict/Balanced/Developer)
- lib/components/PermissionsGrid.svelte — 6 categories × 3 states grid, per-agent, auto-save via IPC
- lib/components/AgentDatabase.svelte — 88-agent table: search, category filter, sortable columns
- lib/components/AgentDatabaseCrud.svelte — CRUD wrapper: add/edit/delete modals, import/export
- lib/components/ReportsTab.svelte — sub-toggle (Overview | Audit Log | Threat Analysis)
- lib/components/Reports.svelte — summary stats, top 10 agents table, export buttons
- lib/components/AuditLog.svelte — audit stats cards, view logs dir + export full audit
- lib/components/ThreatAnalysis.svelte — AI analysis: session/agent mode, results display, full report
- lib/components/Settings.svelte — modal: scan interval, notifications, API key, custom patterns

## Shared (src/shared/)
- constants.js — sensitive rules, ignore patterns
- agent-database.json — 88 agent signatures

## Build Output (dist/renderer/)
- app.html — built entry point
- assets/app-*.js — bundled JS (~95 KB)
- assets/app-*.css — bundled CSS (~44 KB)
