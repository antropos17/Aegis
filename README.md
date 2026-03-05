<p align="center">
  <h1 align="center">AEGIS</h1>
  <p align="center"><b>EDR for AI Agents</b></p>
  <p align="center">Watches what AI agents do on your machine. Processes, files, network, risk scoring.<br>No telemetry. No cloud. Everything stays local.</p>
  <p align="center"><i>With autonomous agents like OpenClaw (247K+ GitHub stars) gaining access to local files, credentials, and shell — somebody needs to watch.</i></p>
</p>

<p align="center">
  <a href="https://github.com/antropos17/Aegis/releases/latest"><img src="https://img.shields.io/github/v/release/antropos17/Aegis?include_prereleases&style=flat-square&label=Release" alt="Release"></a>
  <img src="https://img.shields.io/github/actions/workflow/status/antropos17/Aegis/ci.yml?style=flat-square&label=CI" alt="CI">
  <img src="https://img.shields.io/badge/Tests-568%20passing-brightgreen?style=flat-square" alt="Tests">
  <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="MIT License">
  <img src="https://img.shields.io/badge/Platform-Win%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square" alt="Platform">
</p>

<p align="center">
  <img src="https://github.com/antropos17/Aegis/releases/download/v0.3.0-alpha/demo-trimmed.gif" alt="AEGIS Demo" width="800">
</p>

<p align="center">
  <a href="#download">Download</a> &middot;
  <a href="https://github.com/antropos17/Aegis/issues/new?template=01-bug-report.yml">Report Bug</a> &middot;
  <a href="https://github.com/antropos17/Aegis/issues/new?template=02-feature-request.yml">Feature Request</a> &middot;
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

## Why AEGIS?

AI agents now have deep access to your machine — files, commands, network. Every existing AI security tool is enterprise SaaS that monitors what humans send *to* AI. Nobody monitors what AI agents do *on local machines*.

CrowdStrike, Cisco, and Kaspersky have all flagged security risks in autonomous AI agents. Aegis is the open-source answer.

AEGIS is an independent, open-source monitoring layer. It watches AI agent behavior in real time, doesn't belong to any AI vendor, and keeps all data local.

## What It Monitors

| Layer | How |
|-------|-----|
| **Processes** | 107 known AI agent signatures, parent-child tree resolution, IDE host detection |
| **Files** | Watches `.ssh`, `.aws`, `.gnupg`, `.env*`, cloud configs, 27 AI agent config dirs |
| **Network** | Outbound TCP per agent PID, reverse DNS, known API endpoints vs unknown |
| **Behavior** | Rolling 10-session baselines, 4-axis anomaly scoring (Network/FS/Process/Baseline) |
| **Local LLMs** | Ollama, LM Studio, vLLM, llama.cpp runtime detection |

## How It Compares

| | AEGIS | Lasso / Prompt Security / PromptArmor |
|-|:-----:|:--------------------------------------:|
| Runs locally | Yes | Cloud |
| Open source | MIT | No |
| Free | Yes | Enterprise |
| Monitors file access | Yes | No |
| Detects local LLMs | Yes | No |

> **AEGIS is the only open-source, local-first AI agent monitor.**

## Download

### From Source (all platforms)
```bash
git clone https://github.com/antropos17/Aegis.git
cd Aegis
npm install
npm start
```

