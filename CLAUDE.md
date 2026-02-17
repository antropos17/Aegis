# AEGIS — Independent AI Oversight Layer

> When AI is embedded in your OS, browser, and apps — oversight must be independent.

## What This Is

Consumer desktop app that monitors AI agents (Claude Code, Copilot, Cursor, Manus, Devin, etc.) running on user's local PC. Tracks file access, network activity, process behavior. Shows real-time dashboard with risk scoring.

**Key insight:** All competitors (Lasso, PromptArmor, Prompt Security, Nightfall, WitnessAI) are enterprise B2B — they monitor what humans send to AI. Nobody monitors what AI agents do on local machines. AEGIS fills this gap — an independent, open-source, privacy-first monitoring layer that runs entirely on the user's machine.

## Tech Stack

- **Framework:** Electron 33
- **Frontend:** Vanilla JS + CSS (no React, no build step)
- **File watching:** chokidar@3
- **Process detection:** `tasklist /fo csv` (Windows), `ps aux` (Mac/Linux planned)
- **File handle scanning:** PowerShell `handle64.exe` or `Get-Process` fallback
- **Network scanning:** PowerShell `Get-NetTCPConnection` + DNS reverse lookup
- **Config storage:** JSON files at Electron `userData` directory (`settings.json`, `baselines.json`)
- **Agent database:** `src/shared/agent-database.json` (88 agents with metadata)
- **Fonts:** Plus Jakarta Sans (headings) + DM Sans (body) + DM Mono (code/data)
- **No frameworks:** No React, no Tailwind, no webpack. Pure vanilla for zero dependencies.

## Project Structure

```
AEGIS/
├── package.json
├── CLAUDE.md                              ← you are here
├── README.md                              # Open-source launch docs
├── CONTRIBUTING.md                        # Development setup + code standards
├── SECURITY.md                            # Vulnerability reporting + 90-day disclosure
├── ARCHITECTURE.md                        # System design + observability layers
├── src/
│   ├── main/                              # Electron main process (13 modules)
│   │   ├── main.js                        # Orchestrator, IPC handlers, lifecycle (204 lines)
│   │   ├── preload.js                     # Secure IPC bridge via contextBridge (66 lines)
│   │   ├── config-manager.js              # Settings persistence + permissions (187 lines)
│   │   ├── process-scanner.js             # AI agent detection via tasklist (101 lines)
│   │   ├── process-utils.js               # Parent chain resolution + editor annotation (149 lines)
│   │   ├── file-watcher.js                # chokidar watchers + handle scanning (148 lines)
│   │   ├── network-monitor.js             # TCP scanning + DNS + domain classification (177 lines)
│   │   ├── baselines.js                   # Session tracking + rolling averages (125 lines)
│   │   ├── anomaly-detector.js            # Anomaly scoring + deviation checks (128 lines)
│   │   ├── ai-analysis.js                 # Anthropic API threat analysis (208 lines)
│   │   ├── audit-logger.js                # Persistent JSONL audit trail (176 lines)
│   │   ├── exports.js                     # JSON/CSV/HTML report export (170 lines)
│   │   └── tray-icon.js                   # System tray with procedural icon (125 lines)
│   ├── renderer/                          # Dashboard UI (20 scripts + 1 HTML)
│   │   ├── index.html                     # 4 tab views + overlays (477 lines)
│   │   ├── state.js                       # Global DOM refs, tracking objects (198 lines)
│   │   ├── helpers.js                     # Formatting, sparklines, toast (220 lines)
│   │   ├── theme.js                       # Dark/light toggle (35 lines)
│   │   ├── risk-scoring.js                # Time-decay risk engine + trust grades (156 lines)
│   │   ├── radar-state.js                 # Radar constants, threat colors (94 lines)
│   │   ├── radar-draw.js                  # Canvas: background, sweep, nodes (193 lines)
│   │   ├── radar-engine.js                # Canvas: agent orbits, animation loop (186 lines)
│   │   ├── permissions.js                 # Protection presets + tri-state controls (178 lines)
│   │   ├── agent-database-ui.js           # Agent DB table rendering + filtering (202 lines)
│   │   ├── agent-database-crud.js         # Agent DB add/edit/delete/import/export (187 lines)
│   │   ├── agent-panel.js                 # Agent card HTML + trust bars (234 lines)
│   │   ├── agent-render.js                # Agent list rendering + click handlers (180 lines)
│   │   ├── activity-feed.js               # Feed entries + permission enforcement (181 lines)
│   │   ├── network-panel.js               # Network connections + domain classification (111 lines)
│   │   ├── timeline.js                    # Session event timeline (153 lines)
│   │   ├── reports.js                     # Activity filters + reports table + audit UI (198 lines)
│   │   ├── threat-analysis.js             # AI analysis results + report generation (97 lines)
│   │   ├── settings.js                    # Settings overlay + pattern management (135 lines)
│   │   ├── analysis.js                    # Analysis modal open/close (33 lines)
│   │   └── app.js                         # Renderer orchestrator + IPC wiring (181 lines)
│   ├── shared/
│   │   ├── constants.js                   # Sensitive rules, ignore patterns (179 lines)
│   │   └── agent-database.json            # 88 agent signatures (1,510 lines)
│   └── styles/                            # 9 CSS files (neumorphic design)
│       ├── variables.css                  # CSS custom properties, theme tokens (55 lines)
│       ├── base.css                       # Body, header, footer, layout (159 lines)
│       ├── radar.css                      # Radar container, meta pills (102 lines)
│       ├── panels.css                     # Agent cards, network panel (191 lines)
│       ├── components.css                 # Buttons, trust bars, process list (171 lines)
│       ├── feed-styles.css                # Feed entries, anomaly, timeline, threat (189 lines)
│       ├── settings.css                   # Settings overlay, analysis modal (200 lines)
│       ├── tabs.css                       # Tab bar, tab pills, agent DB table (224 lines)
│       └── responsive.css                 # Media queries (70 lines)
```

