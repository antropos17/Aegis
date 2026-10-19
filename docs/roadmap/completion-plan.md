# AEGIS completion plan — October 2026

Status: approved by the repository owner on 2026-10-19 for execution by a Codex
orchestrator running GPT-6.1 Sol with subagents. Baseline: master `bf65076`
(2026-10-19, after #976 and #985), package `0.19.2-beta`. PR #974 is open. The
owner's main checkout may sit on an older commit with uncommitted changes; leave
it untouched and work only in fresh worktrees from `origin/master`.

Revision 2 (2026-10-19) incorporates the first plan review: a dedicated Windows
workstream (W11), single ownership of shared Rust files, the merge-update rule
from `docs/development/workflow.md`, mutation checks run by writers, stricter
evidence for alert explanations, Cedar translation that preserves current
policy semantics, a specified disk spill, a clarified `sensor/1` contract and
separate states for implemented, verified and owner-pending work.

Execution refresh (2026-10-19): Wave 0 starts from master `ae1b8418`, which
includes #986's idle first-read attribution fix and qualification. W0 must
evaluate that evidence before scheduling W11 block 1. The source package's
`bf65076` baseline above is retained as revision history. At that bootstrap
checkpoint Rust installation was deferred; Wave 0 installed no Rust toolchain.

Wave 0 findings are recorded in [completion-baseline.md](completion-baseline.md).
Its Q1–Q11 rows establish the implementation and evidence boundaries for later
briefs. The runtime baseline remains `ae1b8418`; bootstrap PR #987 changes only
planning, agent definitions and configuration. This session completes Wave 0;
later implementation starts only within the owner's requested scope.

W1-pipe execution (2026-10-19): the owner authorized this block through merge in
a fresh worktree. Its delivery contract, qualification and evidence limits are
recorded in [w1-pipe.md](w1-pipe.md). W1a and W1b remain separate work; Rust
installation was still deferred at that checkpoint.

W1a JavaScript preparation (2026-10-19): [sensor-wire.md](sensor-wire.md)
records the resolved identity representation, owned D1 context, exact message
shapes and strict parser decisions. [w1a-js.md](w1a-js.md) records implementation,
review corrections and scoped verification. This is a JS preparation slice; the
Rust implementation and both-language gates remain required for full W1a acceptance.

W8 Wave 1 preparation (2026-10-19): [the measurement method](../bench/METHOD.md)
defines the prospective effectiveness and resource protocol, existing harness
limits and required admission evidence. This independent documentation milestone
does not qualify measurements or complete T8. Executable corpus/collector work,
platform qualification and publication remain later W8 work.

This document is the work order for the orchestrator. It defines the target, the
fixed constraints, how work is split across agents, each workstream with its
acceptance criteria, the execution order and the actions that stay with the
human owner.

Ten-hour execution update (2026-10-19): the owner authorized necessary tooling
and autonomous development through 15:57 UTC. Rust 1.99.1 MSVC, rustfmt and
Clippy are installed on X with process-local activation. W1a JavaScript #990 and
Rust #996 are merged; both-language wire gates and exact PR/master repository
checks passed. The owner confirmed the wire merges. W1b can now proceed after
its two merged prerequisites. Separate Linux/macOS library crate roots prepare
parallel implementation; native providers, host/session behavior and packaged
application qualification remain open.

## 1. Instruction priority

When two sources disagree, the higher one wins:

1. Explicit instructions from the repository owner in the current session.
2. `AGENTS.md` and the files it routes to (`CODING_STANDARDS.md`,
   `docs/development/workflow.md`, `frontend/observatory/AGENTS.md`).
3. This plan.
4. Skills and other documentation.

If this plan conflicts with a higher source, follow the higher source, name the
file and quote the rule in the progress tracker, and continue with the rest of
the plan. Documentation lags code by default: before acting on any number, path
or status written here or in `docs/`, read it from source.

## 2. Target

AEGIS closes the measured gaps against AgentSight, Sage, Leash and the Microsoft
Agent Governance Toolkit while keeping the properties that already distinguish
it: independent OS-level observation without agent cooperation, per-instance
attribution with stated evidence, local processing by default with explicit
opt-in for external analysis, and a desktop interface for
people who do not live in a terminal.

The plan is complete when all of the following hold on merged master:

| # | Capability | Gap it closes |
| --- | --- | --- |
| T1 | Windows file and process activity captured from ETW events in packaged builds, with polling kept as a declared fallback | Polling blind spot for short-lived processes |
| T2 | Linux event sensor in Rust (eBPF, then fanotify, then procfs) behind the sidecar wire contract | Linux support is experimental |
| T3 | macOS sensor in Rust with a process-generation witness, libproc/kqueue/FSEvents baseline and an Endpoint Security mode that activates when the entitlement exists | macOS has no birth-time witness |
| T4 | Alert explanation: each file, network and process alert links to the agent tool call that preceded it, when local session data allows | No intent visibility |
| T5 | Cedar as the action-policy language for allow/ask/deny, equivalent to policy schema 3 on every existing case | Separate JSON policy families |
| T6 | Guard mode: one-step installation of native pre-execution hooks for supported agents, with "Blocking verified" shown only after qualification | No pre-execution blocking by default |
| T7 | Protected Session reaches its acceptance review with every stage evidenced; enabling launch stays a human decision | Sandbox launch is disabled |
| T8 | Published measurements: per-platform recall against an independent oracle, false-alarm rate on ordinary work, CPU/RAM overhead with a written method | Current per-platform acceptance measurements missing |
| T9 | Observatory shows per-platform, per-sensor coverage: Observed, Blocking verified, Coverage lost, and the active sensor mode | Coverage state is partly hidden |
| T10 | Installable artifacts for Windows, Linux and macOS with verification instructions; signing steps prepared for the owner | Install friction |

## 3. Fixed constraints

These are decided. Do not reopen them; if one blocks a workstream, record the
block in the tracker and continue with other work.

Identity and evidence:

- `instanceId` is `pid:startTime(ms)`. The format is frozen.
- The generation witness is a separate string field.
- An unread birth time stays `null`. A cache never supplies it. An observation
  outage freezes sessions and does not establish process exit.
- Attribution vocabulary is `confirmed`, `inferred`, `unattributed` plus a closed
  registry of evidence codes. No numeric confidence until the benchmark has
  ground truth.
- Hash-chained JSONL is the canonical audit record; SQLite is an index over it.
- A silent fallback counts as a defect. Every fallback is announced in sensor
  capabilities, health state and the coverage view.

Sidecars:

- Every native sensor is a separate process behind a stdio boundary, so a native
  crash cannot take down the Electron control process.
- The wire is the stable contract: `uint32` little-endian payload length followed
  by UTF-8 JSON, a `hello` frame with protocol version and capabilities first, a
  hard stop on an unknown protocol version, and 64-bit integers encoded as decimal
  strings. Reference implementation: `src/main/platform/proc-snapshot-protocol.js`.
- Windows sidecars stay in C# (`sidecar/`). New Linux and macOS sensors are Rust.
  No existing C# component is ported to Rust under this plan.

Permanent exclusions:

- Kernel drivers and minifilters, TLS interception, reading other processes'
  memory, and Job-object auto-containment of ordinary (non-routed) agent launches.
- Honey Workspace, Community Packs, Behavior DNA, Query Console, signed receipts.
- Embedding Sysmon. Sysmon is an external benchmark oracle only.
- Outreach to authors of other projects named Aegis.

Data handling:

- Logs, IPC and exports exclude configuration contents, environment values,
  tokens, secret-bearing arguments, prompt text and model responses by default.
  Relative paths are sensitive metadata.
- Every traversal, read, queue and storage limit exposes incompleteness.
- Policy decisions are deterministic. LLM analysis may explain a decision and
  never grants permission.

Positioning:

- A prevention capability is described as available only after its blocking was
  verified by a recorded qualification. Until then it is labeled observation.
- Write in terms of observation, attribution and coverage. Public text uses
  measured claims, no superlatives and no contrastive "X, not Y" framing.

## 4. Autonomy policy

The full git cycle is authorized: branch from `origin/master` in a dedicated
worktree, commit, push, open a PR, wait for all required CI contexts, merge with
a merge commit, verify with `gh pr view --json state,mergedAt`, then clean up.
Local builds, tests, fixtures and benchmark runs on this machine are authorized.

These actions need the owner's explicit approval in the session, and the
orchestrator stops at a prepared, reviewable state for each:

- release tags, force pushes, deleting remote branches other than the one just
  merged;
- changes under `.github/workflows/` and to `.codex/config.toml`, including the
  sandbox network allowlist (Rust work needs `crates.io`, `index.crates.io` and
  `static.crates.io`; new npm packages need `registry.npmjs.org`); the
  orchestrator lists the exact domains it needs in the tracker;
- regenerating `package-lock.json` (adding a dependency with `npm install <pkg>`
  is covered by the kickoff authorization when the owner grants it there);
- branch-protection or repository settings;
- anything needing a certificate, an Apple Developer account, entitlement
  requests, store submissions, or a machine restart;
- setting `launchAllowed` to `true` or labeling any route "Blocking verified"
  before its qualification record exists;
- any public post, README positioning change or landing-page change.

Everything else proceeds without asking. Ask a question only when the answer
would change what gets built.

## 5. Orchestration

### 5.1 Roles

The root session is the orchestrator. It owns requirements, ordering, briefs,
merge serialization, the tracker and the final report. It writes code only for
small integration fixes that touch files no running worker owns.

| Agent | Source | Model / effort | Writes | Use for |
| --- | --- | --- | --- | --- |
| `researcher` | existing | inherits | no | Read-only questions about the codebase |
| `architecture-mapper` | existing | inherits | no | Module boundaries before a workstream starts |
| `rust-sensor-engineer` | new | gpt-6.1-sol / high | yes | `sensors/` Rust workspace, Linux and macOS sensors |
| `windows-sensor-engineer` | new | gpt-6.1-sol / high | yes | C# sidecars, ETW, Windows routes |
| `integration-engineer` | new | gpt-6.1-sol / high | yes | `src/main/`, sensor host, policy, explanation, Observatory wiring |
| `ui-designer` | existing | inherits | yes | Observatory visual work inside the approved template |
| `bench-engineer` | new | gpt-6.1-sol / medium | yes | `bench/`, `docs/bench/`, measurement scripts |
| `security-reviewer` | existing | inherits | no | Review of every PR touching IPC, policy, secrets, privileges, sidecars |
| `test-auditor` | existing | inherits | no | Read-only judgment of whether new tests are meaningful, using the writer's recorded mutation results |
| `consistency-reviewer` | existing | inherits | no | Docs-versus-code check before any user-facing text merges |
| `auditor` | existing | inherits | no | Full CI-gate readiness run at the end of each wave |
| `shipper` | existing | inherits | yes | Release preparation once the owner approves a release |

Run the root session with `gpt-6.1-sol` at effort `high`. For the identity
conversion work in W2 and W3, the wire contract in W1a and Cedar equivalence in
W5, brief the worker to treat it as high-cost-of-error work; if per-spawn effort
selection is available, use `xhigh` for those briefs.

### 5.2 Delegation

- Spawn read-only agents in parallel whenever several independent questions are
  open. Spawn writers in parallel only for workstreams whose owned paths do not
  overlap (section 5.3).
- Keep at most three writers running at once. Reviewers and researchers do not
  count toward that limit but stay within the session's thread cap.
- Do not delegate work you can finish in a handful of tool calls. Do not spawn an
  agent to re-check your own completed work; use the named reviewers on PRs.
- Each brief follows Appendix B. A child returns a summary in the Appendix B
  return format, never raw logs or full command output.
- Wait for every child of a wave step before starting a step that depends on it.
  Independent steps proceed while others run.
- Messages between agents are read by humans: complete sentences, normal spacing
  between words and numbers, file paths written in full.
- Fallback when an in-session spawn ignores the configured model or effort: the
  orchestrator writes the brief to `X:/aegis-briefs/<workstream>.md` and the
  owner (or the orchestrator, when shell launch is available) starts a separate
  `codex exec` session with the model and effort set at launch, in the
  workstream's worktree. The return format stays the same.

### 5.3 Worktrees and path ownership

Each writer works in its own worktree under `X:/tmp/aegis-wt/<workstream>` with
its own branch from `origin/master`, following the worktree rules in
`docs/development/workflow.md` and `memory-bank/ai-mistakes.md`. A path has one
owner at a time:

| Path | Owner |
| --- | --- |
| `sensors/Cargo.toml`, `sensors/Cargo.lock`, `sensors/rust-toolchain.toml`, `sensors/aegis-wire/**` (shared Rust files) | one writer at a time, assigned by the orchestrator; changes land in their own small PR before platform work that depends on them |
| `sensors/aegis-sensor-linux*/**`, `sensors/linux/**` | `rust-sensor-engineer` (W2 instance) |
| `sensors/aegis-sensor-macos/**` | `rust-sensor-engineer` (W3 instance) |
| `sidecar/**`, `src/main/platform/etw-*`, `src/main/platform/win32.js`, `src/main/platform/windows-*` | `windows-sensor-engineer` |
| `src/main/platform/linux*.js`, `src/main/platform/darwin.js`, `src/main/platform/posix-shared.js` | `rust-sensor-engineer` while W2/W3 run, then `integration-engineer` |
| `src/main/platform/sensor-host*.js` (new), `src/main/platform/index.js` | `integration-engineer` |
| `src/main/` (other files), `src/shared/` | `integration-engineer` |
| `frontend/observatory/**` | `ui-designer`, wired by `integration-engineer` |
| `bench/**`, `docs/bench/**` | `bench-engineer` |
| `docs/roadmap/**`, `ROADMAP.md`, `memory-bank/progress.md` | orchestrator |

A worker that needs a change in a path it does not own reports the needed
change in its return; the orchestrator schedules it with the owner.

### 5.4 Merging

Merge policy is merge commits only, with strict status checks. Follow
`docs/development/workflow.md`: a branch behind master is updated by merging
master into it, and a changed PR head needs fresh check results. The
orchestrator serializes merges: one PR merges, the next branch merges the new
master, its checks rerun on that head, then it merges with `gh pr merge <n>
--merge --delete-branch --match-head-commit <verified-head-sha>`. Required
contexts are build, lint, svelte-check, test and audit. `gh pr merge` may report
nothing or exit 1 on success; confirm state with `gh pr view --json
state,mergedAt` before moving on.

Before merging, each PR gets:

- `security-reviewer` when it touches IPC, policy, secrets, privileges,
  sidecars, network egress or installers;
- `test-auditor` when it adds tests for sensors, identity, policy or correlation;
  it reads the tests and the writer's mutation record and runs nothing;
- `consistency-reviewer` when it changes README, docs or UI text that makes a
  factual claim.

Findings of real defects are fixed in the same PR. Style-only remarks are noted
in the PR and do not block.

PRs that change identity, the wire contract, policy evaluation or the Protected
Session carry the label `needs-independent-review`. The owner runs a separate
review session on them; the orchestrator continues with other work and merges
these PRs after the owner confirms.

### 5.5 Tools available to agents

All agents inherit the root session's MCP servers. Use them in this order of
preference: a first-class CLI already used by the repo, then an MCP server, then
web search.

| Need | Tool |
| --- | --- |
| GitHub PRs, checks, logs, merges | `gh` CLI |
| Codex, GPT-6 and OpenAI API behavior | `openaiDeveloperDocs` MCP |
| Windows APIs: ETW, Job objects, AppContainer, Hyper-V, WFP, Authenticode | `microsoft-learn` MCP (`microsoft_docs_search`, `microsoft_docs_fetch`, `microsoft_code_sample_search`) |
| Electron, Vite, Vitest, Node and npm library APIs | `context7` MCP |
| Svelte 5 components in Observatory | `svelte` MCP, including its autofixer on new or changed components |
| Rust types, diagnostics and references in `sensors/` | `rust-analyzer` MCP for the `sensors/` workspace; `cargo fmt`, `cargo clippy`, `cargo test` through the shell |
| Kernel, aya, Endpoint Security, Cedar and anything not covered above | built-in web search, primary sources first |

Check API facts against these sources before writing code that depends on them,
and cite the page in the PR description when a design choice rests on it. If a
listed server is not connected in the session, use web search for the same
question and note the missing server in the tracker as an owner action.

### 5.6 Progress tracker

The single source of progress is `X:/AEGIS_COMPLETION_PROGRESS.json`, outside the
repository, schema in Appendix C. The orchestrator updates it after every merge,
block, owner decision and wave transition. `memory-bank/progress.md` in the
repository receives one short handoff entry per merged workstream block,
following its existing format.

## 6. Workstreams

Each workstream lists what to confirm in source first, the scope, the design,
deliverables, acceptance and owner. Acceptance criteria are the definition of
done for that workstream; section 8 adds the global gate.

### W0 — Baseline confirmation (read-only)

Purpose: replace assumptions in this plan with facts from current master.

Run in parallel, one `researcher` per question, each returning at most 40 lines:

1. Bounded pipeline: does `src/main/ipc-batcher.js` and the file-access batching
   path have capacity, high-water and loss counters, spill-to-disk for security
   events, and coalescing of benign self-churn? What is missing for event rates
   of 2,000 events per second sustained and 20,000 per second in bursts?
2. Windows ETW: list the open items in `docs/roadmap/etw-sensor-design.md`,
   `docs/roadmap/etw-durable-recovery.md`, open PR #974 and merged PRs #976 and
   #985 and #986. Preserve #985's historical idle-first-read failure and assess
   the fix, source-bound qualification and remaining limits recorded by #986.
   State which items block admission of Kernel-File reads into
   FileEvents, audit, baselines, sequences and risk, and what process
   start/stop capture exists today.
3. Sensor health: map `src/main/sensor-health.js`, `src/main/app-health.js` and
   `src/main/platform/etw-file-health.js` to the states BOOTING,
   SENSORS_STARTING, HEALTHY, DEGRADED, FAILED.
4. Linux and macOS: current behavior of `linux.js`, `darwin.js`,
   `posix-shared.js`, `linux-process-map.js` and D1 identity; where the epoch
   reference and CLK_TCK conversion live.
5. Agent session sources: which local transcript formats AEGIS already reads
   (`src/main/token-adapters/`, `src/main/provider-codex-adapter.js`,
   `src/main/gemini-beforetool-hook.js`, `src/main/agent-event-receiver.js`) and
   the on-disk locations for Claude Code, Codex and Gemini CLI on each OS.
6. Policy: the evaluation path for policy schemas 1–3 (`execution-policy.js`,
   `action-policy*.js`) and every test that fixes a decision.
7. Hooks: what `action-policy-hook.js` and `gemini-beforetool-hook.js` install,
   which agents and versions are qualified, and what qualification evidence exists.
8. Protected Session: stage status E0–E11 and review gates A0–A4 from
   `docs/roadmap/enforcement-*` and `docs/roadmap/ai-agent-protection.md`.
9. Bench: what exists in `bench/` and `docs/bench/`, and what the Sysmon/Procmon
   oracle plan in the bench docs still lacks.
10. CI: jobs in `.github/workflows/ci.yml` and `windows-fixtures.yml`, and what a
    Rust job and a Linux eBPF integration job would need.
11. Test environments: which Linux kernels, macOS versions, Hyper-V hosts and
    Windows packaged-build machines are reachable from this session or only by
    the owner.

Deliverable: the orchestrator writes `docs/roadmap/completion-baseline.md` (one
PR) with a table per question (finding, source location, consequence for this
plan) and a T1–T10 table with three columns per target: implemented, verified by
which evidence, missing. Then it adjusts the order in section 7 only where a
finding requires it, recording each change in the tracker.

Acceptance: every later workstream starts from a baseline row, not from this
document's assumptions.

### W1 — Event-capacity pipeline and sensor host

Owner: `integration-engineer`. Depends on W0.

W1-pipe. Extend the existing batcher to close the gaps found in W0 question 1.
Requirements: bounded queues with capacity, high-water mark and loss counters per
sensor; security-relevant events (sensitive-path access, new agent instance,
outbound connection from an agent) spill to disk when the in-memory queue is
full; benign self-churn is coalesced; metrics are latest-only; every loss
produces a fixed-code audit marker with counts and time range.

The spill store has a fixed disk quota in the user data directory; it is replayed
in order after a restart before new events are admitted; when the quota or the
disk is full, new security events are counted as lost with an exact marker and
the sensor health turns DEGRADED; spilled records are deleted once their
consumers acknowledge them; a damaged spill file is quarantined and reported,
and processing continues with the next file.

Acceptance: a load test feeds 20,000 synthetic events per second for 30 seconds
through the real batcher; security events arrive complete or with exact loss
markers; heap and spill size stay within their bounds; restart replay, full-disk
and damaged-file cases are tested; the test fails when the spill path is removed.

W1a. Sensor wire contract `sensor/1`, specified in Appendix A, implemented in
`src/main/platform/sensor-protocol.js` as a pure codec next to
`proc-snapshot-protocol.js`, plus the `sensors/` Cargo workspace with only the
shared files and the `aegis-wire` crate. `integration-engineer` owns the JS
codec; one `rust-sensor-engineer` instance owns the shared Rust files for this
block. Golden frames live in `tests/fixtures/sensor-wire/`
as binary files plus a JSON description; both the JS codec and the Rust
`aegis-wire` crate decode every golden frame to the same structure. Acceptance:
round-trip and golden tests in both languages; split-frame, multi-frame,
oversize-frame and bad-JSON cases; unknown protocol is a hard stop.

Before freezing the wire, resolve Q4's identity gaps: preserve the raw birth
precision and composite generation witness in watched roots, expose the existing
D1 conversion through an owned host contract, and define clock-anchor and
null/error semantics. Appendix A is a proposal until those decisions are
recorded and reviewed. The earlier Rust deferral was lifted during the authorized ten-hour run. Both
language codecs are merged and verified (#990 and #996); native provider,
host/session and packaged-application qualification remain separate.

W1b depends on merged W1a and W1-pipe. Sensor host
`src/main/platform/sensor-host.js`: spawns the platform sensor
binary, performs the hello handshake, validates the sensor-selected active mode
and its announced capabilities, sends
`watch` and `paths` updates as agent detection changes, feeds events into the
W1-pipe queues, and reports health through the state machine from W0 question 3.
Reuse the ETW supervisor's custody and deadline handling. Add a bounded automatic
restart budget with reset only after an observed HEALTHY state; Q3 found no such
budget in the existing supervisor. Preserve the current aggregate/leaf health
contracts and show a visible coverage gap while the sensor is absent. When no sensor binary exists or
the handshake fails, the platform module keeps its current polling path and the
coverage view says so. Acceptance: tests with a fake sensor process for normal
operation, crash, hang, garbage output, protocol mismatch and restart budget.

### W2 — Linux sensor in Rust

Owner: `rust-sensor-engineer`. Depends on W1a. Runs in parallel with W3 and W4.

Workspace: W1a created `sensors/` with the shared files (layout in Appendix A).
W2 adds the Linux crates; a needed change to a shared file goes into its own
small PR, merged before the Linux PR that uses it. Before choosing the eBPF build
setup, read the current aya book and templates and use what aya recommends today
for building eBPF objects; record the choice and versions in
`sensors/README.md`. Starting versions observed on 2026-10-19: aya 0.14.0,
aya-ebpf 0.2.1, procfs 0.18.0, nix 0.31.3, serde_json 1.0.154.

Modes, announced in `hello.mode` and changed through `mode` frames (Appendix A),
best first:

1. `ebpf` (kernel 5.8 or later with BTF and ring buffer):
   - `sched/sched_process_exec`, `sched/sched_process_fork` and
     `sched/sched_process_exit` tracepoints maintain an in-kernel map of watched
     thread-group IDs: the roots sent by the host plus their descendants.
   - File opens from watched processes through the `openat`/`openat2` syscall
     tracepoints, entry and exit paired so only successful opens are reported,
     with access mode; path prefixes from `paths` filtered in kernel where the
     verifier allows and in user space otherwise.
   - Outbound TCP connects from watched processes, attributed in process
     context. Choose the attach point after checking which one gives the issuing
     process reliably on supported kernels, and document why.
   - Birth time from `task->start_boottime`, emitted in the same clock-tick
     units as field 22 of `/proc/<pid>/stat`, so the host reuses the D1 epoch
     conversion unchanged.
2. `fanotify` (CAP_SYS_ADMIN available, no eBPF): FAN_OPEN events with PID on
   marked mounts for sensitive path prefixes; process lifecycle from procfs
   polling with D1 identity; no network events.
3. `procfs`: process snapshots only, matching what the platform module does now.

Privileges: the Electron app stays unprivileged. The sensor binary needs
CAP_BPF, CAP_PERFMON and CAP_SYS_RESOURCE for `ebpf`, or CAP_SYS_ADMIN for
`fanotify`. Ship `sensors/linux/install-capabilities.sh`, which applies file
capabilities with `setcap` after showing exactly what it will do; running it is
an owner action. Without capabilities the sensor announces `procfs` and the
coverage view shows the reduced mode.

Acceptance:

- Identity parity: on a live Linux machine, for every process seen by both, the
  eBPF birth ticks equal procfs field 22; record counts in a dated bench file the
  way `docs/bench/generation-v2-*.md` records Windows parity.
- An integration test (in CI where the runner allows eBPF, otherwise a recorded
  local run with commit and kernel version) starts a watched process that forks a
  child, the child opens a sensitive fixture file and connects to a local
  listener; all three events arrive attributed to the child's `instanceId` with
  `confirmed` attribution.
- Short-lived process capture: 1,000 processes that live under 50 ms each are
  all reported by `ebpf` mode.
- Overhead measured with the W8 method and published.
- `cargo fmt --check`, `cargo clippy -- -D warnings` and `cargo test` pass.
- Tests fail when the descendant-tracking map update is removed.
- The order of delivery inside W2 is identity and `procfs` first, then `fanotify`,
  then `ebpf`, each in its own PR.

### W3 — macOS sensor in Rust

Owner: a second `rust-sensor-engineer` instance in its own worktree when writer
capacity allows, otherwise the W2 instance after W2's identity PR merges.
Depends on W1a. Shared Rust files follow the same rule as in W2. Order of
delivery: identity and `libproc` first, then `endpoint-security`.

Identity (closes roadmap item D2): read `pbi_start_tvsec` and `pbi_start_tvusec`
through `proc_pidinfo(PROC_PIDTBSDINFO)` for birth time in microseconds, and
`p_uniqueid` through `PROC_PIDUNIQIDENTIFIERINFO` as the generation witness,
since it does not repeat within a boot. `startTime(ms)` in `instanceId` derives
from the microsecond birth time; the witness carries `p_uniqueid` plus the boot
session identifier. Update `darwin.js` to report `providesStartTime: true` only
when this path succeeds. Confirm both fields against Apple headers and libproc
crate bindings before relying on them (libproc 0.14.11 observed on 2026-10-19).

Modes, best first:

1. `endpoint-security`: ES client subscribed to exec, fork, exit, open and
   connect-related notify events, through the `endpoint-sec` crate (0.6.2
   observed). This mode needs the `com.apple.developer.endpoint-security.client`
   entitlement, root and Full Disk Access; build it behind a cargo feature and
   activate it only when the signed binary carries the entitlement. Requesting the
   entitlement from Apple is an owner action.
2. `libproc`: process snapshots through libproc, exit notification through kqueue
   `EVFILT_PROC`/`NOTE_EXIT` for watched PIDs, sensitive-directory changes through
   FSEvents with attribution from sampling watched processes' open file
   descriptors (`PROC_PIDLISTFDS`), and TCP endpoints from socket descriptors.
   FSEvents-only observations carry `inferred` or `unattributed` attribution with
   evidence codes stating why.

Acceptance: identity tests including PID reuse within one second; a recorded
live run on macOS 13 or later with commit and OS version; the coverage view shows
which mode is active; tests fail when the witness comparison is removed.

### W4 — Alert explanation

Owner: `integration-engineer`. Depends on W0 question 5. Runs in parallel with
W2 and W3.

Correlate each alert carrying an `instanceId` with the agent tool call that
preceded it, using local session data the agent itself writes: Claude Code
transcripts (already parsed for token accounting), Codex session rollouts, Gemini
CLI session files and live lifecycle events from `agent-event-receiver.js`.
TLS interception stays excluded; this workstream uses only those local records.

Design:

- A session-source adapter per agent reads bounded tails of the session files
  that match the instance (same process lifetime and working directory), with
  the same bounded-read rules as token accounting.
- Session binding: a session is bound to an instance only through recorded
  evidence (process lifetime, working directory, agent-reported process ID or the
  live lifecycle receiver). Each binding carries its own strength and evidence.
- Linking an OS event to a tool call needs two things: the event falls inside the
  tool call's time window (start, then end or start plus a documented tolerance
  when the end is missing, with measured clock skew applied), and the tool call's
  own record names the same object, compared through a normalized path or
  endpoint digest. Time overlap alone never establishes the link.
- Strength: `confirmed` when the session binding is confirmed, the object digests
  match and exactly one tool call qualifies; `inferred` when the binding is
  inferred or several tool calls qualify (all candidates are listed); with only
  time overlap, or nothing, the alert stays `unattributed` to any tool call and
  states why. The UI wording says "preceded by", and makes no claim that the
  tool call caused the event. New evidence codes go into the closed registry with
  tests.
- The alert gains `context: { source, sessionRef, toolName, argsDigest,
  argsShape, deltaMs, strength, evidence[] }`. `argsShape` is a structural
  summary (command verb, path category, endpoint category) with no raw values.
  Prompt and response text never leave the session file.
- Observatory alert detail gets a "Preceding tool call" section. When nothing
  matched, it says which session sources were available and why none matched.

Acceptance: fixture transcripts for each agent plus synthetic OS events cover
match, no match, ambiguous match, clock skew and truncated session; a recorded
live Windows run reuses the #975 harness (installed Claude Code reading a
synthetic `.env`) and shows the read linked to the tool call that issued it; a
test asserts that no prompt or argument text reaches audit, IPC or exports.

