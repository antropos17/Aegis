# AEGIS Architecture

## Mission

AEGIS is an **Independent AI Oversight Layer** — achieving ~95% user-level observability of AI agent behavior without kernel drivers. When AI is embedded in operating systems, browsers, and applications, oversight must not belong to those same companies. AEGIS provides independent, open-source, privacy-first monitoring that runs entirely on the user's machine.

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          ELECTRON APP                                   │
│                                                                         │
│  ┌──────────────────────────────┐     ┌──────────────────────────────┐  │
│  │       MAIN PROCESS           │     │      RENDERER PROCESS        │  │
│  │                              │     │                              │  │
│  │  ┌────────────────────────┐  │     │  ┌────────────────────────┐  │  │
│  │  │  OBSERVABILITY LAYER   │  │     │  │   VISUALIZATION LAYER  │  │  │
│  │  │                        │  │     │  │                        │  │  │
│  │  │  process-scanner.js    │──┼──►  │  │  Radar.svelte (canvas) │  │  │
│  │  │  file-watcher.js       │──┼──►  │  │  Timeline.svelte       │  │  │
│  │  │  network-monitor.js    │──┼──►  │  │  ActivityFeed.svelte   │  │  │
│  │  │  baselines.js          │──┼──►  │  │  AgentPanel.svelte     │  │  │
│  │  │  ai-analysis.js        │──┼──►  │  │  NetworkPanel.svelte   │  │  │
│  │  │  audit-logger.js       │  │     │  │  Reports.svelte        │  │  │
│  │  └────────────────────────┘  │     │  └────────────────────────┘  │  │
│  │                              │     │                              │  │
│  │  ┌────────────────────────┐  │     │  ┌────────────────────────┐  │  │
│  │  │  INFRASTRUCTURE        │  │     │  │   INTELLIGENCE LAYER   │  │  │
│  │  │                        │  │     │  │                        │  │  │
│  │  │  config-manager.js     │  │     │  │  ipc.js (store)        │  │  │
│  │  │  exports.js            │  │     │  │  risk.js (store)       │  │  │
│  │  │  tray-icon.js          │  │     │  │  theme.js (store)      │  │  │
│  │  └────────────────────────┘  │     │  └────────────────────────┘  │  │
│  │                              │     │                              │  │
│  │          main.js             │     │       App.svelte              │  │
│  │       (orchestrator)         │     │    (root component)           │  │
│  └───────────────┬──────────────┘     └──────────────┬───────────────┘  │
│                  │          preload.js                │                  │
│                  └─────── (IPC bridge) ───────────────┘                  │
│                     contextBridge API (20+ channels)                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────┐
                    │     LOCAL STORAGE          │
                    │                           │
                    │  settings.json            │
                    │  baselines.json           │
                    │  audit-logs/*.json (JSONL) │
                    └───────────────────────────┘
```

## Observability Layers

### What's Covered Now

#### 1. Process Intelligence — `process-scanner.js`
- **What it sees:** All running processes matched against 94 agent signatures
- **How:** `tasklist /FO CSV /NH` on Windows, pattern matching against known process names
- **Depth:** Parent-child process tree resolution via PowerShell (60s TTL cache), IDE host app detection (e.g., "Copilot inside VS Code"), PID tracking for enter/exit events
- **Coverage:** ~95% of known AI agents. Unknown agents detected via wildcard patterns.

#### 2. File & Data Access — `file-watcher.js` + `constants.js`
- **What it sees:** File create/modify/delete in sensitive directories, per-process file handles
- **How:** chokidar watchers on `.ssh`, `.aws`, `.gnupg`, `.kube`, `.docker`, `.azure`, `.env*`, 27 agent config directories, project directory. PowerShell handle scanning (`handle64.exe` or `Get-Process` fallback).
- **Depth:** 70+ sensitive file patterns with severity classification. AI agent config directory protection (Hudson Rock threat vector). 2-second debounce per path.
- **Limitation:** chokidar cannot attribute events to specific processes. Handle scanning provides per-process attribution but runs on a timer.

#### 3. Network Intelligence — `network-monitor.js`
- **What it sees:** All outbound TCP connections for detected agent PIDs
- **How:** `Get-NetTCPConnection` via PowerShell, filtered by PID. Reverse DNS with 5-minute cache.
- **Depth:** Domain classification against 50+ known-safe vendor patterns (from agent database). Unknown domains flagged. Connection state tracking.
- **Limitation:** Cannot inspect encrypted traffic. Sees endpoints but not payload.

#### 4. Risk Engine — `risk-scoring.js` + `baselines.js`
- **What it computes:** Per-agent risk scores (0-100+), trust grades (A+ through F), anomaly scores (0-100)
- **Risk formula:** `Base = min(40, log2(1 + sensitiveFiles) * 8)` + `Network = min(30, unknownDomains * 12)` + `Anomaly = min(30, anomalyScore * 0.3)` → `Total = min(100, Base + Network + Anomaly)`
- **Anomaly scoring:** 5 weighted factors — file volume (30pts), sensitive spike (25pts), new sensitive categories (20pts), new network endpoints (15pts), unusual timing (10pts)
- **Baselines:** Rolling averages over 10 sessions, persisted to `baselines.json`

#### 5. AI Analysis — `ai-analysis.js`
- **What it provides:** Structured threat assessment with executive summary, findings, risk rating, recommendations
- **How:** Anthropic Messages API (`claude-sonnet-4-5-20250929`) with session data context
- **Modes:** Per-agent analysis and full-session analysis
- **Privacy:** Only triggered when user explicitly clicks the button. No background API calls.

#### 6. Audit Trail — `audit-logger.js`
- **What it logs:** 7 event types — file-access, network-connection, anomaly-alert, permission-deny, agent-enter, agent-exit, config-access
- **Format:** Append-only JSONL. Each entry: `{timestamp, type, agent, action, path, severity, riskScore, details}`
- **Rotation:** New file per day (`aegis-audit-YYYY-MM-DD.json`), auto-delete after 30 days
- **Performance:** Buffered writes — flush every 5 seconds or at 50 events

#### 7. Resource Analytics
- **What it shows:** AEGIS's own CPU usage, memory (RSS), heap usage, scan interval
- **Where:** Footer status bar, updated every scan cycle

### What's NOT Covered Yet (Blind Spots → Future Work)

| Blind Spot | Description | Planned Approach |
|---|---|---|
| **UI Awareness** | Cannot see what AI agents display or interact with in UI | Accessibility API monitoring (no screen capture) |
| **Container/VM Detection** | Detected — 7 container/VM agents added (Docker, WSL, Ollama, LM Studio, LocalAI, GPT4All, Jan) | Process pattern matching for containers + GPU monitoring |
| **Sandbox Containment** | Monitor-only — cannot isolate or restrict agents | Job Objects (Windows), AppContainer, Linux namespaces |
| **GPU Monitoring** | Cannot detect local inference processes | GPU utilization APIs, process GPU memory tracking |
| **Deep Packet Inspection** | Sees TCP endpoints but not encrypted payloads | TLS interception proxy with user consent |
| **Syscall Monitoring** | No kernel-level visibility into system calls | Windows Minifilter, macOS Endpoint Security, Linux eBPF |
| **Memory Inspection** | Cannot inspect agent process memory | ReadProcessMemory API, `/proc/[pid]/mem` |
| **Cross-device Correlation** | Single-machine visibility only | Local network discovery + shared audit format |
| **Mac/Linux Support** | Process scanning is Windows-only | `ps aux`, `fanotify`, `ss`/`lsof` implementations |

## Module Dependency Diagram

```
agent-database.json
        │
        ▼
process-scanner.js ◄──── config-manager.js
        │                       │
        ├──► file-watcher.js ◄──┘
        │         │
        ├──► network-monitor.js
        │         │
        ▼         ▼
   baselines.js ◄─┘
        │
        ├──► ai-analysis.js
        │
        ▼
  audit-logger.js

        │
        ▼
     main.js (wires everything, manages intervals)
        │
        ▼ IPC via preload.js
        │
     App.svelte (root component)
        │
        ├──► stores/ (ipc.js, risk.js, theme.js)
        ├──► ShieldTab → Radar, AgentPanel, Timeline
        ├──► ActivityTab → ActivityFeed, NetworkPanel
        ├──► RulesTab → Presets, Permissions, AgentDatabase
        ├──► ReportsTab → Reports, AuditLog, ThreatAnalysis
        └──► Settings, Header, Footer
```

## Data Flow

```
Process Scan (every Ns)
    │
    ├──► Agent list ──► Renderer (scan-results)
    │                   ├──► Radar visualization (agent orbits)
    │                   ├──► Agent cards (trust bars, sparklines)
    │                   ├──► Risk scoring (time-decay weighted)
    │                   └──► Agent enter/exit → Audit log
    │
    ├──► File Handle Scan (every 3Ns)
    │    └──► File events ──► Renderer (file-access)
    │         │               ├──► Activity feed
    │         │               ├──► Session timeline
    │         │               └──► Stats update
    │         └──► Audit log (file-access / config-access)
    │
    ├──► Network Scan (every 30s + on agent change)
    │    └──► Connections ──► Renderer (network-update)
    │         │               ├──► Network panel
    │         │               └──► Session timeline
    │         └──► Audit log (network-connection)
    │
    ├──► Baseline Check
    │    └──► Deviations ──► Renderer (baseline-warnings)
    │         │               ├──► Toast notifications
    │         │               ├──► Anomaly feed entries
    │         │               └──► Session timeline
    │         └──► Audit log (anomaly-alert)
    │
    └──► Anomaly Scores ──► Renderer (anomaly-scores)
                            └──► Agent card badges
```

## IPC Channel Reference

### Invoke (Renderer → Main → Response)

| Channel | Module | Purpose |
|---|---|---|
| `scan-processes` | process-scanner | Trigger manual process scan |
| `get-stats` | main | File counts, agent counts, uptime |
| `get-resource-usage` | main | CPU, memory, heap metrics |
| `get-settings` | config-manager | Read settings |
| `save-settings` | config-manager | Persist settings + restart watchers |
| `get-all-permissions` | config-manager | Full permission map + seen agents |
| `get-agent-permissions` | config-manager | Per-agent permission state |
| `save-agent-permissions` | config-manager | Persist permission map |
| `reset-permissions-to-defaults` | config-manager | Reset all permissions |
| `get-agent-baseline` | baselines | Per-agent session history + averages |
| `analyze-agent` | ai-analysis | Per-agent AI threat analysis |
| `analyze-session` | ai-analysis | Full session AI threat analysis |
| `open-threat-report` | main | Write HTML to temp + open in browser |
| `get-audit-stats` | audit-logger | Audit log statistics |
| `open-audit-log-dir` | audit-logger | Open audit directory in explorer |
| `export-full-audit` | audit-logger | Export all logs to single JSON |
| `export-log` | exports | JSON save dialog |
| `export-csv` | exports | CSV save dialog |
| `generate-report` | exports | HTML report → open in browser |
| `get-agent-database` | process-scanner | Full agent signature database |
| `get-project-dir` | main | Project root path |
| `get-custom-agents` | config-manager | User-defined agent list |
| `save-custom-agents` | config-manager | Persist custom agents |
| `export-agent-database` | main | Export agents to JSON file |
| `import-agent-database` | main | Import agents from JSON file |
| `capture-screenshot` | main | Capture window as PNG |
| `kill-process` | main | Terminate process by PID |
| `suspend-process` | main | Suspend process via NtSuspendProcess |
| `resume-process` | main | Resume process via NtResumeProcess |

### Send (Renderer → Main, no response)

| Channel | Purpose |
|---|---|
| `other-panel-expanded` | Toggle other-agent file scanning |

### Push (Main → Renderer)

| Channel | Purpose |
|---|---|
| `scan-results` | Updated agent list (periodic) |
| `file-access` | New file access events |
| `stats-update` | Updated aggregate stats |
| `network-update` | Network connections |
| `resource-usage` | CPU/memory metrics |
| `baseline-warnings` | Behavioral deviations |
| `anomaly-scores` | Per-agent anomaly scores (0-100) |
| `monitoring-paused` | Pause/resume state from tray |

## Extension Points

### Adding a New Agent Signature
Edit `agent-database.json` — add entry with `processPatterns`, `knownDomains`, `configPaths`, and trust/risk metadata. The process scanner, network monitor, and file watcher all consume this database automatically.

### Adding New Sensitive File Rules
Edit `src/shared/constants.js` — add to `SENSITIVE_RULES` array:
```javascript
{ pattern: /my-pattern/i, reason: 'Display reason', category: 'my-cat', severity: 'critical' }
```

### Adding a New Monitoring Module
1. Create `src/main/new-module.js` with `init(state)` pattern
2. Wire in `main.js` via dependency injection
3. Add IPC handler in `registerIpc()` if renderer needs access
4. Add bridge method in `preload.js`
5. Add audit logging via `aud.log(type, details)`

### Adding a New UI Panel
1. Create `src/renderer/src/lib/components/NewPanel.svelte`
2. Import and place the component in the appropriate tab (e.g., `ShieldTab.svelte`, `ActivityTab.svelte`)
3. Subscribe to IPC data via Svelte stores in `src/renderer/src/lib/stores/`
4. Use scoped styles within the `.svelte` file (follows project CSS conventions)

### Adding Platform Support
The main process modules abstract OS-specific operations:
- `process-scanner.js` — Replace `tasklist` with `ps aux` for Unix
- `file-watcher.js` — chokidar is cross-platform; handle scanning needs `lsof` fallback
- `network-monitor.js` — Replace `Get-NetTCPConnection` with `ss` or `lsof -i`

## Privacy Architecture

AEGIS is designed with privacy as a core architectural constraint:

- **All data stays local.** Settings, baselines, and audit logs are stored in Electron's userData directory. Nothing leaves the machine unless the user explicitly exports it.
- **No telemetry.** AEGIS does not phone home. No analytics, no crash reporting, no usage tracking.
- **No cloud sync.** There is no account system, no server, no cloud backend.
- **AI analysis is opt-in.** Calls to the Anthropic API happen only when the user explicitly clicks "Run AI Threat Analysis." The API key is user-provided and stored locally.
- **Audit logs are metadata-only.** File paths and agent names are logged. File contents are never read, stored, or transmitted.
- **Open-source transparency.** Every line of monitoring, scoring, and analysis logic is visible in the source code. There are no hidden behaviors.