Total: **~7,100 lines** across **44 source files** (JS/CSS/HTML). Plus 1,510 lines of agent database JSON.

## Architecture

### Main Process — 13 modules

**main.js** — Orchestrator (204 lines)
- Wires all sub-modules via init() calls with dependency injection
- Registers 28 IPC handlers (invoke) + 1 IPC listener (send)
- Manages scan intervals (process scan + file scan + network scan)
- Staggered startup: process scan at 3s, file scan at 5s, network at 8s
- Agent enter/exit audit logging via PID change detection
- Single-instance lock, system tray lifecycle, baseline finalization on quit

**config-manager.js** — Settings persistence (187 lines)
- Loads/saves `settings.json` in Electron's `userData` directory
- Default settings: 10s scan interval, notifications on, no API key
- Custom sensitive pattern compilation (user-defined regex rules)
- Per-agent permission defaults: known agents → "monitor", unknown → "block"
- Tracks seen agents and persists their permission state

**process-scanner.js** — Agent detection (101 lines)
- Loads 88 agent signatures from `src/shared/agent-database.json`
- Scans via `tasklist /FO CSV /NH` on Windows
- Pattern matching: process name against known agent patterns
- Deduplication by PID, change detection for triggering network rescans

**process-utils.js** — Parent chain + annotation (149 lines)
- Parent chain resolution via single PowerShell call with 60s TTL cache
- Editor host annotation (e.g., "Copilot via VS Code")
- 20 editor host labels (VS Code, IntelliJ, WebStorm, PyCharm, etc.)

**file-watcher.js** — File monitoring (148 lines)
- chokidar watchers on: `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.docker`, `~/.azure`, `~/.env*`, project dir, 27 AI agent config dirs
- Handle-based file scanning via PowerShell (`handle64.exe` or `Get-Process` fallback)
- Sensitive file classification against 70+ rules from `constants.js`
- 2-second debounce per file path, system-noise filtering

