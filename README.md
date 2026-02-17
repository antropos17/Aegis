# AEGIS — Independent AI Oversight Layer

> When AI is embedded in your OS, browser, and apps — oversight must be independent.

**The first open-source tool that monitors what AI agents do on your computer.**

<!-- ![AEGIS Dashboard](docs/screenshot.png) -->

## The Problem

AI agents now have deep access to your machine. Claude Code reads your files, Copilot scans your codebase, Cursor indexes your projects, Devin executes shell commands. These tools access SSH keys, environment variables, API tokens, cloud credentials, and browser data — and make outbound network connections to servers you've never heard of. Until now, nobody was watching what they actually do.

This isn't theoretical. In February 2026, Hudson Rock documented real-world attacks where infostealers specifically target AI agent configuration directories — stealing API keys, device tokens, session credentials, and memory files from tools like Claude Code, Copilot, and Cursor. AI agent configs are now a documented attack surface, and every developer running these tools is exposed.

Every existing AI security company is enterprise B2B ($10K+/year): Lasso Security, PromptArmor, Prompt Security, Nightfall AI, WitnessAI. They monitor what humans send *to* AI. None of them monitor what AI agents do *on local machines*. There is no consumer-grade, open-source solution for AI agent oversight. AEGIS fills this gap — an independent oversight layer that doesn't belong to any AI vendor.

## What AEGIS Monitors

**Process Intelligence** — Detects 88+ AI agents in real time. Resolves parent-child process trees to identify agents spawned inside editors (Copilot in VS Code, AI extensions in JetBrains). Tracks agent enter/exit events with PID-level granularity.

**File & Data Access** — Monitors sensitive directories (`.ssh`, `.aws`, `.gnupg`, `.env*`, cloud configs, browser data). Protects 27 AI agent configuration directories targeted by infostealers. Classifies file access against 70+ sensitive patterns with severity levels. Detects mass-read behavior and unusual access patterns.

**Network Intelligence** — Scans all outbound TCP connections for detected agent PIDs. Reverse DNS resolution with domain classification — known AI API endpoints (safe), unknown domains (flagged), suspicious connections (alerted). Maintains connection history for baseline comparison.

**Behavioral Analysis** — Rolling 10-session baselines per agent with anomaly scoring (0-100). Five weighted detection factors: file volume spikes, sensitive file escalation, new sensitive categories, new network endpoints, unusual timing patterns. Time-decay risk engine with trust grades (A+ through F).

**AI-Powered Analysis** — Full session threat assessment via Anthropic API. Correlates Process + File + Network data into explainable alerts with executive summary, specific findings, risk rating, and actionable recommendations. Generates printable compliance reports.

## Available Now

- Real-time AI agent detection (88 agents in database)
- File access monitoring with sensitive file alerts
- AI agent config protection (Hudson Rock threat vector — 27 directories)
- Network connection tracking with domain classification
- Behavioral anomaly detection with baseline deviation scoring
- AI-powered threat analysis via Anthropic API
- Protection presets: Paranoid / Strict / Balanced / Developer
- Risk scoring with time decay and trust grades (A+ to F)
- Canvas radar visualization (60fps animated dashboard)
- Session timeline with color-coded severity dots
- Persistent audit logging with 30-day rotation
- Compliance report generation (JSON, CSV, HTML, printable threat report)
- Agent database manager with custom agent support
- Dark/light neumorphic theme
- System tray with threat-level shield icon
- Zero framework dependencies — vanilla JS + Electron

## Coming Soon

- **OS-level enforcement** — Kernel hooks: Windows Minifilter, macOS Endpoint Security, Linux eBPF
- **Mac/Linux full support** — `ps aux`, `fanotify`, `ss`/`lsof` monitoring
- **UI Awareness** — Accessibility API monitoring (no screen capture needed)
- **Container/VM detection** — Docker, WSL, local LLM processes
- **Sandbox containment** — Job Objects, AppContainer isolation
- **GPU monitoring** — Detect local inference processes
- **Deep packet inspection** — TLS inspection for AI agent traffic
- **Browser extension** — Monitor web-based AI agents (ChatGPT, Claude web)
- **Community threat intelligence** — Shared agent signatures and behavioral profiles
- **Cross-device AI activity correlation**

## Quick Start

```bash
git clone https://github.com/YOUR_USERNAME/AEGIS.git
cd AEGIS && npm install
npm start
```

Requires Node.js 18+ and Windows 10/11. Mac/Linux support is on the roadmap.

## Tech Stack

