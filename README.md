<div align="center">
  <h1>AEGIS</h1>
  <p align="center"><b>Independent, OS-level observability for AI coding agents</b></p>
  <p align="center"><i>Watches what AI agents actually do on your machine — processes, files, network — from outside the agents, no hooks required.</i></p>
</div>

**AEGIS monitors local AI agent activity from outside the agents.** It observes detected processes, file access and TCP endpoints, and records whether attribution to an agent instance is confirmed, inferred or unknown. Coverage depends on the available sensors and detection signatures.

**Open-source, monitor-first, no telemetry.** Monitoring data is stored locally. Optional AI analysis sends selected activity metadata to Anthropic when you request it; update checks contact GitHub. See the [privacy details](SECURITY.md#privacy-architecture).

This README describes the current source tree. Installed builds contain the features available at their [release tag](https://github.com/antropos17/Aegis/releases); changes merged afterward require a newer build.

<p align="center">
  <a href="https://github.com/antropos17/Aegis/releases/latest"><img src="https://img.shields.io/github/v/release/antropos17/Aegis?include_prereleases&style=flat-square&label=Release" alt="Release"></a>
  <img src="https://img.shields.io/github/actions/workflow/status/antropos17/Aegis/ci.yml?style=flat-square&label=CI" alt="CI">
  <a href="#monitor-first"><img src="https://img.shields.io/badge/Mode-monitor--first-8a2be2?style=flat-square" alt="Monitor-first"></a>
  <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="MIT License">
  <img src="https://img.shields.io/badge/Platform-Windows%20%C2%B7%20macOS%2FLinux%20experimental-lightgrey?style=flat-square" alt="Platform">
</p>

<p align="center">
  <img src="https://github.com/antropos17/Aegis/releases/download/aegis-v0.10.0-alpha/demo.gif" alt="AEGIS Demo" width="800"><br>
  <sub>Demo recorded at v0.10.0-alpha; some labels have been renamed since.</sub>
</p>

<p align="center">
  <a href="#download">Download</a> &middot;
  <a href="https://github.com/antropos17/Aegis/issues/new?template=01-bug-report.yml">Report Bug</a> &middot;
  <a href="https://github.com/antropos17/Aegis/issues/new?template=02-feature-request.yml">Feature Request</a> &middot;
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

## What AEGIS observes

| Layer | How |
|-------|-----|
| **Processes** | 110 agents (262 process-name signatures), parent-chain resolution, IDE host detection, WSL and IDE-extension discovery |
| **Files** | chokidar watch on sensitive directories (`.ssh`, `.aws`, `.gnupg`, `.env*`, cloud configs) and the registered config paths of known agents; open-handle and Restart-Manager read detection on Windows |
| **Network** | Outbound TCP per agent process, forward-confirmed reverse DNS, and a verdict per endpoint — `allowlisted`, `unknown`, or `flagged`; an unidentified endpoint is never displayed as safe |
| **Behavior** | 73 detection rules across 8 categories (YAML, hot-reloaded), rolling 10-session baselines, anomaly scoring over four axes (network / filesystem / process / baseline) |
| **Local LLMs** | Runtime probes for Ollama and LM Studio, including loaded models; other runtimes such as vLLM and llama.cpp are detected by process signature |

`npm run counts:check` derives the agent, signature, rule and module inventories from source and checks selected declarations in the documentation during CI. It does not validate every number or feature claim in prose.

## The evidence graph

AEGIS records instance identity and attribution evidence alongside observed activity:

- **Instance identity.** When Windows supplies an OS birth time, `instanceId` combines it with the PID to distinguish process lifetimes. Missing birth times and synthetic discoveries have weaker identity; see the limits below. CI exercises the identity witness with fault injection (`npm run verify:gate`, 4 mutants).
- **Attribution with stated evidence.** Event Schema v1 includes `pid`, `instanceId` and attribution evidence. Ownership can be confirmed, inferred or unattributed; fields may be null when ownership is unknown or does not apply to an operational record.
- **Tamper-evident log.** Audit events are hash-chained JSONL (Event Schema v1) with daily rotation, 30-day retention, and explicit loss markers when the write buffer overflows.
- **Measured, not asserted.** The identity mechanism is benchmarked in-repo: provider birth-time parity was exact for every comparable process in both recorded runs (542/542 and 419/419), and the process-snapshot sidecar costs ~10 ms per scan where the fallback provider costs hundreds to thousands. Per-run tables, environments, and the stated gaps are in [docs/bench/](docs/bench/).

Evidence: [`src/main/process-identity.js`](src/main/process-identity.js) · [`src/main/attribution.js`](src/main/attribution.js) · [correctness audit](docs/current-state/CORRECTNESS-AUDIT.md) · [bench 2026-08-12](docs/bench/generation-v2-2026-08-12.md) · [bench 2026-08-13](docs/bench/generation-v2-2026-08-13.md)

## Monitor-first

> **AEGIS observes and logs.** It has no automatic OS-level enforcement. Process control (kill / suspend / resume) is manual and user-invoked. Permission presets affect monitoring and alerting; use a sandbox when you need containment.

## How AEGIS differs from in-agent oversight

Most AI-agent oversight tools instrument the agent itself — a Claude Code plugin, an IDE extension, an SDK wrapper. That placement has a structural blind spot: an agent only shows up if it (or its user) installed the hook. A raw `python autogpt.py`, an unwrapped binary, or a tool that simply does not cooperate is invisible to in-agent instrumentation.

AEGIS sits at the OS layer instead: it watches process, file, and network activity from outside the agents, so what it sees does not depend on the agent's cooperation — only on AEGIS's own coverage (see [known limits](#known-limits)). It is not the only tool observing agents locally — [AgentSight](https://github.com/eunomia-bpf/agentsight), for example, observes from the eBPF layer on Linux — and hook-based tools are complementary rather than competing: hooks see intent (prompts, tool calls) inside the agents that opted in, while AEGIS records observed effects (processes, files, connections) within its sensor coverage, with attribution evidence when available.

## Known limits

A monitor you cannot calibrate is a monitor you cannot trust, so the limits are stated here rather than discovered later. The re-verified findings behind this list, each with an OPEN/CLOSED status, live in the [correctness audit](docs/current-state/CORRECTNESS-AUDIT.md); the short version:

- **Coverage is signature- and heuristic-based.** Detection starts from 110 agents (262 process-name signatures) plus heuristics (WSL, IDE extensions, local LLM probes). An agent binary that matches none of these is not detected.
- **Polling has a blind spot.** A process born and dead between scan ticks (~10 s) is never observed; the bench pages state this explicitly. Per-event capture via ETW is under development in isolated Windows harnesses; it is not wired into production monitoring. See the [current roadmap](ROADMAP.md#b--windows-etw-attribution).
- **macOS/Linux identity is degraded.** Those platforms currently supply no OS birth time, so instance identity falls back to PID only and is unsafe under PID reuse. Token-cost tracking is Windows-only.
- **UI event windows truncate silently.** The renderer keeps bounded event windows that can disagree with totals, and there is no truncation banner yet.
- **Sensor health has limits.** The footer shows failed or degraded sensors, and suspend/resume gaps are recorded. A healthy status is not proof that every event was captured; process-scan overruns still lack a dedicated counter.
- **Audit loss markers need a successful flush.** If the process is killed while the disk is still failing, evicted audit entries can be lost without an on-disk marker.

## What we deliberately do not claim

Numbers appear in this README only when they are derived from the repository (and enforced by `npm run counts:check`) or measured with a written-down method. Some numbers people ask for do not exist yet, so we do not state them:

- **Boot time.** No startup benchmark exists; the old "under two seconds" claim was removed rather than kept unmeasured.
- **Detection or false-positive rates.** A scenario bench with an independent oracle exists (`bench/`, scored against Sysmon/Procmon), but it is Windows-only, covers one scenario, and does not run in CI — not a basis for a rate.
- **Overhead.** AEGIS's own CPU/RAM cost has not been measured under a written-down method.
- **Benchmark speedup headlines.** The measured snapshot-vs-fallback ratio moved from 193× to 51× between two days on the same machine; the durable claim is the weaker one — snapshot ~10 ms, fallback hundreds to thousands of ms — and that is the only form quoted here.
- **Per-event confidence scores.** Deliberately absent from the product until a ground-truth bench exists.
- **Test counts.** Hand-copied suite counts go stale silently; the suite prints its own counts, and CI runs it on every commit.

## Why independent oversight

AI coding agents can run shell commands, read credentials and contact external services with the permissions of the user running them. AEGIS provides a local record of the activity its sensors observe, with attribution evidence and known gaps. This helps investigate changes in agent behavior alongside the access controls and sandboxing already in use.

## Download

### Windows installer

Starting with v0.11.0-alpha, releases ship a Windows NSIS installer — download the `.exe` from the [latest release](https://github.com/antropos17/Aegis/releases/latest). Releases from v0.13.0-alpha onward also ship a signed manifest, so a download can be verified offline against the public key committed in this repository — see [Verifying an AEGIS release](docs/RELEASE-VERIFICATION.md). Earlier releases ship no manifest and cannot be verified this way.

### From source (all platforms)

```bash
git clone https://github.com/antropos17/Aegis.git
cd Aegis
npm ci
npm start
```

> Requires **Node.js 24.x** (`engines` in `package.json`). Windows 10/11 recommended; macOS/Linux experimental ([#37](https://github.com/antropos17/Aegis/issues/37)) — see [known limits](#known-limits).

### Try without AI agents

Build the browser demo with simulated data, then preview it locally:

```bash
npm run build:demo
npx vite preview --mode demo --host 127.0.0.1 --port 4174
# open http://127.0.0.1:4174
```

The demo cycles through calm, elevated, critical and reset phases with up to 12 simulated agents. It does not monitor real processes; Electron-only operations are unavailable in the browser. The output in `dist/demo` can also be served by a static file server.

Use this built preview for now. `npm run dev` currently has a shared CommonJS import incompatibility that prevents the dashboard from loading; it is not a working shortcut to the demo.

### Release history

| Version | Date | Highlights |
|---------|------|------------|
| [v0.14.1-alpha](https://github.com/antropos17/Aegis/releases/tag/aegis-v0.14.1-alpha) | 2026-09-07 | Evidence-file watchers moved off the main thread; dependency maintenance |
| [v0.14.0-alpha](https://github.com/antropos17/Aegis/releases/tag/aegis-v0.14.0-alpha) | 2026-09-07 | Sequence rules, observation-gap records, audit indexing and sensor-health work |
| [v0.13.0-alpha](https://github.com/antropos17/Aegis/releases/tag/aegis-v0.13.0-alpha) | 2026-08-23 | Signed release manifests for offline installer verification |
| [v0.12.0-alpha](https://github.com/antropos17/Aegis/releases/tag/aegis-v0.12.0-alpha) | 2026-08-22 | Monitoring and renderer updates; see release notes |
| [v0.11.0-alpha](https://github.com/antropos17/Aegis/releases/tag/aegis-v0.11.0-alpha) | 2026-08-11 | Windows installer, Event Schema v1 attribution, endpoint verdicts, sensor health records, WSL & IDE-extension detection |
| [v0.10.0-alpha](https://github.com/antropos17/Aegis/releases/tag/aegis-v0.10.0-alpha) | 2026-03-09 | Code cleanup, security hardening, command palette |
| [v0.9.1-alpha](https://github.com/antropos17/Aegis/releases/tag/aegis-v0.9.1-alpha) | 2026-03-09 | Dropdown dedup, skill paths, aegis-context optimized |
| [v0.9.0-alpha](https://github.com/antropos17/Aegis/releases/tag/aegis-v0.9.0-alpha) | 2026-03-08 | categoryIndex, prompt-craft skill, TS migration stores |
| [v0.8.2-alpha](https://github.com/antropos17/Aegis/releases/tag/aegis-v0.8.2-alpha) | 2026-03-08 | formatBytes TS extraction, meaningful tests, branch cleanup |
| [v0.8.1-alpha](https://github.com/antropos17/Aegis/releases/tag/aegis-v0.8.1-alpha) | 2026-03-08 | Patch release |
| [v0.8.0-alpha](https://github.com/antropos17/Aegis/releases/tag/aegis-v0.8.0-alpha) | 2026-03-05 | Launch readiness: CSP hardened, OpenClaw integration, README overhaul |
| [v0.7.0-alpha](https://github.com/antropos17/Aegis/releases/tag/aegis-v0.7.0-alpha) | 2026-03-04 | YAML rulesets, 68 rules, hot-reload, 568 tests |
| [v0.5.0-alpha](https://github.com/antropos17/Aegis/releases/tag/aegis-v0.5.0-alpha) | 2026-03-03 | Fancy UI redesign, VisTimeline, AgentGraph |
| [v0.4.0-alpha](https://github.com/antropos17/Aegis/releases/tag/aegis-v0.4.0-alpha) | 2026-03-03 | TypeScript infrastructure, perf, refactoring |

## Features

**Detection** — 110 agents (262 process-name signatures), parent-chain resolution, sensitive-path and agent-config watching, per-agent risk scoring with trust grades (A+ through F), local LLM detection, false-positive marking

**Analysis** — Behavioral baselines with rolling averages, multi-axis anomaly detection, AI threat assessment via the Anthropic API (opt-in), printable HTML threat reports

**Dashboard** — Radar overview, summary cards, filtered and grouped activity feeds, expandable agent/application cards, network panel, sensor-health status, monitoring presets (Paranoid/Strict/Balanced/Developer), command palette (Ctrl+K), keyboard shortcuts (Ctrl+1-5), dark/light and high-contrast themes

**Export** — JSON, CSV, HTML reports, one-click ZIP archive, hash-chained JSONL audit log (daily rotation, 30-day retention). Settings JSON exports can include the API key; remove it before sharing. See [known limitations](SECURITY.md#known-limitations).

**i18n** — Internationalization with an English base (`en.json`); community translations welcome

**CLI** — `--scan-json` for scripting, `--version`, `--help`

## YAML rulesets

- 73 detection rules across 8 categories (AI config, secrets, SSH, cloud, browser, devtools, crypto, certificates)
- Validated against `rules/_schema.json`; edits to existing rulesets hot-reload in an unpacked source run. Watchers are disabled inside packaged ASAR builds
- Extend by adding a `.yaml` to `rules/`. Rule IDs must be unique — a duplicate ID is skipped, not overridden. A newly added file is picked up on the next reload or restart, since the source-run watcher reacts to changes in existing top-level files

## Screenshots

> Captured from the demo build (`npm run build:demo`), 2026-08-21.

<details><summary>📸 Shield — Real-time Overview</summary>
<img src="docs/screenshots/01-shield.png" alt="Shield tab" width="800" />
</details>

<details><summary>📸 Activity Feed</summary>
<img src="docs/screenshots/02-activity.png" alt="Activity Feed" width="800" />
</details>

<details><summary>📸 Rules & Permissions</summary>
<img src="docs/screenshots/03-rules.png" alt="Rules & Permissions" width="800" />
</details>

<details><summary>📸 Reports & Export</summary>
<img src="docs/screenshots/04-reports.png" alt="Reports & Export" width="800" />
</details>

<details><summary>📸 Agent Statistics</summary>
<img src="docs/screenshots/05-stats.png" alt="Agent Statistics" width="800" />
</details>

<details><summary>📸 Settings</summary>
<img src="docs/screenshots/06-settings.png" alt="Settings" width="800" />
</details>

## Architecture

```
┌───────────────┐  ┌────────────────┐  ┌───────────────┐  ┌───────────────┐
│   Process     │  │     File       │  │    Network    │  │  LLM Runtime  │
│   Snapshot    │  │    Watcher     │  │    Monitor    │  │   Detector    │
│ (sidecar with │  │  (chokidar +   │  │ (TCP + rDNS + │  │ (Ollama / LM  │
│  CIM fallback)│  │  handle / RM)  │  │   verdicts)   │  │    Studio)    │
└──────┬────────┘  └──────┬─────────┘  └──────┬────────┘  └──────┬────────┘
       └──────────────┬───┴───────────────────┴──────────────────┘
                      ▼
        ┌───────────────────────────────┐
        │   Identity & Attribution      │
        │ instanceId = pid + birth time │
        │ evidence codes, no guessing   │
        └──────┬────────────────┬───────┘
               ▼                ▼
    ┌──────────────────┐  ┌─────────────────────┐
    │   Baselines +    │  │    Audit Logger     │
    │ Anomaly (4-axis) │  │  (Event Schema v1,  │
    │   Risk Engine    │  │ hash-chained JSONL) │
    └──────┬───────────┘  └──────┬──────────────┘
           ▼                     ▼
    ┌──────────────┐  ┌──────────────────┐  ┌───────────────┐
    │  Dashboard   │  │     Exports      │  │      CLI      │
    │ (Svelte IPC) │  │ (JSON/CSV/HTML/  │  │  (--scan-json │
    │              │  │       ZIP)       │  │   --version)  │
    └──────────────┘  └──────────────────┘  └───────────────┘

  Per-sensor health is collected in the main process and shown
  in the footer; suspend/resume gaps are recorded in the audit log.
```

**Stack**: Electron 43, Svelte 5, Vite 7, Vitest. The monitoring engine is JavaScript (CommonJS); TypeScript is used in the renderer and the shared types. CI gates every merge with build, lint, svelte-check, test and audit jobs; `npm run counts:check` verifies selected inventory declarations against source, `npm run verify:gate` proves the identity witness against injected mutants, and `npm run verify:seq-gate` proves the sequence engine against injected mutants.

## Agent database

110 agents in [`src/shared/agent-database.json`](src/shared/agent-database.json):

**Coding** — Claude Code, GitHub Copilot, Cursor, Windsurf, Tabnine, Amazon Q, Cody, Aider
**Autonomous** — OpenClaw, Devin, Manus AI, OpenHands, SWE-Agent, AutoGPT, BabyAGI, CrewAI
**Desktop** — Anthropic Computer Use, Google Gemini, Apple Intelligence, Microsoft Copilot
**Frameworks** — LangChain, Semantic Kernel, AutoGen, MetaGPT, TaskWeaver
**Local LLMs** — Ollama, LM Studio, vLLM, llama.cpp, LocalAI, GPT4All, Jan

Add custom agents via the UI or edit the JSON. See [the contributor guide](CONTRIBUTING.md#how-to-add-a-new-agent) for process signatures, endpoint allowlists and config watch roots.

## Roadmap

The [current roadmap](ROADMAP.md) separates completed work, active experiments and remaining requirements. Features merged into source may not be present in the latest installer.

- **Implemented in source:** sensor-health status and observation gaps, sequence correlations, audit indexing and signed Windows update support. The first installer containing the updater still requires a manual install.
- **In progress:** Windows ETW file-attribution experiments and lifecycle validation; production monitoring still uses the existing watcher/handle sensors.
- **Remaining:** broader WSL and container discovery, a meaningful GPU inference signal, macOS/Linux parity, and the other scoped work listed in the roadmap.

AEGIS remains monitor-first. These plans do not imply automatic blocking or sandbox containment.

## Frequently asked questions

### What is Aegis?

Aegis is an open-source, OS-level monitor for AI agents, built on Electron and Svelte. It combines process and network polling with file watchers and behavioral scoring. The monitoring engine uses CommonJS JavaScript, with TypeScript in the renderer and shared types. Monitoring runs locally without telemetry; optional AI analysis and update requests use external services.

### Why do AI agents need monitoring?

An agent may have access to files, credentials and shell commands. Monitoring helps you investigate its observed activity and changes in behavior. Detection has gaps, so visibility complements access controls and sandboxing.

### How is Aegis different from traditional EDR?

AEGIS focuses on AI-agent process signatures, attribution evidence and behavioral baselines. It is an alpha monitoring tool with manual process controls, and does not provide the prevention, containment or managed response expected from a full EDR deployment.

### Does Aegis work with MCP tools?

Aegis monitors processes, not protocols. Activity from an MCP tool may be visible when its processes and file/network operations fall within sensor coverage. Aegis does not parse MCP traffic, identify tool calls or guarantee attribution of every MCP action.

### Is Aegis a replacement for sandboxing?

No. Aegis is an observability layer, not a restriction layer. Sandboxes limit what agents can do; Aegis shows you what agents are doing. They are complementary — use sandboxing for enforcement and Aegis for visibility, auditing, and anomaly detection.

### What agents does Aegis support?

Aegis ships with 110 agents (262 process-name signatures) in its database, spanning coding assistants (Claude Code, Copilot, Cursor), autonomous agents (OpenClaw, AutoGPT, CrewAI, Devin), desktop AI (Gemini, Apple Intelligence), frameworks (LangChain, AutoGen, MetaGPT), and local LLM runtimes (Ollama, LM Studio, llama.cpp). You can add custom agents via the UI or the JSON config.

### Can I use Aegis in production?

Aegis is alpha software intended for evaluation and development. Check the [known limits](#known-limits) and the notes for the specific [release](https://github.com/antropos17/Aegis/releases) you install. Current source includes signed Windows update support; published 0.14.1-alpha predates it. Automatic OS-level enforcement is not implemented.

### Is Aegis free?

Yes. Aegis source is available under the MIT license and local monitoring needs no account or subscription. Optional Anthropic analysis uses your own API key and is subject to that service's charges.

## Contributors

<table>
  <tr>
    <td align="center"><a href="https://github.com/antropos17"><img src="https://github.com/antropos17.png" width="80" alt=""/><br/><sub><b>Antropos7</b></sub></a></td>
    <td align="center"><a href="https://github.com/travisbreaks"><img src="https://github.com/travisbreaks.png" width="80" alt=""/><br/><sub><b>travisbreaks</b></sub></a></td>
    <td align="center"><a href="https://github.com/MsfPablo"><img src="https://github.com/MsfPablo.png" width="80" alt=""/><br/><sub><b>MsfPablo</b></sub></a></td>
    <td align="center"><a href="https://github.com/raye-deng"><img src="https://github.com/raye-deng.png" width="80" alt=""/><br/><sub><b>raye-deng</b></sub></a></td>
    <td align="center"><a href="https://github.com/pablo"><img src="https://github.com/pablo.png" width="80" alt=""/><br/><sub><b>pablo</b></sub></a></td>
  </tr>
  <tr>
    <td align="center"><a href="https://github.com/skmelendez"><img src="https://github.com/skmelendez.png" width="80" alt=""/><br/><sub><b>Steven Melendez</b></sub></a></td>
    <td align="center"><a href="https://github.com/anupamme"><img src="https://github.com/anupamme.png" width="80" alt=""/><br/><sub><b>anupamme</b></sub></a></td>
    <td align="center"><a href="https://github.com/mig-builds"><img src="https://github.com/mig-builds.png" width="80" alt=""/><br/><sub><b>mig-builds</b></sub></a></td>
    <td align="center"><a href="https://github.com/frobel0520"><img src="https://github.com/frobel0520.png" width="80" alt=""/><br/><sub><b>frobel0520</b></sub></a></td>
    <td align="center"><a href="https://github.com/KJyang-0114"><img src="https://github.com/KJyang-0114.png" width="80" alt=""/><br/><sub><b>KJyang-0114</b></sub></a></td>
  </tr>
</table>

[CONTRIBUTING.md](CONTRIBUTING.md) &middot; [SECURITY.md](SECURITY.md) &middot; [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## Support

If Aegis is useful to you, consider giving it a star on GitHub — it helps others discover the project.

For deployment or integration requirements, [open a feature request](https://github.com/antropos17/Aegis/issues/new?template=02-feature-request.yml). Centralized management and a hosted service are not currently provided.

## License

[MIT](LICENSE)

## Star history

[![Star History Chart](https://api.star-history.com/image?repos=antropos17/Aegis&type=timeline&legend=top-left)](https://www.star-history.com/?repos=antropos17%2FAegis&type=timeline&legend=top-left)
