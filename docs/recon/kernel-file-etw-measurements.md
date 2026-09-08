# B1 measurement status — 2026-09-08

The user completed the first eleven-run [standalone harness](../../sidecar/etw-probe/README.md)
matrix in an administrator terminal. B1 remains open for repeat/load measurements
and the unresolved questions below. The observations are from one Home host; they
do not ratify B2 producer design or B3 production integration.

## Observed locally

Windows 11 25H2, build 26200.8655, EditionID Core (Home), x64, 22 logical processors;
.NET SDK 10.0.302 and runtime 10.0.10. The project pins TraceEvent 3.2.6, restored
successfully; its direct/transitive NuGet vulnerability check reported none.

TDH returned the registered manifest without elevation. The original artifact is
`X:/tmp/aegis-etw-preflight-20260908/kernel-file.manifest.xml`, SHA-256
`8B2A7C91BC7C11930084F8A88443CFE9D4AE166F7C7DC4F44247E694E3CAB411`.
Read 15 v1 exposes ByteOffset, Irp, FileObject, FileKey, IssuingThreadId, IOSize,
IOFlags and ExtraFlags; no filename. Create 12 exposes FileObject/FileName,
NameCreate 10 FileKey/FileName, and Cleanup 13 / Close 14 expose lifecycle fields.
These are registered schemas on one build, not proof of runtime emission or rundown.

The offline self-tests cover correlation failures, path boundaries, pointer reuse,
bounded retention, opaque pointer output, QPC retention, option validation, native
loss-query layout and unavailable counters. Six child-process fixture checks cover
buffered, async, mapped, preopened, churn and idle, including delaying ledger writes
until the parent permits them. Neither kind of test starts an ETW session.

## First live matrix

Source: `X:/tmp/aegis-etw-matrix-20260908`, collected with the harness from PR #380.
The [aggregate evidence](evidence/etw-home-26200-first.json) retains source hashes
for run configuration, samples and summaries. All eleven captures returned 0;
pre-stop session loss counters, decoder failures, omitted samples, map resets and
path conflicts were zero. This is collection evidence, not proof of completeness.

| Scenario | Completed fixture operations | Fixture-path Read samples | Observed limitation |
| --- | ---: | ---: | --- |
| idle | 0 | 0 | Actor runtimes still emitted 13 unresolved reads. |
| READ only | 322 | 0 | No path-bearing evidence enabled. |
| names/read | 320 | 320 | Candidate object mapping; not proof of minimal configuration. |
| lifecycle | 322 | 322 | Header PID matched each fixture actor. |
| target PID filter | 322 | 322 | Both target and control delivered 161 fixture reads. |
| preopened | 322 | 0 | 322 actor reads retained without a fixture path. |
| async | 322 | 322 | Two additional actor reads stayed unresolved. |
| warm mapped | 322 | 0 | No fixture-path Read sample; this does not prove no event was emitted. |
| churn / close | 643 | 643 | No observed conflict in this short run. |
| churn / cleanup | 643 | 643 | Does not establish cleanup as a correct eviction rule. |
| churn / no eviction | 645 | 645 | Does not establish that eviction is unnecessary. |

In every path-resolved row, one corresponding fixture Read sample fell inside
each recorded operation's QPC interval. Header PID matched the expected fixture
actor, and the live thread-owner lookup agreed for those samples. This is stronger
than matching totals, but it remains evidence for these workloads on this host;
the operation ledger is not an independent oracle for event emission.

The requested PID filter did not isolate the target on this run. Do not use it as
a demonstrated way to avoid machine-wide collection. NameCreate 10 was delivered,
but these fixture reads resolved through candidate object mappings; its necessity
is not established. Preopened path recovery and mapped-read coverage remain open.

Collector CPU was 218.75–937.5 ms per approximately six-second capture, with a
process-lifetime peak working set of 58,769,408–82,522,112 bytes. Native session
queries reported 1,024 buffers of 64 KiB (64 MiB) per run, separate from that working
set. These are single-run observations, not an overhead budget: background activity
varied, idle used all event IDs, collector CPU excludes kernel generation cost, and
the session counters were queried before final stop.

## Repeated live load study