| Component | Technology |
|---|---|
| Desktop framework | Electron 33 |
| Frontend | Vanilla JS + CSS — zero frameworks, no build step |
| File watching | chokidar@3 |
| Process detection | `tasklist /FO CSV` + PowerShell parent chains |
| File handle scanning | PowerShell / Sysinternals `handle64.exe` |
| Network scanning | `Get-NetTCPConnection` + DNS reverse lookup |
| Visualization | Canvas API (60fps radar) |
| AI analysis | Anthropic Messages API |
| Audit storage | JSONL files with daily rotation |

## How It Works

```
Process Scanning → File Watching → Network Monitoring
        ↓                ↓               ↓
    Risk Engine ← Anomaly Detection ← Baselines
        ↓                ↓               ↓
   AI Analysis → Activity Feed → Audit Log → User Dashboard
```

**Process Scanner** detects AI agents by matching running processes against 88 known signatures. Resolves parent chains (60s TTL cache) to identify IDE-hosted agents. Triggers network rescans on agent change.

**File Watcher** runs chokidar on sensitive directories and PowerShell handle scanning for per-process file access. Events are classified against 70+ sensitive patterns and 27 agent config directory rules.

**Network Monitor** scans TCP connections for agent PIDs. Reverse DNS with 5-minute cache. Domain classification against known vendor endpoints from the agent database.

**Baseline Engine** tracks per-agent behavior over rolling 10-session windows. Computes anomaly scores with weighted factors. Deviations trigger alerts in the activity feed and audit log.

**AI Analysis** sends session data to Claude for structured threat assessment — summary, findings, risk rating, recommendations. Only triggered when the user explicitly requests it.

**Audit Logger** writes all events to daily JSONL files with 30-day rotation. Seven event types: file-access, network-connection, anomaly-alert, permission-deny, agent-enter, agent-exit, config-access.

## Threat Model

AEGIS is built for AI-native threats that traditional security tools don't address:

- **Autonomous agents** with filesystem and terminal access (Devin, Manus, OpenHands)
- **Self-updating AI workers** that modify their own configurations
- **AI-modular malware** that uses AI agents as attack vectors
- **Local LLMs** with unrestricted file access (Ollama, LM Studio, llama.cpp)
- **Self-executing workflows** that chain multiple AI tools together
- **Background AI services** embedded in operating systems and browsers

AEGIS uses behavioral pattern detection, not just signature matching. It establishes baselines for what's normal and alerts when agents deviate — regardless of whether the agent is known or unknown.

## Principles

- **Open-source transparency** — Every line of monitoring logic is visible and auditable
- **Privacy-first** — All data stays local. No cloud sync. No telemetry. No tracking.
- **Local data processing** — Analysis runs on your machine. API calls only when you explicitly trigger them.
- **No hidden telemetry** — AEGIS does not phone home. Period.
- **User in full control** — You choose what to monitor, what to allow, what to block

## Project Structure

```
AEGIS/
├── agent-database.json        # 88 agent signatures with metadata
├── src/
│   ├── main/                  # Electron main process (11 modules)
│   │   ├── main.js            # Orchestrator, IPC handlers, lifecycle
│   │   ├── process-scanner.js # Agent detection engine
│   │   ├── file-watcher.js    # chokidar + handle scanning
│   │   ├── network-monitor.js # TCP + DNS monitoring
│   │   ├── baselines.js       # Anomaly detection engine
│   │   ├── ai-analysis.js     # Anthropic API integration
│   │   ├── audit-logger.js    # Persistent audit trail
│   │   ├── config-manager.js  # Settings persistence
│   │   ├── exports.js         # Report generation
│   │   ├── tray-icon.js       # System tray
│   │   └── preload.js         # IPC bridge (contextBridge)
│   ├── renderer/              # Dashboard UI (18 scripts)
│   │   ├── index.html         # 4 tab views + overlays
│   │   ├── radar-*.js         # Canvas radar (3 files)
│   │   ├── timeline.js        # Session event timeline
│   │   ├── activity-feed.js   # Real-time event feed
│   │   ├── reports.js         # Reports + audit UI
│   │   └── ...                # state, helpers, risk, permissions
│   ├── shared/constants.js    # Sensitive file rules (70+ patterns)
│   └── styles/                # 8 CSS files (neumorphic design)
```

~7,100 lines across 39 source files.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code standards, and how to extend AEGIS.

## Security

See [SECURITY.md](SECURITY.md) for vulnerability reporting and responsible disclosure.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for system design, data flow, observability layers, and extension points.

## License

MIT License. See [LICENSE](LICENSE) for details.

---

Built for the [OpenAI Cybersecurity Grant](https://openai.com/index/openai-cybersecurity-grant-program/) and Y Combinator. AI oversight should be independent, transparent, and open-source.
