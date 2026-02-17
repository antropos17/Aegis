# AEGIS — AI Agent Privacy Shield

> "The only door between AI and your life."

## What This Is

Consumer desktop app that monitors AI agents (Claude Code, Copilot, Cursor, Manus, Devin, etc.) running on user's local PC. Tracks file access, network activity, process behavior. Shows real-time dashboard with risk scoring.

**Key insight:** All competitors (Lasso, PromptArmor, Prompt Security, Nightfall, WitnessAI) are enterprise B2B — they monitor what humans send to AI. Nobody monitors what AI agents do on local machines. AEGIS fills this gap.

## Tech Stack

- **Framework:** Electron 33
- **Frontend:** Vanilla JS + CSS (no React, no build step)
- **File watching:** chokidar@3
- **Process detection:** `tasklist /fo csv` (Windows), `ps aux` (Mac/Linux)
- **File handle scanning:** PowerShell `handle64.exe` or `Get-Process` fallback
- **Network scanning:** PowerShell `Get-NetTCPConnection` + DNS reverse lookup
- **Config storage:** JSON file at Electron `userData` directory (`settings.json`, `baselines.json`)
- **Agent database:** `agent-database.json` (440 lines, 13+ agents with metadata)
- **Fonts:** Plus Jakarta Sans (headings) + DM Sans (body) + DM Mono (code/data)
- **No frameworks:** No React, no Tailwind, no webpack. Pure vanilla for zero dependencies.

## Project Structure

```
AEGIS/
├── package.json
├── CLAUDE.md                          ← you are here
├── agent-database.json                # Agent signatures, colors, domains (440 lines)
├── src/
│   ├── main/
│   │   ├── main.js                    # Electron main-process orchestrator (128 lines)
│   │   ├── preload.js                 # Secure IPC bridge via contextBridge (53 lines)
│   │   ├── config-manager.js          # Settings persistence + permissions defaults (164 lines)
│   │   ├── process-scanner.js         # AI agent detection via tasklist + parent chains (194 lines)
│   │   ├── file-watcher.js            # chokidar watchers + handle-based file scanning (141 lines)
│   │   ├── network-monitor.js         # TCP connection scanning + DNS + domain classification (177 lines)
│   │   ├── baselines.js               # Behaviour baselines, rolling averages, deviation detection (137 lines)
│   │   ├── ai-analysis.js             # Anthropic API risk analysis per agent (113 lines)
│   │   ├── exports.js                 # JSON/CSV/HTML report export with save dialogs (170 lines)
│   │   └── tray-icon.js               # System tray with procedural PNG icon + notifications (125 lines)
│   ├── renderer/
│   │   ├── index.html                 # Dashboard HTML shell, 4 tab views + overlays (327 lines)
│   │   ├── state.js                   # Global DOM refs, tracking objects, permissions cache (190 lines)
│   │   ├── helpers.js                 # Formatting, sparklines, toast, file-type detection (177 lines)
│   │   ├── theme.js                   # Dark/light toggle with persistence (35 lines)
│   │   ├── risk-scoring.js            # Time-decay risk engine + trust grades (156 lines)
│   │   ├── radar-state.js             # Radar constants, node definitions, threat colors (94 lines)
│   │   ├── radar-draw.js              # Canvas: background, sweep arm, center core, system nodes (193 lines)
│   │   ├── radar-engine.js            # Canvas: agent orbits, connection lines, animation loop (186 lines)
│   │   ├── permissions.js             # Protection presets + tri-state permission controls (178 lines)
│   │   ├── agent-panel.js             # Agent card HTML with trust bars, sparklines, baselines (119 lines)
│   │   ├── agent-render.js            # Agent list rendering, click handlers, radar sync (124 lines)
│   │   ├── activity-feed.js           # Feed entries, permission enforcement, show-more (163 lines)
│   │   ├── network-panel.js           # Network connection rendering + domain classification (110 lines)
│   │   ├── reports.js                 # Activity tab filtering + Reports tab aggregate table (184 lines)
│   │   ├── settings.js                # Settings panel, export handlers, pattern management (135 lines)
│   │   └── analysis.js                # Analysis modal open/close (33 lines)
│   ├── shared/
│   │   └── constants.js               # Sensitive rules, ignore patterns, permission categories (91 lines)
│   └── styles/
│       ├── variables.css              # CSS custom properties, theme tokens (55 lines)
│       ├── base.css                   # Body, header, footer, layout reset (159 lines)
│       ├── radar.css                  # Radar container, meta pills, threat colors (102 lines)
│       ├── panels.css                 # Agent cards, activity feed, network panel (186 lines)
│       ├── components.css             # Buttons, badges, toast, trust bars, presets (182 lines)
│       ├── settings.css               # Settings overlay, analysis modal, patterns (200 lines)
│       ├── tabs.css                   # Tab bar, tab pills, tab views (124 lines)
│       └── responsive.css             # Media queries for smaller viewports (70 lines)
```

