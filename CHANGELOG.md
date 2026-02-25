# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.2.0-alpha] - 2026-02-24

### Added
- Full Svelte 5 + Vite 7 rewrite with `$state`/`$derived`/`$effect` runes replacing vanilla JS renderer
- IPC bridge as Svelte reactive stores (`ipc.js`, `risk.js`, `theme.js`)
- 4-tab navigation: Shield, Activity, Rules, Reports
- Canvas radar with agent dots, sweep arm, connection lines at 60fps
- Risk scoring derived store with weighted time-decay model and trust grades (A+ through F)
- Agent card expandable details with sparklines, session duration, parent chain, and action tabs
- SVG horizontal timeline in Shield tab (last 100 events as color-coded dots)
- Network panel with Feed/Network toggle in Activity tab
- Activity feed process grouping with expandable details
- Clickable file paths (reveal in explorer) and copyable network addresses
- AI agent config file protection for 27 agent config directories (Hudson Rock threat vector)
- Behavioral anomaly detection with baseline deviation alerts (5 weighted factors, 0-100 scoring)
- AI-powered threat analysis via Anthropic API (per-agent and full session analysis)
- Real-time timeline, dashboard metrics, persistent JSONL audit logging with daily rotation
- Container/VM and local LLM detection expanding agent database from 88 to 95 agents
- Settings modal with export/import config buttons
- CSP header and network connections store cap (500 max)
- Protection presets (Paranoid/Strict/Balanced/Developer) and per-agent permissions grid
- Agent Database Manager with custom add/edit/delete and import/export
- Reports tab with aggregate stat cards, JSON/CSV/HTML export, and audit log viewer
- Printable HTML threat reports
- GitHub Actions CI/CD lint + build workflow
- electron-builder config for Windows NSIS installer with procedural shield icon
- macOS build compatibility
- GitHub issue templates, PR template, CODE_OF_CONDUCT
- Responsive min-width and electron window constraints
- Tab transitions and micro-interactions
- M3 design tokens with neumorphic glassmorphism (Plus Jakarta Sans + DM Sans + DM Mono)
- UI screenshots added to README for all tabs
- README, CONTRIBUTING, SECURITY, ARCHITECTURE docs for open-source launch
- CI badge in README

### Fixed
- Risk scoring rebalance — self-access exemption, dedup, diminishing returns
- Radar canvas visibility — increased grid/label/sweep opacity for dark theme
- Radar centering and light theme visibility
- Black screen in packaged exe (CSP + path fix)
- Threat analysis JSON parsing and robust JSON extraction
- Table header overlap in threat analysis view
- `sendToRenderer` crash on shutdown
- Hardcoded `#fff` colors in 4 Svelte components breaking dark theme
- Removed WSL from agent DB, added event dedup (30s window)
- `icon.ico` to `icon.png` for electron-builder NSIS packaging
- Lazy init settings/baselines path — resolved `app.getPath` crash on startup
- Unset `ELECTRON_RUN_AS_NODE` in start script for IDE terminal compatibility
- Dev server port fixed to 5174
- Nested ternary in Header, dead import in Footer
- Duplicate/wrong author name in package metadata
- CI YAML syntax error in lint step
- 10 UI bugs resolved from full audit pass

### Changed
- Complete UI rewrite from vanilla JS to Svelte 5 component architecture (22 components)
- Premium dark minimal redesign with glassmorphism panels, blur, translucent surfaces
- Header compact redesign with shield score, agent/file counts, theme toggle
- Footer merged with system stats (version, uptime, MEM/HEAP/SCAN)
- Agent card compact redesign with trust bars and grouped-by-name display
- Shield tab bento grid layout
- Activity tab compact feed with network panel merged
- Rules tab visual polish with presets/permissions/database sections
- Extracted IPC handlers from main.js into dedicated modules
- Renamed `app.html` to `index.html` and updated Vite config
- Removed legacy vanilla JS renderer and old CSS
- Cleaned config-manager.js and aligned all components to M3 tokens

## [0.1.0-alpha] - 2026-02-15

### Added
- Initial release — AI Agent Privacy Shield for Windows
- AI agent process detection via `tasklist /FO CSV` with pattern matching
- File monitoring via chokidar for sensitive directories (`.ssh`, `.aws`, `.gnupg`, `.kube`, `.docker`, `.azure`, `.env*`)
- Handle-based file scanning via PowerShell for per-process file attribution
- Network monitoring via `Get-NetTCPConnection` with DNS reverse lookup
- Sensitive file classification against 70+ rules
- Per-agent risk scoring with time-decay model
- System tray with procedural shield icon and native notifications
- Dark mode dashboard with real-time agent monitoring
- Process control (Kill/Suspend/Resume per agent)
- Settings persistence via JSON in Electron userData directory
- Secure IPC bridge via contextBridge with context isolation
