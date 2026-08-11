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
│  │  │  logger.js             │  │     │  │  toast.js (store)      │  │  │
│  │  │  scoring-utils.js      │  │     │  │  demo-data.js (store)  │  │  │
│  │  │  ipc-batcher.js        │  │     │  │                        │  │  │
│  │  │  zip-writer.js         │  │     │  │                        │  │  │
│  │  │  scan-loop.js          │  │     │  │                        │  │  │
│  │  └────────────────────────┘  │     │  └────────────────────────┘  │  │
│  │                              │     │                              │  │
│  │          main.js             │     │       App.svelte              │  │
│  │       (orchestrator)         │     │    (root component)           │  │
│  └───────────────┬──────────────┘     └──────────────┬───────────────┘  │
│                  │          preload.js                │                  │
│                  └─────── (IPC bridge) ───────────────┘                  │
│              contextBridge API (49 channels: 40 invoke + 9 push)        │
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
- **What it sees:** All running processes matched against 110 agent signatures
- **How:** `tasklist /FO CSV /NH` on Windows, pattern matching against known process names
- **Depth:** Parent-child process tree resolution via PowerShell (60s TTL cache), IDE host app detection (e.g., "Copilot inside VS Code"), PID tracking for enter/exit events
- **Coverage:** ~95% of known AI agents. Unknown agents detected via wildcard patterns.

#### 2. File & Data Access — `file-watcher.js` + `rule-loader.js`
- **What it sees:** File create/modify/delete in sensitive directories, per-process file handles
- **How:** chokidar watchers on `.ssh`, `.aws`, `.gnupg`, `.kube`, `.docker`, `.azure`, `.env*`, the 35 directories in `AGENT_CONFIG_PATHS` (minus those already covered as sensitive dirs), and the project directory. Open-handle detection is per-platform: Windows uses the Restart Manager (`rstrtmgr.dll`), macOS/Linux use `lsof` / `/proc`.
- **Depth:** 73 sensitive file rules (from `rules/*.yaml`) with severity classification. AI agent config directory protection (Hudson Rock threat vector). 2-second debounce per path.
- **Limitation:** chokidar cannot attribute events to specific processes. Handle scanning provides per-process attribution but runs on a timer.

#### 3. Network Intelligence — `network-monitor.js`
- **What it sees:** All outbound TCP connections for detected agent PIDs
- **How:** `Get-NetTCPConnection` via PowerShell, filtered by PID. Reverse DNS with 5-minute cache.
- **Depth:** Domain classification against 50+ known-safe vendor patterns (from agent database). Unknown domains flagged. Connection state tracking.
- **Limitation:** Cannot inspect encrypted traffic. Sees endpoints but not payload.

