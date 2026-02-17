# AEGIS Architecture

## System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        ELECTRON APP                              │
│                                                                  │
│  ┌─────────────────────────┐    ┌─────────────────────────────┐  │
│  │     MAIN PROCESS        │    │     RENDERER PROCESS        │  │
│  │                         │    │                             │  │
│  │  process-scanner.js ────┼──► │  state.js (global state)   │  │
│  │  file-watcher.js ───────┼──► │  risk-scoring.js           │  │
│  │  network-monitor.js ────┼──► │  radar-*.js (canvas)       │  │
│  │  baselines.js ──────────┼──► │  agent-panel.js            │  │
│  │  ai-analysis.js ────────┼──► │  activity-feed.js          │  │
│  │  audit-logger.js ───────┤    │  timeline.js               │  │
│  │  config-manager.js      │    │  network-panel.js          │  │
│  │  exports.js             │    │  reports.js                │  │
│  │  tray-icon.js           │    │  settings.js               │  │
│  │                         │    │  permissions.js            │  │
│  │         main.js         │    │  app.js (orchestrator)     │  │
│  │      (orchestrator)     │    │                             │  │
│  └────────────┬────────────┘    └──────────────┬──────────────┘  │
│               │          preload.js            │                 │
│               └──────── (IPC bridge) ──────────┘                 │
│                    contextBridge API                              │
└──────────────────────────────────────────────────────────────────┘
```

## Main Process Modules

### main.js — Orchestrator
Wires all sub-modules via `init()` dependency injection. Registers IPC handlers. Manages three scan intervals (process, file, network) with staggered startup (3s, 5s, 8s). Handles single-instance lock, tray lifecycle, and baseline finalization on quit.

### process-scanner.js — Agent Detection
Loads 88 agent signatures from `agent-database.json`. Scans via `tasklist /FO CSV /NH`. Pattern-matches process names against known signatures. Resolves parent process chains via PowerShell with 60s TTL cache. Deduplicates by PID. Detects host apps (e.g., "Copilot inside VS Code").

### file-watcher.js — File Monitoring
Two monitoring approaches running in parallel:
1. **chokidar watchers** on sensitive directories (`.ssh`, `.aws`, `.gnupg`, `.kube`, `.docker`, `.azure`, `.env*`, agent config dirs, project dir)
2. **Handle-based scanning** via PowerShell (`handle64.exe` or `Get-Process` fallback) for per-process file access

Classifies files against 70+ sensitive patterns from `constants.js`. 2-second debounce per path.

### network-monitor.js — Network Scanning
`Get-NetTCPConnection` via PowerShell, filtered to agent PIDs. Reverse DNS with 5-minute cache. Domain classification against 50+ known-safe patterns (vendor domains from agent database). Connections flagged when domain is unknown.

### baselines.js — Anomaly Detection
Per-agent session tracking: files, sensitive count, directories, endpoints, sensitive reasons, active hours. Rolling averages over 10 sessions. Anomaly scoring (0-100) with 5 weighted factors:
- File volume vs baseline (30 points)
- Sensitive file spike (25 points)
- New sensitive categories (20 points)
- New network endpoints (15 points)
- Unusual timing (10 points)

### ai-analysis.js — AI Threat Assessment
Two analysis modes:
1. **Per-agent** — File counts, sensitive details, network connections, parent chain
2. **Full session** — All agents, anomaly scores, config accesses, network summary

Both use Anthropic Messages API (`claude-sonnet-4-5-20250929`) with structured prompts.

### audit-logger.js — Persistent Audit Trail
Append-only JSONL logs at `userData/audit-logs/aegis-audit-YYYY-MM-DD.json`. Seven event types: file-access, network-connection, anomaly-alert, permission-deny, agent-enter, agent-exit, config-access. Buffered writes (flush every 5s or 50 events). 30-day retention with auto-cleanup.

### config-manager.js — Settings Persistence
`settings.json` in Electron userData. Stores scan interval, notification preferences, API key, custom sensitive patterns, per-agent permissions, seen agents list.

### exports.js — Report Generation
Three export formats: JSON (timestamped activity log), CSV (flat format), HTML (styled dashboard report with charts). All use Electron save dialogs.

### tray-icon.js — System Tray
Procedural 16x16 PNG shield icon (no external assets). Color-coded by threat level. Context menu for show/pause/quit. Native notifications for sensitive access.

## Renderer Architecture

### Script Load Order
Scripts are loaded via `<script>` tags in dependency order:

```
1. state.js          → DOM refs, global state, permissions cache
2. helpers.js        → Formatting, sparklines, toast, file-type detection
3. theme.js          → Dark/light toggle
4. risk-scoring.js   → Time-decay risk engine, trust grades
5. radar-state.js    → Radar constants, node definitions
6. radar-draw.js     → Canvas background, rings, sweep arm, nodes
7. radar-engine.js   → Agent orbits, connection lines, animation loop
8. permissions.js    → Protection presets, tri-state controls
9. agent-database-ui.js → Agent database manager UI
10. agent-panel.js   → Agent card HTML rendering
11. agent-render.js  → Agent list, click handlers, radar sync
12. activity-feed.js → Feed entries, permission enforcement
13. network-panel.js → Network connection rendering
14. timeline.js      → Session event timeline
15. reports.js       → Activity filters, reports table, audit UI
16. settings.js      → Settings panel, export handlers
17. analysis.js      → Analysis modal
18. app.js           → Tab navigation, IPC listeners, init
```

All functions and variables are global (no module system). Load order matters.

### Risk Scoring Formula

```
score = (sensitive * 10) + (config * 5) + (network * 3) + (unknownDomain * 15) + min(files * 0.1, 10)

