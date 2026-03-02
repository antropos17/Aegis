# AEGIS Roadmap

## Done

- **#9** IPC event batching — batch IPC events to reduce renderer overhead (append/latest modes, 150-200ms windows)
- **#11** Ignore .git/node_modules — configurable directory ignore list in file-watcher with UI toggle
- **#12** EPERM graceful fallback — scanner catches access errors and logs warning instead of crashing
- Startup perf Phase 1 — deferred file watchers, lazy-loaded modules (400-2200ms saved)
- Toast/AgentDB/docs color fixes — replaced hardcoded colors with design tokens

## Bugs (In Progress)

- **P1.1** 37 hardcoded `rgba(255,255,255)` in 15 Svelte components — replace with `tokens.css` vars
- **P1.2** Add `eslint-plugin-svelte` (31 components unlinted)
- **P1.3** Fix hardcoded test counts in README
- **P1.4** Fix hardcoded test counts in CHANGELOG

## Startup Perf Phase 2

- Defer `cleanOldLogs()` via `setImmediate` in logger.js + audit-logger.js
- `show: false` BrowserWindow + show on `did-finish-load` in main.js
- Defer `tray.createTray()` to after `did-finish-load`
- Lazy-wrap network-monitor agent-db parse (same pattern as process-scanner.js)
- Defer `baselines.loadBaselines()` to after `createWindow`

## 20-Feature Plan

### UI/UX
- **#1** Click-to-copy PID — click any PID in the UI to copy it to clipboard
- **#2** Smart autoscroll Activity Feed — auto-scroll to new events, pause when user scrolls up
- **#3** Smart truncation for paths — shorten long file paths without breaking layout
- **#4** Relative + exact time — show "2 min ago" with full timestamp on hover
- **#5** Threat flash animation — red flash on high-threat detection for visibility
- **#6** Version display — show app version from package.json in UI corner
- **#7** Hotkeys — Esc closes panels, Ctrl+F opens search
- **#8** Open File Location — "Show in Explorer" button next to file paths

### Electron
- **#10** HW acceleration toggle — let users disable GPU acceleration if app lags

### Logic
- **#13** HTTP vs HTTPS scoring — score HTTP connections higher threat than HTTPS
- **#14** Custom User-Agent — identify Aegis in Anthropic API calls
- **#15** API status indicator — green/red dot showing Anthropic API availability
- **#16** OOM protection on export — prevent crash when exporting large log files
- **#17** Zip logs export — one-click ZIP export of all audit logs

### Community
- **#18** Report False Positive — "Not a threat" button for user feedback
- **#19** Agent Database link — link to agent-database.json from UI
- **#20** Scan status badge — "Scanning active/paused" indicator in header

## Architecture Roadmap

- **Phase A:** Ship v0.3.0 — complete bugs + features, auto-updater
- **Phase B:** scanner to child_process, ring buffers, container detection, GPU monitor, process tree fan-out
- **Phase C:** ETW/eBPF native C++ addons (CPU 15% to 0.1%)
- **Phase D:** daemon architecture, MCP interception, SIEM export
