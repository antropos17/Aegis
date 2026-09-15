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

The extended live capture and final verification are recorded below when complete.
This work does not establish event recall, foreground UI responsiveness, packaged
installation behavior or ETW throughput. The user's installed application is not
replaced and no release is cut by this optimization pass.