The user completed `X:/tmp/aegis-etw-load-20260908` with PR #381's probe, Node
24.11.1 and npm 11.6.2. The [aggregate evidence](evidence/etw-home-26200-load.json)
retains all nine outcomes and summary/workload hashes. All three repetitions of
idle, npm CLI startup and renderer builds completed without decoder/retention
errors or queried pre-stop session losses. The normal workloads completed 244 npm
CLI commands and 14 renderer builds successfully. QPC checks show no previous
workload overlapping the next capture; build tails extended 0.39–2.01 seconds past
their own captures and were allowed to finish before the next one began.

| Workload | Read 15 events/s, range | Collector CPU as % of one logical processor, range |
| --- | ---: | ---: |
| idle | 143–1,781 | 0.292–3.405 |
| npm CLI | 2,545–4,341 | 2.327–3.496 |
| renderer build | 1,316–1,554 | 1.845–2.531 |

Rates use collection duration (approximately 16 seconds including tail drain).
All enabled event types reached 23,834 events/s in one npm run. Background traffic
was not isolated and there is no tracing-off control, so these are observed rates
and collector CPU, not total-system overhead or causal workload attribution.

Process-lifetime peak working set reached 83.28 MiB; native queries reported 64 MiB
of session buffers throughout. The same collector process serves every run, so
repeated 83.28 MiB peaks do not prove current memory stability or absence of a leak.

Next: `EtwProbe.exe tune <new-directory>` compares 64/32/16 MiB requests with three
rotated repetitions, then performs one ten-minute continuous capture with 16 MiB
and cycling normal-user workloads. Current/private/managed memory and session loss
counters are sampled over time. This preparation has no new live measurements yet;
the default buffer budget is unchanged and B1 remains open.

## Hardware-gated checklist

Numbers match the [frozen recon](kernel-file-etw.md#hardware-gated).

| # | Required evidence | Current status / next measurement |
| --- | --- | --- |
| 1 | Provider PID filter | First run did not isolate target: 161 target plus 161 control reads. Repeat and investigate before generalizing. |
| 2 | Authoritative issuer | Fixture header PID, QPC intervals and live owner agreed for resolved reads; other paths and event-time identity remain open. |
| 3 | Current manifest / rundown | Registered manifest verified on one Home build; capture-state/rundown behavior pending. |
| 4 | NameCreate delivery | Observed on this host; necessity and completeness of mapping are unresolved. |
| 5 | Cleanup/Close requirements | All three short churn policies resolved the recorded fixture operations; requirements remain unproven. |
| 6 | Object/key lifetime and reuse | Short churn has no observed conflicts; reuse/lifetime guarantees remain open. |
| 7 | Minimal mask and IDs | 0x190 and 0x1B0 resolved fresh fixture reads; READ-only did not resolve paths. Minimality remains open. |
| 8 | Idle/npm/build event rates | Three repetitions observed per workload on this Home host; background not isolated and npm is CLI startup, not install. |
| 9 | CPU/memory/buffers/loss | Repeated collector metrics and zero pre-stop losses recorded; smaller buffers, sustained behavior and total-system overhead remain open. |
| 10 | Fast I/O | Pending: dedicated path evidence; buffered workload alone is insufficient. |
| 11 | mmap/page faults | 322 warm-mapped operations, zero fixture-path Read samples; dedicated cold/page-fault evidence remains pending. |
| 12 | Home versus Pro | Pending: same matrix on both editions. |
| 13 | Hyper-V | Pending: same matrix in a documented guest configuration. |

Preserve the environment, options, exit status and all counter failures with each
run. Distinguish verified observations, unresolved cases and environment limits.
Do not turn zero events into a claim that no read happened or call a candidate map
authoritative attribution. No installed AEGIS behavior changes in this block.

API references: [TraceEvent package](https://www.nuget.org/packages/Microsoft.Diagnostics.Tracing.TraceEvent/3.2.6),
[session implementation](https://github.com/microsoft/perfview/blob/main/src/TraceEvent/TraceEventSession.cs),
[native session counters](https://learn.microsoft.com/en-us/windows/win32/api/evntrace/ns-evntrace-event_trace_properties).