### W5 — Cedar action policies

Owner: `integration-engineer`. Depends on W0 question 6. Starts after W4's first
PR merges, or in parallel if path ownership allows.

Use the official Cedar engine from JavaScript through `@cedar-policy/cedar-wasm`
(4.13.0 observed on 2026-10-19; cedar-policy Rust crate 4.14.0). Adding it is a
dependency change covered by the kickoff authorization when granted; otherwise
prepare the PR and stop for the owner.

Design:

- First, fix current behavior: characterization tests record the existing
  evaluators' decisions for rule order, `ask`, `defaultDecision`, schema 3
  review-required actions, malformed policies and unknown fields. Those tests
  become the equivalence reference.
- Q6 distinguishes Claude action schema 1 from execution schemas 2/3 and the
  separate Gemini, deletion and MCP contracts. Preserve their validation and
  adapter outputs, including reason, review classification and launch eligibility.
  Existing exact predicates cannot overlap in a valid policy; equivalent
  duplicates are rejected. New principals, sensor-health fields and routes need
  explicit trusted-input provenance before they influence authorization.
- Policy schema 4 is a Cedar policy set plus an AEGIS Cedar schema. Principals
  are agent instances; actions are `exec`, `mcp_call`, `delete_file`,
  `net_connect` and the other routes that exist in source; resources are paths,
  tools and endpoints; context carries attribution strength, route identifier and
  sensor health.
