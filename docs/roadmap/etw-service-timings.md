# B5 follow-up — collector and main service measurements

This records the first v4 timing run. The [output-wakeup follow-up](etw-output-wakeup.md)
replaces the measured 10 ms polling delay with a signal/deadline wait. Its idle
duration retains the same field but measures the updated waiting behavior.

Implemented on `codex/etw-service-timings` from `4006268` (merged #432). The
diagnostic protocol is v4. This step measures existing behavior; output overflow
and E3 remain open. Main/helper v1–3 are rejected rather than given invented zeros.

## Measurement boundaries

Collector counters have one serial writer. Every completed call records `calls`,
`totalTicks`, `maxTicks`, `failed` as canonical uint64 strings. `frequency` converts
ticks to seconds; `asOfQpc` dates the snapshot. Failed/cancelled calls count, but a
failed transport may prevent the last snapshot from reaching main. An ended
summary then retains the last received sample, not an inferred final measurement.

| Collector group | Elapsed interval |
| --- | --- |
| `pump` | Entire observation pump: dequeue, fresh process observation, encoding, pipe write; includes empty polls. |
| `outputWrite` | Nested header/body writes and flush for observation frames only. |
| `idleWait` | Actual elapsed `Task.Delay(10)` after an empty pump; includes scheduler delay. |

Pump minus output-write time includes all non-write pump work, not just encoding.
Control/heartbeat writes, mapper CPU and broker parsing/forwarding are outside
these intervals. Pipe write completion does not acknowledge main processing.
Telemetry is sampled between completed pump calls; the stopped frame itself is
outside its embedded sample. Both stage queue snapshots retain current/high-water
record counts and bytes, each capped at 4,096 records / 4 MiB. High water is not
the time spent at capacity. The existing combined fields remain per-field maxima.

Main uses an independent monotonic nanosecond clock and constant-space counters:

| Main group | Elapsed interval |
| --- | --- |
| `decodeChunk` | Synchronous framed parsing, validation and callbacks for one stdout chunk. |
| `acceptFrame` | Nested session reducer and accepted-frame handling. |
| `retainBatch` | Nested copying, accounting and eviction in the diagnostic ring. |
| `snapshot` | Separate `getDiagnostics()` copies, including the harness's polling overhead. |

These are wall durations, not CPU usage. Nested groups and different processes
must not be added. Main does not measure event-loop queue delay before the callback.
Snapshot counters cover launch through broker close, including polls during UAC;
the snapshot being constructed appears only in subsequent completed measurements.
Final summaries freeze completed main calls at broker close. Session restart resets
current metrics; prior summaries remain detached. Missing collector telemetry is
null. Raw observations and exceptions are absent from the metrics/report.

The ring extraction preserves 256 records / 1 MiB, copied snapshots, eviction
counts and clearing on stop/failure. The existing 32-summary bound remains. No
timing IPC, agent attribution, FileEvent admission or automatic restart is added.

## Live evidence

The [aggregate](../recon/evidence/etw-file-home-26200-service-timings.json) retains
three original normal/saturation/live reports with their hashes and 26 measured
source hashes. Two subsequent lint-comment lines have a separate final hash;
removing those comments reproduces the measured source. Normal and saturation
checks used the same binaries as the live run.
The workload modules and `repeated-read-4k-v1` profile match #432. One authorized
UAC session on Windows 11 Home 25H2 / 26200.8655 completed all 66,000 reads in
19.738 seconds (270,336,000 logical bytes).

| Whole live session | Result |
| --- | ---: |
| Delivered / filtered | 117,946 / 51,927 |
| Output overflow / invalidation | 52,066 / 0 |
| Ingress / native event / realtime-buffer / log-buffer loss | 0 / 0 / 0 / 0 |
| Decoder errors / map conflicts / map resets | 0 / 0 / 6 |
| Main ring evictions | 11,775 |
| Ingress high water | 831 records / 262,755 bytes |
| Output high water | 1,922 records / 4,193,804 bytes |
| Fixture Read/header-PID candidate | Observed |
| Out-of-root path or non-null agent/instanceId in checked records | None observed |
| Owned stop / child exit / remaining EtwFile processes | Verified / 0 / 0 |

| Completed elapsed measurements | Calls | Total ms | Maximum ms |
| --- | ---: | ---: | ---: |
| Collector pump, including writes | 1,476 | 173.667 | 16.148 |
| Collector output writes, nested | 211 | 124.442 | 2.807 |
| Collector empty-pump delay | 1,264 | 19,702.462 | 24.365 |
| Main chunk handling, including callbacks | 167 | 161.116 | 2.964 |
| Main accepted frames, nested | 223 | 98.002 | 1.353 |
| Main retained batches, nested | 183 | 60.599 | 0.773 |
| Main diagnostic snapshots, separate | 2,559 | 687.099 | 2.835 |

All timing failure counters are zero. Non-write collector pump work totals
49.225 ms. Mean empty-pump delay is 15.587 ms. Paced rates were 799.95, 800.18 and
803.28 reads/s; bursts ran at 334,711.79, 324,012.05 and 349,190.66 reads/s in
57–62 ms. Whole-session counters include ambient activity and settling; neither
losses nor timings can be attributed to individual phases or divided by logical
reads to claim coverage. The earlier run had different background traffic and
burst rates, so these results do not establish a throughput improvement/regression.

The output queue reached its byte cap while measured write and main callback
intervals were short. The next bounded experiment is an output-available signal
that wakes the empty pump, with cancellation and drain semantics preserved, then
the same live profile. The large idle total includes the workload's deliberate
pauses and is not proof that polling caused overflow. Phase-local occupancy,
wake latency and broker-specific timing remain unmeasured; compare evidence
before adopting a throughput claim or increasing buffers.

Event-time agent identity and safe path admission (E4/E5), independent session
absence evidence, protected crash recovery and deployment remain open. Sleep/wake
is still deferred. The installed app was not replaced.

## Verification

39 C# self-tests and 161 focused JS tests passed, including nested durations,
failed writes, detached counters, stage high-water retention, protocol rejection,
uint64 precision and final-summary/reset behavior. Normal and deliberate-saturation
process checks passed three scenarios each; missing EOF acknowledgement remained
unverified. C# Release build and formatter passed. Full JS coverage passed 200
files / 3,354 tests with four skips. Renderer build, format/lint, TypeScript/Svelte,
witness/sequence gates, derived counts and the production dependency audit passed.
The PR retains the CI result; live reports preserve the measured source revision.