> Requires **Node.js 18+** and **npm 9+**. Windows 10/11 recommended. macOS/Linux experimental ([#37](https://github.com/antropos17/Aegis/issues/37)).

### Try Without AI Agents

```bash
npm run build:demo && npm start
```

No real AI agents needed — explore the full UI with simulated data.

### Windows Installer

Pre-built `.exe` installer is coming in a future release. Track progress in [Releases](https://github.com/antropos17/Aegis/releases).

<!-- TODO: uncomment when CI builds .exe
[![Download](https://img.shields.io/badge/Download-Windows%20Installer-00ff88?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/antropos17/Aegis/releases/latest)
-->

### Release History

| Version | Date | Highlights |
|---------|------|------------|
| [v0.7.0-alpha](https://github.com/antropos17/Aegis/releases/tag/aegis-v0.7.0-alpha) | 2026-03-04 | YAML rulesets, 68 rules, hot-reload, 568 tests |
| [v0.5.0-alpha](https://github.com/antropos17/Aegis/releases/tag/aegis-v0.5.0-alpha) | 2026-03-03 | Fancy UI redesign, VisTimeline, AgentGraph |
| [v0.4.0-alpha](https://github.com/antropos17/Aegis/releases/tag/aegis-v0.4.0-alpha) | 2026-03-03 | TypeScript infrastructure, perf, refactoring |

## Features

**Detection** — 107 agent signatures, parent chain resolution, config dir protection, per-agent risk scoring with trust grades (A+ through F), HTTP/User-Agent scoring, local LLM detection, false positive marking

**Analysis** — Behavioral baselines with rolling averages, multi-dimensional anomaly detection, AI threat assessment via Anthropic API (opt-in), printable HTML threat reports

**Dashboard** — Bento grid dashboard — RiskRing gauge, Sparklines, TrustBadge, agent stats, activity feed with filters, session timeline, agent cards with expandable details, protection presets (Paranoid/Strict/Balanced/Developer), dark/light theme, toast notifications, OOM protection, keyboard shortcuts (Ctrl+1-4)

**Export** — JSON, CSV, HTML reports, one-click ZIP archive, JSONL audit logging (daily rotation, 30-day retention)

**i18n** — Internationalization with English base (110+ strings), community translations welcome

**CLI** — `--scan-json` for scripting, `--version`, `--help`

## YAML Rulesets

- 68 detection rules across 8 categories (AI config, secrets, SSH, cloud, browser, devtools, crypto, certificates)
- JSON Schema validated, hot-reload without restart
- Extend or override via `rules/custom/` directory

## Screenshots

<details><summary>📸 Shield — Real-time Overview</summary>
<img src="docs/screenshots/01-shield-tab.png" alt="Shield tab" width="800" />
</details>

<details><summary>📸 Activity Feed</summary>
<img src="docs/screenshots/02-activity-tab.png" alt="Activity Feed" width="800" />
</details>

<details><summary>📸 Rules & Permissions</summary>
<img src="docs/screenshots/03-rules-tab.png" alt="Rules & Permissions" width="800" />
</details>

<details><summary>📸 Reports & Export</summary>
<img src="docs/screenshots/04-reports-tab.png" alt="Reports & Export" width="800" />
</details>

<details><summary>📸 Agent Statistics</summary>
<img src="docs/screenshots/05-stats-tab.png" alt="Agent Statistics" width="800" />
</details>

<details><summary>📸 Settings</summary>
<img src="docs/screenshots/06-settings.png" alt="Settings" width="800" />
</details>

## Architecture

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Process    │    │    File     │    │   Network   │    │     LLM     │
│   Scanner    │    │   Watcher   │    │   Monitor   │    │  Detector   │
│  (tasklist)  │    │ (chokidar)  │    │ (NetTCP+DNS)│    │(Ollama/LMS) │
└──────┬───────┘    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘
       │                   │                  │                  │
       └───────────┬───────┴──────────┬───────┘                  │
                   │                  │                           │
            ┌──────▼──────┐    ┌──────▼──────┐                   │
            │  Baseline   │    │   Anomaly   │◄──────────────────┘
            │   Engine    │    │  Detector   │
            │(10-session) │    │  (4-axis)   │
            └──────┬──────┘    └──────┬──────┘
                   │                  │
            ┌──────▼──────┐    ┌──────▼──────┐    ┌─────────────┐
            │    Risk     │    │   Audit     │    │     CLI     │
            │   Engine    │    │   Logger    │    │ (--scan-json│
            │(time-decay) │    │  (JSONL/30d)│    │  --version) │
            └──────┬──────┘    └──────┬──────┘    └─────────────┘
                   │                  │
            ┌──────▼──────┐    ┌──────▼──────┐
            │  Dashboard  │    │ ZIP Writer  │
            │ (Svelte IPC)│    │ (export)    │
            └─────────────┘    └─────────────┘
```

**Stack**: Electron 33, Svelte 5, Vite 7, TypeScript, Vitest (568 tests across 34 files)

## Agent Database

107 agents in [`src/shared/agent-database.json`](src/shared/agent-database.json):

**Coding** — Claude Code, GitHub Copilot, Cursor, Windsurf, Tabnine, Amazon Q, Cody, Aider
**Autonomous** — OpenClaw, Devin, Manus AI, OpenHands, SWE-Agent, AutoGPT, BabyAGI, CrewAI
**Desktop** — Anthropic Computer Use, Google Gemini, Apple Intelligence, Microsoft Copilot
**Frameworks** — LangChain, Semantic Kernel, AutoGen, MetaGPT, TaskWeaver
**Local LLMs** — Ollama, LM Studio, vLLM, llama.cpp, LocalAI, GPT4All, Jan

Add custom agents via the UI or edit the JSON. See [AGENTS.md](AGENTS.md).

## Roadmap

- [ ] GPU monitoring for local inference detection
- [ ] OS-level enforcement (Windows Minifilter, macOS Endpoint Security, Linux eBPF)
- [ ] Per-process file attribution (ETW, fanotify)
- [ ] Container/VM detection (Docker, WSL)
- [ ] Browser extension for web-based AI agents
- [ ] Auto-update mechanism
- [x] i18n / localization ([#53](https://github.com/antropos17/Aegis/issues/53))

## Contributors

<table>
  <tr>
    <td align="center"><a href="https://github.com/antropos17"><img src="https://github.com/antropos17.png" width="80px;" alt=""/><br/><sub><b>Ruslan Murtuzaliyev</b></sub></a></td>
    <td align="center"><a href="https://github.com/ElshadHu"><img src="https://github.com/ElshadHu.png" width="80px;" alt=""/><br/><sub><b>Elshad Humbatli</b></sub></a></td>
    <td align="center"><a href="https://github.com/skmelendez"><img src="https://github.com/skmelendez.png" width="80px;" alt=""/><br/><sub><b>Steven Melendez</b></sub></a></td>
    <td align="center"><a href="https://github.com/travisbreaks"><img src="https://github.com/travisbreaks.png" width="80px;" alt=""/><br/><sub><b>travisbreaks</b></sub></a></td>
  </tr>
</table>

[CONTRIBUTING.md](CONTRIBUTING.md) &middot; [SECURITY.md](SECURITY.md) &middot; [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## Support

If Aegis is useful to you, consider giving it a star on GitHub — it helps others discover the project.

**Teams & Enterprise** — Need centralized dashboards, SIEM integration, or managed deployment? We're building it. [Get notified](mailto:aegis@antropos17.dev?subject=Aegis%20Enterprise%20Interest)

## License

[MIT](LICENSE)

## Star History

[![Star History Chart](https://api.star-history.com/image?repos=antropos17/Aegis&type=timeline&legend=top-left)](https://www.star-history.com/?repos=antropos17%2FAegis&type=timeline&legend=top-left)
