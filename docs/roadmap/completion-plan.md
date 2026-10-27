# AEGIS completion plan — October 2026

Scope approved by the repository owner on 2026-10-19 for execution by a Codex
orchestrator running GPT-6.1 Sol with subagents. Historical baseline: master `bf65076`
(2026-10-19, after #976 and #985), package `0.19.2-beta`. PR #974 was later
superseded by #1007. The owner's main checkout may sit on an older commit with
uncommitted changes; leave
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

Revision 3 (2026-10-25) preserves T1–T10 and their acceptance requirements while
removing unnecessary execution barriers. Section 7 prioritizes complete paths
from a real caller to a visible result, reuses matching verification evidence,
and separates the next Windows milestone from later expansion lanes. The dated
checkpoints above retain their historical scope; read current source and receipts
before scheduling work. This revision grants no cloud dispatch, rerun, release
or host/profile intervention; the current cloud-run allowance is exhausted.

Revision 4 (2026-10-26) implements the owner's delivery-process correction:
no mutation campaigns, no duplicate full verification, and completion of existing
user-visible slices before additional preparation. Section 7 names the next
closure milestones. Required PR checks and actual native acceptance remain in
force. Dated execution allowances above are historical; the active request and
the exact run's authorization receipt determine whether a new run is allowed.

Revision 5 (2026-10-26) resolves policy drift in preserved checkouts and makes
the [delivery loop](../development/workflow.md#delivery-loop) the common execution
procedure. Reuse existing baseline evidence, keep the selected model and perform
implementation directly when delegation was not requested. This is a workflow
correction; it does not promote any product acceptance row.

Revision 6 (2026-10-26) applies the owner's paper/video review to the existing
workstreams. Section 2.1 distinguishes useful security controls from infrastructure
outside AEGIS's scope. W4 incorporates the live Claude path merged in #1088;
W6/W9 require a visible decision and response outcome; W8 adds ordinary-work and
bounded decoy comparisons. This is a plan revision, with no new acceptance,
production honeypot activation, profile change or native-run authorization.

Revision 7 (2026-10-27) responds to the owner's HOL Guard comparison and delivery
review. The [source and CI findings](guard-delivery-review-20261027.md) identify
portable Guard packaging, everyday policy behavior and installed-route checks
as the immediate product gaps. Section 7 now puts a usable Windows Claude Guard
journey first for new work, with W11/W4 continuing on their own evidence-bound
lanes. It reuses the genuine source and packaged-Claude results in #1115 and
does not promote those bounded results to full Guard acceptance. T1–T10 and
their security/acceptance requirements remain unchanged. This revision changes
planning documents only; protected workflow edits, paid-provider/cloud-VM runs and
release actions retain their existing authorization boundaries.

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
| T4 | Alert explanation: each file, network and process alert links to the agent tool call that preceded it, when local session data allows | Limited evidence about preceding actions |
| T5 | Cedar as the action-policy language for allow/ask/deny, equivalent to policy schema 3 on every existing case | Separate JSON policy families |
| T6 | Guard mode: one-step installation of native pre-execution hooks for supported agents, with "Blocking verified" shown only after qualification | No pre-execution blocking by default |
| T7 | Protected Session reaches its acceptance review with every stage evidenced; enabling launch stays a human decision | Sandbox launch is disabled |
| T8 | Published measurements: per-platform recall against an independent oracle, false-alarm rate on ordinary work, CPU/RAM overhead with a written method | Current per-platform acceptance measurements missing |
| T9 | Observatory shows per-platform, per-sensor coverage: Observed, Blocking verified, Coverage lost, and the active sensor mode | Coverage state is partly hidden |
| T10 | Installable artifacts for Windows, Linux and macOS with verification instructions; signing steps prepared for the owner | Install friction |

### 2.1 Applying the honeypot paper and enterprise diagram

Review baseline: merged master `cd71cb2971167909f6d84392d7f35d585af608cf`
(#1088), including the current delivery policy. The research input is Wehner and
Kraprayoon, [Honeypots for AI Agent Insider Threats, v1](https://arxiv.org/abs/2610.26664v1)
(2026-10-19). The owner-supplied 7.87-second silent clip shows one animated diagram,
"Components of a Secure AI System in an Enterprise", with an aidigital.co.uk
watermark. It supplies an architecture checklist; it contains no demonstrated
implementation or effectiveness measurements.

The diagram's ten components map to AEGIS as follows. These are source-backed
boundaries and planned applications, not claims that every component is delivered.

| Diagram component | Existing boundary and application to this plan |
| --- | --- |
| 1. AI Gateway | [Explicit MCP gateways](../MCP-STDIO-GATEWAY.md) already mediate selected tool routes. The [bounded model broker](enforcement-e5/model-broker.md) remains a private developer factory. Qualify one real selected route under W6/W7; neither component mediates all agent traffic. |
| 2. Model Registry | Record provider, agent/model version when available, route, policy version and qualification receipt for W6/W8/W9. Agent recognition is not approval or a security scan of a model. A hosted model registry is outside this plan. |
| 3. Input/output guardrails | Reuse strict schemas and the optional [known-secret filter](../MCP-KNOWN-SECRETS.md). Test malicious tool metadata and results at an actual guarded boundary. Finite known-value checks do not establish general DLP or prompt-injection immunity; filtering a result cannot undo a tool's completed side effect. |
| 4. AI application layer | External agents remain the callers. W4 explains observed actions using local evidence; AEGIS does not add an agent runtime, RAG service or copilot. |
| 5. Identity and policy | Preserve OS instance/generation evidence and deterministic route-specific allow/ask/deny. W5/W6 must bind the selected operation and resource to the decision. Enterprise SSO/RBAC is outside the desktop scope. |
| 6. Secure data layer | Enforce bounded reads, metadata-only explanations and explicit disclosure at AEGIS boundaries. W7 qualifies its owned workspace. Database row permissions and permission-aware RAG retrieval remain the connected service's responsibility. |
| 7. Tool access and human approval | Reuse [exact one-attempt grants](../MCP-DURABLE-GRANTS.md), route binding and provider hooks. Complete one owner-visible preview/decision/result path; qualify replay, substitution, expiry and bypass behavior on that selected route. Existing grant profiles have different guarantees and must be named. |
| 8. Private model serving and secrets vault | Keep local processing and explicit external-analysis consent. Existing encrypted settings and bounded brokers do not constitute an enterprise vault, private inference platform or a provider "no training" guarantee. No new hosting/vault service is required for this milestone. |
| 9. Evals and monitoring | W8 measures independent ground truth, misses, ordinary-task false alarms, task completion and latency. W9 shows current losses and route coverage. More alerts or fewer alerts alone do not establish better protection. |
| 10. Audit, security view and response | Reuse the durable event pipeline and Observatory. Connect evidence, the owner's scoped response and its observed result. Hash-chained local JSONL supplies an integrity check with limits; it does not establish immutable, complete or independently authenticated evidence. A SIEM integration is deferred until a concrete consumer requires it. |

The paper's most useful immediate contribution is its distinction between
detecting an action, establishing a policy violation and inferring malicious
intent (PDF pp. 20–30, 34–40). A file read needed for an ordinary task is weak
evidence; independently observed use of a decoy credential against a resource
outside the authorized task is a stronger violation signal. Neither one proves
an agent's internal motive. Report measured detection separately from
incrimination and deterrence hypotheses; published results for other deployments
are not AEGIS measurements.

Source checks at the review baseline establish the remaining integration work:

- [Live tool context](../../src/main/live-tool-context.js) now has an application
  caller for native local Claude main sessions. Its registry hint and assumed
  same-host clock permit inferred association only. The previous description of
  all W4 readers as disconnected is obsolete. W4.3/W4.4 and other sources remain
  open; the separate [AI analysis](../../src/main/ai-analysis.js) still groups by
  agent display name and must not be presented as an instance-specific verdict.
- [Windows ETW read views](../../src/main/platform/etw-file-attribution.js) remain
  diagnostic observations outside FileEvent sinks. The [Linux/macOS runtime](../../src/main/platform/sensor-runtime.js)
  refuses native event custody. Native read-to-audit/risk acceptance remains a
  prerequisite for claims about those paths.
- [Audit verification](../../src/main/audit-hashchain.js) cannot detect removal
  of a valid trailing suffix. Without an independently protected anchor, a writer
  able to replace the file can also recompute its public hash chain. Local checks
  do not establish resistance to a compromised same-account monitor or host.
- Existing ordinary process controls address one freshly verified process.
  They do not establish automatic incident containment of every descendant,
  shared service or remote task. W7's owned launch boundary remains separate.

Apply the paper's supporting requirements now: trustworthy instance attribution,
visible incompleteness, prompt response with a recorded outcome, and independent
ordinary-work evaluation. Section 6's W8 decoy comparison is a later bounded lab
experiment. Production honeypots require a separately scoped design and owner
deployment decision; the Honey Workspace exclusion remains in force.

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
  Disposable decoys in W8 evaluation fixtures do not create a production Honey
  Workspace or authorize planting traps in the owner's files or credentials.
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

When delegation is requested, the root session coordinates requirements,
ordering, briefs, merge serialization, the tracker and the final report. It may
implement unowned work while workers proceed. Without delegation, the current
session implements and reviews the authorized task directly. A role catalog is
not an instruction to create agents or wait for another worker.

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
| `test-auditor` | existing | inherits | no | Read-only judgment of regression assertions, independent expected results and recorded checks |
| `consistency-reviewer` | existing | inherits | no | Docs-versus-code check before any user-facing text merges |
| `auditor` | existing | inherits | no | Check matching CI evidence at wave transitions; execute only missing or invalidated checks |
| `shipper` | existing | inherits | yes | Release preparation once the owner approves a release |

Keep the user's selected model and effort. The role table describes configured
roles when those roles are explicitly delegated; it does not authorize switching
the root model or starting an external CLI. Identity conversion in W2/W3, the W1a
wire contract and W5 Cedar equivalence retain their independent-review requirement.

### 5.2 Delegation

- Only when the owner requests delegation, spawn read-only agents in parallel when independent questions are
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
- If a delegated role cannot use the authorized model or effort, report that
  limitation and continue independent work. Starting an external AI CLI requires
  the owner's request; tool availability alone does not authorize that fallback.

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

When delegation is authorized, assign the relevant reviewers below. Otherwise
perform the scoped review in the current session; the independent-review
requirement for the critical contracts below remains separate.

Before merging, each PR gets:

- `security-reviewer` when it touches IPC, policy, secrets, privileges,
  sidecars, network egress or installers;
- `test-auditor` when delegation is authorized and it adds tests for sensors,
  identity, policy or correlation; it reads assertions and recorded behavioral
  evidence and runs nothing;
- `consistency-reviewer` when it changes README, docs or UI text that makes a
  factual claim.

Findings of real defects are fixed in the same PR. Style-only remarks are noted
in the PR and do not block.

PRs that change identity, the wire contract, policy evaluation or the Protected
Session carry the label `needs-independent-review`. Record an independent review
of the final relevant changes before merging. When that review and required CI
have passed, the already authorized Git cycle proceeds without a second routine
owner-confirmation checkpoint. Missing independent review remains an explicit
gap; continue independent work while resolving it. Releases, protected files,
privilege/profile changes and other actions listed in AGENTS.md retain their
actual authorization boundaries.

For multiple writers contributing to one user-visible milestone, prefer one
coherent integration PR. Collect frozen commits and focused evidence, review
each owned delta, and run final required CI on the combined current revision.
Do not merge every dormant helper separately when that creates repeated strict
branch updates without an independently usable result. Independently useful
deliverables still use separate PRs. Coordinate the merge order across active
chats so a cosmetic sibling change does not invalidate a nearly finished
integration run. This does not relax strict checks or permit merging an old head.

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

Keep completed preparation, delivered implementation and verified acceptance
separate. The visual roadmap counts completed substeps; adding another helper
inside a partial substep does not increase that percentage. Record each delivery
under its existing substep with the remaining closure condition. Never add
artificial substeps or mark acceptance complete to make the percentage move.
Reports name the nearest unfinished substep and what observable result closes it.

## 6. Workstreams

Each workstream lists what to confirm in source first, the scope, the design,
deliverables, acceptance and owner. Acceptance criteria are the definition of
done for that workstream; section 8 adds the global gate.

### W0 — Baseline confirmation (read-only)

Purpose: replace assumptions in this plan with facts from current master.

Use the existing baseline first and refresh only rows affected by new evidence.
When delegation is requested, independent missing rows may be assigned to one
`researcher` per question, each returning at most 40 lines. Otherwise inspect
the needed rows directly; starting another workstream does not repeat W0:

1. Bounded pipeline: does `src/main/ipc-batcher.js` and the file-access batching
   path have capacity, high-water and loss counters, spill-to-disk for security
   events, and coalescing of benign self-churn? What is missing for event rates
   of 2,000 events per second sustained and 20,000 per second in bursts?
2. Windows ETW: list the open items in `docs/roadmap/etw-sensor-design.md`,
    `docs/roadmap/etw-durable-recovery.md`, then-open PR #974 (superseded by #1007)
    and merged PRs #976 and
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
- Keep observation, association and policy judgment separate. Tool history is
  untrusted evidence and cannot authorize an action. If the optional AI analysis
  appears in an incident detail, scope it to that `instanceId` and observation
  window first, or clearly retain it as an aggregate provider summary. A case with
  two same-name agent instances must never borrow the other instance's events,
  process identity or connections for an instance-specific explanation.

Acceptance: fixture transcripts for each agent plus synthetic OS events cover
match, no match, ambiguous match, clock skew and truncated session; a recorded
live Windows run reuses the #975 harness (installed Claude Code reading a
synthetic `.env`) and shows the read linked to the tool call that issued it; a
test asserts that no prompt or argument text reaches audit, IPC or exports.

The [live local explanation path](../development/live-tool-explanations.md)
connects native local Claude main-session metadata to the selected observation
through owned IPC. Read-history and active growing-source journeys retain a
synthetic OS observation; they do not qualify the native file-read sensor. The
real FileWatcher Write journey in #1106 instead checks the actual event, output
bytes, persisted audit and Details through the original event UUID. The external
project scenario recorded at `1a235a14` for #1108 additionally passed its retained
stages for two same-name Claude instances and restart/resume of the old event UUID.
Reuse those scoped receipts rather than queueing the same paid cases again.
Independently confirmed native Windows process-to-session binding does not
confirm the OS write issuer: path attribution and tool association remain inferred
under the same-host clock assumption. Remaining W4 work includes measured clock
alignment, genuine native file-read acceptance and other providers with named
consumers and missing ownership evidence. Packaged runtime and native owner-consent
acceptance remain open; these cases do not complete T4 or all W4 substeps.

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

Owner: `integration-engineer` with `ui-designer`. Installation and qualification
may use existing supported policy evaluators independently of W5. A Cedar-backed
route depends on the applicable W5 translation, equivalence and runtime evidence.

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
- For the selected covered route, connect the owner's exact operation preview to
  the policy decision, dispatch and visible result. Bind authorization to the
  actual instance/session, operation, target, route and lifetime using the route's
  existing contract; ambiguous ownership cannot become an implicit allow. A
  changed request requires a new decision. Exercise cancellation, timeout,
  replay, changed arguments/route and policy unavailability. A post-execution
  confirmation or filtered tool response is not evidence of prevention.
- When a selected MCP route supplies the tool boundary, reuse its existing
  gateway/grant profile rather than add a parallel proxy. Prove denial with an
  independent receiver or filesystem outcome, and prove the allowed operation
  still completes. Qualify one provider/version/surface first. Other launches,
  direct network paths and shared services retain their stated coverage limits.

Acceptance: qualification scripts and records per agent and version; tests for
install, removal, tamper detection and the hook-versus-OS mismatch signal;
`consistency-reviewer` pass on all UI text.

#### Guard priorities informed by rv (2026-10-27)

The [rv README](https://github.com/christopherkarani/rv) describes a pre-tool
policy gate, categorized rules, decision explanations, one-time overrides and
an observation mode. These are ideas for the existing W6/W8/W9 work, not
evidence that either product covers every agent action. rv's dated
[runtime acceptance audit](https://github.com/christopherkarani/rv/blob/main/docs/security/runtime-acceptance.md)
also records unresolved isolation and integration gaps for its tested revision.
No rv code, policy packs or runtime is adopted by this plan.

Apply the following priorities within the revised section 7 queue. The first
usable Guard journey is now the priority for new work. Existing W11/W4 ownership
continues independently, and claims depending on their sensors or attribution
still require their acceptance evidence.

1. **Finish one usable Guard route (W6.3/W6.4 and W9).** Reuse the
   [separate Claude hook profile](../CLAUDE-HOOK-APP.md): the app can review,
   install and remove its own profile with prepared Windows assets, but only an
   explicitly selected `--settings` launch uses it. Configuration presence is
   not proof that the provider invoked the hook or enforced a decision. Complete
   the owner-visible install, launch guidance, decision and outcome path for one
   named Claude version and Bash surface. Retain exact preview, backup, readback
   and removal behavior; exercise an allowed action, a denied action with an
   independent effect oracle, cancellation, unavailable hooks and bypasses.
   Show the tested version, route and evidence; never infer blocking for other
   tools, providers or launches.
2. **Explain decisions and bind owner approval (W6 and W6.1/W6.2).** On the
   selected route show the action and target, policy/rule identifier and reason,
   decision and observed outcome, with unknown and unobserved outcomes explicit.
   Keep secrets and raw payloads out of persistent audit/export unless their
   existing contracts permit them. Reuse the applicable one-attempt MCP grant
   profile and its actual route, argument and expiry bindings; complete the
   owner-facing preview and changed-argument/target checks already specified in
   W6.1. Provider-delegated `ask` is not an AEGIS approval. A new approval must
   not authorize a changed request; qualify expiry, replay and substitution.
3. **Make coverage and loss actionable (W9).** Extend the existing
   [configuration and selected-owner observation](../ACTION-COVERAGE-UI.md)
   with installed provider/version and tool-surface evidence as it becomes
   available. Distinguish configured, observed, blocking verified, coverage
   lost and unknown; identify the route and reason. Hook disappearance, failed
   decisions and evidence of an outside-route action must not imply that all
   bypasses are detectable. Verify transitions without converting configuration
   checks or self-reported client metadata into proof of enforcement.
4. **Include a small, measured rule set in the first usable route (W6/W8).**
   Scope initial Windows developer cases to destructive Git operations, file
   deletion and selected secret paths. The current Claude Bash hook matches
   complete exact input; it is not a general shell parser. Design any broader
   evaluator and route-specific defaults explicitly, with safe examples and
   bypass/unsupported syntax cases. Compare blocked and ordinary work against an
   independent oracle, including false allows, false blocks, task completion and
   latency, before expanding categories. Exact-input demonstrations remain useful
   boundary evidence; the first usable milestone also needs ordinary tasks that
   do not require hand-authoring each complete tool request. Static npm
   lifecycle-script analysis
   already exists; evaluating scripts before execution is a separate later
   capability, with explicit bounds and unknown results, not a current claim.
5. **Evaluate a nonblocking policy trial after that route is qualified (W6/W8).**
   Show would-allow/would-deny results for supported actions with a prominent
   nonblocking label and no claim of protection. Keep data bounded and private;
   distinguish missed inputs and unknown decisions. Compare the trial against
   an independently labelled workload before using its results to tune rules.
   Historical-session replay is optional and requires a named consumer and a
   trustworthy, privacy-preserving input contract.

Secret brokers, network egress enforcement and an on-device model judge are
deferred until a selected route and concrete user need justify their additional
trust boundaries. Existing known-secret checks apply only to configured MCP
routes and supplied values; they are not general DLP. Policy decisions remain
deterministic under section 3's invariant. A model may explain evidence but must
not silently override policy or turn an unknown enforcement result into a pass.
None of these plan additions authorizes a native VM run or changes acceptance.

#### Phased provider coverage for shared Guard policies (2026-10-27)

Extend the existing W6/W9 path in the sequence below after its first Claude
closure, without changing the section 7 order. A single AEGIS policy contract
and evaluator should serve each supported adapter; provider-specific adapters
translate only documented hook inputs and decisions. Reuse an existing evaluator
where its policy and action contracts apply. Cedar remains contingent on W5
equivalence and route-specific runtime evidence. This is a phased implementation
plan, not a claim of universal interception or current provider acceptance.

1. **Claude Code on Windows:** finish the first named version and Bash route as
   described above, including owner-visible setup, independent allow/deny effect
   checks and clear coverage limits. Use this route to establish the shared
   policy contract and end-to-end evidence needed by later adapters.
2. **Codex:** connect one supported pre-execution tool surface to that contract
   after checking the installed version's actual hook schema, decision semantics,
   setup and failure behavior. The existing
   [finite Codex adapter replay](enforcement-e8/provider-replay.md) is
   developer-only and does not establish native enforcement or interactive
   approval. Qualify a real allowed action and a denied action with independent
   effect evidence. If the hook cannot honor `ask`, explicitly refuse or use a
   separately qualified owner-approval route; never translate it into an allow.
3. **Gemini CLI:** connect and qualify a named version's supported shell surface
   against the same applicable policy contract. Reuse the existing
   [exact-deny BeforeTool adapter](../ACTION-GEMINI-BEFORETOOL.md) as a starting
   point; its manual, exact-match behavior and unmatched response do not prove
   general shell enforcement. Verify permitted and denied effects and the host's
   actual handling of errors and timeouts before claiming protection.
4. **Other agents and surfaces:** add Cursor and other requested agents one at a
   time when their supported pre-execution boundary and a concrete user-visible
   route are available. Record unsupported or unavailable hooks explicitly;
   selected MCP routes may use their existing gateway and grants when the client
   actually traverses them. A proxy, installed hook or agent signature alone
   does not cover direct calls, other tools or unobserved launches.

For every stage, record agent and version, platform, tool/action scope, selected
policy and settings, adapter mapping and installation/removal evidence. Show the
operation, rule reason, decision and observed or unknown outcome in the existing
Guard/coverage UI. Policy changes or input/target changes require a fresh
decision under the applicable grant contract. Preserve unrelated provider
settings and require the existing owner confirmation for profile changes.

Each adapter must preserve the policy's deny and supported approval semantics;
unknown, malformed or unsupported input and unavailable decisions cannot become
an implicit AEGIS allow. This local rule is not a claim that a host fails closed:
test missing, unstartable, timed-out and tampered hooks, malformed responses and
bypasses on the actual provider, and report when the host can still execute.
An installed-agent receipt must independently prove both denied-no-effect and
allowed-effect cases, and include ordinary tasks and false blocks. Fixture replay
is preliminary evidence only. Mark `Blocking verified` solely for the qualified
version, platform, route and action surface; otherwise show the actual observed,
unknown or lost state. W8 records false allows, false blocks and task impact
against an independent oracle for each qualified surface.

#### W6.1 — MCP approval target identity and argument changes

Pending follow-up added on 2026-10-27 from QuanTradin's r/mcp feedback on
"One MCP tool, two target paths": show the resolved target and highlight changed
arguments relative to the last approved call. This extends W6's existing MCP
route; implementation and qualification remain open.

At the post's beta revision `274d65711ac858c9d309c73f1f7c9c4e52872ed1`,
the gateway matches the tool name and JSON argument values directly. It does
not resolve filesystem paths inside tool arguments. Exact argument matching
alone does not establish the identity of the file reached by a path.

- For explicitly supported file tools, define which arguments represent paths
  and resolve them in the executing tool server's filesystem context, including
  its working directory, platform and remote/container namespace when applicable.
  Show both the submitted path and the resolved absolute target, accounting for
  `..`, symlinks and Windows junctions. Do not infer path semantics from arbitrary
  strings or present a gateway-local resolution as the server's target. Unknown
  or unavailable resolution is explicit; routes requiring verified targets deny
  when that evidence is unavailable. For a new file, specify how the existing
  parent and intended leaf are bound before claiming target verification.
- Keep the exact original tool/argument binding and one-use semantics. Bind the
  reviewed target identity and execution context to that same approval; define
  its serialization and any digest inputs explicitly. A changed request, target
  or context invalidates the approval. Do not silently normalize changed
  arguments into an existing approval or rewrite the forwarded payload.
- In the approval preview, highlight added, removed and changed argument fields
  against the last owner-approved call for the same tool, catalog/schema and
  selected route/session. Include path and content changes; keep the full current
  payload available for review with applicable secret masking. Identify the
  comparison baseline, show when none exists, and require fresh approval even
  for an unchanged diff. Keep raw content and comparison history out of audit,
  telemetry and exports unless the existing explicit data contract permits them.
- For each argument field, including nested fields, present bounded provenance:
  direct user instruction, user-supplied material, retrieved file/page, tool result,
  agent-derived value, mixed sources or unknown. Include protected source
  references and the recorded transformations (copied, extracted, computed or
  combined). Scope collection to the supported route and state missing or
  truncated lineage explicitly; do not invent origins when instrumentation lacks
  evidence. Keep raw prompts, documents, credentials and source contents out of
  audit, telemetry and exports under the existing data-handling rules.
- Distinguish system-recorded provenance from agent-asserted provenance and
  unavailable evidence. Record the collecting component and its trust boundary;
  an agent's source label cannot promote itself to verified evidence. A recorded
  origin establishes where data was obtained within that boundary, not that its
  contents are true or authorized. Material supplied by the user can contain
  quoted or embedded untrusted instructions; its origin does not grant authority
  to those instructions or authorize the resulting operation.
- Bind the reviewed provenance snapshot to the same approved operation, argument
  fields and route/context as W6.2's grant. Changed provenance or bindings require
  renewed review; provenance must not silently rewrite the forwarded arguments.
  Where policy requires verified provenance, missing or merely asserted evidence
  cannot silently satisfy that requirement; mixed-source values retain evidence
  for each contributing source. Enforce authorization from
  trusted policy and explicit operation authority. Instructions inside argument
  values, retrieved material or tool results cannot override that policy in either
  direction. An optional model judgment remains advisory; typed/schema-valid
  output alone does not establish resistance to such instruction influence.
- Revalidate the reviewed target at execution in the tool server. Address the
  approval-to-write race with a supported handle-relative or equivalent operation
  that binds the write to the verified target; another path lookup alone does
  not prove that binding. A changed link, junction or parent must not redirect an
  approved operation. Record unsupported routes and remaining race limits before
  making a prevention claim.

Acceptance: behavioral cases cover scratch versus configuration targets,
different paths reaching the same target through `..`, symlinks and junctions,
relative paths with changed working directories, missing/new targets, unavailable
server resolution, link/parent replacement after approval, changed content and
one-use replay. UI cases cover added/removed/changed fields and the missing
baseline. An independent filesystem outcome proves that a substituted target
is untouched and an approved write still succeeds on each qualified route and
platform. Fixture evidence and native execution evidence remain separately
identified; these criteria do not authorize a new VM run or mutation campaign.

Argument-provenance acceptance uses independent expected decisions from the
trusted policy and authorized operation. Cover nested and mixed-source arguments,
agent transformations, missing/truncated lineage, forged source labels, and
provenance substitution after review. Pair benign controls with untrusted data
containing irrelevant instructions such as "choose allow" and "choose block";
include user-supplied documents, retrieved text and tool results. An operation
that should be denied must remain denied, and an operation that should be allowed
must remain allowed. Cover a classifier-only boundary with typed output and no
tools when an advisory classifier is evaluated; do not treat tool isolation or a
valid output schema as a passing security oracle. Retain legitimate content-policy
denials in the expected outcomes. Verify the selected application route exposes
source/evidence distinctions and unavailable provenance without disclosing raw
private source contents. Implementation and provider qualification remain open.

#### W6.2 — Executor evidence, uncertain outcomes and state-bound approval

Pending follow-up added on 2026-10-27 from dylan_skydive's r/LLMDevs
feedback on "What should an approval bind to when an LLM agent calls a tool?"
The owner supplied the comment in chat. Extend the selected W6 MCP route and
coordinate target identity with W6.1; implementation and qualification remain open.

At the post's beta revision `274d65711ac858c9d309c73f1f7c9c4e52872ed1`,
the gateway consumes the grant before forwarding and does not restore it after
failure or cancellation. Time-bounded profiles check validity before dispatch.
Gateway consumption, dispatch and response events do not independently establish
the executor's actual parameters or side effects. Grant-store and catalog
rechecks do not establish freshness of the target's business state.

- On a supported executor, record the parameters actually used at execution,
  resolved target/context, approved state version, operation/grant correlation
  and outcome. Compare that record with the approval and gateway dispatch;
  surface mismatches, missing records and partial effects explicitly. Preserve
  existing secret masking and bounded storage contracts; use defined metadata
  or digests where raw values cannot be retained. State the executor's trust
  boundary: its own report alone does not establish an independently verified
  effect or protection against a compromised executor.
- Keep a consumed grant spent after timeout, cancellation or partial failure.
  Do not automatically retry the side effect or renew the grant. A retry needs
  fresh approval, and an unanswered dispatched call has an unknown outcome until
  reconciled. Where supported, use an executor-side idempotency key scoped to
  the intended operation and payload, with a defined retention window and
  duplicate-result contract. Fresh approval alone does not prevent duplicate
  effects; expose unsupported reconciliation/idempotency explicitly to the owner.
- Keep `operationId` and `grantId` separate. `operationId` identifies one intended
  operation and remains stable across retries of that operation. Each fresh
  approval issues a new single-use `grantId`, bound to that operation and the
  approved caller, target, route, payload and state precondition. Retrying never
  restores or reuses a consumed grant. A deliberately new operation gets a new
  `operationId`, even when its arguments equal an earlier operation's arguments.
  Existing per-attempt gateway evidence IDs remain separately identifiable during
  migration; they must not be mistaken for the stable operation identity.
- Use the stable operation identity as the executor's idempotency key within a
  defined caller/tenant and target scope. Bind its durable entry to the approved
  payload and precondition; reject key reuse with different bindings. Coordinate
  deduplication, the side effect and outcome recording atomically where supported,
  including concurrent requests and executor restart. An already completed
  operation returns its recorded result without another side effect; in-flight,
  partial or unknown outcomes require an explicit reconciliation outcome before
  another effect is permitted. Define retention/expiry behavior: an expired or
  missing deduplication record alone cannot establish that a previous attempt
  never executed. An identifier or gateway-only log does not by itself establish
  exactly-once execution; unsupported tools retain an explicit limitation.
- Retain deduplication protection for the entire enforced retry horizon plus
  the route's clock-skew bound, independently of the shorter approval lifetime.
  Define that horizon from a trusted operation time through the latest permitted
  retry arrival, including bounded queuing/delivery delays; fresh approvals do
  not reset the operation's age. The executor rejects requests beyond that
  horizon even after their deduplication entries expire. Missing or expired
  entries cannot silently turn a late retry into a new operation. Preserve the
  required protection across restart and retain explicit unknown outcomes for
  reconciliation. Bound storage; exhausted capacity refuses new mutating
  admission rather than evicting still-required deduplication protection.
- Define a short, route-appropriate approval validity window and recheck expiry
  at the executor before applying the action. Bind approval to the reviewed
  target's version, ETag or equivalent state precondition. Check that precondition
  atomically with the write through a supported transaction or conditional
  operation; a separate preflight read leaves a race. Changed state requires
  review and fresh approval. Routes without this support must state the limit
  and cannot claim state-bound execution.
- If the applicable policy requires live-state verification or an atomic state
  precondition and that requirement cannot be satisfied, deny the operation
  before its side effect. Missing versions, unavailable checks, timeout and
  unsupported conditional writes cannot silently downgrade to allow or
  approve-with-warning. The executor enforces the required precondition at the
  mutation boundary. A route without that capability can operate only under a
  separately explicit policy that permits its stated limitations. Compensation
  is tool-specific and does not satisfy a mandatory pre-execution state check.
- During a mandatory state-check outage, keep bounded diagnostics available while
  refusing new mutating dispatch on the affected route. Clearly expose the
  unavailable check, blocked mutations and recovery state; avoid an ambiguous
  "observe-only" label suggesting that execution continues. Record only fixed
  reason/status codes, safe correlation metadata and bounded loss counters under
  the existing privacy contract; no raw arguments, prompts, documents, secret
  values or credential-bearing source references enter diagnostics. Already
  dispatched operations retain their actual or unknown outcomes; refusal of new
  work does not establish rollback of earlier effects.
- Recovery does not automatically replay refused, queued or outcome-unknown
  operations, renew approvals or restore consumed grants. An explicit new attempt
  follows the existing fresh-approval, stable-operation deduplication and atomic
  state-precondition checks. Restoring the check alone cannot authorize an effect.

Acceptance: use independent fixture outcomes to cover successful execution with
matching records, differing executed parameters, missing executor evidence,
effect committed followed by a lost response, partial failure, cancellation,
replay after reconnect, expiry between dispatch and execution, and state changes
both before execution and during a concurrent write. Prove that a stale approved
version leaves the target unchanged, a valid version succeeds, and a supported
idempotent retry produces one effect even when the first response is lost.
Also cover fresh `grantId` with stable `operationId` after a lost response,
distinct intentional operations with identical arguments, conflicting key/payload
or precondition reuse, concurrent duplicate calls, executor restart and expired
deduplication evidence. Use independent target outcomes to prove that required
state-check failure or unavailability prevents the effect, and that unsupported
conditional execution is refused under a policy requiring it. A completed retry
must return the recorded outcome without creating a second effect.
Add independent target-outcome cases with approval expiry before the retry
horizon, skew-boundary and delayed retries, restart during the retention window,
post-horizon requests after deduplication cleanup, and full storage while live
entries remain protected. Simulate a state-check outage and recovery: mutations
remain unexecuted, diagnostics remain bounded and secret-free, and recovery
alone causes no dispatch, approval renewal or replay. Include an already
dispatched call whose response is lost during the outage; its outcome must remain
unknown until reconciled, without a second effect from automatic recovery.
Preserve existing grant-profile distinctions and W6.1 target binding. Keep
fixture evidence separate from qualification of a real provider/server/version;
this planning change grants no native run or product acceptance.

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

Owner: `bench-engineer`. Preparation starts from the available W1 contracts.
Measure and publish each qualified platform/mode independently; missing Linux,
macOS or explanation work does not block a scoped Windows result. Report missing
rows explicitly and retain the full per-platform acceptance target.

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
- For W6.1's untrusted-instruction cases, report false allows against the
  independently expected deny cases and false blocks against expected allow
  cases, with separate denominators, paired benign-control results and task
  completion. Report `ask`, unavailable/invalid judgments and missing provenance
  separately rather than excluding them from the sample. Record route/policy,
  provenance collector, model/version and sampling parameters when applicable,
  scenario counts and planned repetitions. A few repeated classifier outputs are
  scoped observations; they do not establish a general protection rate. Keep
  advisory-classifier errors separate from actual authorization decisions and
  independently observed execution effects.
- Complete one existing incident path as a measurement case: a real supported
  agent performs an ordinary task and a separate controlled unauthorized action;
  independent evidence establishes the attempted/effected action, AEGIS records
  the observation and attribution, and the owner can inspect a decision or scoped
  response outcome in the application. Record detection and response latency
  separately, including whether the prohibited effect preceded the response.
  Include missing telemetry, two same-name instances, process restart and failed
  response cases. This adds evidence to existing W4/W6/W9 rows, not a new product
  acceptance target or automatic containment claim.
  Missing explanation or prevention stays explicitly unavailable and does not
  block an observation-only baseline; qualify response cases separately when
  their route is ready.

After the first real workload has a qualified observation path and independent
oracle, a bounded decoy comparison may answer whether decoys add detection value
for that workload (paper PDF pp. 41–47, 52–56, 69–72):

- Use an isolated disposable workspace and an inert test-only credential or file;
  any credential-use receiver is owner-controlled and cannot reach real accounts
  or production resources. The mapping from decoy tokens to runs/instances and
  the ground-truth catalogue stay in the trusted harness. No real secret discovery, production
  planting or automatic privilege change is part of the experiment.
- Distinguish discovery/read, attempted credential use and the receiver's observed
  test effect. Include legitimate broad searches and authorized file reads as
  benign controls. Associate a trigger with an instance only when independently
  supported; a shared helper without that evidence stays unattributed. Realistic
  decoy metadata and discoverability are experimental variables, not proof that
  an adaptive agent cannot identify the trap.
- Compare matched tasks with existing monitoring alone, the decoy detector alone
  and both together. Record agent/model versions and parameters when available,
  task success, false alarms per ordinary task, relevant attempts/effects, misses,
  loss/completeness and time to detection. Use prespecified denominators and
  repetitions from the measurement method; count episodes, not repeated alerts.
  Detection conditional on encountering a trap does not estimate overall recall.
- Publish only this scenario's incremental value and limits. Do not claim
  deterrence from reduced trigger counts. If deterrence is later the question,
  it needs a separate comparison of actual trap presence and warning disclosure,
  including attacks that avoid the decoy. A lab result does not establish
  production effectiveness, complete coverage or malicious intent.

Keep this experiment within W8.3/W8.4; it cannot block the first ordinary-work
measurement or advance completion percentages by adding synthetic substeps.

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

Within the existing incident detail, present a short evidence chain: observed
event and instance, preceding tool context with its strength, applicable policy
decision when one exists, owner response and observed outcome. Show unsupported,
failed and unconfirmed response states explicitly. Reuse existing process
controls with fresh generation verification; an ordinary-process action does not
imply descendant or remote-task containment. W7 alone owns its qualified launch
scope. Preserve bounded audit/loss evidence even when explanation is unavailable.
Integrity status must distinguish a checked local chain from completeness and
external authentication; no "immutable" or "tamper-proof" label follows from
hash-chain verification. Test these states with behavioral fixtures, then record
the selected real incident path through the application under W8.

### W10 — Packaging and distribution

Owner: `integration-engineer`, with `shipper` once the owner approves a release.

Prepare a current-candidate integration artifact alongside each platform slice
so its actual host, preload and sensor can be qualified before broad measurement.
Reuse the existing build path. Signing, submission and public distribution remain
later owner-dependent work; a development artifact is not release acceptance.

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
2. Recovery: decide with evidence which remaining restart and post-restart
   capture checks from the recovery track (#974, superseded by #1007) are needed
   for admission, and prepare the owner steps for the machine restart.
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

Revision 7's order is authoritative for new work. The original waves retained
below describe dependencies and history; they do not put every sensor, Cedar or
Protected Session ahead of a usable Guard route. The
[27 October review](guard-delivery-review-20261027.md) records the source and CI
evidence. Keep one active primary delivery milestone. Existing independent task
ownership remains intact; do not take over another chat's changes.

1. **G1 — Usable Windows Claude Guard (W6/W9/W10, measured with W8).** A clean
   installation supplies its Guard dependencies, guides an explicitly selected
   Claude launch, applies a small practical policy, shows a decision and its
   known/unknown result, and supports safe removal. Qualify one agent version,
   shell and action surface with ordinary and forbidden tasks. ETW read admission
   is required for native-read claims, not for the hook's independently checked
   allow/deny outcome. Reuse #1115's bounded evidence; finish the gaps below.
2. **G2 — Extend the same usable contract (W6/W9 and local security review).**
   Qualify one Codex surface, then Gemini, using the shared policy semantics and
   each provider's actual approval/failure behavior. Connect existing artifact
   inventory/snapshot review to a selected launch; add a package-install check
   only at a real supported pre-install boundary. Record unsupported routes.
   This increases practical overlap with HOL; it does not establish equal
   cross-platform effectiveness or coverage of its full advertised catalog.
3. **G3 — Measured differentiation (W4/W8/W9 plus qualified W11 inputs).**
   Connect decisions to the correct agent instance and independently observed
   effects. Compare declared supported tasks and ordinary-work costs against a
   pinned HOL version when that comparison run is authorized. Continue the OS
   lanes and later Cedar/Protected Session slices according to concrete value
   and readiness. All T1–T10 retain their full long-term acceptance targets.

W11 diagnostic admission/recovery and W4 source ownership can continue alongside
G1 under their existing owners and authorizations. Their missing evidence must
remain visible, and cannot be supplied by hook fixtures or a passing CI suite.
Do not start another native/cloud run merely because the priority order changed.

### Next closure milestones

Use this queue to implement G1. A preparation PR can close its own integration
boundary but cannot mark G1 complete. Scope a PR to a coherent observable change;
do not create a separate delivery milestone for every helper or report.

| Priority | Existing substep | Next deliverable and closure evidence |
| --- | --- | --- |
| G1-A — start next | W6.3, W9, W10 | Make ordinary Windows packaging prepare and validate portable hook-review assets. Finish the existing owned-profile setup/removal and supported launch guidance in Observatory. Produce one candidate whose installed path, native assets and packaged hook IO work on a clean supported Windows environment. Preserve exact preview, backups, readback, consent and integrity checks. Scripted confirmation remains distinct from a real owner-dialog journey. |
| G1-B | W6.4, W9, W8 | Add the bounded practical rule set and policy selection needed for ordinary project work, selected secret reads and destructive Git/file actions. Reuse applicable parser/policy components only after checking their runtime limits. Unsupported syntax/programs cannot silently allow. Show policy/rule reason and known/unknown outcome through the existing UI; keep provider ask distinct from AEGIS approval. Preserve schema-1 exact policies and qualify any new semantics. |
| G1-C | W6.4, W8.3–W8.4, W9 | On the resulting installed candidate, exercise the declared ordinary/forbidden cases, missing/unstartable/timed-out hooks, malformed responses, restart/removal and outside-route behavior. Prove denied-no-effect and allowed-effect with independent filesystem/receiver evidence. Record false blocks, misses, approvals, task completion and latency. Label Blocking verified only for the accepted agent/version/platform/surface. Full G1 waits for this record and the real owner journey. |
| CI companion to G1 | Existing required checks and packaging | Implement the review's required Windows package/Guard lane and cheap early validation when workflow edits are authorized. Keep all five context names and strict protection; relevant native failures must reach a required result. Reuse one candidate and keep provider-free checks separate from paid/installed-provider acceptance. |
| Continuing independent lane | W11.2/W11.4 and W4.3–W4.4 | Consume existing Windows diagnostics and #1106/#1108/#1115 receipts within their source and environment scope. Fix demonstrated gaps; retain inferred association, native-read and packaged/native-consent limits. Do not reopen accepted renewal/ownership work without changed inputs or a specific residual defect. |

G1 is complete only when a user can install, select the supported policy/route,
complete the declared ordinary tasks, encounter a real blocked attempted action,
inspect the decision/result and remove the integration. A two-command exact-input
fixture, a green installer build or a policy file alone does not close G1.
The existing [source and packaged-Claude receipts](../CLAUDE-HOOK-APP.md) prove
their recorded marker outcomes and transport behavior. They reduce repeated
work, while portability, everyday policy and broader failure coverage remain open.

### Start the next implementation task

Begin G1-A from current `origin/master` in an isolated worktree after a small
delta check against this review. Read the current asset builder, packaging hook,
profile loader and actual Observatory consumer; preserve unrelated work. Fix the
portable asset/installation path and connect the result to the existing UI.
Run focused regression checks for changed behavior and the smallest package
check that exercises the actual binary. Prepare the related required Windows
CI integration in the same delivery scope when the owner authorizes workflow
edits; preserve branch protection and no-secret PR execution. Complete the Git
cycle under existing authorization. Report the candidate, observed behavior and
precise remaining G1 condition. Do not replace this task with another general
audit, new tracker, architecture rewrite or unrelated sensor work.

An authorization boundary does not stop independent source work. Prepare a
reviewable candidate before requesting a specifically required workflow/cloud-VM/
paid-provider action. Never infer new paid sessions, VM runs, personal-profile
changes, release tags or delegation from this plan. Keep the selected model.
Policy evaluation changes retain the existing independent-review requirement.

W8.1 and W8.2 already represent method and educational harness preparation in
the tracker. Additional oracle adapters, replay validators or synthetic controls
are scheduled only for a named missing input to W8.3's first real workload.
Next measurement names one agent/version, platform/mode, independent oracle,
loss/completeness accounting and the method's planned repetitions. Publish its
bounded results under W8.4. Keep cross-platform completion as the long-term goal.
The enterprise diagram does not introduce a competing platform roadmap. Work on
RAG infrastructure, a hosted registry, SSO, private model hosting, a secrets vault,
SIEM ingestion or production honeypots is deferred unless a concrete authorized
consumer makes it necessary. The selected G1 journey and already-owned Windows/W4
closure work come first; an unrelated blocked lane does not prevent a ready
integration from finishing.

Each new task names the existing substep, final consumer, acceptance observation,
missing dependency and smallest relevant verification. If its deliverable is
another dormant component, identify the concrete integration it unblocks first.
No mutation campaign is part of task completion. No VM is launched for a docs,
skill, offline parser or unrelated UI change. Diagnose the first failed stage
before another expensive run; keep failures and unexecuted stages visible.

The five required checks remain tied to the current PR revision and strict
branch protection. Run focused checks during implementation, then use hosted CI
for final verification. Do not duplicate the full suite locally. After merging,
confirm the merge and observe master CI while starting independent work. A
master failure blocks dependent integration/release, not all useful work.

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
Wave 3  W5 Cedar | W6 on existing policy; Cedar-backed routes after W5
        W9 extended with every merged sensor and surface
Wave 4  W8 source-bound results per qualified platform/mode, independently
Wave 5  W10 distribution prepared; integration artifacts accompany earlier slices
        Release only on owner approval
```

The three-writer cap applies across all lines of a wave; the orchestrator picks
which ready block runs next by dependency and by which target it advances.

At wave transitions, `auditor` reads the existing required CI results for the
matching merged head and inputs. Do not repeat a passing full gate merely for a
checkpoint. Changed heads need fresh mandatory contexts; changed relevant inputs,
failures or a concrete unresolved risk justify additional verification. Preserve
unaffected local evidence within its recorded scope. Exact source matching does
not establish native/runtime qualification. A failing required gate blocks the
dependent merge; independent authorized work can continue.

## 8. Global definition of done

A workstream block is done when:

- its PR is merged and `gh pr view` shows it merged;
- all five required contexts passed on the current PR revision before merge;
  the merge is confirmed and any post-merge failure is investigated before
  dependent integration or release;
- its acceptance criteria hold, with any live or hardware run recorded in a dated
  evidence file naming commit, machine, OS and versions;
- the writer recorded meaningful behavioral regression evidence and independent
  expected results for changed contracts; no mutation campaigns or deliberate
  source breakage are required or run. Review existing evidence without
  repeating it. Reversible low-impact maintenance needs relevant structural
  checks and does not require an artificial test group;
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
