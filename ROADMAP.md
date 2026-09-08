# AEGIS Roadmap

Status checked against `11215d4` on 2026-09-07. Package version: `0.14.1-alpha`;
locked Electron: `43.4.1`. Changes merged after a release are available in source,
not automatically in an installed app.

This is the current development queue. Implementation and measurement history
remain in [progress.md](memory-bank/progress.md). The separately developed frontend
is user-owned. Application grouping is explicitly integrated into the current
interface; broader renderer and design work remain separate. Plan IDs below are
distinct from GitHub issue numbers.

## Completed baseline

Do not schedule these capabilities as new work:

- Codex migration and SQLite audit-index blocks 1–2: index maintenance and paginated
  reads with JSONL fallback. JSONL remains the source of truth. See
  [audit-index.md](docs/roadmap/audit-index.md).
- Sensor Health B1–B8, including suspend/resume gaps and the cross-sensor umbrella
  suite (PR #329). See [sensor-health-degraded.md](docs/roadmap/sensor-health-degraded.md).
- Sequence loader, engine, scan taps, hot reload and mutation gate. See
  [sequence-rules.md](docs/roadmap/sequence-rules.md).
- Startup work: deferred initialization, evidence watchers in workers and deferred
  log cleanup. Further performance changes need a measured bottleneck.
- Application process grouping in data and the current interface: one named card,
  observed application trees and expandable child PIDs. See
  [application-groups.md](docs/roadmap/application-groups.md) for the frontend contract.
- Signed Windows update checking, download and installer verification (PR #367).
- Downloads defaults (#332), incomplete-export rejection (#370), WSL observation
  freshness (#371), shared fresh Windows process observations (#372), streamed
  JSON/ZIP audit exports (#373), and completed native baseline retirement (#374).

Limits remain: streamed exports reject audit records over 1 MiB and do not implement
ZIP64; profile persistence retains its existing crash durability limits; WSL on this
baseline covers the default distribution and `opencode` / `grok` signatures only.

## A — discovery coverage

| Block | Remaining work | Dependency and completion evidence |
| --- | --- | --- |
| A1 | All running WSL distributions, separate identities, caches and health. | Supplied patch `a408af0` was tested separately and is unmerged. Resolve the running-list / `wsl -d` race: a distribution can stop between the commands and be restarted by the probe. Another list check alone cannot provide an atomic no-start guarantee. |
| A2 | Derive suitable POSIX signatures from the agent database. | After A1. Verify executable boundaries, Windows-only aliases and misleading argument matches; preserve `opencode` / `grok` coverage. The database's 110 agents / 262 names are not a count of detectable Linux agents or processes. Derive the usable subset. |
| A3 | Docker and Podman discovery under [#8](https://github.com/antropos17/Aegis/issues/8). | After A2. List running containers through runtime commands, with distinct runtime/container identities and independent freshness/health. No container start or exec for discovery. Command/image metadata is discovery evidence, not proof of every process inside. Direct daemon-socket integration is outside this block. |
| A4 | Define and implement the missing GPU signal in [#9](https://github.com/antropos17/Aegis/issues/9). | Recon first: current code already reports per-PID NVIDIA VRAM through `nvidia-smi`. Allocation does not measure active inference. Establish signal meaning, supported hardware, cost and unavailable behavior before implementation. |

A1 must preserve successful observations from other distributions when one fails.
Retained observations keep their original time and an explicit stale flag. A WSL
namespace PID must never become a Windows PID for file/network attribution.
Discovery alone does not close every requirement of issue #8.

## B — Windows ETW attribution

[Issue #12](https://github.com/antropos17/Aegis/issues/12) needs measurements before
production implementation. [kernel-file-etw.md](docs/recon/kernel-file-etw.md) lists
**13** hardware-gated questions, including Fast I/O, mapped files, Windows editions
and Hyper-V as well as filtering, event identity, mapping lifecycle and loss.
The dependency is those observations, not the absence of a Windows host.

1. **B1:** isolated [C#/TraceEvent harness and procedure](sidecar/etw-probe/README.md)
   are prepared; the first Home matrix is recorded and a repeated load study is ready.
   The [live measurement checklist](docs/recon/kernel-file-etw-measurements.md) remains open.
   Collect results on target systems that answer each question; distinguish verified
   results from environment-limited or unresolved coverage. One machine or a mock
   cannot close all questions.
2. **B2:** use B1 evidence to choose producer scope, sensor IDs, attribution, loss
   handling and the relation to population/identity health.
3. **B3+:** split implementation into sidecar blocks after B2. The existing
   `sidecar/procsnap` transport and health integration are a precedent. ETW runs in
   a separate process, not a native addon inside Electron.

## C — existing rules coverage

**C1 / C2 implemented:** [rules-coverage.md](docs/roadmap/rules-coverage.md) maps
[#73](https://github.com/antropos17/Aegis/issues/73) and
[#75](https://github.com/antropos17/Aegis/issues/75) to the previous coverage and the
new regression cases. The gaps were in YAML failure boundaries and independent
OpenClaw expectations. Tests now exercise these contracts without changing
production rules or matching behavior; five deliberate mutations were caught.

## D — platform identity, then sensors

Linux now supplies fresh procfs birth observations. macOS still declares
`providesStartTime: false`; its native `<pid>:u` identities cannot distinguish reuse.

- **D1 implemented:** Linux reads field 22 from fresh `/proc/<pid>/stat`, observes
  CLK_TCK, and pins a boot-ID-bound epoch reference. Kernel ticks provide generation
  witnesses; unavailable identity yields null birth times and freezes sessions.
  Tests cover parsing, conversion, PID reuse, outages/recovery and clock corrections.
- **D2:** select and verify macOS birth-time collection. Document resolution and
  residual ambiguity: a one-second timestamp cannot distinguish every rapid reuse.
- **D3 / D4:** Linux fanotify/eBPF and macOS Endpoint Security follow platform
  identity work and separate recon documents. Schedule implementation after the
  Windows ETW track establishes the cost of operating a file sensor sidecar.

An unread birth time stays `null`; never fill it from a cache. An observation outage
freezes sessions rather than establishing process exits.

## E — longer-term architecture

Browser extension, cross-device correlation, daemon operation, MCP interception and
SIEM export remain unscoped. Each needs requirements and recon before an estimate.
Keep them outside the active queue while the first ETW sensor is being established.

## F — maintenance

- **F1:** a scripted audit-index mutation gate may replace documented manual
  mutations. A local gate and CI wiring are separate scopes: changes under
  `.github/workflows/` require explicit authorization under `AGENTS.md`.
- **F2:** dependency PRs #352 / #353 (Vitest and coverage together) and #354 (Vite and
  plugin compatibility) are separate from functional work. Lockfile regeneration
  requires explicit authorization.
- **F3:** release PR #364 is pending preparation, not authorization to publish a
  release or tag. Leave it outside the development merge cycle.

## Execution order

Block 0 is this roadmap reconciliation, including the stale B8 status correction.
Next resolve A1's no-start requirement, then A2 and A3. C1/C2 are implemented with
evidence linked above. D1 is implemented; B1 now needs repeated load measurements;
independent D2 can follow. A4 starts with recon. Application process grouping is separately
authorized in both data and the current interface; broader frontend work remains separate.

Keep one logical block per branch and PR. A supplied patch is not complete until
reviewed, verified and merged. Use `AGENTS.md` for the authorized git cycle and
verification: branch from `origin/master`, stage task files only, run appropriate
local checks, open the PR, wait for all five required contexts, then merge. Update
the session handoff after each block. A docs change does not authorize a release or
changes to protected configuration.