- Cedar evaluates without rule order (any matching `forbid` wins over `permit`).
  The schema 3 translator therefore compiles each ordered rule into a policy
  whose condition also excludes every earlier rule's condition, so the first
  matching rule decides exactly as today. Decisions map as: `forbid` to deny,
  `permit` to allow, `permit` annotated `@decision("ask")` to ask,
  `@reviewRequired("true")` to the schema 3 review-required behavior. The policy's
  `defaultDecision` becomes an explicit policy whose condition excludes every
  rule's condition, so Cedar's implicit deny never decides a translated policy.
- Schemas 1–3 stay supported with their current evaluator; Cedar is used for
  schema 4 and for translated policies once equivalence holds.
- Equivalence: every characterization test runs against both paths, and a
  property test generates requests across every field schema 3 reads (including
  literal equality and default cases) and asserts identical decision, ask and
  review-required outcomes. Generate duplicate/overlapping inputs as invalid
  cases where the current validator rejects them; compare those failures too.
- Evaluation stays deterministic and local. Explanations name the Cedar policy
  IDs that decided.

Acceptance: equivalence property test with at least 10,000 generated cases per
run and a fixed seed recorded in CI output; translator tests; docs page
`docs/ACTION-POLICY-CEDAR.md`; schema 3 users see no behavior change.

