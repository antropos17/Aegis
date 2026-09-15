# Final Windows observer optimization — 2026-09-15

The recurring file-holder, TCP and batch working-directory observations now use
one-shot `aegis-observer.exe` processes. They query the same Windows APIs as their
PowerShell fallbacks. The Restart Manager wrapper is compiled from the same source
used by Add-Type, avoiding compilation on every scan. CPU/RAM collection already
uses the resource helper from #464; TCP's direct CIM query from #465 is retained
as the fallback.

Six alternating pairs per mode ran on disposable loopback sockets and one child
holding a temporary file. The CWD fixture includes Unicode in the child's command
line. Each query checked its exact endpoint/state tuples, complete command line
or expected holder PID/group. All 36 checks matched; two absent-PID scopes were
empty and the holder disappeared after its process exited.

| Observation | PowerShell median | Native median |
| --- | ---: | ---: |
| TCP table | 1,722.06 ms | 478.66 ms |
| Batch command-line/CWD source | 1,378.42 ms | 301.27 ms |
| One held-file group | 1,556.52 ms | 353.76 ms |

These are elapsed times including process startup, not total application CPU
savings. The holder fixture covers one file/group; live full-scan cost depends on
the group population. The samples and source/binary hashes are in the adjacent
JSON record. Reproduce with `node bench/observer-compare.cjs` after
`npm run build:sidecar` on Windows. No external server, ETW opt-in or UAC is used.

The initial diagnostic uncovered PowerShell replacing a Cyrillic command-line
character with `?`. The fallback now emits UTF-8 explicitly for CWD and RM rows;
the successful comparison uses that correction on both sides. An earlier harness
revision also waited a second time for an already signal-terminated child; its
completed samples were discarded and its owned process stopped. The final
comparison exits normally and closes its own sockets and fixture files.

Transport bounds, fallback cooldown and startup rollback are documented in
`sidecar/observer/README.md`. Input paths use stdin and holder responses use group
indices. No watched file contents or OS error details are logged. Missing/failed
helpers retain the previous fallback behavior. In particular, Restart Manager
still observes handles held at the tick, may miss brief reads, and retains its
existing empty-on-native-error semantics. Collection intervals, attribution and
identity stamping are unchanged.

## Recorded live window and verification

The user ended the planned two-hour run early. Its last checkpoint covers
48.51 minutes (2,910,778.04 ms), including a 90-second startup window and 282
steady process ticks. Only the owned diagnostic Electron process tree was
terminated. The original report remains `complete:false`; the runner returned 1
because its duration/graceful-exit gate did not complete. The stop reason is
recorded separately. This is an interrupted observation window, not a completed
two-hour soak or a successful shutdown/flush test. All source fingerprints still
matched the running manifest when the summary was produced.

Steady medians: hot holders 272.77 ms (282 calls), full holders 2,449.53 ms
(94 calls), TCP 600.34 ms (116 calls), batch CWD source 433.11 ms (68 calls).
These stages recorded zero failures. No steady PowerShell launch was recorded;
the full RM scan still pays for its individual registration groups. Live load
differs from the one-group fixture, so these are not controlled before/after
application comparisons.

Main RSS median moved from 217.98 MiB in the first ten steady minutes to
232.45 MiB in the last ten (observed steady range 198.82–247.64 MiB). Heap medians
were 13.85 and 15.13 MiB. These measurements do not prove absence of a leak.
IPC eviction and audit-drop counters remained zero. Sampled IPC buffering peaked
at two; its retained high-water counter was 14. Audit buffering peaked at 44 and
was one at the final checkpoint, so persistence of every final buffered entry is
not established after termination. Sequence state stayed empty: this workload
does not stress sequence-state capacity. Recorded audit size reached 2,397,661
bytes. Private profiles and stop/guard receipts remain outside Git on X:.

Local full coverage passed 3,487 tests with four skips in an isolated two-worker
run. An earlier simultaneous build/typecheck run had eight UI timeouts; no test
timeouts or product code were changed to obtain the passing rerun. Three later
path/Unicode cases passed in the focused transport suite (29 passes). Windows
compilation, twelve quiet native input rejections, actual PID scope and the
36-query comparison passed. Renderer build, formatting, lint (zero errors;
existing warnings: 56), both typechecks, production audit, both mutation gates and
derived counts passed. Implementation CI passed all five required contexts:
3,489 tests passed, five skipped; final documentation CI is required before merge.

This work does not establish event recall, foreground UI responsiveness, packaged
installation behavior or ETW throughput. The user's installed application is not
replaced and no release is cut by this optimization pass.