**network-monitor.js** — Network scanning (177 lines)
- `Get-NetTCPConnection` via PowerShell, filtered to non-loopback established connections
- Reverse DNS resolution with 5-minute TTL cache
- Known-domain classification: 50+ safe domain patterns from agent database
- Connections flagged when domain is unknown or unresolvable

**baselines.js** — Session tracking + averages (125 lines)
- Per-agent session tracking: files, sensitive count, directories, network endpoints
- Rolling averages over last 10 sessions
- Persisted to `baselines.json`, finalized on app quit

**anomaly-detector.js** — Anomaly scoring + deviations (128 lines)
- Anomaly score (0-100) with 5 weighted factors: file volume (30), sensitive spike (25), new sensitive categories (20), new network endpoints (15), unusual timing (10)
- Deviation checks: 3x file volume, 3x sensitive count, new categories, new endpoints, 4+ new directories, unusual hours

**ai-analysis.js** — AI risk analysis (208 lines)
- Anthropic Messages API (`claude-sonnet-4-5-20250929`)
- Per-agent and full-session threat analysis
- Returns structured assessment: summary, findings, risk level, recommendations
- 30-second timeout, requires API key in settings

**audit-logger.js** — Persistent audit trail (176 lines)
- Append-only JSONL files in `audit-logs/` directory
- 7 event types: file-access, network-connection, anomaly-alert, permission-deny, agent-enter, agent-exit, config-access
- Daily rotation, 30-day auto-cleanup, buffered writes (flush every 5s or 50 events)

**exports.js** — Report generation (170 lines)
- JSON/CSV/HTML export with Electron save dialogs
- HTML report: dark-themed dashboard with summary cards, bar charts, tables

**tray-icon.js** — System tray (125 lines)
- Procedural 16x16 PNG shield icon generation (no external assets)
- Color-coded by threat level: green / yellow / red
- Context menu: Show Dashboard, Pause/Resume Monitoring, Quit
- Native notifications for sensitive file access (30s cooldown)

**preload.js** — IPC bridge (66 lines)
- `contextBridge.exposeInMainWorld('aegis', {...})`
- 26 invoke methods + 8 event listeners
- Context isolation enabled, node integration disabled

### Renderer — 20 scripts loaded in dependency order

Script load order in `index.html`:
1. `state.js` → DOM refs, tracking objects, permissions cache, agent database
2. `helpers.js` → formatDuration, formatUptime, escapeHtml, showToast, sparklines
3. `theme.js` → Dark/light mode toggle + persistence
4. `risk-scoring.js` → Time-decay weighted risk engine + trust grades (A+ through F)
5. `radar-state.js` → RADAR_NODES (8 system nodes), THREAT_COLORS, AGENT_COLORS
6. `radar-draw.js` → Canvas: background, rings, crosshairs, sweep arm, system nodes
7. `radar-engine.js` → Canvas: agent orbits, connection lines, animation loop
8. `permissions.js` → Protection presets (Paranoid/Strict/Balanced/Developer)
9. `agent-database-ui.js` → Agent DB table rendering, filtering, detected sync
10. `agent-database-crud.js` → Agent DB add/edit/delete/import/export modals
11. `agent-panel.js` → Agent card HTML: trust bar, sparkline, baseline tab
12. `agent-render.js` → Agent list rendering, click-to-filter, radar sync
13. `activity-feed.js` → Feed entry creation, AI/other event splitting
14. `network-panel.js` → Network connection rendering, domain classification
15. `timeline.js` → Session event timeline (100 dots, color-coded)
16. `reports.js` → Activity tab filtering + Reports tab aggregate stats + audit UI
17. `threat-analysis.js` → AI threat analysis results + printable report generation
18. `settings.js` → Export handlers, settings overlay, custom patterns
19. `analysis.js` → Analysis modal open/close
20. `app.js` → Renderer orchestrator, IPC listener wiring

### Risk Scoring Formula