### W6 — Guard mode for supported agents

Owner: `integration-engineer` with `ui-designer`. Depends on W5.

Offer a guided installation of each agent's native pre-execution hook (Claude Code
hooks, Codex hooks, Gemini CLI before-tool hook, Cursor where a supported hook
exists) that routes decisions to the local policy (Cedar when present). Rules:

- Installation shows the exact file and lines it will change and writes a backup;
  removal restores the backup. Writing into user profile files happens only after
  the user confirms in the UI.
- An agent version that has not passed qualification shows "Observed"; after the
  recorded qualification for that agent and version passes (a scripted run where
  a denied action does not execute and an allowed one does), it shows "Blocking
  verified" for that agent, version and surface only.
- A hook that disappears, fails to answer, or is bypassed by an action the OS
  sensors see without a matching hook decision produces "Coverage lost" with the
  evidence.

Acceptance: qualification scripts and records per agent and version; tests for
install, removal, tamper detection and the hook-versus-OS mismatch signal;
`consistency-reviewer` pass on all UI text.

### W7 — Protected Session to acceptance review

Owner: `windows-sensor-engineer`. Runs as its own sequence whenever the Windows
writer has no W11 block in progress.

Continue the E-stages and A0–A4 review gates exactly as defined in the
enforcement roadmap documents and `docs/PROTECTED-SESSION-PROTOCOL.md`:
installed-caller authorization, authenticated runtime communication,
cancellation and owner-loss supervision, result review, then the first user goal
(Claude Code through AEGIS edits a test project, passes its tests, does not read
a private canary and sends nothing out), then Codex. Every stage ends with an
evidence record in the existing format. The track stops when all stages have
evidence and the A1–A4 review package is assembled; `launchAllowed` stays
`false` and the owner decides the change. Steps requiring a reboot, Hyper-V host
provisioning or UAC prompts are prepared and handed to the owner with exact
commands.

