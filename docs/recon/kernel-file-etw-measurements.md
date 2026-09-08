# B1 measurement status — 2026-09-08

The [standalone harness](../../sidecar/etw-probe/README.md) is prepared. Live ETW
capture has **not** run in the current non-administrator session. B1 is still open;
B2 producer design and B3 production integration cannot be ratified from these tests.

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

## Hardware-gated checklist

Numbers match the [frozen recon](kernel-file-etw.md#hardware-gated).

| # | Required evidence | Current status / next measurement |
| --- | --- | --- |
| 1 | Provider PID filter | Pending: target/control, filtered/unfiltered comparison. |
| 2 | Authoritative issuer | Pending: QPC/caller/header/payload observations; late live TID lookup alone cannot settle it. |
| 3 | Current manifest / rundown | Registered manifest verified on one Home build; capture-state/rundown behavior pending. |
| 4 | NameCreate delivery | Pending: names/read and lifecycle runs. |
| 5 | Cleanup/Close requirements | Pending: close/cleanup/no-eviction comparison and lifecycle analysis. |
| 6 | Object/key lifetime and reuse | Pending: churn evidence; synthetic map tests do not prove OS semantics. |
| 7 | Minimal mask and IDs | Pending: READ-only, 0x190, 0x1B0; broaden comparisons if inconclusive. |
| 8 | Idle/npm/build event rates | Pending: repeated baseline and normal-terminal workload runs. |
| 9 | CPU/memory/buffers/loss | Pending: repeated load capture; collector CPU excludes kernel generation cost. |
| 10 | Fast I/O | Pending: dedicated path evidence; buffered workload alone is insufficient. |
| 11 | mmap/page faults | Pending: warm mapping baseline, then dedicated cold/page-fault experiment. |
| 12 | Home versus Pro | Pending: same matrix on both editions. |
| 13 | Hyper-V | Pending: same matrix in a documented guest configuration. |

Preserve the environment, options, exit status and all counter failures with each
run. Distinguish verified observations, unresolved cases and environment limits.
Do not turn zero events into a claim that no read happened or call a candidate map
authoritative attribution. No installed AEGIS behavior changes in this block.

API references: [TraceEvent package](https://www.nuget.org/packages/Microsoft.Diagnostics.Tracing.TraceEvent/3.2.6),
[session implementation](https://github.com/microsoft/perfview/blob/main/src/TraceEvent/TraceEventSession.cs),
[native session counters](https://learn.microsoft.com/en-us/windows/win32/api/evntrace/ns-evntrace-event_trace_properties).