Weighted, time-decay model:
- `sensitive × 10` — sensitive file access (strongest signal)
- `config × 5` — config file access
- `network × 3` — outbound connections
- `unknownDomain × 15` — connections to unrecognized domains
- `files × 0.1` (capped at 10) — general file volume
- Multiplier: trusted agents (default trust >= 70) get 0.5x reduction
- Files inside the project working directory are excluded from scoring
- Time decay: 1.0x (recent), 0.5x (>1hr), 0.1x (>24hr)

Trust score: `baseTrust - riskScore × 0.8`, graded A+ through F.

## Known AI Agent Signatures

88 agents loaded from `src/shared/agent-database.json`:
- **Coding assistants:** Claude Code, GitHub Copilot, OpenAI Codex, Cursor AI, Windsurf, Tabnine, Amazon Q, Sourcegraph Cody, Replit AI, JetBrains AI, Aider
- **Autonomous agents:** Devin, Manus AI, OpenHands, SWE-Agent, AutoGPT, BabyAGI, CrewAI, AgentGPT
- **Desktop/browser agents:** Anthropic Computer Use, Google Gemini, Apple Intelligence, Microsoft Copilot (OS), Opera Aria, Perplexity
- **CLI/framework tools:** LangChain, Semantic Kernel, AutoGen, TaskWeaver, MetaGPT
- **Security/DevOps:** Snyk AI, GitHub Advanced Security
- Plus wildcard detection for unknown agents

## Sensitive File Rules

Defined in `src/shared/constants.js` — 70+ patterns:
- **SSH:** `.ssh/`, `id_rsa`, `id_ed25519`, `id_ecdsa`, `known_hosts`, `authorized_keys`
- **Environment:** `.env`, `.env.local`, `.env.production`, `.env.*`
- **Credentials:** `password`, `credential`, `secret`, `token`, `api_key`
- **Keys:** `.pem`, `.key`, `.pfx`, `.p12`
- **Cloud:** `.aws/`, `.azure/`, `.gcloud/`, `.gnupg/`
- **Browser:** Chrome/Firefox/Edge passwords, cookies, autofill, history
- **Config:** `.npmrc`, `.pypirc`, `.docker/config.json`, `.kube/`
- **Git:** `.git-credentials`
- **AI Agent configs:** 27 agent config directories (Hudson Rock threat vector)

## What's Done (Features Working)

- [x] Detection of 88 AI agents + wildcard matching
- [x] Parent-child process tree resolution + IDE host annotation
- [x] File monitoring via chokidar (sensitive dirs + project dir + .env*)
- [x] Handle-based file scanning via PowerShell (per-process file access)
- [x] AI agent config directory protection (Hudson Rock threat vector — 27 dirs)
- [x] Network monitoring (Get-NetTCPConnection + DNS + domain classification)
- [x] Risk scoring per agent (weighted, time-decay, trust-adjusted)
- [x] Trust grades (A+ through F) with visual trust bars
- [x] Behavioural baselines with rolling 10-session averages
- [x] Anomaly scoring (0-100) with 5 weighted factors
- [x] Deviation detection + alerting (6 check types)
- [x] AI-powered threat analysis via Anthropic API (per-agent + full session)
- [x] Printable HTML threat reports
- [x] Session timeline (last 100 events as color-coded dots)
- [x] Persistent audit logging (JSONL, daily rotation, 30-day retention)
- [x] Audit log UI (stats, view logs, export full audit)
- [x] 4 tab views: Shield, Activity, Rules, Reports
- [x] Canvas radar (60fps: sweep arm, agent orbits, connection lines, system nodes)
- [x] Activity feed with agent/severity/filetype filters
- [x] Agent cards with sparklines, session duration, parent chain, expand tabs
- [x] Protection presets (Paranoid/Strict/Balanced/Developer)
- [x] Per-agent permissions (6 categories x tri-state allow/monitor/block)
- [x] Agent Database Manager (88 agents, custom add/edit/delete, import/export)
- [x] Process control (Kill/Suspend/Resume per agent)
- [x] Export reports (JSON/CSV/HTML with save dialogs)
- [x] System tray with procedural shield icon + native notifications
- [x] Dark/light neumorphic theme toggle with persistence
- [x] Header/footer pills (shield score, agents, files, CPU, memory, heap)
- [x] README.md, CONTRIBUTING.md, SECURITY.md, ARCHITECTURE.md