### W8 — Measurement

Owner: `bench-engineer`. Starts when W1 merges; publishes after W2–W4.

- Effectiveness (roadmap D1): scenario catalogue of ordinary agent tasks and
  unsafe-action tasks (sensitive file reads, writes outside the project,
  deletion, outbound transfer, persistence locations) on fixed agent versions.
  Generate the expected event set from the catalogue and confirm it with an
  independent oracle: Sysmon and Procmon as separate columns on Windows inside
  the Hyper-V gold image; auditd as the Linux oracle; for macOS, `eslogger` when
  available. Report recall per category, false alarms on ordinary tasks, task
  success and latency, per platform and sensor mode, with the commit and versions.
- Overhead: CPU and RSS of AEGIS and each sensor at idle, under a scripted agent
  workload and under a 20,000 events per second burst; three runs each; report
  p50 and p95 with the exact method in `docs/bench/METHOD.md`.
- Coverage matrix: map scenarios to MITRE ATT&CK techniques with executable
  red/green tests, including the scenarios where AEGIS misses, listed as misses.

Acceptance: dated result files in `docs/bench/` generated by scripts in `bench/`;
rerunning a script on the same commit reproduces its table within the stated
variance; `consistency-reviewer` confirms every number quoted in docs.

### W9 — Coverage view

