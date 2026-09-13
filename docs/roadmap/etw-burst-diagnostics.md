# B5 follow-up — bounded burst measurements

Implemented on `codex/etw-burst-diagnostics` from `ef5f39c` (merged #449).
The previous [live wakeup run](etw-output-wakeup.md) counted 50,246 output overflow
drops with zero ingress/native losses. Whole-session elapsed totals did not show
when arrival exceeded draining. This change supplies measurements for the next
controlled experiment; it does not claim a reduction in losses.

## Measurements

Matching main/helper builds require `etw-file/5`, with helper marker `-5-burst`.
Earlier protocol versions are rejected. Existing queue caps, output batching,
notification behavior, process-witness budget and loss classifications are unchanged.

`performance.outputFlow` is sampled under the existing output queue lock. Each
window spans at most `floor(frequency / 10)` QPC ticks, on that absolute clock grid.
It records successful `enqueued`, `dequeued`, rejected `overflow`, queued
`invalidated`, initial/current record counts and record/byte high water. Counts
remain canonical uint64 strings. Every window obeys:

```text
startRecords + enqueued = records + dequeued + invalidated
```

These are output-queue transitions after mapping/filtering, not kernel arrival or
logical read counts. A dequeued record can still be invalidated during its process
witness, fail encoding or fail transport. Such in-flight invalidations remain in
the existing total loss counter; the window's `invalidated` counts queued discard
only. Window `overflow` corresponds to `outputOverflowDropped`, but an evicted
history cannot reconstruct lifetime totals.

At most 256 windows are retained. A transition or snapshot in a later window adds
one entry; intervals with neither are omitted, including arbitrarily long quiet
gaps. `evictedWindows` counts removed entries. No per-event data or path is retained.
Snapshots are detached; the active window ends at `outputFlow.asOfQpc`, previous
ones at their boundary. A partial current window is not a complete 100 ms rate
sample. The first retained window may also begin before profiling started.
Instrumentation uses one clock read and constant work per queue transition;
history copying/serialization is bounded. Its overhead has not been measured live.

`outputFlow.readyToTake` measures from the first enqueue into an empty queue to
the first successful dequeue of that backlog. It excludes preceding quiet time
and is recorded once per empty-to-nonempty transition. Invalidation retires a
pending readiness timestamp without a successful timing sample. This is reader
response delay, including scheduling and any intervening collector work, rather
than a pure OS scheduler measurement. It does not measure the waiting time of
every queued record. `idleWait` keeps its earlier meaning, including quiet waits.

`performance.brokerForward` is added by the normal-token broker. Its `duration`
covers elapsed annotation, serialization and stdout header/body/flush work for
all outbound frame kinds, including failed attempts. It excludes reading and
decoding from the collector pipe, and includes downstream backpressure. The
sample's `asOfQpc` is captured before forwarding its carrying telemetry frame;
the duration covers only earlier completed forwards. Consequently final stopped
telemetry excludes its own forwarding duration. The collector supplies a null
placeholder, which the broker replaces; main rejects a missing/null broker sample.
No failure text or stream data is retained in these counters.

Collector `pump` and nested `outputWrite`, broker forwarding, and main callback
timings remain distinct elapsed regions. Do not sum them as CPU time. Ingress
depth/native loss counters remain separate; this change does not add ingress
arrival windows or isolate broker decoding cost.

## Verification and limits

The initial regression failed against the old output snapshot because readiness
delay and burst counts were absent. With the implementation, 54 C# self-tests
pass, including controlled clock boundaries, quiet time, backlog timing,
invalidation, a 256-entry ring with a long idle jump, snapshot isolation and broker
failure accounting. The existing saturation fixture also reconciles retained
window overflow/dequeue totals with actual pipeline loss and drained output.
JS tests reject malformed, missing, oversized and inconsistent profiles, reject
v4, and round-trip 256 windows with integers beyond Number precision under the
existing frame/depth bounds. The process harness requires measured forwarding,
readiness and window samples in each normal stopped summary.

The [retained evidence](../recon/evidence/etw-file-home-26200-burst-diagnostics.json)
contains the final normal/saturation process reports, matching executable and
assembly hashes and 32 source hashes. Each process report passed two clean stops
and one parent-EOF scenario with unverified stop/restart blocked. No EtwFile
processes remained after those runs. The first saturation session retained 1,922
enqueues/dequeues, 6,270 output overflows and 4,097 ingress drops. Windows show the
queue filling before draining begins, as the synthetic fixture deliberately
requires. These values validate instrumentation and loss accounting; they are
not a live-provider throughput measurement.

Required local checks passed: renderer build, format/lint, TypeScript/Svelte,
production dependency audit, derived counts and both four-mutant gates. Full
coverage passed 206 files / 3,398 tests with four skips using two workers. An
initial run alongside build/lint had 12 failures involving UI timeouts; the
isolated rerun preserved the same timeouts and assertions. The .NET build and
whitespace verification also passed. Repository CI does not build this sidecar.

Only normal-token synthetic/process checks are authorized for this iteration.
The user deferred a new real-provider/UAC load run. The historical 66,000-read
workload and earlier live reports remain unchanged. E3 stays open, as do event-time
identity, path admission, independent absence/protected crash recovery and
deployment. Sleep/wake and installer work remain deferred.
