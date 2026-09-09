<div align="center">
  <h1>AEGIS</h1>
  <p><b>Local monitoring for AI coding agents</b></p>
</div>

AEGIS observes detected agent processes, file activity and TCP endpoints from outside the agents. It records attribution evidence and behavioral changes without requiring an agent plugin.

**Open-source, monitor-first, no telemetry.** Monitoring data is stored locally. Optional AI analysis sends activity metadata to Anthropic on request; update checks contact GitHub. See [privacy and key handling](SECURITY.md#privacy-architecture).

<p align="center">
  <a href="https://github.com/antropos17/Aegis/releases/latest"><img src="https://img.shields.io/github/v/release/antropos17/Aegis?include_prereleases&style=flat-square&label=Release" alt="Release"></a>
  <img src="https://img.shields.io/github/actions/workflow/status/antropos17/Aegis/ci.yml?style=flat-square&label=CI" alt="CI">
  <a href="#monitor-first"><img src="https://img.shields.io/badge/Mode-monitor--first-8a2be2?style=flat-square" alt="Monitor-first"></a>
  <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="MIT License">
  <img src="https://img.shields.io/badge/Platform-Windows%20%C2%B7%20macOS%2FLinux%20experimental-lightgrey?style=flat-square" alt="Platform">
</p>

[Download](#download) · [Local demo](#try-without-ai-agents) · [Known limits](#known-limits) · [Contributing](CONTRIBUTING.md) · [Report a bug](https://github.com/antropos17/Aegis/issues/new?template=01-bug-report.yml)

## What AEGIS observes

| Layer | Coverage |
| --- | --- |
| Processes | 110 agents (262 process-name signatures), parent-chain and IDE-host detection, with limited WSL and IDE-extension discovery |
| Files | Changes in configured sensitive directories and agent config paths; Windows open-handle and Restart Manager observations |
| Network | TCP endpoints for detected agent PIDs, forward-confirmed reverse DNS, and `allowlisted` / `unknown` / `flagged` verdicts |
| Behavior | 73 sensitive-path detection rules across 8 categories, rolling 10-session baselines, anomaly scoring and sequence correlations |
| Local LLMs | Ollama and LM Studio runtime probes; other supported runtimes detected by process signature |

Activity can be filtered and grouped, inspected per agent, and exported to JSON, CSV, HTML or ZIP. The [agent database](src/shared/agent-database.json) and [contributor guide](CONTRIBUTING.md#how-to-add-a-new-agent) describe how to extend detection.

## Monitor-first

AEGIS observes and logs; it does not automatically block or contain agents. Kill, suspend and resume are manual actions. Monitoring presets and endpoint allowlists do not establish that an agent is safe. Use sandboxing when you need enforcement.

AEGIS is alpha software. This README describes current source; installed builds contain the features available at their [release tag](https://github.com/antropos17/Aegis/releases).

## Download

### Windows installer

Download the `.exe` from [GitHub Releases](https://github.com/antropos17/Aegis/releases). Releases from v0.13.0-alpha include a signed manifest for [offline installer verification](docs/RELEASE-VERIFICATION.md). Current source includes signed Windows update support; published 0.14.1-alpha predates it, so the first release containing the updater must be installed manually.

### From source

Requires **Node.js 24.x**. Windows 10/11 is the primary platform; macOS/Linux support is experimental.

```bash
git clone https://github.com/antropos17/Aegis.git
cd Aegis
npm ci
npm start
```

### Try without AI agents

After installing dependencies, build and preview the browser demo:

```bash
npm run build:demo
npx vite preview --mode demo --host 127.0.0.1 --port 4174
# open http://127.0.0.1:4174
```

The demo uses simulated data and does not monitor real processes. Electron-only operations are unavailable. Use the built preview: `npm run dev` currently fails to load the dashboard because of a shared CommonJS import incompatibility.

<details>
<summary>Release history</summary>

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

</details>

## The evidence graph

- **Instance identity:** Windows PID and OS birth time distinguish process lifetimes when birth time is available. Missing birth times and synthetic discoveries provide weaker identity.
- **Attribution:** Records distinguish confirmed, inferred and unattributed ownership. Identity or attribution can be null when unknown or not applicable.
- **Audit trail:** Hash-chained JSONL records rotate daily and have 30-day retention. Chain verification detects edits relative to a trusted chain state; it does not guarantee that no events were lost.

See the [architecture](ARCHITECTURE.md), [correctness audit](docs/current-state/CORRECTNESS-AUDIT.md) and [dated measurements](docs/bench/) for implementation details and evidence.

## Known limits

- **Incomplete coverage:** Unknown signatures and processes that start and exit between polling ticks can be missed. MCP traffic and individual tool calls are not parsed.
- **Platform gaps:** macOS/Linux lack OS birth times for identity and remain unsafe under PID reuse. Token-cost tracking is Windows-only.
- **Bounded UI history:** Retained event windows can differ from aggregate totals; there is no truncation banner yet.
- **Sensor and audit gaps:** Health status does not prove complete capture. Audit loss markers require a successful flush; process-scan overruns lack a dedicated counter.
- **Sensitive metadata:** Logs and exports contain paths, agent names and endpoints. Settings JSON exports can also include the configured API key; remove it before sharing. Local key encryption depends on safeStorage availability. See [SECURITY.md](SECURITY.md).
- **Unmeasured claims:** No general detection rate, false-positive rate, startup-time guarantee or whole-app overhead figure has been established.

## Development and roadmap

The monitoring engine uses CommonJS JavaScript; the Svelte renderer and shared types use TypeScript. See [development setup](CONTRIBUTING.md), the [development reference](docs/DEVELOPMENT.md) and [package.json](package.json) for the stack and commands.

CI runs build, lint, type checks, tests and dependency auditing. `npm run counts:check` verifies selected inventory declarations. `npm run verify:gate` checks identity-witness behavior with fault injection (4 mutants); `npm run verify:seq-gate` checks sequence behavior. Run `npm test` for current suite results.

The [roadmap](ROADMAP.md) tracks Windows ETW experiments and remaining discovery/platform work. Source changes and isolated experiments are not automatically available in released installers.

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

## Support and license

[Feature requests](https://github.com/antropos17/Aegis/issues/new?template=02-feature-request.yml) · [Private vulnerability reports](https://github.com/antropos17/Aegis/security/advisories/new) · [MIT license](LICENSE)

Local monitoring requires no account or subscription. Optional Anthropic analysis uses your own API key and is subject to that service's charges.

## Star history

[![Star History Chart](https://api.star-history.com/image?repos=antropos17/Aegis&type=timeline&legend=top-left)](https://www.star-history.com/?repos=antropos17%2FAegis&type=timeline&legend=top-left)