Total: **5,147 lines** across **36 source files**.

## Architecture

### Main Process — 10 modules

**main.js** — Orchestrator (128 lines)
- Wires all sub-modules via init() calls with dependency injection
- Registers 16 IPC handlers
- Manages scan intervals (process scan + file scan + network scan)
- Staggered startup: process scan at 3s, file scan at 5s, network at 8s
- Single-instance lock, system tray lifecycle, baseline finalization on quit

**config-manager.js** — Settings persistence (164 lines)
- Loads/saves `settings.json` in Electron's `userData` directory
- Default settings: 10s scan interval, notifications on, no API key
- Custom sensitive pattern compilation (user-defined regex rules)
- Per-agent permission defaults: known agents → "monitor", unknown → "block"
- Tracks seen agents and persists their permission state

**process-scanner.js** — Agent detection (194 lines)
- Loads agent signatures from `agent-database.json` (13+ agents)
- Scans via `tasklist /FO CSV /NH` on Windows
- Pattern matching: process name substring against known agent patterns
- Parent chain resolution via single PowerShell call with 60s TTL cache
- Deduplication by PID, change detection for triggering network rescans

**file-watcher.js** — File monitoring (141 lines)
- chokidar watchers on: `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.docker`, `~/.azure`, `~/.env*`, project dir
- Handle-based file scanning via PowerShell (`handle64.exe` or `Get-Process` fallback)
- Sensitive file classification against 40+ rules from `constants.js`
- 2-second debounce per file path, system-noise filtering
- Events attributed to first detected AI agent (limitation: cannot attribute per-process via chokidar)

**network-monitor.js** — Network scanning (177 lines)
- `Get-NetTCPConnection` via PowerShell, filtered to non-loopback established connections
- Reverse DNS resolution with 5-minute TTL cache
- Known-domain classification: 50+ safe domain patterns (Anthropic, OpenAI, GitHub, Azure, etc.)
- Agent-database domains merged into known list
- Connections flagged when domain is unknown or unresolvable

**baselines.js** — Behaviour baselines (137 lines)
- Per-agent session tracking: files, sensitive count, directories, network endpoints
- Rolling averages over last 10 sessions
- Deviation detection: 3x file volume, 3x sensitive count, new endpoints, 4+ new directories
- Persisted to `baselines.json`, finalized on app quit

**ai-analysis.js** — AI risk analysis (113 lines)
- Anthropic Messages API (`claude-sonnet-4-5-20250929`)
- Sends per-agent summary: file counts, sensitive files, network connections, parent chain
- Returns structured risk assessment: summary, findings, risk level, recommendations
- 30-second timeout, requires API key in settings

**exports.js** — Report generation (170 lines)
- JSON export: timestamped activity log with summary stats
- CSV export: activity log + network connections in flat format
- HTML report: dark-themed dashboard with summary cards, bar charts, sensitive alerts table, network table
- All use Electron save dialogs

**tray-icon.js** — System tray (125 lines)
- Procedural 16x16 PNG shield icon generation (no external assets)
- Color-coded by threat level: green (clear) / yellow (elevated) / red (critical)
- Context menu: Show Dashboard, Pause/Resume Monitoring, Quit
- Native notifications for sensitive file access (30s cooldown)

**preload.js** — IPC bridge (53 lines)
- `contextBridge.exposeInMainWorld('aegis', {...})`
- 17 invoke methods + 7 event listeners
- Context isolation enabled, node integration disabled

### Renderer — 15 scripts loaded in dependency order

