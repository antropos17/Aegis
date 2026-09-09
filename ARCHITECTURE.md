# AEGIS Architecture

## Mission

AEGIS is an **Independent AI Oversight Layer** for local agent processes, file activity and TCP endpoints. Coverage is signature- and sensor-dependent; no overall observability percentage has been established. Monitoring runs locally, with optional external AI analysis and update requests described below.

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
│  │  │  file-watcher.js       │──┼──►  │  │  GroupedFeed.svelte    │  │  │
│  │  │  network-monitor.js    │──┼──►  │  │  ActivityFeed.svelte   │  │  │
│  │  │  baselines.js          │──┼──►  │  │  AgentPanel.svelte     │  │  │
│  │  │  ai-analysis.js        │──┼──►  │  │  NetworkPanel.svelte   │  │  │
│  │  │  audit-logger.js       │  │     │  │  Reports.svelte        │  │  │
│  │  └────────────────────────┘  │     │  └────────────────────────┘  │  │
│  │                              │     │                              │  │
│  │  ┌────────────────────────┐  │     │  ┌────────────────────────┐  │  │
│  │  │  INFRASTRUCTURE        │  │     │  │   INTELLIGENCE LAYER   │  │  │
│  │  │                        │  │     │  │                        │  │  │
│  │  │  config-manager.js     │  │     │  │  ipc.ts (store)        │  │  │
│  │  │  exports.js            │  │     │  │  risk.ts (store)       │  │  │
│  │  │  tray-icon.js          │  │     │  │  theme.ts (store)      │  │  │
│  │  │  logger.js             │  │     │  │  toast.ts (store)      │  │  │
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
│              contextBridge API (54 channels: 44 invoke + 10 push)        │
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
- **What it sees:** Processes matching 110 agents (262 process-name signatures), plus supported IDE, WSL and local-runtime probes.
- **How:** The Windows path uses a shared process snapshot from the native sidecar, with a CIM fallback. If the process population cannot be established from the snapshot, the scanner can fall back to `tasklist`. POSIX implementations use `ps`.
- **Identity:** OS-observed birth times distinguish Windows process lifetimes when available. Missing birth times and synthetic observations have weaker identity; snapshot outages retain existing sessions.
- **Coverage:** Undetected signatures and processes that start and exit between polls are blind spots. See [known limits](README.md#known-limits).

#### 2. File & Data Access — `file-watcher.js` + `rule-loader.js`
- **What it sees:** File create/modify/delete in sensitive directories, per-process file handles
- **How:** chokidar watchers on `.ssh`, `.aws`, `.gnupg`, `.kube`, `.docker`, `.azure`, `.env*`, the 35 directories in `AGENT_CONFIG_PATHS` (minus those already covered as sensitive dirs), and the project directory. Open-handle detection is per-platform: Windows uses the Restart Manager (`rstrtmgr.dll`), macOS/Linux use `lsof` / `/proc`.
- **Depth:** 73 sensitive file rules (from `rules/*.yaml`) with severity classification. AI agent config directory protection (Hudson Rock threat vector). 2-second debounce per path.
- **Limitation:** chokidar cannot attribute events to specific processes. Handle scanning provides per-process attribution but runs on a timer.

#### 3. Network Intelligence — `network-monitor.js`
- **What it sees:** All outbound TCP connections for detected agent PIDs
- **How:** `Get-NetTCPConnection` via PowerShell, filtered by PID. Reverse DNS with 5-minute cache.
- **Depth:** Endpoint verdicts are `allowlisted`, `unknown` (no usable resolved identity), or `flagged` (resolved outside the applicable allowlists). Allowlists use database vendor domains and shared patterns. An allowlist match does not establish safe behavior.
- **Limitation:** Cannot inspect encrypted traffic. Sees endpoints but not payload.

#### 4. Risk Engine — `src/renderer/lib/utils/risk-scoring.js` + `src/main/anomaly-detector.js` + `src/main/baselines.js`
- **What it computes:** Per-agent risk scores (0-100), trust grades (A+ through F), anomaly scores (0-100)
- **Where it runs:** risk scoring lives in the RENDERER (`lib/utils/risk-scoring.js`); there is no `src/main/risk-scoring.js`. Anomaly scoring and baselines are main-process modules.
- **Base risk formula:** Sum `min(40, sensitive * 5 / (1 + sensitive * 0.1))`, `min(20, sshAwsFiles * 5)`, `min(20, flaggedDomains * 8 + unknownDomains * 3)`, `min(10, networkCount * 0.5)`, `min(5, configFiles * 0.5)`, `min(5, fileCount * 0.02)`, and 15 when `httpUnencryptedCount > 0`. Round the sum and clamp it to 100. The renderer supplies time-decayed file counts and subtracts 20, with a floor of zero, for agents marked as false positives. Anomaly scores, including sequence signals, are exposed separately from this risk score.
- **Anomaly scoring:** 4 weighted dimensions, `composite = Σ(dimension.score × weight)` with `{network: 0.3, filesystem: 0.25, process: 0.25, baseline: 0.2}`. Individual signals such as file volume and sensitive-access spikes are sub-factors inside a dimension, not top-level weighted factors.
- **Baselines:** Rolling averages over 10 sessions, persisted to `baselines.json`

#### 5. AI Analysis — `ai-analysis.js`
- **What it provides:** Structured threat assessment with executive summary, findings, risk rating, recommendations
- **How:** Anthropic Messages API (`claude-haiku-4-5-20251001`, both call sites in `ai-analysis.js`) with session data context
- **Modes:** Per-agent analysis and full-session analysis
- **Privacy:** Only triggered when user explicitly clicks the button. No background API calls.

#### 6. Audit Trail — `audit-logger.js`
- **What it logs:** Activity records include `file-access`, `config-access`, `network-connection`, `anomaly-alert`, `agent-enter` and `agent-exit`. The main process also emits `sequence-detection` and `observation-gap`; the logger records `buffer-overflow-drop` for buffer loss. `permission-deny` remains a legacy accepted type without a current emission site.
- **Format:** Append-only JSONL. Each entry follows `AuditRecordV1` (the authoritative definition in `src/shared/types/events.ts`): `{schemaVersion, timestamp, type, agent, pid, instanceId, action, path, severity, riskScore, attribution, details, seq, hash}`. `seq` and `hash` are added at flush time by `audit-hashchain.js`, which makes each daily file an independent SHA-256 chain. `riskScore` is vestigial and always 0 in v1; `attribution: null` means the ownership question does not apply to that event type, which is distinct from `status: 'unattributed'` (question applies, owner unknown). Pre-v1 records are told apart by the ABSENCE of `schemaVersion` — and only for a record that parses and whose hash verifies (in v0, `pid`, `instanceId`, and `attribution` were nested inside `details`, not top-level). Chain verification can detect edits relative to a trusted chain state. It cannot prove that no records were lost, or prevent an actor who controls local files from replacing and recomputing an entire chain.
- **Rotation:** New file per day (`aegis-audit-YYYY-MM-DD.json`), auto-delete after 30 days
- **Performance:** Buffered writes — flush every 5 seconds or at 50 events

#### 7. Resource Analytics
- **What it shows:** AEGIS's own CPU usage, memory (RSS), heap usage, scan interval
- **Where:** Footer status bar, updated every scan cycle

### What's NOT Covered Yet (Blind Spots → Future Work)

| Blind Spot | Description | Planned Approach / Status |
|---|---|---|
| **UI Awareness** | Cannot see what AI agents display or interact with in UI | Accessibility API monitoring (no screen capture) |
| **Container/VM Detection** | Runtime process signatures and limited WSL discovery exist; this does not enumerate every container or its internal processes | Broader WSL, Docker and Podman discovery; see [roadmap](ROADMAP.md#a--discovery-coverage) |
| **Sandbox Containment** | Monitor-only — cannot isolate or restrict agents | Non-goal: OS containment (Job Objects, AppContainer) is deliberately out of scope; pair AEGIS with external sandboxing |
| **GPU Monitoring** | Per-PID NVIDIA VRAM samples exist; allocated memory does not establish active inference | Define and validate the missing inference signal; see [roadmap](ROADMAP.md#a--discovery-coverage) |
| **Deep Packet Inspection** | Sees TCP endpoints but not encrypted payloads | Non-goal: TLS interception is deliberately out of scope; endpoints-only is the contract |
| **Syscall Monitoring** | No kernel-level visibility into system calls | Kernel drivers (Minifilter/Endpoint Security/eBPF) are a non-goal; user-mode ETW telemetry is under evaluation |
| **Memory Inspection** | Cannot inspect agent process memory | Non-goal: process-memory reading is deliberately out of scope |
| **Cross-device Correlation** | Single-machine visibility only | Local network discovery + shared audit format |
| **Mac/Linux parity** | Narrower than it looks: `platform/darwin.js` and `platform/linux.js` both implement `listProcesses()` (via `ps`) and `suspendProcess()`/`resumeProcess()` (via `posix-shared.js`), so process scanning and stop/resume are cross-platform. What is Windows-only is open-handle detection via the Restart Manager (`rstrtmgr.dll`); POSIX falls back to `lsof` / `/proc` | `fanotify` (Linux) for richer file-access attribution |

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
        ├──► stores/ (ipc.ts, risk.ts, theme.ts, toast.ts, demo-data.js)
        ├──► ShieldTab → Radar, AgentPanel, SummaryCards, ActivityFeed/GroupedFeed
        ├──► ActivityTab → ActivityFeed/GroupedFeed, NetworkPanel
        ├──► RulesTab → Presets, Permissions, AgentDatabase
        ├──► ReportsTab → Reports, AuditLog, ThreatAnalysis
        └──► Settings, Header, Footer, Toast
```

## Data Flow

```
Process scan (configured interval)
    ├──► shared process observation → scanner → instance/session reconciliation
    ├──► baselines, anomaly scores and sequence-rule taps
    ├──► scan-batch → agents, stats, resourceUsage, anomalyScores stores
    └──► agent-enter / agent-exit / anomaly-alert audit records

File watcher events + handle scans (max(3 × scan interval, 30 s))
    ├──► attribution → file-access push → activity feeds
    └──► file-access / config-access audit records + sequence-rule taps

Network scan (30 s interval and agent-set changes)
    ├──► endpoint verdicts → network-update push → network panel
    └──► network-connection audit records + sequence-rule taps

Operational records
    ├──► sensor health → stats/scan-batch → footer health status
    ├──► suspend/resume → observation-gap audit record
    └──► sequence completion → sequence-detection audit record and score
```

There are no standalone `scan-results`, `baseline-warnings` or `anomaly-scores` preload channels. Scan results and anomaly scores share `scan-batch`.

## IPC Channel Reference

### Invoke (Renderer → Main → Response)

The 44 invoke channels below are exposed through `src/main/preload.js`. Handlers are registered in `src/main/ipc-handlers.js`; update operations delegate to `src/main/app-updates.js`. The bridge exposes named operations rather than arbitrary IPC access.

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
| `updates:status` | app-updates | Read updater state |
| `updates:check` | app-updates | Check signed release metadata |
| `updates:download` | app-updates | Download and verify the selected installer |
| `updates:install` | app-updates | Request native confirmation and installation |

`kill-process`, `suspend-process` and `resume-process` each refuse AEGIS's own PID and any
PID not in the current scan result — see the C-01 guards in `ipc-handlers.js`.

### Send (Renderer → Main, no response)

None. `preload.js` wraps only `invoke()` and `on()`; it exposes no `ipcRenderer.send`, so
there is no fire-and-forget path from the renderer.

### Push (Main → Renderer)

The 10 push channels below are subscribed via `ipcRenderer.on` in `preload.js`.

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
| `updates:status` | Safe display state for update status, progress and available actions |

## Extension Points

### Adding a New Agent Signature
Edit `agent-database.json` — append an entry to the `agents` array. The process-name field is `names` (an array of match strings), **not** `processPatterns`, which appears nowhere in the codebase. Alongside it: `name`, `displayName`, `category`, `knownDomains`, `configPaths`, and trust/risk metadata. Process signatures and endpoint metadata are consumed by the scanner and network classifier. Database `configPaths` does not add watch roots: register supported directories in `src/shared/constants.js` (`AGENT_CONFIG_PATHS`). Trust/risk metadata does not automatically change the scoring formula or permission defaults.

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
`category` must be one of the 8 values allowed by `_schema.json` (ai-config, secrets, ssh, certificates, cloud, browser, devtools, crypto).

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

## Application Updates

Installed Windows x64 builds use `electron-updater` 6.8.9 with
`update-provider.js`, a custom provider for the existing `aegis-v` release tags and
signed manifests. Automatic checks and downloads default to off. With the saved
`automaticUpdatesEnabled` preference enabled, the first check runs after 30 seconds
and subsequent checks run every six hours. Settings also provides manual check and
download actions; the dashboard links to release notes and installation controls.

The provider requests only public GitHub release metadata and assets for
`antropos17/Aegis`, without account credentials or monitoring data. It verifies the
raw manifest's Ed25519 signature against the public key bundled inside app.asar,
then binds the version, repository, installer size and SHA-256. Installer bytes are
checked after download and again after native restart confirmation. Stable versions
stay on the stable channel; alpha versions can advance to alpha or stable. Lower
versions are never selected. Release notes are untrusted plain text.

`app-updates.js` owns the lifecycle. Four argument-free IPC operations are restricted
to the application's own top-level renderer; one push carries safe display state.
No file path, URL or updater options are accepted from the renderer. Closing AEGIS
does not install an update. Installation uses the per-user NSIS upgrade and requires
the native Restart/Later confirmation. Existing settings and history are retained
by the installer configuration; there is no automatic rollback or backup.

The existing SHA-256 manifests work without publishing updater YAML feeds. The NSIS
build still bundles electron-builder's `app-update.yml` for cache configuration.
The downloader cannot reuse a SHA-256-only cached file across application restarts,
so a later session downloads it again. macOS, Linux and development builds expose
an unsupported state. Published 0.14.1-alpha predates this feature: the first version
containing the updater must be installed manually.

## Privacy Architecture

AEGIS is designed with privacy as a core architectural constraint:

- **Storage is local by default.** Settings, baselines and audit logs are stored in Electron's userData directory. Exports create local files; optional AI analysis and updates make the external requests described below.
- **No telemetry.** No analytics, no crash reporting, no usage tracking.
- **Updates are opt-in.** Manual update actions or the saved automatic-update preference contact GitHub for public release files. These requests expose the normal network address to GitHub but do not send monitoring records, settings or API keys.
- **No cloud sync.** There is no account system, no server, no cloud backend.
- **AI analysis is opt-in.** An explicit request sends activity metadata to Anthropic, including agent/process names, PIDs, parent chains, sensitive paths, counts and network endpoints as applicable. The user provides the API key. Local key storage uses safeStorage when available and currently falls back to plaintext otherwise.
- **Audit logs contain monitoring metadata.** File-monitoring events record paths and attribution, not the contents of sensitive files. Token accounting separately reads agent transcript JSONL to extract usage. Settings JSON exports currently include a configured API key; remove it before sharing.
- **Source review.** Monitoring, scoring and analysis implementations are available in the repository; see [SECURITY.md](SECURITY.md) for the security model and known limitations.
