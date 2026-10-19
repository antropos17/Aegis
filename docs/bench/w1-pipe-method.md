# W1-pipe load qualification method

`scripts/verify-event-pipeline.mjs` measures the production `createSecurityBatcher`
export from `src/main/ipc-batcher.js` with synthetic metadata and a synchronous
acknowledging consumer. It opens no watched credential files, starts no native
sensor, and does not qualify the Electron renderer or the real audit consumer.
The runtime's focused tests separately cover restart, full-disk, corruption,
loss-marker and integration behavior.

Run with the repository's supported Node 24 runtime and an existing disposable
output parent on a data drive with at least 128 MiB free:

```sh
node scripts/verify-event-pipeline.mjs --output-dir /path/to/task-output
```

`--source-root /path/to/checkout` selects another checkout's production modules.
The receipt records its Git HEAD and SHA-256 hashes of every loaded application
module, `package.json`, `package-lock.json`, the harness and its oracle. Hashes must remain unchanged
through the run; HEAD alone does not establish the tested inputs while a change
is uncommitted. Keep the receipt with the tested revision. `--smoke`
runs 40,000 events over two seconds and labels the result **smoke-not-acceptance**.

## Workloads and scheduling

The acceptance command runs these workloads sequentially:

| Workload | Requested rate | Duration | Total offered | Consumer refusal interval |
| --- | ---: | ---: | ---: | --- |
| Burst | 20,000/s | 30 seconds | 600,000 | 1.0–1.6 seconds |
| Sustained | 2,000/s | 5 seconds | 10,000 | 1.0–3.0 seconds |

A monotonic clock schedules 10 ms batches. Catch-up is limited to two batches'
worth of events per turn (400 or 40), followed by a timer yield. No workload
events are skipped to hide lateness. The receipt includes actual duration and
rate, one-second offering counts, late and catch-up batch counts, maximum
lateness, maximum offered burst and skipped-event count. Passing requires the
full count, average offered rate at least 98% of the requested rate, and maximum
scheduler lateness at most 1,000 ms. This tolerance is explicit; the receipt's
measured rate is the supported claim. A two-second overrun aborts the workload.

Events rotate across the five fixed sensor buckets and four allowed security
event types. Each event has a unique synthetic PID, deterministic timestamp,
instance identity and fixture path. A controlled consumer refusal forces the
real spill implementation to write and fsync its normal files. After resumption,
the production interval timer and final flush must drain all acknowledged data.

## Independent oracle and bounds

The oracle consumes actual output records. It checks IDs against a packed bitmap
(75,000 bytes for 600,000 IDs), rejects duplicates and foreign IDs, enforces
global offering order across memory and disk, and independently recomputes
sensor, type, timestamp, instance identity and path. It does not accept producer
delivery counters as proof of delivery. The callback catches oracle failures
explicitly so a production consumer-exception handler cannot hide a failed
assertion as a temporary refusal.

Normal storage must deliver every offered event with zero loss markers, zero
declared losses and zero runtime loss counters. It must also produce nonzero
real disk bytes, pending spilled records and replayed output. A memory-only
implementation cannot pass. Once acknowledged, the directory must contain zero
files and zero bytes, and all memory and spill queues must be empty.

| Bound | Value | Observation |
| --- | ---: | --- |
| In-memory records per sensor | 512 | Current counters and retained high-water marks |
| Serialized queue bytes per sensor | 1 MiB | Current counters and retained high-water marks |
| Spill quota | 32 MiB | Independent filesystem enumeration plus production stats |
| Spill file count | 1,024 | Independent filesystem enumeration |
| Absolute V8 heap | 256 MiB | Sample at each offered batch |
| Heap growth from case start | 128 MiB | Sample at each offered batch |
| Full disk/stat sample interval | 250 ms | Monotonic elapsed time |
| Final drain deadline | 5 seconds | Real elapsed time |
| Receipt size | Less than 64 KiB | Checked before write |

Heap and disk peaks are sampled observations, so they do not claim every
transient allocation was observed. Queue high-water marks retain peaks between
samples. The configured heap thresholds bound this isolated fixture process;
they do not establish an application-wide Electron heap budget. Real disk quota
and corruption behavior are also checked in the focused runtime suite.

## Negative control and retention

Run the normal smoke first. In a separate owned source copy, replace the single
call that appends the full queue to the spill store with a fixed
`spill-write-failed` outcome; assert exactly one replacement. Run the unchanged
smoke harness on that copy and require failure. Preserve original and mutated
file hashes, the exact mutation, exit code and failing assertion with the
receipt. Restore or remove only the owned copy; never mutate the shared worktree
during another agent's review or test. The normal-storage oracle deliberately
rejects even exact loss accounting when durable storage should have succeeded.

Each invocation creates one uniquely named directory beneath the explicit output
parent. It writes one finite receipt and at most the configured spill quota per
case, without per-event input/output logs. A successful run leaves empty spill
directories. Retain verification receipts; manually review disposable closed
fixture files after seven days. Do not recursively clear another directory,
follow a reparse point or delete an open artifact. This is a retention procedure,
not an installed cleanup service.