Script load order in `index.html`:
1. `state.js` → DOM refs, tracking objects, permissions cache, agent database
2. `helpers.js` → formatDuration, formatUptime, escapeHtml, showToast, sparklines, file-type icons
3. `theme.js` → Dark/light mode toggle + persistence
4. `risk-scoring.js` → Time-decay weighted risk engine + trust grades (A+ through F)
5. `radar-state.js` → RADAR_NODES (8 system nodes), THREAT_COLORS, AGENT_COLORS, radarState object
6. `radar-draw.js` → Canvas: background, concentric rings, crosshairs, sweep arm, center core, system nodes
7. `radar-engine.js` → Canvas: agent orbit animation, connection lines, blocked flash, DPR handling
8. `permissions.js` → Protection presets (Paranoid/Strict/Balanced/Developer), tri-state permission UI
9. `agent-panel.js` → Agent card HTML: trust bar, sparkline, baseline tab, permissions tab
10. `agent-render.js` → Agent list rendering, click-to-filter, radar sync, analyze/expand handlers
11. `activity-feed.js` → Feed entry creation, AI/other event splitting, permission enforcement
12. `network-panel.js` → Network connection rendering, safe-domain classification, other-panel toggle
13. `reports.js` → Activity tab filtering + Reports tab aggregate stats table
14. `settings.js` → Export handlers, settings overlay, custom pattern management
15. `analysis.js` → Analysis modal open/close

### IPC Flow

```
Renderer                         Main Process
   │                                  │
   ├──scan-processes────────────────►│ tasklist scan + parent chains
   ├──get-stats─────────────────────►│ totalFiles, sensitive, agents, uptime
   ├──get-resource-usage────────────►│ CPU, memory, heap
   ├──get-settings──────────────────►│ Returns settings snapshot
   ├──save-settings─────────────────►│ Persist + restart watchers
   ├──get-all-permissions───────────►│ Full permission map + seen agents
   ├──get-agent-permissions─────────►│ Per-agent permission state
   ├──save-agent-permissions────────►│ Persist permission map
   ├──reset-permissions-to-defaults─►│ Reset all to defaults
   ├──get-agent-baseline────────────►│ Session history + averages
   ├──analyze-agent─────────────────►│ Anthropic API risk analysis
   ├──export-log────────────────────►│ JSON save dialog
   ├──export-csv────────────────────►│ CSV save dialog
   ├──generate-report───────────────►│ HTML report → open in browser
   ├──capture-screenshot────────────►│ webContents.capturePage → PNG
   ├──get-agent-database────────────►│ Full agent DB JSON
   ├──get-project-dir───────────────►│ Project root path
   ├──other-panel-expanded──────────►│ Toggle other-agent file scanning
   │                                  │
   │◄──scan-results─────────────────┤ Agent list (periodic)
   │◄──file-access──────────────────┤ File events (chokidar + handle scan)
   │◄──stats-update─────────────────┤ Updated stats
   │◄──network-update───────────────┤ Network connections
   │◄──resource-usage───────────────┤ CPU/memory metrics
   │◄──baseline-warnings────────────┤ Deviation alerts
   │◄──monitoring-paused────────────┤ Pause/resume state
```

### Radar Visualization Pipeline

Canvas-based, 60fps `requestAnimationFrame` loop:
1. **Background** — Radial pearl gradient, 4 concentric rings (25/50/75/100%), 8 crosshair lines
2. **Sweep arm** — Rotating teal arm with 40-step gradient trail + tip dot
3. **Blocked flash** — Brief red overlay when permission denies access
4. **Connection lines** — Animated lines from agent orbit to system node, with traveling dot, 2s lifespan
5. **Agent orbits** — Detected AI agents orbit at r×0.55 with trails and labels; Claude pinned static
6. **System nodes** — 8 nodes around perimeter (SSH, Browser, ENV, AWS, Git, Docker, NPM, Kube) with pearl gradient + pulse effects
7. **Center core** — Threat-level glow (green/yellow/red) with label (CLEAR/MEDIUM/HIGH/CRITICAL)

DPR-aware rendering (`devicePixelRatio` scaling).

### Risk Scoring Formula

Weighted, time-decay model:
- `sensitive × 10` — sensitive file access (strongest signal)
- `config × 5` — config file access
- `network × 3` — outbound connections
- `unknownDomain × 15` — connections to unrecognized domains
- `files × 0.1` (capped at 10) — general file volume
- Multiplier: trusted agents (default trust ≥ 70) get 0.5× reduction
- Files inside the project working directory are excluded from scoring
- Time decay: 1.0× (recent), 0.5× (>1hr), 0.1× (>24hr)

