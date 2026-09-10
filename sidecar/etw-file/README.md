# Diagnostic Kernel-File backend

Development opt-in only. This is the first connected file producer, distinct from
the frozen `etw-probe` measurements and the empty-session `etw-lifecycle` harness.
It does not emit FileEvents, identify agents, update risk/baselines/sequences, or
persist paths. Packaged AEGIS refuses enablement until deployment and lifecycle
gates are closed. No installer, service or default production buffer budget changes.

Build on Windows x64 with .NET 10:

```powershell
dotnet build sidecar/etw-file/EtwFile.csproj -c Release
& sidecar/etw-file/bin/Release/net10.0-windows/EtwFile.exe self-test
node scripts/verify-etw-file.mjs --report=X:/tmp/etw-file-check-new.json
node scripts/verify-etw-file.mjs --loss-check --report=X:/tmp/etw-file-loss-new.json
```

The default process check launches only normal-token processes. File observations
are injected fixtures, native loss counters stay null. It exercises the actual
C# broker/collector, framed JS decoder and supervisor, two clean sessions with
different IDs, then parent EOF with unverified stop and blocked retry. The report
retains build hashes and bounded session summaries, with no raw observations.
Choose a new report path on every run. Temporary fixture folders are retained.
`--loss-check` deliberately saturates the raw and outbound queues in fixed
normal-token fixtures, requiring nonzero split losses in the final report. It
cannot be combined with `--live` and never requests UAC or ETW.

The matching main/helper now require `etw-file/2`. Each telemetry sample includes
`ingressDropped` and `outputDropped` uint64 strings whose sum is exactly `dropped`.
Version 1 peers are rejected; rebuild the helper together with the main reader.

For a separately agreed live check, run the following from normal PowerShell and
approve **one** UAC prompt. The ordinary Node process reads its own temporary test
file for ten seconds; only the collector elevates. This never sleeps the computer.

```powershell
node scripts/verify-etw-file.mjs --live --report=X:/tmp/etw-file-live-new.json
```

Live acceptance requires a Read candidate matching the fixture path and the normal
workload's header PID, no outgoing path outside the selected root, known final zero
native loss counters, valid stopped acknowledgement and broker/collector exit 0.
This is a smoke test, not proof of event-time issuer semantics or complete read coverage.
Failed checks still request stop and retain final summaries. No elevated kill or
orphan cleanup is attempted. Real sleep/wake remains deferred by the user.

The repeatable load check also requests one UAC prompt and uses the same collector:

```powershell
node scripts/verify-etw-file.mjs --live --load-check --report=X:/tmp/etw-file-load-new.json
```

Its normal-token worker performs three fixed cycles of 2,000 paced and 20,000 burst
reads, with one file handle per phase and two seconds of settling after each phase.
All 66,000 reads target offset zero of the same disposable 4 KiB file; the report
records actual rates. `passed` certifies completion, observation checks, measured
final native counters and verified stop; positive losses are retained and allowed
in this overload measurement. It does not certify loss-free capture. See the
[repeatable-load record](../../docs/roadmap/etw-repeatable-load.md) for results and limits.

After building the renderer, explicitly enable a development app session with a
single local subdirectory (not an entire drive, UNC root, dot-segment or relative path):

```powershell
node scripts/launch.js '--etw-file-diagnostic-root=X:\tmp\my-fixture'
```

Without this flag no broker is spawned and the `etw-file` leaf is DISABLED.
Only health enters the existing app-health payload; diagnostic observations remain
in the main-process runtime's bounded `getDiagnostics()` ring. No renderer IPC was
added. Pause, suspend and quit request stop and erase the ring. Resume/unpause never
automatically prompt for UAC. The internal runtime supports explicit restart after
verified stop and child exit; a new app invocation is currently the user-facing
way to start another capture. The separately owned frontend is unchanged.

## Boundaries and accounting

- Normal broker and elevated collector reuse the lifecycle harness's restricted
  local pipe ACL and mutual PID/full FILETIME/image/user/logon/elevation checks.
  The collector authorizes capture only after a valid start command. Consent is
  bounded by a 120-second pipe deadline; this does not dismiss an OS UAC dialog.
  Mutable development binaries are trusted. Protected installation/signatures,
  alternate credentials and other-logon clients are still E1 gates.
- The collector uses fixed `AEGIS-EtwFileDiagnostic`, StartTrace success grants
  handle-based ownership, and occupied names fail. Kernel-File IDs 10/12/13/14/15,
  mask 0x1B0, requested 256 buffers of 64 KiB. The application cannot select other
  providers, commands, output files or session names. Actual buffers are reported.
