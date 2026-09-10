# B5 — connected diagnostic ETW backend

Implemented 2026-09-09 in `codex/etw-file-backend`, following the user's request to
do the file/transport/backend block while deferring real sleep/wake. See the
[runnable commands and exact bounds](../../sidecar/etw-file/README.md).

The source graph is now Electron main → `etw-file-runtime` → `etw-file-supervisor`
→ existing protocol/health modules → fixed normal C# broker → authenticated pipe
→ elevated file collector. Startup requires an explicit development root flag;
packaged enablement remains blocked. No renderer, IPC channel, FileEvent adapter,
scoring, sequence, baseline or audit consumer receives diagnostic observations.
The existing app-health composer receives one optional `etw-file` leaf and keeps
its process-population gate independent.

## What this implements

| Part | Behavior | Remaining evidence |
| --- | --- | --- |
| Provider | Native StartTrace/EnableTraceEx2, fixed diagnostic event-ID filter and mask, TraceEvent 3.2.6 consumer, final handle-based stop counters; narrow live smoke passed | Independent absence and broader live coverage |
| Transport | Closed framed commands, known diagnostic schemas, bounded queues/batches, backpressure, heartbeat/lease/write deadlines | Real sustained elevated transport, total memory/kernel cost |
| Lifecycle | Explicit start/stop and new IDs on verified restart, request correlation, old callback/frame rejection, pause/suspend/quit stop, bounded ended summaries | Actual sleep/wake is deferred; pending-dialog cancellation and protected collector-crash recovery remain open |
| Paths | Preceding names only, null preopened paths, epoch invalidation on loss/conflict/close/order/cap, scope minimization | Object/key semantics under actual reuse, reparse identity, E5 admission |
| Processes | Separate header/issuing TID, uncached full FILETIME observation with its own interval, no agent join | E4 event-time issuer/generation proof; matching public instanceId is insufficient |
| Health | Diagnostic DEGRADED state, sticky losses, null unmeasured native counters, failed EOF/stop timeout, no population fallback | No claim of complete kernel read coverage |

No automatic elevated restart or orphan deletion was introduced. A failed capture
blocks retries until a separate trusted recovery path is established; restarting
the app still cannot overwrite an occupied fixed session name. The bounded normal
broker may be terminated after a cleanup grace period; the elevated collector
receives EOF/lease/parent-exit triggers and is never killed by main.

## Local acceptance

22 C# self-tests cover map lifecycle/TTL/order/rebinding/conflict, retained-string
caps, 100,000-input overload with counted discard, PID reuse without borrowed birth,
wire framing/replay/foreign context/closed commands and native structure layout.
An unread-output test verifies that the separately bounded mapper continues draining
raw input while the outbound stage fills and counts its own drops. v1 queue fields
report maxima across the independently bounded stages; dropped is their combined
loss, including discarded queued candidates on invalidation.
Three actual normal-token process scenarios exercise two clean sessions and parent
EOF through the JS supervisor. Their native counters stay null and their events
are explicitly synthetic. The process test reports build hashes and never writes
raw paths/observations. Native sleep or UAC was not exercised by these tests.

The JS protocol/reducer/supervisor tests and the actual main health-composer tests
cover ring entry/byte caps, control backpressure, wrong IDs, replay, lost heartbeat,
stop timeout, explicit restart, ended-summary eviction, and forbidden attribution
fields. The composer checks prove a failed ETW leaf degrades the app without
changing process-population reliability or writing diagnostic data to audit/stats.

After the user approved the UAC test, the first live attempt failed fixture-path
acceptance while still confirming owned stop. Subsequent implementation passes
moved the blocking ETW consumer onto a dedicated thread, used event QPC for the
ingress-loss boundary, woke the mapper on queue arrival and limited unresolved-path
output to ten diagnostic samples per second. Known selected paths are unsampled.
The final implementation also separates the mapper from native queries and writes
with a second bounded queue. No buffer-default increase was used.

The final [evidence aggregate](../recon/evidence/etw-file-home-26200-backend.json)
retains 20 canonical LF source hashes, three normal-token process cases, the final
live report and all four earlier live attempts. Final normal/live C# binary hashes
match. The final live run passed a fixture path/header PID Read candidate, actual
256 × 64 KiB buffers, final stop query 0, three native loss counters 0 and broker/
collector exit 0. No helper processes remained. These are new file-backend binaries,
not recycled B1 or empty-session evidence.

**Transport is still degraded:** application queues dropped 12,061 of 88,772 delivered events;
76,418 were deliberately filtered, decoder errors and ring evictions were zero.
The sample limiter contributes to filtering, not overflow. These runs had different
ambient workloads and are not a controlled performance comparison. Native zero
loss does not erase application drops. Optimizing/validating burst handling under
sustained machine-wide traffic remains an E3 gate; no production readiness claim.
Sleep/wake remains explicitly deferred. The successful smoke does not close E4/E5
event-time identity or the independent cleanup/recovery and deployment gates.

## API basis

The [2026-09-11 burst follow-up](etw-burst-handling.md) moves process probes and
JSON serialization off the mapper. Controlled blocked-probe and byte/loss tests
pass. Its subsequent live check recorded 6,674 application drops among 463,125
delivered events with zero native losses and verified stop. Ambient workloads
differ, so these runs do not establish a controlled performance improvement.

The collector owns the session it successfully starts and stops by its original
handle. Provider filtering follows Microsoft's [EnableTraceEx2 parameters](https://learn.microsoft.com/en-us/windows/win32/api/evntrace/ns-evntrace-enable_trace_parameters)
and [ETW session configuration](https://learn.microsoft.com/en-us/windows/win32/etw/configuring-and-starting-an-event-tracing-session).
The realtime source and raw QPC handling use the installed TraceEvent 3.2.6 API;
[Microsoft's source](https://github.com/microsoft/perfview/blob/main/src/TraceEvent/ETWTraceEventSource.cs)
explains why realtime loss is queried from the controller rather than inferred
from the consumer's initial trace header.
