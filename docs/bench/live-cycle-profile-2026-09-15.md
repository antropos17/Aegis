# Live monitoring cycle — 2026-09-15

Two three-minute Windows development runs used the real Electron application,
minimized fresh profiles, normal machine observations, no ETW opt-in and no UAC.
The first 90 seconds were excluded from the steady window. Production sources
were unchanged at `b42d4c08c2fe6ed497173cefad173f3f8d21a936`. This is a pair of
sequential diagnostic observations, not a controlled before/after optimization:
machine load and the observed agent population changed between runs.

Run A discovered a missing development snapshot binary and used CIM on all twelve
snapshots. `npm run build:sidecar` compiled the existing source with the inbox C#
compiler. Run B used `class5` on all twelve snapshots, with no CIM fallback. Both
exited normally and produced nine steady process ticks. The observed running
agent population was 19–20 in run A and 19 in run B. This fixes the diagnostic
checkout's build preparation; it does not
establish anything about the user's installed application's helper.

| Steady measurement | A: missing helper | B: built helper |
| --- | --- | --- |
| Process-cycle median | 2,153 ms | 19 ms |
| Process-cycle max / nearest-rank p95 (9 samples) | 4,705 ms | 1,700 ms |
| Process snapshot median | 2,143.26 ms | 11.26 ms |
| Main CPU, percent of one core | 4.54% | 3.35% |
| Electron group CPU, percent of one core | 9.50% | 8.18% |
| Peak main RSS in sampled window | 198.34 MiB | 192.05 MiB |
| Peak summed Electron working sets | 602.32 MiB | 587.73 MiB |
| Largest sampled main event-loop delay | 55.41 ms | 43.38 ms |

Run B's 1.7-second cycle coincided with the working-directory cache refresh:
one CIM request took 1,688.82 ms. The other eight process cycles took 13–23 ms.
The source retains its existing 60-second CWD cache and generation checks.

Remaining costs in run B's 90-second steady window:

| Stage | Completed calls | Median | PowerShell launches |
| --- | --- | --- | --- |
| CPU/RAM/GPU collection | 9 | 1,948.63 ms | 9 |
| Full file-handle observation | 3 | 4,306.62 ms | 3 |
| Hot file-holder observation | 9 | 1,693.09 ms | 6 |
| Network observation including DNS | 3 | 4,784.71 ms | 3 |
| Working-directory lookup | 1 | 1,688.82 ms | 1 |

There were 22 PowerShell launches in that window. CPU/RAM is the next bounded
optimization candidate because it contributes nine recurring launches. A future
change should compare an alternative collector against the current provider,
retaining measurement units, missing-value behavior, per-instance provenance and
single-flight semantics. File/network providers are also costly but need separate
coverage and freshness validation. No collection interval was increased here.

Limits: stage durations overlap and include waiting; they are not CPU costs.
CPU excludes external helpers. Working-set sums include shared pages. The window
is short and the renderer is minimized; fresh profiles have no mature historical
baselines. These figures do not characterize foreground interaction, long-session
memory growth, ETW loss or event recall. No speedup in total application CPU is
claimed from the two runs. Instrumentation overhead was not calibrated.

The [numeric summary](live-cycle-profile-2026-09-15.json) includes report/manifest
hashes, complete steady-stage aggregates, launch counts and process-tick values.
Original numeric reports and private run profiles remain outside the repository
on X:. The [harness instructions](../../bench/cycle-profile/README.md) describe
reproduction, instrumentation, privacy and storage limits.