Trust score: `baseTrust - riskScore × 0.8`, graded A+ through F.

## Known AI Agent Signatures

Loaded from `agent-database.json` (13+ agents with metadata: display name, process patterns, icon, color, known domains, default trust score):
- Claude Code, GitHub Copilot, OpenAI Codex, Cursor AI
- Devin, Manus AI, Windsurf, Tabnine
- Amazon Q, Sourcegraph Cody, Replit AI, JetBrains AI
- Aider + wildcard detection for unknown agents

## Sensitive File Rules

Defined in `src/shared/constants.js` — 40+ patterns:
- **SSH:** `.ssh/`, `id_rsa`, `id_ed25519`, `id_ecdsa`, `known_hosts`, `authorized_keys`
- **Environment:** `.env`, `.env.local`, `.env.production`, `.env.*`
- **Credentials:** `password`, `credential`, `secret`, `token`, `api_key`
- **Keys:** `.pem`, `.key`, `.pfx`, `.p12`
- **Cloud:** `.aws/`, `.azure/`, `.gcloud/`, `.gnupg/`
- **Browser:** Chrome/Firefox/Edge passwords, cookies, autofill, history
- **Config:** `.npmrc`, `.pypirc`, `.docker/config.json`, `.kube/`
- **Git:** `.git-credentials`

## Design System — Neumorphism + Dark Mode

Dual-theme system with light (default) and dark mode toggle.

### Design Tokens (variables.css)
```css
/* Light mode */
--bg: #E0E5EC;
--shadow-dark: rgba(163,177,198,0.6);
--shadow-light: rgba(255,255,255,0.8);
--accent: #4ECDC4;
--red: #E53E3E;      /* critical */
--orange: #ED8936;   /* high */
--blue: #4299E1;     /* medium */
--green: #38A169;    /* low / safe */
--text: #2D3748;
--text-mid: #5A6577;
--text-dim: #8896A6;

/* Dark mode (.dark class on body) overrides via variables.css */
```

### Typography
- **Headings:** Plus Jakarta Sans, weight 700-800
- **Body/UI:** DM Sans, weight 400-600
- **Data/Code:** DM Mono, weight 400-500
- **Spacing:** letter-spacing: 2-3px for labels, -0.5px for large headings