Owner: `ui-designer` with `integration-engineer`. Depends on W1b; extends as each
sensor lands.

Observatory gains a per-platform coverage panel: each sensor with its active
mode, health state, event rate, loss counters and last restart; each action
surface with Observed, Blocking verified or Coverage lost; each agent with which
of its surfaces are covered. Reduced modes and missing entitlements are stated in
plain language with the step that would raise coverage. Follow
`frontend/observatory/AGENTS.md` for the visual authority. Acceptance: states
driven from real health data in tests; screenshots from the browser preview with
simulated data; one recorded run through the real Electron preload bridge in a
built app showing live sensor states; keyboard access and reduced motion as in
existing panels.

### W10 — Packaging and distribution

Owner: `integration-engineer`, with `shipper` once the owner approves a release.

Prepare, and stop before any step that needs credentials:

- Windows: Authenticode signing step in the release build that activates when a
  signing secret exists; winget manifest files under `packaging/winget/` ready
  for submission.
- Linux: AppImage and .deb including the sensor binary and the capabilities
  script, with the sensor mode shown on first run.
- macOS: .dmg build, hardened runtime, notarization step that activates with
  credentials, and the Endpoint Security entitlement file used when granted.
- Release verification docs extended to every artifact.

Workflow changes for these jobs are prepared as a PR and stop for owner approval.
Acceptance per OS: a recorded install, first run with sensor mode shown, update
and uninstall on a clean machine, with artifact hashes.