- The callback only decodes the known schema pairs and enqueues copied input.
  Ingress is capped at 4,096 entries and 4 MiB including retained string estimates.
  A gap discards buffered inputs with counted loss and invalidates the map epoch.
  A dedicated mapper drains ingress independently of pipe writes and native counter
  queries. Process-generation queries and JSON serialization also run on the single
  output reader, outside the mapper lock. Its outbound queue is separately capped
  at 4,096 entries / 4 MiB; retained records use a 2,048-byte allowance plus UTF-16
  path storage, without serializing to count bytes. Overflow
  there counts loss without blocking raw mapping. `ingressDropped` includes raw
  overflow and buffered discard at gaps; `outputDropped` includes outbound overflow
  and queued/in-flight invalidation. Decoder errors, deliberate filtering and main
  ring eviction have separate counters. The writer retains one bounded
  batch, with at most 128 records and a 256 KiB wire limit. The v1 telemetry queue
  fields report maxima across the two separately capped stages, not their sum.
  Broker readers/writers retain one frame per direction, writes expire after five
  seconds. Heartbeats run between bounded batches; controls have a separate task
  and a ten-second lease. The JS writer retains at most one outstanding control
  frame plus one pending stop, not a promise per input event.
- Naming maps are capped at 32,768 entries / 8 MiB with retained-string accounting.
  Only earlier names yield candidates. TTL is 30 seconds of event QPC; it bounds
  reuse of evidence, not a correctness claim. Unknown/preopened paths stay null;
  later names do not backfill reads. Rebind conflict, object/key disagreement,
  Cleanup/Close, out-of-order events, query failure, observed loss, decoding or
  ingress loss reset the whole map epoch. Close/cleanup with both pointers known
  and neither present in the maps can be ignored; a matching or incomplete close
  resets the epoch. This conservative lifecycle strategy
  may leave many reads unresolved under machine-wide churn.
- Roots are lexical retention boundaries. Only selected paths are emitted, raw
  object/key addresses never leave the collector. Root selection does not establish
  reparse target identity or reduce machine-wide kernel cost. No file contents,
  command lines, environment values or API keys are collected.
  Reads with unresolved paths are sampled at up to ten per second of receipt time;
  omitted samples contribute to `filtered`, separately from overflow `dropped`.
  This sample is not an activity count. Selected-path candidates are not sampled.
- Header PID and issuing TID remain candidates. At most 100 fresh limited-query
  process handle probes per second retain full creation FILETIME and the actual
  QPC observation interval, without caching birth time. Probes happen when output
  is consumed; queued or dropped records do not trigger a probe. A native/ingress
  loss invalidation during a probe discards and counts the in-flight record too.
  This later observation
  cannot prove the earlier event issuer; agent and instanceId remain null.
- Main retains at most 256 diagnostic records / 1 MiB including UTF-16 storage
  estimates. Eviction has its own counter. Stop/failure clears this ring. At most
  32 ended summaries retain reasons, loss maxima, ready clock/buffers, final sampled
  counters and stop reason; an omitted-summary count records older eviction.
  EOF is not a stop acknowledgement. Stop timeout, wrong request IDs, stale frames
  and failed process exit cannot certify cleanup. Failure never auto-relaunches.

## Current evidence and limits

See [backend implementation record](../../docs/roadmap/etw-file-backend.md).
The local C# build/formatter, self-tests and process checks are separate from the
repository's five CI contexts, which do not build this new .NET project.
The initial provider's narrow live smoke passed, including a scoped Read/header-PID
candidate and owned stop. Its application queues dropped 12,061 of 88,772 events despite
zero native ETW losses; this is a degraded diagnostic backend, not loss-free capture.
The aggregate retains all earlier attempts, including the failed first one. Independent
absence witnessing and protected collector-crash recovery remain unfinished.
Warm mmap, Fast I/O and the remaining B1/E4–E8 coverage questions remain open.

The 2026-09-11 [burst-handling follow-up](../../docs/roadmap/etw-burst-handling.md)
removes process probes and serialization from the ingress drain. Its controlled
regression passes 8,192 further reads while a probe is held, with no ingress loss
and counted outbound overflow. A subsequently authorized live check observed a
scoped fixture Read/header-PID candidate and verified stop on matching binaries:
6,674 application drops among 463,125 delivered events, zero native losses, decoder
errors or ring eviction. Both reports and source hashes are retained in the
[live evidence](../../docs/recon/evidence/etw-file-home-26200-burst-live.json).
Different ambient traffic prevents a controlled before/after comparison. E3 remains
open. Those historical v1 reports combine ingress and outbound drops.

The [stage-counter follow-up](../../docs/roadmap/etw-stage-loss.md) implements v2
split accounting and verifies nonzero totals through the actual normal processes.
Its live check delivered 57,927 events with zero ingress/output/native losses,
but 11 evictions from the bounded main diagnostic ring. The lower ambient load
does not establish loss-free burst capture. Reports and 20 source hashes are in
the [stage evidence](../../docs/recon/evidence/etw-file-home-26200-stage-loss.json).
