# B5 follow-up — output drop causes and frame encoding

This records the v3 step. The [service-timing follow-up](etw-service-timings.md)
extends the current protocol to v4; the evidence below remains a v3 measurement.

Implemented on `codex/etw-output-drain` from `93aae23`, following the fixed
66,000-read baseline that recorded 49,406 output-stage drops. E3 remains open.

## Counter contract

This step introduced `etw-file/3`. Main and helper require canonical
uint64 `outputOverflowDropped` and `outputInvalidatedDropped` in every telemetry
sample. Older versions are rejected; missing measurements never become zero.

| Counter | Meaning |
| --- | --- |
| `outputOverflowDropped` | Candidate rejected by the output record or byte cap. |
| `outputInvalidatedDropped` | Candidate discarded after an epoch change before enqueue, queued candidates cleared by invalidation, or an in-flight process observation discarded after invalidation. |
| `outputDropped` | Exactly the sum of those two causes in this snapshot. |
| `dropped` | Exactly `ingressDropped + outputDropped` in this snapshot. |

Invalidation takes precedence when a candidate is both stale and over capacity;
one record contributes to one cause. The snapshot is taken under the same lock.
JS rejects malformed or inconsistent sums using BigInt and retains independent
cause maxima and sticky flags in ended summaries. Maxima need not sum after a
counter regression; received snapshots must. Only native EventsLost contributes
to the health `lossCount`. Decoder errors, filtering and main-ring eviction stay
separate. Coverage remains `home-26200-diagnostic-v1`, with candidate identity only.

## Encoding change

The former pump serialized each record to measure its size, serialized the list
into a JsonElement, then serialized the envelope. `FileWire.WriteObservations`
now serializes records directly into the final UTF-8 envelope. Actual encoded
bytes determine the batch boundary, including separators. It starts at most
128 records and stops starting another after reaching the 32 KiB target; one
large final record may exceed that target. The complete frame is limited to
256 KiB before any bytes reach the stream.

The frame buffer starts at 64 KiB. Utf8JsonWriter can request conservative space
larger than actual encoded output for UTF-16 strings: the maximal escaped-path
test required a 588,642-byte reservation with 673 bytes already committed.
Capacity is therefore capped separately at 768 KiB, while committed JSON is
still capped at 256 KiB. A too-large internal record cannot bypass either bound.
Empty polls allocate no frame and consume no sequence number. Failed encoding
also consumes no sequence. Cancellation is checked before taking records and
between records; existing pipe deadlines, heartbeat cadence, controls, queue
limits, process-probe budget and stop/drain ownership remain unchanged.

A warmed, same-process allocation test reconstructs the previous batch encoder
and compares 30 batches of the same synthetic records. Allocated bytes were
4,301,280 for the previous path and 1,983,120 for the new path (about 54% lower).
This measures managed allocation during batch formation, not whole-pipeline
latency or sustainable throughput. The broker still parses and forwards frames;
the JS decoder and bounded main ring still process every delivered record.

## Live evidence

The [aggregate](../recon/evidence/etw-file-home-26200-output-drain.json) preserves
three original reports (normal process, deliberate saturation, live load), their
hashes, matching binary hashes and the checked source hashes. The workload modules
and `repeated-read-4k-v1` profile match the previous baseline. One UAC session on
Windows 11 Home 25H2 / 26200.8655 completed all 66,000 reads in 20.005 seconds.

| Entire live session | Result |
| --- | ---: |
| Delivered / filtered | 290,598 / 224,580 |
| Ingress drops | 0 |
| Output overflow / invalidation drops | 51,648 / 0 |
| Native event / realtime-buffer / log-buffer loss | 0 / 0 / 0 |
| Decoder errors / map conflicts / map resets | 0 / 0 / 6 |
| Main diagnostic ring evictions | 14,113 |
| Scoped fixture Read/header-PID candidate | Observed |
| Out-of-root path or non-null agent/instanceId in checked records | None observed |
| Owned stop / child exit / remaining EtwFile processes | Verified / 0 / 0 |

Paced rates were 801.31, 799.26 and 805.64 reads/s. Burst rates were 108,452.22,
281,552.93 and 156,763.52 reads/s. Background delivery and burst timings differ
from the previous run, so 51,648 versus 49,406 drops does not establish a causal
throughput change. The measured allocation reduction has not eliminated overflow.
Counters cover the whole session, including ambient activity and settling; they
cannot be assigned to individual phases or treated as a logical-read denominator.

The new evidence distinguishes overflow from invalidation in this run. It does
not distinguish serialization time from pipe/broker/main backpressure or the
effect of idle polling. Next instrument those service/wait intervals and retained
queue depths before selecting another throughput change. Main ring eviction is
a separate retention limit. Event-time identity, independent absence witnessing,
protected crash recovery, sleep/wake and installed-app replacement remain open.

## Verification

35 C# self-tests and 141 focused JS tests passed. Coverage includes queued and
in-flight invalidation, overflow, exact cause sums beyond JS integer precision,
regression/failure retention, old-peer rejection, full record/witness round trips,
large escaped paths, frame bounds, ordering, cancellation and empty polling.
C# Release build and formatter passed. Normal and saturation process checks
passed three scenarios each; deliberate saturation retained 4,097 ingress and
6,270 output overflow drops, zero output invalidation, and unverified EOF remained
unverified. The authorized live test used the same binaries as those checks.

Full JS coverage passed 199 files / 3,334 tests with four skips (`--maxWorkers=2`).
Renderer build, format/lint (zero errors), TypeScript/Svelte, witness/sequence
gates, derived counts and production dependency audit passed.