#### 4. Risk Engine — `src/renderer/lib/utils/risk-scoring.js` + `src/main/anomaly-detector.js` + `src/main/baselines.js`
- **What it computes:** Per-agent risk scores (0-100), trust grades (A+ through F), anomaly scores (0-100)
- **Where it runs:** risk scoring lives in the RENDERER (`lib/utils/risk-scoring.js`); there is no `src/main/risk-scoring.js`. Anomaly scoring and baselines are main-process modules.
- **Risk formula:** a sum of six independently capped contributions, each saturating so no single signal can dominate — `min(40, sensitive * 5 * (1 / (1 + sensitive * 0.1)))` + `min(20, sshAwsFiles * 5)` + `min(20, unknownDomains * 8)` + `min(10, networkCount * 0.5)` + `min(5, configFiles * 0.5)` + `min(5, fileCount * 0.02)`, the total clamped to 100. The sensitive term is deliberately sub-linear: the `1 / (1 + sensitive * 0.1)` damping is what stops `sensitive * 10` from pinning the score at 100 on the first burst (ai-mistakes.md #10).
- **Anomaly scoring:** 4 weighted dimensions, `composite = Σ(dimension.score × weight)` with `{network: 0.3, filesystem: 0.25, process: 0.25, baseline: 0.2}`. Individual signals such as file volume and sensitive-access spikes are sub-factors inside a dimension, not top-level weighted factors.
- **Baselines:** Rolling averages over 10 sessions, persisted to `baselines.json`

#### 5. AI Analysis — `ai-analysis.js`
- **What it provides:** Structured threat assessment with executive summary, findings, risk rating, recommendations
- **How:** Anthropic Messages API (`claude-haiku-4-5-20251001`, both call sites in `ai-analysis.js`) with session data context
- **Modes:** Per-agent analysis and full-session analysis
- **Privacy:** Only triggered when user explicitly clicks the button. No background API calls.

#### 6. Audit Trail — `audit-logger.js`
- **What it logs:** 6 event types are actually emitted — file-access, config-access, network-connection, anomaly-alert, agent-enter, agent-exit. A 7th, `permission-deny`, is listed in the logger's JSDoc and accepted by the renderer timeline, but no call site emits it.
- **Format:** Append-only JSONL. Each entry: `{timestamp, type, agent, action, path, severity, riskScore, details, seq, hash}` — `seq` and `hash` are added at flush time by `audit-hashchain.js`, which makes each daily file an independent SHA-256 chain. The chain proves no record was EDITED; it cannot prove none was lost, since a record that never reached disk leaves no gap.
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
| **Mac/Linux parity** | Narrower than it looks: `platform/darwin.js` and `platform/linux.js` both implement `listProcesses()` (via `ps`) and `suspendProcess()`/`resumeProcess()` (via `posix-shared.js`), so process scanning and stop/resume are cross-platform. What is Windows-only is open-handle detection via the Restart Manager (`rstrtmgr.dll`); POSIX falls back to `lsof` / `/proc` | `fanotify` (Linux) and Endpoint Security (macOS) for richer file-access attribution |

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
        ├──► stores/ (ipc.js, risk.js, theme.js, toast.js, demo-data.js)
        ├──► ShieldTab → Radar, AgentPanel, Timeline
        ├──► ActivityTab → ActivityFeed, NetworkPanel
        ├──► RulesTab → Presets, Permissions, AgentDatabase
        ├──► ReportsTab → Reports, AuditLog, ThreatAnalysis
        └──► Settings, Header, Footer, Toast
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

All 40 registered in `src/main/ipc-handlers.js` and exposed through `src/main/preload.js`. A
channel absent from `preload.js` is unreachable from the renderer under `contextIsolation`,
so this table is the complete surface — nothing else can be invoked.

| Channel | Module | Purpose |
|---|---|---|
| `get-stats` | main | File counts, agent counts, uptime, attribution counters |
| `get-resource-usage` | main | CPU, memory, heap metrics |
| `get-settings` | config-manager | Read settings |
| `save-settings` | config-manager + settings-validation | Validate, persist, restart watchers |
| `get-all-permissions` | config-manager | Agent + instance permission maps and seen agents |
| `save-agent-permissions` | config-manager | Persist per-agent permission map |
| `save-instance-permissions` | config-manager | Persist per-instance permission map |
| `reset-permissions-to-defaults` | config-manager | Reset all permissions |
| `analyze-agent` | ai-analysis | Per-agent AI threat analysis |
| `analyze-session` | ai-analysis | Full session AI threat analysis |
| `open-threat-report` | main | Write HTML to temp + open in browser |
| `get-audit-stats` | audit-logger | Entry counts, durability counters, size, date range |
| `open-audit-log-dir` | audit-logger | Open audit directory in the file manager |
| `export-full-audit` | audit-logger | Export all audit logs to a single JSON |
| `get-audit-entries-before` | audit-logger | Paginated audit log entries (cursor) |
| `export-log` | exports | JSON save dialog |
| `export-csv` | exports | CSV save dialog |
| `generate-report` | exports | HTML report → open in browser |
| `export-zip` | zip-writer | One-click ZIP session export |
| `get-agent-database` | process-scanner | Full agent signature database |
| `get-custom-agents` | config-manager | User-defined agent list |
| `save-custom-agents` | config-manager | Persist custom agents |
| `export-agent-database` | main | Export agents to a JSON file |
| `import-agent-database` | main | Import agents from a JSON file |
| `export-config` | config-manager | Export settings to a JSON file |
| `import-config` | config-manager | Import settings from a JSON file |
| `kill-process` | platform | Terminate a monitored PID (own-PID guarded) |
| `suspend-process` | platform | Suspend a monitored PID (own-PID guarded) |
| `resume-process` | platform | Resume a monitored PID (own-PID guarded) |
| `rules:getAll` | rule-loader | All loaded rules, serialized |
| `rules:reload` | rule-loader | Force a reload, returns the new count |
| `blocklist-add` | blocklist | Add a watchlist entry (alert-only) |
| `blocklist-remove` | blocklist | Remove a watchlist entry |
| `blocklist-list` | blocklist | Current watchlist |
| `get-false-positives` | config-manager | List of false-positive entries |
| `add-false-positive` | config-manager | Mark a process as a false positive |
| `reveal-in-explorer` | main | Open a file's location in the file manager |
| `open-external-url` | main | Open an http/https URL in the default browser |
| `get-app-version` | main | Current app version string |
| `test-notification` | main | Trigger a test OS notification |

`kill-process`, `suspend-process` and `resume-process` each refuse AEGIS's own PID and any
PID not in the current scan result — see the C-01 guards in `ipc-handlers.js`.

### Send (Renderer → Main, no response)

None. `preload.js` wraps only `invoke()` and `on()`; it exposes no `ipcRenderer.send`, so
there is no fire-and-forget path from the renderer.

### Push (Main → Renderer)

All 9 subscribed via `ipcRenderer.on` in `preload.js`.

| Channel | Purpose |
|---|---|
| `scan-batch` | One coalesced payload per scan: agents, stats, resourceUsage, anomalyScores |
| `file-access` | New file access events (batched, 150ms) |
| `stats-update` | Updated aggregate stats |
| `network-update` | Network connections |
| `agent-resource-usage` | Per-agent CPU/RAM/GPU, one record per instance (keyed by `instanceId`, never pid). Distinct from `scan-batch.resourceUsage`, which is AEGIS's own load |
| `token-costs` | Per-agent token usage and cost estimates |
| `scan-status` | Scanner state (scanning/idle) |
| `rules:reloaded` | Rule hot-reload landed, with the new count |
| `toggle-theme` | Theme toggle from the tray menu |

## Extension Points

### Adding a New Agent Signature
Edit `agent-database.json` — append an entry to the `agents` array. The process-name field is `names` (an array of match strings), **not** `processPatterns`, which appears nowhere in the codebase. Alongside it: `id`, `displayName`, `category`, `knownDomains`, `configPaths`, and trust/risk metadata. The process scanner, network monitor, and file watcher all consume this database automatically.

### Adding New Sensitive File Rules
Rules live in `rules/*.yaml` (one file per category), validated against `rules/_schema.json` and loaded by `rule-loader.js` with hot-reload. Add an entry to the ruleset matching the category:
```yaml
  - id: "SS007"
    name: "SSH agent socket"
    pattern: "ssh-agent"
    reason: "SSH agent socket"
    category: "ssh"
    risk: critical
    enabled: true
```
`category` must be one of the 8 values allowed by `_schema.json` (ai-config, secrets, ssh, certificates, cloud, browser, devtools, crypto). `SENSITIVE_RULES` in `src/shared/constants.js` is deprecated and not read at runtime — editing it has no effect.

### Adding a New Monitoring Module
1. Create `src/main/new-module.js` with `init(state)` pattern
2. Wire in `main.js` via dependency injection
3. Add IPC handler in `registerIpc()` if renderer needs access
4. Add bridge method in `preload.js`
5. Add audit logging via `audit.log(type, details)` (injected as `deps.audit` in `scan-loop.js`)

### Adding a New UI Panel
1. Create `src/renderer/lib/components/NewPanel.svelte` (there is no `src/renderer/src/` directory)
2. Import and place the component in the appropriate tab (e.g., `ShieldTab.svelte`, `ActivityTab.svelte`)
3. Subscribe to IPC data via Svelte stores in `src/renderer/lib/stores/`
4. Use scoped styles within the `.svelte` file (follows project CSS conventions)

### Adding Platform Support
OS-specific operations already live behind `src/main/platform/`, which picks an
implementation at load time — so this is about filling gaps in an existing abstraction,
not introducing one. Add to the platform module, never branch on `process.platform` in a
caller:
- `platform/win32.js` — `tasklist /FO CSV /NH`, `Get-CimInstance` for parent chains and
  `startTime`, `Get-NetTCPConnection`, Restart Manager handle detection, suspend/resume
  via `NtSuspendProcess`/`NtResumeProcess` P/Invoke
- `platform/darwin.js`, `platform/linux.js` — `listProcesses()` via `ps`, with the shared
  POSIX pieces (including `SIGSTOP`/`SIGCONT` suspend/resume) in `platform/posix-shared.js`
- `file-watcher.js` — chokidar is cross-platform; only open-handle detection is
  platform-specific

## Privacy Architecture

AEGIS is designed with privacy as a core architectural constraint:

- **All data stays local.** Settings, baselines, and audit logs are stored in Electron's userData directory. Nothing leaves the machine unless the user explicitly exports it.
- **No telemetry.** AEGIS does not phone home. No analytics, no crash reporting, no usage tracking.
- **No cloud sync.** There is no account system, no server, no cloud backend.
- **AI analysis is opt-in.** Calls to the Anthropic API happen only when the user explicitly clicks "Run AI Threat Analysis." The API key is user-provided and stored locally.
- **Audit logs are metadata-only.** File paths and agent names are logged. File contents are never read, stored, or transmitted.
- **Open-source transparency.** Every line of monitoring, scoring, and analysis logic is visible in the source code. There are no hidden behaviors.
