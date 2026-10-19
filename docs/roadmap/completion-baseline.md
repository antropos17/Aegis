# AEGIS completion baseline — 2026-10-19

Runtime baseline: `ae1b8418c4e6b43678ce98f547142e9673a0fdf8` (#986).
The bootstrap changes only planning, agent definitions and project configuration;
its implementation files match this runtime baseline. This report separates
source inspection, existing recorded qualification and checks executed for the
documentation PR. Read-only researchers did not run native scenarios, providers,
tests or installers. Historical records retain their original limits.

## Q1 — Event pipeline

| Finding | Source location | Consequence |
| --- | --- | --- |
| File-access display batching already has a 1,000-entry cap, a 150 ms window, high-water and eviction counters, sensitive-priority retention and bounded benign self-access coalescing. Sensitive-only overflow can still evict sensitive entries. | `src/main/file-access-batching.js:26,32,94,149`; `src/main/ipc-batcher.js:262,416`; `src/main/main.js:628` | Extend these mechanisms in W1; add byte budgets and distinguish delivery eviction from sensor loss. |
| Watch-worker ingress has 512 pending events / 1 MiB, 32-event batches and one outstanding acknowledgement; overflow is counted. Display sends can be skipped for absent windows without acknowledgement. | `src/main/watch-event-queue.js:10,22,37`; `src/main/watch-worker-client.js:43`; `src/main/file-watcher.js:595`; `src/main/main.js:615` | Account for every stage before claiming end-to-end delivery. |
| Debounce/dedup precedes audit and sequence delivery. Audit omits accumulated repeatCount and final suppressed groups lack timed trailing flush. | `src/main/file-watcher.js:725`; `src/main/scan-loop.js:156,184,207` | Specify intentional aggregation versus loss before changing security-event retention. |
| Audit uses a 500-entry RAM buffer with synchronous flushes; failed writes can drop oldest entries and report only after later successful persistence. The sensitive journal holds only 100 redacted summaries / 64 KiB. | `src/main/audit-logger.js:49,64,157,346,368,427,448,458`; `src/main/sensitive-alert-journal.js:8,43,225` | W1 still needs a quota-managed, replayable security-event overflow store and explicit full-disk/restart semantics. |
| Existing fake-timer and 4,000-push tests establish policy intent. No requested throughput measurement was performed by W0. | `tests/main/file-access-batching.test.js:242,328,395`; `tests/main/ipc-batcher.test.js:558` | Measure 2,000/s sustained and 20,000/s bursts through real ingress, persistence, IPC and rendering; queue arithmetic is not a benchmark. |

## Q2 — Windows ETW

| Finding | Source location | Consequence |
| --- | --- | --- |
| #976 and #985 are merged. Ordinary packages include the helper and explicit scoped capture. #986 preserves the original issuer proof interval across valid renewal and avoids renewal starvation at capacity. | PRs #976, #985, #986; `sidecar/etw-file/FileGeneration.cs:38-55,71-106` | Adopt the implemented behavior; do not rebuild already delivered preparation/capture controls. |
| #986's receipt binds runtime `5249c10a`, package/native hashes and three first reads after 65/70/85 seconds. Its runtime inputs match this baseline. Four instrumented baseline attempts passed, so the unique cause of #985's historical intermittent failure remains unproven. | `docs/recon/evidence/agent-idle-first-read.json:7-20,40-45,107,386-394`; [#986](https://github.com/antropos17/Aegis/pull/986) | W11 block 1 adopts this bounded evidence; repeat repair/qualification only for a residual defect or changed input. One-host qualification is not complete capture. |
| #974 remains open/draft; its preparation was cancelled. Existing preflight does not include an actual restart or post-restart capture. | [#974](https://github.com/antropos17/Aegis/pull/974), head `0c7a6e8a`; its `docs/recon/evidence/etw-packaged-reboot-preflight.json` | Select necessary recovery cases; prepare owner reboot steps without claiming a reproduced reboot defect. |
| Read observations feed `readView.accept`, separately from accepted FileEvents/audit/baselines/sequences/risk. Paths remain candidates, and the shared FileEvent evidence union has no ETW code. | `src/main/platform/etw-file-runtime.js:89-96`; `src/main/platform/etw-file-attribution.js:12-39,56-104`; `sidecar/etw-file/FileMapping.cs:63-80`; `src/shared/types/events.ts:30-46`; `src/main/main.js:910-931` | W11 admission needs object/path proof, event-time identity, unknown/loss semantics and consumer tests before wiring. |
| The collector selects Kernel-File IDs 10/12/13/14/15. Process discovery still polls snapshots. | `sidecar/etw-file/FileCapture.cs:8,23-27`; `FileTrace.cs:86-90`; `src/main/platform/proc-snapshot-client.js:349-375`; `src/main/scan-loop.js:1282-1284` | W11 process start/stop capture remains unimplemented. |
| Older ETW docs retain disabled-package and instance/path-only dedup descriptions. Current dedup includes action, source and attribution evidence. | `docs/roadmap/etw-file-backend.md:10`; `sidecar/etw-file/README.md:248`; `docs/roadmap/etw-sensor-design.md:53`; `src/main/scan-loop.js:169-180` | Preserve current behavior; reconcile historical status before relying on old admission checklists. |

## Q3 — Health and coverage

| Finding | Source location | Consequence |
| --- | --- | --- |
| BOOTING, SENSORS_STARTING, HEALTHY, DEGRADED and FAILED already exist as derived app states. Leaf states and ETW phases are separate contracts. | `src/main/app-health.js:69-91,212-230,305-330`; `src/main/sensor-health.js:23-37,409-456`; `src/main/platform/etw-file-health.js:52-77` | Reuse the aggregate contract. Keep operating health, capture coverage and cleanup phase distinct. |
| Residual loss survives successful observations. Operational ETW remains DEGRADED with experimental correlation; recovered cleanup retains a FAILED leaf. | `src/main/sensor-health.js:211-226`; `src/main/platform/etw-file-health.js:103-149,205-286` | A successful cleanup or fresh observation cannot erase earlier loss or establish restored capture. |
| ETW has deadlines/custody-aware explicit restart, but no bounded automatic restart budget/reset-on-HEALTHY implementation. | `src/main/platform/etw-file-supervisor.js:263-266,342-349,431-439` | Specify the new host budget independently; it is not an existing ETW feature to copy. |
| Outages freeze sessions. Observatory already receives leaf status/loss and detailed ETW packaging mode/phase/loss. | `src/main/session-tracker.js:159-178,215-218`; `src/main/scan-loop.js:738-791`; `frontend/observatory/runtime/host.ts:212-220,259-292,341`; `components/StatsSensors.svelte:98-108,249-290`; `components/FileReadObservations.svelte:26-30,73,122-135` | W9 extends existing delivery/UI. Add capture mode, surface coverage, event rate and last restart/budget; preserve unreliable-population retention. |

## Q4 — Linux and macOS

| Finding | Source location | Consequence |
| --- | --- | --- |
| Linux D1 already reads fresh procfs start ticks and boot ID. BigInt conversion uses a boot epoch pinned for the same boot and validated CLK_TCK; fallback births are null. | `src/main/platform/linux-process-map.js:18-39,44-137`; `src/main/process-scanner.js:348-358` | Preserve D1 parity, one epoch anchor and the existing bootId:ticks witness across modes. |
| Linux TCP/files are polling; macOS uses ps/lsof and declares providesStartTime false with no native witness. | `src/main/platform/linux.js:84-110,175-216`; `src/main/platform/darwin.js:43-137,157-175` | Linux event modes and macOS native identity/sensors remain work. |
| providesStartTime is copied at module initialization; witness validators explicitly enumerate current sources. Linux conversion state is private to the map reader. | `src/main/process-scanner.js:28`; `src/main/process-utils.js:30,177-192,519-529`; `src/shared/types/process.ts:21-22`; `linux-process-map.js:44-47,146` | W3 must integrate capability consumers/types; W1a/W2 need a shared conversion owner instead of assuming an exported conversion API. |
| Proposed watch roots omit the generation witness; epoch milliseconds cannot reconstruct arbitrary macOS birth microseconds. Wire null/error and composite-witness encoding need definition. | Completion plan Appendix A; `src/main/process-utils.js:348-357`; `linux-process-map.js:122-123,136` | Resolve raw birth precision, witness comparison, clocks and unread-birth semantics before freezing W1a. |
| Source tests cover Linux tick conversion, pinned epoch/boot races and current macOS parsing; native macOS identity and eBPF parity are not established. | `tests/main/platform/linux-process-map.test.js:47-156`; `linux-process-map-races.test.js:69-212`; `darwin.test.js:79-190`; `linux-process-control.test.js:79-92` | Platform acceptance requires live runs with commit, OS/kernel and exact mode recorded. |

## Q5 — Session sources and explanation

| Finding | Source location | Consequence |
| --- | --- | --- |
| Only Claude Code is a default local transcript adapter. It reads home-relative .claude/sessions PID registries and projects JSONL, including subagent JSONL, extracting assistant usage rather than tool calls. | `src/main/token-feed.js:30,38`; `src/main/token-adapters/claude-code.js:98,129,154,195,261`; `claude-code-subagents.js:128` | W4 needs tool-call parsing and explicit native/alternate-home/WSL support; existing token parsing does not establish intent correlation. |
| Byte/line/tick budgets exist, but subagent filename discovery is not count-bounded. Session IDs are only string-checked and normal file operations follow links. | `src/main/claude-registry.js:3,13`; `claude-code-subagents.js:52,68,95,128`; `claude-code.js:105,218,267,334` | Define confined roots, identifier validation, replacement/link handling and total discovery limits for new readers. Full JSON bytes are transiently parsed; only selected output is retained. |
| Registry startedAt is checked within 60 seconds of observed birth. Usage is mapped to current scan identity, with subagent totals deliberately assigned to the main PID; accounting digests are not object/tool digests. | `claude-code.js:66,143,272,275,337`; `src/main/token-cost-collector.js:73,76,112`; `src/main/token-dedup-ledger.js:215` | Require one-to-one verified session binding, ambiguity rejection and normalized object/argument digests for W4 confirmed links. |
| Codex is a bounded finite hook-replay adapter; Gemini is a bounded stdin BeforeTool shell-policy hook. Neither implements local transcript discovery. Config-inventory paths do not establish session-file formats. | `src/main/provider-codex-adapter.js:3`; `provider-adapter-common.js:68,76,110,147,165`; `gemini-beforetool-hook.js:61`; `docs/roadmap/enforcement-e8/provider-replay.md:3`; `docs/PROFILE-INVENTORY.md:26,92,98` | Obtain version-pinned Codex/Gemini transcript formats and path evidence before designing their readers. |
| Claude lifecycle intake emits opaque references with processBinding unbound. Existing hook sessions compare provider IDs/input but remain OS-unbound. | `src/main/agent-event-receiver.js:14,42,107,124`; `src/main/handoff-live.js:24`; `src/main/action-policy-session.js:11,41,101,193` | Preserve provider-reported intent versus OS evidence. Object match and verified binding are prerequisites; temporal overlap alone stays insufficient. |

## Q6 — Policy families and Cedar equivalence

| Finding | Source location | Consequence |
| --- | --- | --- |
| Claude action schema 1 matches exact Bash input plus cwd. Execution schemas 2/3 match exact executable/cwd/args/env descriptors. These are JSON policy families. | `src/main/action-policy.js:67-91,160-174,219-222`; `src/main/execution-policy.js:41-111,147-170` | Replace the plan's YAML-only premise; characterize each family before selecting the schema-4 translation boundary. |
| Both use first-match evaluation but reject equivalent duplicate rules; exact predicates mean valid policies cannot overlap. Defaults permit deny/ask only. | `action-policy.js:49-64,89,219-222`; `execution-policy.js:77-88,169-170` | Preserve literal matching and validation. Treat duplicates as invalid property cases; valid exact-match policies remain non-overlapping. |
| Schema-3 reviewRequired is a nonempty unique list referencing explicit allow actions. A matching allow becomes ask/review-required; private launch metadata additionally requires trusted review context. | `execution-policy.js:92-108,171-182`; `src/main/action-confirmation.js:85-101`; `action-execution.js:132-154` | Equivalence includes reasons, review classification and launch eligibility, plus the separate single-use approval boundary. |
| Gemini denial, selected deletion and MCP schemas/grants are separate contracts; MCP already has schema versions 1-5. Endpoint normalization is route-specific. | `gemini-beforetool-hook.js:31-94`; `action-delete-file.js:31-106`; `mcp-gateway-schema.js:134-153`; `mcp-gateway.js:306-340`; `mcp-gateway-route.js:12-40,149-150`; `mcp-gateway-tls.js:45-71` | Do not conflate numeric versions or replace route/grant authority with Cedar permits. New trusted principal/sensor-health fields require a separate provenance design. |
| Unknown fields, malformed bytes, changed bindings/files and unsupported provider approval have fixed deny behavior. | `action-policy.js:197-217`; `execution-policy.js:138-167`; `provider-adapter-common.js:115-132`; `action-policy-session.js:41-43` | Compare complete adapter outputs, invalid/error cases and provider-specific ask behavior; current process identity is unbound. |

Decision-test inventory (all under `tests/main/`; source inventory, not an
executed pass): `action-policy.test.js:43-252`,
`execution-policy.test.js:36-173`, `action-policy-hook.test.js:59-253`,
`action-policy-session.test.js:46-370`, `execution-binding.test.js:51-225`,
`execution-approval.test.js:142-302`, `action-execution.test.js:74-179,356-381`,
`action-confirmation.test.js:343-377,583-653`, `action-route-check.test.js:314-350`,
`action-catalog-check.test.js:155-254`, `action-mcp-revisions.test.js:185-241`,
`provider-adapter.test.js:19`, `provider-adapter-controls.test.js:35-141`,
`gemini-beforetool-hook.test.js:79-174`, `action-delete-file.test.js:68-156`,
`mcp-gateway.test.js:215`, `mcp-gateway-schema.test.js:16-54`,
`mcp-gateway-http.test.js:216,255-272,324`,
`mcp-gateway-tls-schema.test.js:14-74`,
`mcp-gateway-manifest-v2.test.js`, `mcp-gateway-manifest-v3.test.js`,
`mcp-gateway-manifest-v4.test.js`, `mcp-gateway-manifest-v5.test.js`,
and `mcp-gateway-grants.test.js:282-399`.

## Q7 — Native hooks and Guard mode

| Finding | Source location | Consequence |
| --- | --- | --- |
| Production hook installation/removal is manual. Only the opt-in fixture writes an owned isolated settings file; it is not an installer for existing user configuration. | `docs/ACTION-POLICY-HOOK.md:40,60`; `docs/ACTION-GEMINI-BEFORETOOL.md:48,74`; `scripts/verify-claude-hooks.mjs:30,111,131,155,267,350` | W6 needs preview/backup/idempotent merge, conflict-aware rollback/removal and effective-configuration detection. |
| Claude covers PreToolUse Bash with allow/ask/deny; Gemini covers BeforeTool run_shell_command with exact denials and no decision for unmatched input. Codex is finite replay with native qualification not-run. | `src/main/action-policy-hook.js:22-48`; `src/main/action-policy.js:160,219`; `src/main/gemini-beforetool-hook.js:61,93,118`; `src/main/provider-adapter-common.js:165` | Define provider/version/tool matrices. Existing adapters do not establish general blocking across tools or agents. |
| Hooks have bounded input/deadline and read-time selected-policy checks, but no continuous hook presence/load/tamper/bypass monitor. Static inventory cannot establish which configuration a running provider selected. | `src/main/action-policy-hook.js:5,14`; `src/main/command-hook-input.js:17,51,80`; `src/main/action-policy.js:94,107,206`; `docs/PROFILE-INVENTORY.md:36,108,120` | Add evidence for loaded/disabled/missing/tampered states and failure paths before publishing Blocking verified. |
| Historical native evidence covers Claude Code 2.1.263 on Windows 11 Home 26200, runtime 52fc21f1, isolated settings and local synthetic model replies. Deny prevented a Bash sentinel; the missing/unstartable-hook control executed it. | `docs/roadmap/enforcement-e0/evidence.md:3,12,17,59,75-77`; `scripts/verify-claude-hooks.mjs:177,307` | Preserve this narrow installed-client effect evidence. It does not qualify current binaries/configs, interactive ask, cloud sessions, all platforms or a protected OS boundary. |
| Gemini native behavior remains unverified. Codex 0.157.1 is only a recorded executable-version probe. | `docs/ACTION-GEMINI-BEFORETOOL.md:104,112`; `docs/roadmap/enforcement-e8/provider-replay.md:98,114`; `docs/ACTION-POLICY-HOOK.md:148` | Record fresh positive/negative effects, failure/bypass behavior and uninstall restoration for each supported surface/version. |

## Q8 — Protected Session

Stage labels identify scoped work; none substitutes for the acceptance gates.
The enforcement paths below are relative to `docs/roadmap/`.

| Finding | Source location | Consequence |
| --- | --- | --- |
| E0 has historical architecture-only A0 acceptance; E1 has inactive protocol/enrollment/caller-binding slices. Installed binding still permits inspection only. | `enforcement-e0/review-resolution.md:3-11`; `enforcement-e1/evidence.md:13-25`; `enforcement-e2/installed-caller-operation-binding.md:3-13` | Establish ordinary installed-caller authority for protected operations before joining administrative execution. |
| E2 has real administrative Hyper-V/image/guest evidence, including a 16 October packet at source 5113e3b; ordinary desktop dispatch and unknown-VMMS recovery are excluded. | `enforcement-e2/protected-guest-hosted-evidence-20261016.md:11-27,50-62,84-95` | Preserve the real administrative evidence without promoting it to ordinary installed acceptance. |
| E3 has scoped stdio/cancellation/retained-exit fixture evidence; full E2/E3/A1 and general crash/reboot recovery remain outside that corpus. | `enforcement-e3/stdio-cancellation-readiness-evidence-20261008.md:3-21`; `enforcement-e2/cloud-stdio-retained-exit-evidence-20261009.md:54-66` | Qualify cancellation/owner-loss against the actual admitted operation chain. |
| E4 authority and one-use operation broker exist. E5 private model broker has local HTTPS controls, but no public production caller or actual provider-boundary acceptance. | `enforcement-e4/session-authority.md:3-7`; `src/main/session-operation-broker.js:4`; `enforcement-e5/model-broker.md:3-8`; `enforcement-e5/model-https-failure-evidence-20261008.md:44-51` | Disposable effects and local broker tests do not authorize production launch or real credentials. |
| E6's fixed disposable task/review evidence retains claudeAcceptancePassed=false and E6Qualified=false. | `enforcement-e2/cloud-hyperv-evidence-20261007.md:711-732` | Keep authenticated provider execution and the full matrix open. |
| E7 uses actual gateway/grant-store code with loopback accounts/dummy credentials. E8 has finite provider replay and executable-version probes. | `enforcement-e7/mcp-workflows.md:9-22,41-46`; `enforcement-e8/provider-replay.md:3-13,98-115,131-133` | Neither proves real account/provider identity or useful protected agent work. |
| E9 result-review IPC/UI and disposable publication exist; E10 is a generated-effect harness; E11 artifact admission uses inert bytes/disposable keys. | `enforcement-e9/result-review.md:3-29,96-110,133-139`; `src/main/local-security-ipc.js:33,178`; `enforcement-e10/evidence.md:3-13,58-86`; `enforcement-e11/helper-artifacts.md:3-8,58-69` | Writer termination, protected return authority, native enforcement and release/installer acceptance stay distinct. |
| A1-A4 remain UNREVIEWED in the retained checkpoint. These are enforcement acceptance gates, distinct from similarly named inventory/static-analysis stages. | `enforcement-e0/backend-adr.md:136-140`; `ai-agent-protection.md:11-24`; `enforcement-e2/protected-guest-hosted-evidence-20261016.md:92-95` | A0 architecture acceptance cannot satisfy A1 containment, A2 provider/grants, A3 external effects or A4 installer/release. |
| Both current protocol implementations fix launchAllowed=false; installed operation registration permits inspect-owned only. | `src/main/protected-session-protocol.js:71-72`; `sidecar/session/Protocol.cs:60-61`; `sidecar/session/InstalledFixedOperationRegistration.cs:14,32,139-141`; `docs/PROTECTED-SESSION-PROTOCOL.md:37-50` | W7 first proves installed-caller/owner/image/replay/lifetime binding, then authenticated runtime and cancellation. Preserve launchAllowed=false through review-package preparation. |

No new VM, UAC, provider or live artifact qualification was performed. Later
owner actions can include admin/Hyper-V/reboot execution, trusted offline image
and guest credentials, real-provider authorization and the final launch decision;
their exact commands must be prepared for the selected implementation.

## Q9 — Benchmark method, corpus and oracles

| Finding | Source location | Consequence |
| --- | --- | --- |
| Bench V1 has catalogue/audit capture, replay, oracle confirmation and metrics; traces add chained records and a virtual clock. | `bench/run.js:3-25`; `bench/score.js:5-30`; `bench/trace/bench-replay.js:5-25` | Reuse the harness while qualifying its input/effect boundaries. |
| Only two scenario directories exist: renamed ping held for 35 seconds and renamed Node holding a disposable .ssh fixture for 40 seconds. | `bench/scenarios/S1-agent-lifecycle/scenario.json:35-76`; `bench/scenarios/S2-rm-holder/scenario.json:35-60` | W8 needs fixed-version real-agent tasks, ordinary/unsafe task outcomes and a scenario-to-technique matrix. |
| Scored categories cover process start/end and file creation/deletion. Holding/read/modification/network/persistence events are outside the mapping. | `bench/lib/join.js:63-73`; `bench/lib/observed.js:43-54,121-134`; `bench/lib/metrics.js:1001,1085` | Expand the catalogue, observations and oracle mappings together before computing recall for new sensors. |
| Sysmon live ingestion is LIVE-UNVALIDATED; its parser tests use synthetic XML. Procmon, auditd and eslogger adapters are absent; the report generator is planned. | `bench/lib/oracles/sysmon.js:26-36`; `bench/lib/manifest.js:144-169`; `bench/README.md:156-162,560-579` | Qualify independent oracle ingestion and gold-image execution before publishing comparative effectiveness. |
| Recall uses oracle-confirmed rows; latency reports p50/max. Precision is a lower bound mixing unrelated activity and sensor noise. | `bench/lib/metrics.js:858-903`; `tests/main/bench/metrics-mutation.test.js:3-28` | Preserve the confirmed denominator. Arithmetic mutation tests and this precision value do not measure benign-task false alarms. |
| Committed recordings are historical development-host, legacy-unversioned S1 evidence; derived fixtures model identity/scoring. A 30-minute Electron profile at f19c2f03 measured CPU/RSS/stages/queues, excluding ETW and external helpers. | `tests/fixtures/bench/README.md:3-17,43-46,69-75`; `tests/fixtures/bench/derived/README.md:3-18`; `docs/bench/windows-post-sprint-live-2026-09-27.md:3-16,30-69` | Preserve these measurements with their original scope; the plan's former Nothing measured claim was inaccurate. |
| Sensor-only arm C starts no sensor; overhead is deferred. Instrumentation overhead is uncalibrated and docs/bench/METHOD.md is absent. | `bench/run.js:11-13,852-854`; `bench/cycle-profile/README.md:39-57`; `scripts/bench-ipc-batcher.js:7-35` | W8 first freezes the method, implements overhead controls and records per-platform/mode source-bound results, loss and three-run variance. |

## Q10 — CI and packaging

| Finding | Source location | Consequence |
| --- | --- | --- |
| The five required jobs all use Ubuntu/Node 24: build, lint, svelte-check, test and audit. They include coverage, both mutation gates and counts. | `.github/workflows/ci.yml:10-96`; `package.json:16-32` | Required green checks establish these gates; native and packaged acceptance remains separate. |
| Windows-2025 fixtures are optional/path-filtered and cover five caller/import/protected-GUI suites. Their receipt excludes Electron bridge, installer, VM and provider authentication and retains UNREVIEWED/launchAllowed=false. | `.github/workflows/windows-fixtures.yml:3-26,56-65`; `tools/development/verification-contract.mjs:3-9`; `tools/development/windows-fixtures.mjs:63-118,139-180` | Keep clean exact-SHA/dependency/compiler/disk receipt checks. This workflow does not qualify ETW or full application installation. |
| Linux tests include a conditional live owned-child pidfd case; many platform responses are mocked. No macOS runner exists. Development-tools and manual native/cloud-guest qualification are separate workflows. | `tests/main/platform/linux-process-control.test.js:79-99`; `tests/main/platform/darwin.test.js:4-8`; `.github/workflows/development-tools.yml:18-37`; `.github/workflows/enforcement-native-qualification.yml:3-22,196-218,238-260` | Inspect actual conditional-test execution; neither all-native nor all-mocked describes current coverage. |
| No sensors workspace, Rust gate or eBPF integration job exists. | Runtime baseline tree; `.github/workflows/ci.yml`; proposed `completion-plan.md` Appendix A | After W1a, prepare pinned-toolchain/locked restore/fmt/clippy/tests/build gates. Native eBPF needs recorded kernel/BTF/attach/capability preflight, isolated fixtures, identity/loss evidence and bounded cleanup. Workflow changes remain a later authorization boundary. |
| Builder declares NSIS, AppImage/deb and dmg. Only Windows preflight builds native helpers; Linux ships a Python controller/Podman config and no Rust sensor. | `package.json:56-118`; `scripts/electron-builder-before-build.js:25-55`; `tests/main/packaging-preflight.test.js:16-51` | Target declarations and mocked preflight tests do not demonstrate successful native packages; add sensor payload and first-run mode checks. |
| Release CI publishes Windows executables with an Ed25519 integrity manifest. No explicit Authenticode/notarization flow exists. Packaged Windows x64 alone uses NsisUpdater. | `.github/workflows/release-build.yml:23-24,59-106`; `scripts/release-sign.js:169-195`; `src/main/main.js:1177-1184`; `src/main/app-updates.js:95-120` | Separate artifact integrity from executable signing; define Linux/macOS updates and prepare owner signing inputs. |
| Manual installer qualification is pinned to old d62e589f/0.15.0-alpha inputs. Release 0.19.2-beta records artifact verification/extracted-app smoke but leaves installation, upgrade and uninstall unqualified. | `.github/workflows/release-qualification.yml:14-25,83-91`; `scripts/qualify-windows-installer.ps1:32-70`; `docs/releases/0.19.2-beta.md:32-54` | Parameterize current source/version/artifact inputs before reuse; run clean-machine install/first-run/update/uninstall for each delivered platform. |

## Q11 — Available test environments

Environment inventory was read-only on 2026-10-19. Tool/service presence and
historical hosted receipts are separate from current native qualification.

| Finding | Source location / read-only evidence | Consequence |
| --- | --- | --- |
| Local Windows 11 Home x64 build 26200.8655 is reachable; .NET SDK 10.0.302 and GH CLI 2.86.0 are present. PATH Node is 24.11.1. | `Get-CimInstance Win32_OperatingSystem`; `wsl --version`; tool version probes | Packaging tooling exists, but PATH Node is below the repository's required 24.16.0. Use an already qualified runtime or prepare it in a later authorized task before local tests. |
| #986 ordinary-package evidence used Node 24.16.0/Electron 44.7.2 on one Windows x64 host. | `docs/recon/evidence/agent-idle-first-read.json:7-24,386-394` | Keep its source/package identity and scope; it does not qualify reboot, every recovery case or Protected Session. |
| WSL2 Ubuntu and docker-desktop are installed and stopped. WSL 2.6.3.0 reports bundled kernel 6.6.87.2-1. | `wsl --list --verbose`; `wsl --version` | No distribution was started. Active kernel, Ubuntu version, BTF, privileges and mode behavior remain unmeasured. |
| vmms, vmcompute and WslService were already running; Get-VM/Get-VMHost and the Hyper-V module were not discoverable in this shell. | Bounded `Get-Service`, `Get-Command`, `Get-Module -ListAvailable` probes | Service presence does not establish usable VM administration, trusted image availability or an admitted installed-caller route. |
| Ubuntu CI passed at e6c36cf7; Windows-2025 native fixtures passed at f225798e. | [CI 39190211789](https://github.com/antropos17/Aegis/actions/runs/39190211789); [Windows fixtures 39188525169](https://github.com/antropos17/Aegis/actions/runs/39188525169) | Hosted workers are available execution routes; exact kernels/privileges and sensor qualification still require a dedicated run. |
| Historical cloud-hyperv/windows11 jobs passed at 5113e3b5; an installer lifecycle run passed at bbde538d. | [38847001856](https://github.com/antropos17/Aegis/actions/runs/38847001856), [38847307744](https://github.com/antropos17/Aegis/actions/runs/38847307744), [34709329189](https://github.com/antropos17/Aegis/actions/runs/34709329189); `enforcement-e2/protected-guest-hosted-evidence-20261016.md:84-95` | Preserve historical administrative/fixture limits; new source/artifact inputs require new receipts. |
| No macOS host was identified/contacted; inspected workflows have no macOS runner. Cargo/rustc/rustup were not discoverable on PATH. | Workflow inventory in Q10; bounded command discovery | macOS availability is unknown. Rust installation remains deferred; do not infer an unavailable executable from PATH absence alone. |

No VM, distribution, Docker service or provider was started. Remaining native
matrices cover Windows recovery, Linux kernel/mode/privilege, macOS
version/architecture/entitlement, Hyper-V administrative versus installed-caller
execution and each artifact's install/update/uninstall lifecycle. Owner-provided
hosts/privileges, reboot/UAC and signing inputs are selected when those
workstreams have prepared a concrete qualification procedure.

## T1–T10 — Implementation and verification boundary

No complete target is verified by this read-only baseline. A partial implementation
or historical receipt remains useful within the scope recorded below.

| Target | Implemented | Verified by which evidence | Missing |
| --- | --- | --- | --- |
| T1 Windows ETW | Ordinary packaged file-read observation, generation attribution and recovery controls; process population still polls. | Source-bound #986 idle-first-read receipt, with the Q2 one-host limits. | Admission into FileEvents/audit/risk, process lifecycle ETW, selected recovery cases and packaged acceptance of the resulting chain. |
| T2 Linux | Procfs D1 identity and polling platform adapter. | Existing identity/control tests are inventoried in Q4; no new native run. | Rust sensor, wire/host, eBPF/fanotify/procfs mode qualification and live identity parity. |
| T3 macOS | Polling process/network adapter. | Source inspection in Q4; no reachable live macOS qualification established. | Fresh birth/witness support, Rust sensor, explicit fallback coverage and native/entitled-mode evidence. |
| T4 Explanation | Claude usage extraction and opaque lifecycle intake; bounded provider policy/replay adapters. | Source and existing test inventory in Q5. | Tool-call readers, verified one-to-one session binding, object match, bounded discovery, ambiguous/unavailable states and UI qualification. |
| T5 Cedar | Separate deterministic JSON evaluators, review and approval controls. | Existing decision-test inventory in Q6. | Characterization reference, Cedar integration, full-output equivalence including errors/ask/review and trusted-input provenance. |
| T6 Guard | Manual Claude/Gemini hooks; finite Codex replay. | Historical native Claude sentinel test under isolated configuration/local model replies (Q7). | Safe installer/remover, effective-configuration detection, current version/tool qualification and coverage-loss monitoring. |
| T7 Protected Session | Scoped E0–E11 components, inactive installed protocol and administrative fixture route. | Historical A0 architecture acceptance and bounded E2/E3/E4–E11 records (Q8). | Installed operation authority, authenticated useful agent work, A1–A4 acceptance and owner launch decision; launchAllowed remains false. |
| T8 Measurements | Benchmark harness, two bounded scenarios and historical development-host performance records. | Scope and oracle limitations in Q9. | Independent per-platform recall, ordinary-work false alarms, current overhead method/results and reproducible published corpus. |
| T9 Coverage UI | Aggregate/leaf health and ETW observation diagnostics already reach Observatory. | Source inventory in Q3; no new UI/live run. | Per-surface Observed/Blocking verified/Coverage lost, active capture mode, rate/restart state and qualified end-to-end delivery. |
| T10 Artifacts | Existing packaging configuration and Windows ETW packaging path. | Current workflow inventory in Q10 and scoped historical Windows evidence in Q2. | Sensor-inclusive Linux/macOS packages, cross-platform install/update/uninstall evidence and prepared owner signing/notarization steps. |

## Decisions before later work

| Decision | Evidence | Execution consequence |
| --- | --- | --- |
| Fix identity representation before freezing sensor/1. | Q4: D1 conversion is private; watch roots omit the witness; epoch milliseconds cannot recover raw precision. | W1a first specifies raw birth, composite witness, clock anchor and null/error semantics; shared Rust ownership remains serialized. |
| Preserve Rust deferral. | Explicit owner instruction; W1a acceptance requires both JS and Rust golden tests. | W1-pipe and contract design can proceed when authorized. W1a cannot be called complete, and W1b cannot start, until the deferred toolchain prerequisite and both language gates are satisfied. |
| Keep W1b after merged W1a and W1-pipe. | Q1/Q3 plus the explicit owner ordering correction. | Reuse current health aggregation; specify the new automatic restart budget separately from existing ETW custody/deadlines. |
| Adopt #986 before reopening first-read repair. | Q2 source-bound receipt and current runtime equality. | W11 block 1 becomes evidence adoption/residual-gap assessment; select block 2 recovery cases before preparing any owner reboot. |
| Preserve each policy family's semantics. | Q6: exact non-overlapping predicates, duplicate rejection and distinct schemas/approval routes. | W5 starts with characterization; duplicate/overlap inputs are invalid cases where current validation rejects them. New principals/routes require explicit trusted inputs. |
| Obtain version-bound sources and independent oracles before claims. | Q5/Q7/Q9: transcript discovery, native hook qualification and oracle execution are incomplete. | W4/W6/W8 separate available fixture evidence from unavailable real-provider/platform acceptance. |

The tracker separates implementation, verification and owner-pending work. Wave 0
does not prepare a release, enable protected launch, install a toolchain, start a
VM or authorize Wave 1 implementation. Later machine restarts, protected/provider
qualification and signing need concrete commands/inputs prepared by their owning
workstream before any request to the owner.

## Verification of this baseline

This change contains documentation only. Local validation is source/reference and
diff checking; no new behavioral tests or mutation checks apply. Full required
checks run in hosted CI for the exact PR revision and again on merged master.
Their immutable run URLs, PR/merge SHAs and final result are recorded in the PR
and the external completion tracker after they exist. They validate repository
gates, without extending the native/provider evidence described above.

The primary dirty checkout is preserved. Work uses a separate data-drive worktree.
Task diagnostics have bounded output and a seven-day manual retention review;
verification receipts are retained. No system-wide cleanup or persistent log
rotation is installed by Wave 0.