## Roadmap (What's NOT Done)

### Known Issues
- [ ] Demo mode (browser, no Electron) removed during modularization — needs reimplementing if needed

### Launch Prep
- [ ] Push to GitHub (gh auth needed)
- [ ] GitHub Issues (20+ covering roadmap items)
- [ ] GitHub Releases (alpha -> beta -> v0.1.0)
- [ ] GitHub Actions (CI/CD, auto-build)

### Future Features
- [ ] True per-process file attribution (ETW on Windows, fanotify on Linux)
- [ ] OS-level enforcement via kernel hooks (Minifilter/Endpoint Security/eBPF)
- [ ] Mac/Linux support (`ps aux`, `fanotify`, `ss`/`lsof`)
- [ ] electron-builder packaging (NSIS installer for Windows)
- [ ] Container/VM detection (Docker, WSL, local LLMs)
- [ ] GPU monitoring (local inference detection)
- [ ] UI Awareness via Accessibility APIs
- [ ] Browser extension for web-based AI agents
- [ ] Cross-device AI activity correlation

### Grant Applications
- [ ] OpenAI Cybersecurity Grant — $10K, rolling basis, 3000 words plaintext
- [ ] NRC IRAP — up to $50K for Canadian small business
- [ ] RAII — $250K-$5M (needs 50% co-funding)

## Design System — Neumorphism + Dark Mode

Dual-theme system with light (default) and dark mode toggle.

### Design Tokens (variables.css)
```css
--bg: #E0E5EC;
--accent: #4ECDC4;
--red: #E53E3E;      /* critical */
--orange: #ED8936;   /* high */
--blue: #4299E1;     /* medium */
--green: #38A169;    /* low / safe */
```

### Typography
- **Headings:** Plus Jakarta Sans, weight 700-800
- **Body/UI:** DM Sans, weight 400-600
- **Data/Code:** DM Mono, weight 400-500

## Code Conventions

- **Module pattern:** Main process uses CommonJS (`require`/`module.exports`) with `init()` dependency injection
- **Renderer:** Global functions via `<script>` tags in load-order; no imports/exports
- **Variables:** `const` over `let` when possible. `var` only for cross-script shared state.
- **Template literals** for HTML generation in renderer
- **IPC channels:** kebab-case (`scan-processes`, `get-stats`, `file-access`)
- **CSS class naming:** `component-element` pattern (e.g., `agent-card`, `feed-entry`)
- **Section comments:** `// ═══ SECTION NAME ═══` for major, `// ── subsection ──` for minor
- **JSDoc:** All exported functions have `@param`, `@returns`, `@since` tags
- **200 line soft limit per file** — split into focused, single-responsibility modules when exceeding
- **CSS:** 9 files split by concern (variables, base, radar, panels, components, feed-styles, settings, tabs, responsive)

## Important Notes

- The app currently MONITORS only — it does NOT enforce/block anything at OS level. Permission states (allow/monitor/block) affect UI display only. True blocking requires kernel-level hooks.
- Process detection is Windows-focused (tasklist + PowerShell). Mac/Linux support is planned.
- chokidar watchers detect file changes but cannot attribute them to specific processes. Handle scanning provides per-process attribution on a timer.
- `agent-database.json` lives at `src/shared/` and is read by `process-scanner.js` and `network-monitor.js` via relative path.
- AI analysis calls the Anthropic API only when the user explicitly clicks the button. No background API calls.
- All data stays local. No telemetry, no cloud sync, no analytics.

## Positioning

### Consumer Layer
Free open-source desktop monitor for developers. MIT license. "Antivirus but for AI agents."

### Government Layer
Canadian AI Agent Audit Platform — sovereign visibility into foreign AI agents operating on Canadian systems.

### Competitors (all enterprise B2B, different focus)
None of them monitor what agents DO on local machines. That's AEGIS.
