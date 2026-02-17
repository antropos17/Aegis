# AEGIS — AI Agent Privacy Shield

**The first open-source tool that monitors what AI agents do on your computer.**

AI coding agents like Claude Code, Cursor, Copilot, Devin, and dozens more now have deep access to your filesystem, credentials, and network. They read your SSH keys, access your `.env` files, and make outbound connections — and until now, nobody was watching. In February 2025, Hudson Rock revealed that infostealers are already targeting AI agent configuration directories to steal API keys and session tokens. AEGIS changes that.

<!-- ![AEGIS Dashboard](docs/screenshot.png) -->

## Features

- **Real-time AI agent detection** — 88 agents in the database (Claude Code, Copilot, Cursor, Devin, Manus, Windsurf, Codex, and 80+ more)
- **File access monitoring** — Sensitive file alerts for SSH keys, credentials, `.env` files, cloud configs, browser data
- **AI agent config protection** — Monitors 27 agent config directories targeted by infostealers (Hudson Rock threat vector)
- **Network connection tracking** — TCP connection scanning with DNS resolution and domain classification (safe/unknown/flagged)
- **Behavioral anomaly detection** — Rolling baselines with deviation scoring: file volume spikes, new sensitive categories, unusual timing
- **AI-powered threat analysis** — Full session threat assessment via Anthropic API with executive summary, findings, and recommendations
- **Protection presets** — Paranoid / Strict / Balanced / Developer — one-click permission profiles
- **Risk scoring** — Time-decay weighted engine with trust grades (A+ through F) per agent
- **Canvas radar visualization** — 60fps animated radar with agent orbits, connection lines, sweep arm, and threat-level glow
- **Session timeline** — Horizontal event strip with color-coded severity dots and hover tooltips
- **Persistent audit logging** — Daily JSON logs with 30-day rotation in `userData/audit-logs/`
- **Compliance report generation** — Export JSON, CSV, or styled HTML reports; printable AI threat assessment
- **Agent database manager** — Add, edit, import/export custom agent signatures
- **Dark/light theme** — Neumorphic design system with one-click toggle
- **Zero framework dependencies** — Pure vanilla JS + CSS. No React, no Tailwind, no webpack.

## Quick Start

```bash
git clone https://github.com/YOUR_USERNAME/AEGIS.git
cd AEGIS && npm install
npm start
```

Requires Node.js 18+ and Windows 10/11 (Mac/Linux support planned).

## Tech Stack

| Component | Technology |
|---|---|
| Desktop framework | Electron 33 |
| Frontend | Vanilla JS + CSS (no build step) |
| File watching | chokidar@3 |
| Process detection | `tasklist /FO CSV` (Windows) |
| File handle scanning | PowerShell / `handle64.exe` |
| Network scanning | `Get-NetTCPConnection` + DNS |
| Visualization | Canvas API (60fps) |
| AI analysis | Anthropic Messages API |
| Config storage | JSON files in Electron userData |

## How It Works

AEGIS runs three monitoring loops in parallel:

1. **Process Scanner** — Detects AI agents by matching running processes against 88 known signatures. Resolves parent process chains to identify agents spawned by IDEs (e.g., Copilot inside VS Code). Triggers network rescans when agents change.

2. **File Watcher** — Uses chokidar to watch sensitive directories (`.ssh`, `.aws`, `.gnupg`, `.env*`, agent config dirs) and PowerShell handle scanning to detect per-process file access. Classifies files against 70+ sensitive patterns with severity levels.

3. **Network Monitor** — Scans TCP connections for detected agent PIDs using `Get-NetTCPConnection`. Reverse DNS lookup on remote IPs. Classifies domains as safe (known vendor domains), unknown, or flagged. Maintains connection history for baseline comparison.

All events feed into a **risk scoring engine** (time-decay weighted, trust-adjusted) and **behavioral baseline system** (rolling 10-session averages with anomaly detection). The renderer displays everything on a real-time dashboard with radar visualization, activity feeds, and aggregate reports.

## Project Structure

```
AEGIS/
├── agent-database.json        # 88 agent signatures with metadata
├── src/
│   ├── main/                  # Electron main process (11 modules)
│   │   ├── main.js            # Orchestrator + IPC handlers
│   │   ├── process-scanner.js # Agent detection engine
│   │   ├── file-watcher.js    # chokidar + handle scanning
│   │   ├── network-monitor.js # TCP + DNS monitoring
│   │   ├── baselines.js       # Anomaly detection engine
│   │   ├── ai-analysis.js     # Anthropic API integration
│   │   ├── audit-logger.js    # Persistent audit trail
│   │   └── ...                # config, exports, tray, preload
│   ├── renderer/              # Dashboard UI (17 scripts)
│   │   ├── index.html         # 4 tab views + overlays
│   │   ├── radar-*.js         # Canvas radar (3 files)
│   │   ├── timeline.js        # Session event timeline
│   │   └── ...                # state, helpers, feeds, reports
│   ├── shared/constants.js    # Sensitive file rules
│   └── styles/                # 8 CSS files (neumorphic design)
```

~6,700 lines across 39 source files.

## Roadmap

- [ ] **OS-level enforcement** — Kernel hooks (Windows Minifilter, macOS Endpoint Security, Linux eBPF) for true blocking
- [ ] **Mac/Linux support** — `ps aux` process detection, `fanotify` file monitoring, `ss`/`lsof` network scanning
- [ ] **Browser extension** — Monitor AI web agents (ChatGPT, Claude web, browser-based coding tools)
- [ ] **Community threat intelligence** — Shared agent signature database with crowdsourced behavioral profiles
- [ ] **Per-process file attribution** — ETW (Windows) / fanotify (Linux) for exact process-to-file mapping

## Why AEGIS Exists

Every AI security company today monitors what humans send *to* AI. Nobody monitors what AI agents do *on your machine*. As AI agents gain filesystem access, terminal control, and network capabilities, the attack surface grows. AEGIS provides independent, open-source visibility into AI agent behavior — the same way antivirus monitors programs, but specifically designed for the AI agent era.

**Competitors are enterprise B2B.** Lasso Security, PromptArmor, Prompt Security, Nightfall AI, WitnessAI — all focus on enterprise AI governance. None monitor local agent behavior. AEGIS is the consumer/developer layer.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code standards, and how to add new agents.

## Security

See [SECURITY.md](SECURITY.md) for vulnerability reporting and responsible disclosure.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for system design, data flow, and extension points.

## License

MIT License. See [LICENSE](LICENSE) for details.

---

Built for the [OpenAI Cybersecurity Grant](https://openai.com/index/openai-cybersecurity-grant-program/) and the belief that AI oversight should be independent and open-source.