### W11 — Windows event capture (T1)

Owner: `windows-sensor-engineer`. Depends on W0 question 2. Shares the Windows
writer with W7; when both have work, W11 goes first and W7 waits.

Blocks, each its own PR:

1. First-read attribution after idle: adopt #986's source-bound renewal fix and
   packaged qualification after W0 confirms applicability to the current runtime.
   Preserve #985's historical failure and the uncertainty about its unique cause.
   Schedule another repair or live qualification only for a demonstrated residual
   gap or changed runtime inputs; do not repeat the accepted renewal repair.
2. Recovery: decide with evidence which remaining checks from #974 (restart and
   post-restart capture) are needed for admission, and prepare the owner steps
   for the machine restart.
3. Admission: once blocks 1 and 2 are qualified, connect verified Kernel-File
   reads to FileEvents, audit, baselines, sequences and risk through the W1
   pipeline, with loss markers and an explicit label for unverified reads.
4. Process events: capture process start and stop from ETW process events in
   the same collector design, so processes that live shorter than the polling
   interval are recorded with OS creation time and the existing identity rules;
   polling stays as the declared fallback.

Acceptance: packaged-build qualification records for attribution, loss,
collector stop and recovery; a test where 1,000 processes living under 50 ms are
all recorded in event mode; the coverage view states when Windows runs in event
mode, polling mode or a mix; the documented coverage limits in README and
`docs/CAPABILITIES.md` match the measured behavior.

## 7. Execution order

```
Wave 0  W0 (parallel researchers) -> completion-baseline.md merged
        -> plan deviations recorded before any writer starts
Wave 1  W1-pipe; Q4 identity decisions before W1a wire freeze
        W1a (JS codec + shared Rust files + aegis-wire;
             completion waits for both-language wire acceptance)
        -> W1b after both prerequisites merge (integration-engineer)
        W11 blocks 1-2 (Windows writer)
        W8 measurement method drafted (bench-engineer)
Wave 2  W11 blocks 3-4 | W2 Linux | W3 macOS     (Rust writers per 5.3)
        W4 explanation once an integration slot is free
        W9 panel skeleton once W1b merges
        W7 Protected Session whenever the Windows writer is free
Wave 3  W5 Cedar -> W6 guard mode
        W9 extended with every merged sensor and surface
Wave 4  W8 measurement on merged master, results published
Wave 5  W10 packaging prepared; release only on owner approval
```

The three-writer cap applies across all lines of a wave; the orchestrator picks
which ready block runs next by dependency and by which target it advances.

At the end of each wave, `auditor` runs the full CI gate on master and the
orchestrator records the result. A failing gate is fixed before the next wave
starts writing.

## 8. Global definition of done

A workstream block is done when:

- its PR is merged and `gh pr view` shows it merged;
- all five required contexts passed on the merged head;
- its acceptance criteria hold, with any live or hardware run recorded in a dated
  evidence file naming commit, machine, OS and versions;
- the writer ran a mutation check for each new test group (removed or broke the
  covered code, saw the test fail, restored it) and recorded the result in the
  PR description, and `test-auditor` found the tests meaningful;
- `npm run counts:check` passes and documentation numbers match source;
- the tracker and `memory-bank/progress.md` are updated.

Each target T1–T10 is tracked in three separate states: implemented (code
merged), verified (acceptance evidence recorded on merged master, including live
runs) and owner-pending (prepared work waiting on an owner action). A target
counts as reached only when verified. The plan is done when T1–T10 are verified,
or when every remaining target is owner-pending with prepared next steps.

## 9. Reporting

Report to the owner at each wave transition and when blocked on an owner action.
Lead with the outcome in the first sentence. Then: merged PRs with numbers, what
each changed in one line, measured results with their evidence files, open owner
actions with the exact command or step, and the next wave. Keep it under 30
lines. Commit messages, PR text and docs carry no AI attribution lines.

---

## Appendix A — Rust workspace and `sensor/1`

The detailed JavaScript preparation contract in [sensor-wire.md](sensor-wire.md)
supersedes the schematic shapes below where it adds precision or resolves an
ambiguity. Final wire freeze still requires both language implementations.

### Layout

```
sensors/
  Cargo.toml                 workspace
  rust-toolchain.toml
  README.md                  build, toolchain choice, versions
  aegis-wire/                framing + message types, serde, no platform code
  aegis-sensor-linux/        user-space binary: modes ebpf | fanotify | procfs
  aegis-sensor-linux-ebpf/   eBPF programs (built as aya recommends)
  aegis-sensor-macos/        binary: modes endpoint-security | libproc
  linux/install-capabilities.sh
tests/fixtures/sensor-wire/  golden frames shared with the JS codec
```