### Color Usage
- Severity critical → red (#E53E3E)
- Severity high → orange (#ED8936)
- Severity medium → blue (#4299E1)
- Severity low → green (#38A169)
- Accent/brand → teal (#4ECDC4)
- Trust A/A+ → green, B/C → yellow, D/F → red
- Network: safe domain → green, unknown → dim, flagged → yellow/red

## What's Done (Features Working)

- [x] Detection of 13+ AI agents + wildcard matching (from agent-database.json)
- [x] File monitoring via chokidar (sensitive dirs + project dir + .env*)
- [x] Handle-based file scanning via PowerShell (per-process file access)
- [x] Network monitoring (Get-NetTCPConnection + DNS reverse lookup + domain classification)
- [x] Risk scoring per agent (weighted, time-decay, trust-adjusted)
- [x] Trust grades (A+ through F) with visual trust bars
- [x] System tray with procedural shield icon + native notifications
- [x] Export reports (JSON/CSV/HTML with save dialogs)
- [x] Settings panel (scan interval, notifications, API key, custom patterns)
- [x] AI analysis via Anthropic API (per-agent risk assessment)
- [x] Behaviour baselines with deviation warnings (3+ sessions)
- [x] 4 tab views: Shield (radar), Activity (filtered feed), Rules (permissions), Reports (aggregates)
- [x] Canvas radar: concentric rings, sweep arm, agent orbits, connection lines, system nodes, center core
- [x] Two-column layout: radar+feed left, agents right, network+other bottom
- [x] Header pills: shield score, streak, agents, files, uptime
- [x] Footer status bar: CPU, memory, heap, scan interval
- [x] Protection presets (Paranoid/Strict/Balanced/Developer)
- [x] Per-agent permissions (6 categories × tri-state allow/monitor/block)
- [x] Agent cards with sparklines, session duration, parent chain, expand tabs
- [x] Dark/light theme toggle with persistence
- [x] Click-to-filter: select agent to filter feed + network
- [x] Process enter/exit animations with toast notifications
- [x] Activity tab with agent/severity/filetype filters
- [x] Reports tab with per-agent aggregate table sorted by risk

## Roadmap (What's NOT Done)

### Known Issues
- [ ] `backgroundColor: '#0a0e17'` in main.js is stale dark theme — flash on load in light mode
- [ ] Demo mode (browser, no Electron) removed during modularization — needs reimplementing if needed

### Launch Prep
- [ ] README.md rewrite (GIF demo, badges, proper install instructions)
- [ ] CONTRIBUTING.md
- [ ] SECURITY.md
- [ ] ARCHITECTURE.md (detailed)
- [ ] GitHub Issues (20+ covering roadmap items)
- [ ] GitHub Releases (alpha → beta → v0.1.0)
- [ ] GitHub Actions (CI/CD, auto-build)

### Future Features
- [ ] True per-process file attribution (ETW on Windows, fanotify on Linux)
- [ ] OS-level enforcement via kernel hooks (Minifilter/Endpoint Security/eBPF)
- [ ] Mac/Linux process detection (partially implemented via `ps aux`)
- [ ] electron-builder packaging (NSIS installer for Windows)

### Grant Applications
- [ ] OpenAI Cybersecurity Grant — $10K, rolling basis, 3000 words plaintext
- [ ] NRC IRAP — up to $50K for Canadian small business
- [ ] RAII — $250K-$5M (needs 50% co-funding)

## Positioning

### Consumer Layer
Free open-source desktop monitor for developers. MIT license. "Antivirus but for AI agents."

### Government Layer
Canadian AI Agent Audit Platform — sovereign visibility into foreign AI agents operating on Canadian systems. Aligns with Canadian AI & Data Act (AIDA).

### Competitors (all enterprise B2B, different focus)
- **Lasso Security** — monitors AI app usage in orgs
- **PromptArmor** — prompt injection defense
- **Prompt Security** — DLP for AI tools
- **Nightfall AI** — data loss prevention
- **WitnessAI** — AI usage governance

None of them monitor what agents DO on local machines. That's AEGIS.

## Monetization Path
1. OpenAI Cybersecurity Grant ($10K) — apply after GitHub launch
2. NRC IRAP ($50K) — Canadian small business R&D funding
3. Pre-seed angels after traction (GitHub stars + HN post)
4. RAII ($250K-$5M) — later, needs co-funding

## Code Conventions

- **Module pattern:** Main process uses CommonJS (`require`/`module.exports`) with `init()` dependency injection
- **Renderer:** Global functions via `<script>` tags in load-order; no imports/exports
- **Variables:** `const` over `let` when possible
- **Template literals** for HTML generation in renderer
- **IPC channels:** kebab-case (`scan-processes`, `get-stats`, `file-access`)
- **Event severity:** critical > high > medium > low
- **CSS class naming:** `component-element` pattern (e.g., `agent-card`, `feed-entry`, `trust-bar-fill`)
- **Section comments:** `// ═══ SECTION NAME ═══` for major sections, `// ── subsection ──` for minor
- **User-facing text:** UPPERCASE for labels, Title Case for names
- **JSDoc:** All exported functions have `@param`, `@returns`, `@since` tags
- **CSS:** 7 files split by concern (variables, base, radar, panels, components, settings, tabs, responsive)

## Important Notes

- The app currently MONITORS only — it does NOT enforce/block anything at OS level. Permission states (allow/monitor/block) affect UI display only. True blocking requires kernel-level hooks (Minifilter on Windows, Endpoint Security on Mac, eBPF on Linux). This is post-MVP.
- Process detection is Windows-focused (tasklist + PowerShell). Mac/Linux support (ps aux) is not yet implemented.
- chokidar watchers detect file changes but cannot attribute them to specific processes. Events are attributed to the first detected AI agent. True per-process attribution needs ETW (Windows) or fanotify (Linux).
- Handle-based scanning (`file-watcher.js:scanFileHandles`) requires `handle64.exe` from Sysinternals for best results; falls back to `Get-Process` module enumeration.
- The `agent-database.json` lives at project root (not in src/shared/) but is read by `process-scanner.js` and `network-monitor.js` via relative path.

## Related Ideas (Separate Projects)

- **CodeMap / RepoLens** — Interactive visualizer for open-source projects with AI explanations of code blocks
- **Privacy Presets** — Firefox browser extension for one-click privacy configuration through preset modes
