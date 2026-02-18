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

---








# AEGIS — Independent AI Oversight Layer

> When AI is embedded in your OS, browser, and apps — oversight must be independent.

## What This Is

Consumer desktop app that monitors AI agents (Claude Code, Copilot, Cursor, Manus, Devin, etc.) running on user's local PC. Tracks file access, network activity, process behavior. Shows real-time dashboard with risk scoring.

**Key insight:** All competitors (Lasso, PromptArmor, Prompt Security, Nightfall, WitnessAI) are enterprise B2B — they monitor what humans send to AI. Nobody monitors what AI agents do on local machines. AEGIS fills this gap — an independent, open-source, privacy-first monitoring layer that runs entirely on the user's machine.

## Tech Stack

- **Framework:** Electron 33
- **Frontend:** Svelte 5 + Vite (component-based with `$state`/`$derived`/`$effect` runes)
- **File watching:** chokidar@3
- **Process detection:** `tasklist /fo csv` (Windows), `ps aux` (Mac/Linux planned)
- **File handle scanning:** PowerShell `handle64.exe` or `Get-Process` fallback
- **Network scanning:** PowerShell `Get-NetTCPConnection` + DNS reverse lookup
- **Config storage:** JSON files at Electron `userData` directory (`settings.json`, `baselines.json`)
- **Agent database:** `src/shared/agent-database.json` (95 agents with metadata)
- **Fonts:** Plus Jakarta Sans (headings) + DM Sans (body) + DM Mono (code/data)
- **Build:** Vite 7 with `@sveltejs/vite-plugin-svelte`. No Tailwind, no webpack.

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
│   ├── renderer/                              # Dashboard UI (Svelte 5 + Vite)
│   │   ├── app.html                           # Vite HTML entry point
│   │   ├── main.js                            # Svelte app mount
│   │   ├── App.svelte                         # Root component, tab routing
│   │   └── lib/
│   │       ├── components/                    # 22 Svelte components
│   │       │   ├── Header.svelte / Footer.svelte / TabBar.svelte
│   │       │   ├── ShieldTab.svelte / Radar.svelte / AgentPanel.svelte / AgentCard.svelte
│   │       │   ├── ActivityTab.svelte / ActivityFeed.svelte / FeedFilters.svelte
│   │       │   ├── NetworkPanel.svelte / Timeline.svelte
│   │       │   ├── RulesTab.svelte / ProtectionPresets.svelte / PermissionsGrid.svelte
│   │       │   ├── AgentDatabase.svelte / AgentDatabaseCrud.svelte
│   │       │   ├── ReportsTab.svelte / Reports.svelte / AuditLog.svelte
│   │       │   └── ThreatAnalysis.svelte / Settings.svelte
│   │       ├── stores/                        # Svelte stores (reactive state)
│   │       │   ├── ipc.js                     # IPC bridge as writable/derived stores
│   │       │   ├── risk.js                    # Risk scoring derived store
│   │       │   └── theme.js                   # Dark/light theme store
│   │       ├── utils/                         # Shared utilities
│   │       │   ├── risk-scoring.js            # Risk calculation + trust grades
│   │       │   └── threat-report.js           # HTML report generation
│   │       └── styles/                        # Global styles
│   │           ├── tokens.css                 # M3 design tokens + theme variables
│   │           └── global.css                 # Base styles + animations
│   ├── shared/
│   │   ├── constants.js                   # Sensitive rules, ignore patterns (179 lines)
│   │   └── agent-database.json            # 95 agent signatures (1,510 lines)
│   (styles are scoped inside .svelte components + 2 global files in renderer/lib/styles/)
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
- Loads 95 agent signatures from `src/shared/agent-database.json`
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

### Renderer — Svelte 5 component tree

Built with Vite + `@sveltejs/vite-plugin-svelte`. Uses `$state`, `$derived`, `$effect` runes.

**Entry:** `main.js` → mounts `App.svelte` into `app.html`

**Component tree:**
- `App.svelte` → root layout, tab routing, Settings modal
  - `Header.svelte` → shield score, agent/file counts, theme toggle, settings gear
  - `TabBar.svelte` → Shield / Activity / Rules / Reports tabs
  - `ShieldTab.svelte` → bento grid layout
    - `Radar.svelte` → canvas radar with agent dots + sweep arm (60fps)
    - `AgentPanel.svelte` → agent list, grouped by name
      - `AgentCard.svelte` → trust bar, risk score, expandable detail tabs
    - `Timeline.svelte` → SVG horizontal event bar (last 100 events)
  - `ActivityTab.svelte` → feed/network toggle
    - `ActivityFeed.svelte` + `FeedFilters.svelte` → event list with filters
    - `NetworkPanel.svelte` → connection list with domain classification
  - `RulesTab.svelte` → presets/permissions/database toggle
    - `ProtectionPresets.svelte` → Paranoid/Strict/Balanced/Developer
    - `PermissionsGrid.svelte` → per-agent tri-state controls
    - `AgentDatabase.svelte` + `AgentDatabaseCrud.svelte` → agent DB manager
  - `ReportsTab.svelte` → reports/audit/threat toggle
    - `Reports.svelte` → aggregate stats + export buttons
    - `AuditLog.svelte` → audit log viewer + stats
    - `ThreatAnalysis.svelte` → AI analysis results + report
  - `Settings.svelte` → modal overlay for app settings
  - `Footer.svelte` → version, uptime, MEM/HEAP/SCAN stats

**Stores** (Svelte writable/derived):
- `ipc.js` → IPC bridge: agents, events, stats, networkConnections, anomalyScores, permissions
- `risk.js` → derived `enrichedAgents` store with calculated risk scores + trust grades
- `theme.js` → dark/light mode toggle with localStorage persistence

**Utils:**
- `risk-scoring.js` → `calculateRiskScore()`, `getTrustGrade()`, `getTimeDecayWeight()`
- `threat-report.js` → HTML threat report generation for print

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

95 agents loaded from `src/shared/agent-database.json`:
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
- [x] Agent Database Manager (95 agents, custom add/edit/delete, import/export)
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
- **Renderer:** Svelte 5 components with `$state`/`$derived`/`$effect` runes. ES module imports.
- **Variables:** `const` over `let` when possible. Never use `var`.
- **Template literals** for HTML generation in utils
- **IPC channels:** kebab-case (`scan-processes`, `get-stats`, `file-access`)
- **CSS class naming:** `component-element` pattern (e.g., `agent-card`, `feed-entry`)
- **Section comments:** `// ═══ SECTION NAME ═══` for major, `// ── subsection ──` for minor
- **JSDoc:** All exported functions have `@param`, `@returns`, `@since` tags
- **200 line soft limit per file** — split into focused, single-responsibility modules when exceeding
- **CSS:** Scoped styles inside `.svelte` components + 2 global files (`tokens.css`, `global.css`) in `renderer/lib/styles/`

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