multiplier = trustedAgent ? 0.5 : 1.0
timeDecay  = recent(1.0) | >1hr(0.5) | >24hr(0.1)

finalScore = score * multiplier * timeDecay
trustScore = baseTrust - riskScore * 0.8   // Graded A+ through F
```

Files inside the project working directory are excluded from scoring.

## Data Flow

```
Process Scan (every Ns)
    │
    ├──► Agent list ──► Renderer (scan-results)
    │                   ├──► Radar visualization
    │                   ├──► Agent cards
    │                   └──► Risk scoring
    │
    ├──► File Handle Scan (every 3Ns)
    │    └──► File events ──► Renderer (file-access)
    │                        ├──► Activity feed
    │                        ├──► Timeline
    │                        └──► Stats update
    │
    ├──► Network Scan (every 30s + on agent change)
    │    └──► Connections ──► Renderer (network-update)
    │                        ├──► Network panel
    │                        └──► Timeline
    │
    ├──► Baseline Check
    │    └──► Deviations ──► Renderer (baseline-warnings)
    │                       ├──► Toast notifications
    │                       ├──► Anomaly feed entries
    │                       └──► Timeline
    │
    └──► Anomaly Scores ──► Renderer (anomaly-scores)
                            └──► Agent card badges

All events ──► Audit Logger ──► Daily JSONL files
```

## IPC Channel Reference

### Invoke (Renderer → Main → Response)

| Channel | Purpose |
|---|---|
| `scan-processes` | Trigger manual process scan |
| `get-stats` | File counts, agent counts, uptime |
| `get-resource-usage` | CPU, memory, heap metrics |
| `get-settings` / `save-settings` | Settings CRUD |
| `get-all-permissions` / `save-agent-permissions` | Permission map |
| `get-agent-baseline` | Per-agent behavioral baseline |
| `analyze-agent` / `analyze-session` | AI threat analysis |
| `get-audit-stats` / `export-full-audit` | Audit log operations |
| `open-audit-log-dir` | Open audit directory in explorer |
| `export-log` / `export-csv` / `generate-report` | Data export |
| `get-agent-database` | Full agent signature database |
| `kill-process` / `suspend-process` / `resume-process` | Process control |

### Push (Main → Renderer)

| Channel | Purpose |
|---|---|
| `scan-results` | Updated agent list (periodic) |
| `file-access` | New file access events |
| `stats-update` | Updated aggregate stats |
| `network-update` | Network connections |
| `resource-usage` | CPU/memory metrics |
| `baseline-warnings` | Behavioral deviations |
| `anomaly-scores` | Per-agent anomaly scores |
| `monitoring-paused` | Pause/resume state |

## Extension Points

### Adding a New Monitoring Source
1. Create module in `src/main/` with `init()` pattern
2. Wire in `main.js` with dependency injection
3. Add IPC handler in `registerIpc()` if renderer needs data
4. Add bridge method in `preload.js`
5. Create renderer component to display data

### Adding a New Agent Signature
Add entry to `agent-database.json` with process patterns, known domains, config paths, and trust/risk metadata. The process scanner, network monitor, and file watcher all consume this database.

### Adding a New Sensitive File Rule
Add pattern to `SENSITIVE_RULES` in `src/shared/constants.js` with `pattern` (regex), `reason` (display string), optional `category` and `severity` fields.

### Adding Platform Support
The main process modules abstract OS-specific operations:
- `process-scanner.js` — Replace `tasklist` command with `ps aux` for Unix
- `file-watcher.js` — chokidar is cross-platform; handle scanning needs `lsof` fallback
- `network-monitor.js` — Replace `Get-NetTCPConnection` with `ss` or `lsof -i`
