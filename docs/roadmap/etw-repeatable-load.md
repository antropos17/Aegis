# B5 follow-up — repeatable ETW file load

Implemented on `codex/etw-repeatable-load` from `0f40a6d`. The C# collector,
protocol v2, supervisor, queue limits and production enablement are unchanged.
The verifier gains `--live --load-check`; `--load-check` alone and mixing live
capture with synthetic `--loss-check` are rejected before launching a broker.

## Fixed workload

`scripts/etw-file-workload.mjs` defines profile `repeated-read-4k-v1`. A single
normal-token Node worker thread opens the disposable fixture after capture is
ready, once per phase, then repeatedly reads its first 4,096 bytes into a reusable
buffer and verifies its fixed contents. All workload reads target this fixture.
There is no cache flush or direct-I/O request; these are logical reads, commonly
served from cache, not measurements of disk bandwidth.

Each of three cycles contains 2,000 paced reads (25 per batch, target 1,000/s),
then 20,000 unpaced reads. Each phase closes its handle and waits two seconds,
including after the last burst. Pacing waits until each deadline and never
catches up missed batches. The report retains durations, achieved rates and
maximum batch-start lateness instead of claiming that the target rate was met.
Total volume is 66,000 reads / 270,336,000 logical bytes through a 4 KiB fixture.

The worker has a 90-second parent deadline and is terminated on failure; it does
not run on the supervisor event loop. The parent continues checking capture and
the bounded diagnostic ring every 25 ms. Only six phase results are retained;
partial results survive failure. The report contains aggregate metrics and final
session summaries, with no fixture paths, contents or raw observations. The
existing collector stop/EOF cleanup path is reused on all outcomes.

```powershell
dotnet build sidecar/etw-file/EtwFile.csproj -c Release
node scripts/verify-etw-file.mjs --live --load-check --report=X:/tmp/etw-load-new.json
```

Run from normal PowerShell and approve one UAC prompt. Only the collector elevates.
Use a new report path. `passed` means the finite workload, scoped Read/header-PID
candidate check, exact stage sum, known final native query and owned stop completed.
Positive native/application losses are allowed and retained in this load mode;
the ordinary ten-second live smoke still requires zero native losses. Neither
mode establishes complete file-read coverage or event-time identity.

## Measured result — Windows 11 Home 25H2 / 26200.8655

The [evidence aggregate](../recon/evidence/etw-file-home-26200-repeatable-load.json)
preserves the original normal process check and live report, their hashes,
matching apphost/assembly hashes and the source hashes of this implementation.
The binaries also match the preceding stage-counter check. Node was v24.11.1.
This task launched no concurrent test/build jobs during the live workload; ordinary machine
activity remained present and uncontrolled.

| Cycle | Paced reads/s | Burst reads/s | Burst duration |
| --- | ---: | ---: | ---: |
| 1 | 802.32 | 219,748.10 | 91.01 ms |
| 2 | 803.96 | 174,925.63 | 114.33 ms |
| 3 | 805.52 | 175,482.62 | 113.97 ms |

All six phases completed their exact requested counts in 19.896 seconds including
settling and worker overhead. Paced batches started up to 11.64 ms late.

| Entire live session | Result |
| --- | ---: |
| Delivered / filtered | 956,985 / 890,960 |
| Ingress / output drops | 0 / 49,406 |
| Native event / realtime-buffer / log-buffer loss | 0 / 0 / 0 |
| Decoder errors / map conflicts / map resets | 0 / 0 / 6 |
| Main diagnostic ring evictions | 16,362 |
| Scoped fixture Read/header-PID candidate | Observed |
| Out-of-root path or non-null agent/instanceId in checked records | None observed |
| Owned stop / child exit / remaining EtwFile processes | Verified / 0 / 0 |

This reproduces application loss and locates it in the output stage for this run.
Output drops include queue overflow and invalidation; this measurement does not
separate those causes or attribute every drop to a workload phase. Counter totals
cover the whole session, including ambient events and settling. Logical reads and
delivered ETW events are not interchangeable denominators. Two-second settling is
a fixed workload pause, not a proof that every asynchronous event has arrived.
Main ring eviction is another, independent retention loss.

E3 remains open. Next measure and improve output draining/serialization with this
same profile, separating overflow from invalidation before assigning a cause.
Repeatable parameters do not make this one live run a statistically repeatable
result or a controlled comparison with earlier ambient smokes. Identity admission,
independent session-absence witnessing, protected crash recovery, sleep/wake and
installed-app replacement remain outside this measurement.

## Verification

The 13 workload/CLI tests cover complete fixed volume, parent responsiveness,
pacing, invalid bounds/modes, short reads with handle cleanup, worker failure,
sensor failure and omission of private error text/paths. Full JS coverage passed
199 files / 3,321 tests with four skips (`--maxWorkers=2`). Format, lint (zero
errors), renderer build, TypeScript/Svelte, witness/sequence gates, derived counts
and production dependency audit passed. The ordinary three-case process verifier
also passed on the same binaries. C# code is unchanged; the prior 28 self-tests
and matching apphost/assembly evidence remain applicable.
