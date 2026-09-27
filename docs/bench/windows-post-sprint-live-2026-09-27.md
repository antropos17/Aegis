# Windows live observation after sprint optimizations — 2026-09-27

A 30-minute development run of `f19c2f03f10a671315d4552a457644035e303d1d`
completed through the normal Electron lifecycle. The first 90 seconds are startup;
the remaining 28.50 minutes contain 171 completed process cycles. The runner
returned zero and the final report has `complete: true`. All 309 recorded source,
harness and renderer fingerprints and three measured native binary hashes matched
after exit. The adjacent JSON contains numeric aggregates and receipt hashes.

The renderer and Windows helpers were rebuilt before running
`node bench/cycle-profile/run.cjs <new-absolute-output-directory> 1800`.
The harness used a separate profile, a minimized window and the normal observation
schedule, with native process snapshot selection set to `auto`. No ETW opt-in or
UAC request was made. All 174 process snapshots reported the `class5` source.
This measures a development checkout under the machine's live workload; it does
not characterize the user's packaged installation or foreground interaction.

## Recorded process observations

| Measure | September 15 observation | September 27 observation |
| --- | ---: | ---: |
| Steady observation window | 47.01 min | 28.50 min |
| Recorded steady `tasklist` launches | 70 | 0 |
| `tasklist` launches per steady minute | 1.49 | 0 |
| Process-scan calls | 282 | 171 |
| Process-scan median | 11.50 ms | 8.50 ms |
| Process-scan p95 | 14.83 ms | 12.25 ms |
| Process-scan failures | 0 | 0 |

The comparator is `windows-observer-final-2026-09-15.json`. It was interrupted
and remains `complete: false`; it is an observational reference. Both launch
counts sum every `steady:child:tasklist:` bucket, including attributed fallbacks.
The current run recorded no such launch. This is consistent with #689 reusing
the current named process map, but the harness does not separately time the IDE
detector. Its missing or unreliable-map fallbacks were not exercised by this
live window. Machine load, code and observation dates differ, so the scan latency
and resource figures do not establish a controlled application speedup.

The complete process cycle had a 12 ms median and 359 ms p95. This includes work
beyond `scanProcesses`; it must not be compared with the historical scan-stage
median. Periodic CWD enrichment is visible in the longer cycles.

## Resources and remaining costs

Steady main-process RSS ranged from 184.40 to 203.26 MiB. Its first and last
ten-minute medians were 188.96 and 200.89 MiB; heap medians were 14.26 and
14.63 MiB. Electron working-set sum medians were 466.56 and 486.41 MiB.
These observations do not prove absence of a memory leak. Working-set sums can
count shared pages more than once.

Main CPU averaged 0.85% of one core; the measured Electron process group averaged
3.46%. Only intervals wholly after startup enter these CPU aggregates. External
PowerShell, WSL and native helper CPU is excluded, and process-group membership
changes can leave unobserved CPU time. The historical CPU aggregates retained in
the JSON have not been recalculated with this interval rule; no CPU reduction is
attributed to the sprint from this comparison. Sampled event-loop maximum delay
peaked at 44.86 ms with the harness's 20 ms sampling resolution.

Full file-holder observation remained the longest measured stage: median
2,259.05 ms, p95 2,504.61 ms over 57 calls. Hot holders were 235.66 ms median;
the asynchronous resource query was 581.12 ms median. Stage durations overlap
and must not be added to infer cycle time or CPU use. This capture does not
establish brief file-read recall, active model throughput or ETW performance.

No failure observation, IPC eviction or audit drop was recorded. IPC's retained
high-water count was 12. Audit buffering reached 48 in sampled counters and was
zero in the final sample. Sequence state stayed empty; this workload does not
stress sequence capacity. The final sample does not independently verify the
persistence of every audit record.

## Storage and receipt limits

Verification output was kept outside Git on the data drive. The observed output
size at the largest storage check was about 10.6 MiB; after normal database
shutdown it occupied about 7.3 MiB.
The capture's TEMP directory contained no files after exit. Free-space checks
showed no uncontrolled growth. The private profile, normal logs and databases
remain local because they may contain paths and agent metadata. No automatic
retention enforcement is claimed; the harness's operator-managed TEMP policy is
documented in `bench/cycle-profile/README.md`.

For the numeric summary, point-in-time RSS and heap samples are selected by their
timestamp after startup. CPU and event-loop interval samples must start after
startup. Medians average the two middle values for even sample counts; p95 uses
nearest rank. Stage samples were not truncated. The raw numeric report and source
manifest remain available privately under the hashes in the adjacent receipt.