Binary names: `aegis-sensor-linux`, `aegis-sensor-macos`. The sensor host finds
them next to the app executable in packaged builds and under
`sensors/target/release/` in source builds.

### Framing

Identical to `proc-snapshot-protocol.js`: `uint32` little-endian payload length,
then that many bytes of UTF-8 JSON object. Maximum payload 8 MiB. 64-bit values
(birth ticks, microseconds, unique IDs, sequence numbers) are decimal strings.

### Messages

Sensor to host:

- `{t:'hello', proto:'sensor/1', platform, mode, modes:[...], caps:{exec, exit,
  fork, fileOpen, tcpConnect, identity, witness}, versions:{sensor, kernel|os},
  pid}` — first frame. `mode` is the active mode and lives only at the top level;
  `modes` lists the modes this binary could run with current privileges. `caps`
  describes the active mode. `identity` names the birth-time source and unit
  (`procfs-ticks`, `bpf-start-boottime-ticks`, `pbi-start-usec`); `witness` names
  the generation witness (`boot-id`, `p-uniqueid`).
- `{t:'mode', mode, caps, reason, seq}` — the active mode changed (for example
  `ebpf` to `procfs` after a program failed to load). `seq` is the first event
  sequence number produced under the new mode; `reason` is a code from a closed
  list. The host updates coverage state from this frame alone.
- `{t:'evs', from, to, events:[...]}` — batch of events with contiguous sequence
  numbers `from..to`. Sequence numbers are per sensor process, start at 1 and
  continue across mode changes.
- `{t:'loss', from, to, count, reason}` — the events numbered `from..to` were not
  delivered; `count` equals `to - from + 1`; `reason` from a closed list
  (`ring-full`, `queue-full`, `verifier-limit`, `read-failed`). A gap in sequence
  numbers without a `loss` frame is a protocol error.
- `{t:'snap', id, procs:[{pid, ppid, name, birth, witness}]}` — answer to a
  snapshot request.
- `{t:'health', state, detail}` — degradation or recovery inside the same mode;
  `detail` is a code.
- `{t:'err', id, code}` — a request could not be answered.

Event objects carry `seq`, `kind` (`exec`, `fork`, `exit`, `open`, `connect`),
`pid`, `ppid`, `birth`, `witness`, `ts` and kind-specific fields: `open` has
`path` and `access`; `connect` has `family`, `daddr`, `dport`, `saddr`, `sport`;
`exec` has `exe` and `argc` (argument text is never sent).

Units: `birth` is in the unit named by `caps.identity` (clock ticks since boot on
Linux, microseconds since the epoch on macOS), as a decimal string. `ts` is the
capture time in microseconds since the Unix epoch as a decimal string; the
sensor derives it from a monotonic clock anchored to wall time once at start,
and reports the anchor in `hello.versions.clockAnchor` so the host can measure
skew.

Host to sensor:

- `{t:'watch', id, roots:[{pid, birth, witness}], descendants:true}` — replace the set of
  watched roots. A root whose birth does not match is ignored and reported in
  `err`.
- `{t:'paths', id, prefixes:[...]}` — replace sensitive path prefixes.
- `{t:'snap', id}` — request a full process snapshot.
- `{t:'stop', id}` — orderly shutdown.

### Identity conversion

Linux: `/proc/<pid>/stat` field 22 is the process start in clock ticks since
boot. The eBPF sensor reads `task->start_boottime` (nanoseconds since boot) and
emits `birth = floor(start_boottime * CLK_TCK / 1e9)` as an integer tick count, the
same quantity procfs reports. The host converts ticks to epoch milliseconds with
the existing D1 code; the sensor never computes epoch time.

macOS: `birth` is `pbi_start_tvsec * 1e6 + pbi_start_tvusec` in microseconds.
The host computes `startTime(ms)` by integer division by 1000. The witness is
`p_uniqueid` with the boot session identifier.

## Appendix B — Brief and return format

Brief (orchestrator to worker), plain text:

```
WORKSTREAM: W1a shared wire contract: Cargo workspace and aegis-wire crate
GOAL: <one sentence: the outcome when this block is done>
BASELINE: <rows from docs/roadmap/completion-baseline.md that apply>
OWNED PATHS: <paths this worker may change>
READ-ONLY CONTEXT: <files and docs to read for the task>
CONTRACT: <section of the plan or doc the work must satisfy>
ACCEPTANCE: <the criteria from the plan that this block must meet>
WORKTREE: X:/tmp/aegis-wt/<name>, branch <name> from origin/master
GIT: full cycle authorized per AGENTS.md; open the PR; do not merge, the
orchestrator serializes merges
RETURN: use the return format
```

Return (worker to orchestrator), at most 25 lines:

```
OUTCOME: <one sentence: done, partly done or blocked, and what now works>
PR: <url and number>, head <sha>
CHANGED: <files or modules, one line each>
CHECKS: <commands run and their pass/fail result>
EVIDENCE: <dated evidence files, if any>
GAPS: <what remains, what was not verified, needed changes in paths owned by others>
OWNER ACTIONS: <exact steps only the owner can do, if any>
```

## Appendix C — Tracker schema

`X:/AEGIS_COMPLETION_PROGRESS.json`:

```json
{
  "plan": "docs/roadmap/completion-plan.md",
  "baselineCommit": "bf65076",
  "targets": {
    "T1": { "implemented": false, "verified": false, "ownerPending": [], "evidence": [] }
  },
  "updatedAt": "ISO-8601",
  "wave": 0,
  "workstreams": {
    "W2": {
      "status": "not-started | running | in-review | merged | blocked | done",
      "owner": "rust-sensor-engineer",
      "worktree": "X:/tmp/aegis-wt/w2-linux",
      "blocks": [
        { "name": "workspace and aegis-wire", "pr": 0, "mergedAt": null, "evidence": [] }
      ],
      "blockedOn": null,
      "notes": ""
    }
  },
  "ownerActions": [
    { "id": "OA1", "workstream": "W2", "action": "run sensors/linux/install-capabilities.sh", "status": "open" }
  ],
  "planDeviations": [
    { "date": "ISO-8601", "section": "7", "change": "", "reason": "", "source": "" }
  ]
}
```
