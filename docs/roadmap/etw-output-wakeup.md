# B5 follow-up — wake the output pump when records arrive

Implemented on `codex/etw-output-wakeup` from `3d88df4` (merged #433). The previous
timing run retained 52,066 output overflow drops while non-write pump work totaled
49.225 ms. Empty-pump waits averaged 15.587 ms. Those aggregates motivated this
experiment but did not establish polling as the cause of overflow.

## Behavior

`FilePipeline.OutputAvailable` exposes one notification task protected by the same
lock as the output queue. The first enqueue into an empty queue completes it with
asynchronous continuations. Taking the last record rearms it. Invalidation rearms
a completed notification after discarding output; invalidation of an already empty
queue preserves its pending task so existing waiters cannot be abandoned.

Enqueue before wait registration is visible as an already completed task; enqueue
after registration completes the task held by the waiter. A stale completed task
may cause a harmless recheck after invalidation. There is no counting semaphore
or per-record notification backlog. Copying, process queries and writer work stay
outside the mapper's queue lock. Existing record/byte caps, invalidation accounting,
fresh process-witness budget and frame limits are unchanged.

`FilePumpWait` waits for output, mapper completion, capture completion, operator
stop, cancellation or the next two-second heartbeat deadline. When another signal
wins, the losing deadline is cancelled. Mapper/capture failures reach the owner's
existing cleanup path. The running collector rechecks lifecycle state between
pumps and continues sending heartbeats even when no records arrive.

Draining waits only for output, mapper completion or its existing five-second
cancellation deadline. Already completed stop/capture tasks are excluded, avoiding
an empty-queue spin. The final output drain and owned native stop precede the
stopped acknowledgement as before. Parent EOF, lease expiry and failure do not
gain a clean-stop assertion. No elevated kill or automatic UAC retry is added.

The protocol remains `etw-file/4`; the build marker ends in `-wakeup`. `idleWait`
continues to measure elapsed empty-pump waiting, now a signal/deadline wait rather
than `Task.Delay(10)`. Its total includes deliberately quiet workload periods;
its mean and maximum no longer describe a fixed polling interval. Other timing
regions and counters retain their v4 meanings. Main, IPC, workload and buffer
budgets are unchanged. This remains an opt-in diagnostic collector.

## Verification and live evidence

49 C# self-tests passed, including ten new wakeup tests: notification before and
after registration, 1,000 drain/rearm cycles, invalidation, stop versus drain,
mapper cancellation, mapper/capture failures, cancelled waits, heartbeat timeout
and final buffered drain. Release build and formatter passed. Normal and deliberate
saturation process checks passed three scenarios each on matching binaries.

The [aggregate](../recon/evidence/etw-file-home-26200-output-wakeup.json) preserves
three original reports, matching binary hashes and 28 source hashes. One authorized
live UAC session on Windows 11 Home 25H2 / 26200.8655 completed the unchanged
`repeated-read-4k-v1` workload: all 66,000 reads / 270,336,000 logical bytes in
19.800 seconds. No builds/tests were running concurrently with the live capture.

| Whole live session | Result |
| --- | ---: |
| Delivered / filtered | 111,722 / 45,703 |
| Output overflow / invalidation | 50,246 / 0 |
| Ingress / native event / realtime-buffer / log-buffer loss | 0 / 0 / 0 / 0 |
| Decoder errors / map conflicts / map resets | 0 / 0 / 6 |
| Main ring evictions | 15,516 |
| Ingress high water | 1,095 records / 351,624 bytes |
| Output high water | 1,922 records / 4,193,804 bytes |
| Scoped fixture Read/header-PID candidate | Observed |
| Out-of-root path or non-null agent/instanceId in checked records | None observed |
| Owned stop / child exit / remaining EtwFile processes | Verified / 0 / 0 |

| Completed elapsed measurements | Calls | Total ms | Maximum ms |
| --- | ---: | ---: | ---: |
| Collector pump, including writes | 298 | 340.821 | 18.374 |
| Collector output writes, nested | 257 | 263.684 | 6.656 |
| Collector empty-pump signal/deadline wait | 40 | 19,589.352 | 1,983.918 |
| Main chunk handling, including callbacks | 188 | 307.434 | 7.144 |
| Main accepted frames, nested | 269 | 203.724 | 2.749 |
| Main retained batches, nested | 256 | 141.158 | 2.535 |
| Main diagnostic snapshots, separate | 717 | 781.802 | 3.059 |

All measured failure counters are zero. Pump work outside writes totals 77.137 ms.
Empty waits fell from 1,264 in the preceding run to 40; their longer durations
reflect sleeping until a signal/deadline rather than recurring polling. The
maximum is below the two-second heartbeat interval in this run. This verifies
the waiting behavior; it does not establish that wake latency is negligible.

Overflow remains: 50,246 versus the preceding 52,066. Paced rates were 798.81,
804.77 and 802.62 reads/s; burst rates were 192,035.33, 354,240.61 and 300,847.79
reads/s. Actual burst timings and ambient delivery differ. Whole-session counts
include ambient activity and settling, so no causal throughput gain or complete
logical-read coverage is claimed. Ring eviction is a separate retention limit.

Full JS coverage passed 200 files / 3,354 tests with four skips. Renderer build,
format/lint, TypeScript/Svelte, witness and sequence mutation gates, derived counts
and the production dependency audit passed. Missing EOF acknowledgement remained
unverified in the process checks.

## Remaining work

E3 is still open. The next measurement should resolve arrival/drain rates and
queue occupancy over short burst intervals, with output-ready-to-resume latency
and broker forwarding time separated from main callbacks. Whole-session totals
are insufficient to select the next throughput change; the queue still reaches
its byte cap after removing polling. Keep the same workload and bounded storage
when adding those observations, and do not increase buffers on this evidence alone.

E4/E5 event-time identity and safe path admission, independent session absence,
protected crash recovery and deployment remain open. Sleep/wake remains deferred;
the installed app was not replaced.
