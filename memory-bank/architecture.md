# AEGIS Architecture

## Main Process (src/main/) — CommonJS
- main.js — orchestrator, IPC handlers, lifecycle
- preload.js — IPC bridge (window.aegis via contextBridge)
- process-scanner.js — AI agent detection (tasklist + pattern matching)
- process-utils.js — parent chain resolution + editor annotation
- file-watcher.js — chokidar watchers + handle scanning
- network-monitor.js — TCP scanning + DNS + domain classification
- config-manager.js — settings persistence + permissions
- baselines.js — session tracking + rolling averages
- anomaly-detector.js — anomaly scoring + deviation checks
- ai-analysis.js — Anthropic API threat analysis
- audit-logger.js — persistent JSONL audit trail
- exports.js — JSON/CSV/HTML report export
- tray-icon.js — system tray with procedural icon

## Renderer (src/renderer/) — Vanilla JS, no framework
- index.html — 4 tab views + overlays (single HTML entry point)
- state.js — global DOM refs, tracking objects, permissions cache
- helpers.js — formatting, sparklines, toast notifications
- theme.js — dark/light toggle
- risk-scoring.js — time-decay risk engine + trust grades
- radar-state.js — radar constants, threat colors
- radar-draw.js — canvas: background, sweep, nodes
- radar-engine.js — canvas: agent orbits, animation loop
- permissions.js — protection presets + tri-state controls
- agent-database-ui.js — agent DB table rendering + filtering
- agent-database-crud.js — agent DB add/edit/delete/import/export
- agent-panel.js — agent card HTML + trust bars
- agent-render.js — agent list rendering + click handlers
- activity-feed.js — feed entries + permission enforcement
- network-panel.js — network connections + domain classification
- timeline.js — session event timeline
- reports.js — activity filters + reports table + audit UI
- threat-analysis.js — AI analysis results + report generation
- settings.js — settings overlay + pattern management
- analysis.js — analysis modal open/close
- app.js — renderer orchestrator + IPC wiring

## Shared (src/shared/)
- constants.js — sensitive rules (70+ patterns), ignore patterns
- agent-database.json — 88 agent signatures

## Styles (src/styles/) — 9 CSS files, neumorphic design
- variables.css — CSS custom properties, theme tokens
- base.css — body, header, footer, layout
- radar.css — radar container, meta pills
- panels.css — agent cards, network panel
- components.css — buttons, trust bars, process list
- feed-styles.css — feed entries, anomaly, timeline, threat
- settings.css — settings overlay, analysis modal
- tabs.css — tab bar, tab pills, agent DB table
- responsive.css — media queries

## Root Files
- package.json — dependencies + scripts
- CLAUDE.md — AI assistant instructions
- README.md — public launch docs
- CONTRIBUTING.md — development setup + code standards
- SECURITY.md — vulnerability reporting + 90-day disclosure
- ARCHITECTURE.md — system design + observability layers
- CODE_OF_CONDUCT.md — community standards + enforcement
- .gitignore — dist/, out/, .env, node_modules/, *.log, .DS_Store

## Key Patterns
- Main process: CommonJS (require/module.exports) with init() dependency injection
- Renderer: global functions via script tags in load order, no imports/exports
- IPC channels: kebab-case (scan-processes, file-access, network-update)
- All renderer scripts loaded in dependency order in index.html
- No build step — vanilla JS served directly by Electron
