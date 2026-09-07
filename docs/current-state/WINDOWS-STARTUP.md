# Windows startup investigation — 2026-09-07

The installed 0.14.0-alpha app has a reproducible source of main-thread pauses:
chokidar creates thousands of native `fs.watch` subscriptions on that thread.
This explains measured pauses after the window appears. The longer unresponsive
episode observed during the installation smoke was not reproduced in full, so its
cause remains open. The implementation below now moves evidence watchers into workers.

## Measurements

All numbers are local observations under background desktop load, not startup targets.
The published Windows executable was profiled with an inspector attached before main
entry, using disposable profiles and synthetic history. Times below start at the
instrumented entry and exclude executable launch / debugger attachment. Profiler and
instrumentation overhead is included. `ready-to-show` is an Electron event, not a
measurement of visual completeness or keyboard responsiveness.

| Probe | Observation |
| --- | --- |
| Isolated packaged audit initialization, 11,000 synthetic records | Synchronous seeding 12 ms; index ready 162 ms; largest heartbeat gap 33 ms |
| Packaged app, empty profile | `ready-to-show` 464 ms; largest main-thread heartbeat gap 1,119 ms |
| Packaged app, first index build from 11,000 records | `ready-to-show` 593 ms; largest gap 2,026 ms; individual SQLite batches 31–57 ms |
| Same packaged profile, existing index | `ready-to-show` 514 ms; largest gap 1,539 ms; 4,812 native `fs.watch` calls taking 2,231 ms cumulatively |

The CPU profile's dominant non-idle stack during the first five seconds was:
`chokidar._addToNodeFs → _handleFile → _watchWithNodeFs → createFsWatchInstance → fs.watch → FSWatcher.start`.
An existing index did not remove the pauses. The isolated audit result excludes the
index as the explanation for these seconds-long pauses at the sampled history size;
it does not prove history loading is bounded for arbitrarily large logs.

## Reproduce the isolated registration comparison

Run `node scripts/bench-watch-startup.js 3000` after `npm ci`. The script creates its
own temporary fixture, registers the same files using the application's chokidar
options (`depth: 2`, no polling, no symlink following), and cleans up afterward. It
compares registration on the measuring thread with registration in a worker thread.
The worker is a diagnostic experiment, not an application watcher implementation.

Three successive pairs on Windows / Node 24.11.1:

| Run | Main-thread ready | Main-thread largest gap | Worker ready, including launch | Measuring-thread largest gap with worker |
| --- | --- | --- | --- | --- |
| 1 | 1,737 ms | 1,415 ms | 1,416 ms | 19 ms |
| 2 | 1,501 ms | 1,135 ms | 1,643 ms | 25 ms |
| 3 | 1,255 ms | 971 ms | 1,431 ms | 16 ms |

Each arm observed 3,031 entries: 3,000 files, 30 subdirectories and the fixture root
in its parent's watch entry. A count mismatch fails the comparison. The heartbeat
interval is 10 ms; reported gaps include that interval. Fixture creation and watcher
shutdown are outside the measurement. Main always runs first, so filesystem-cache
order is a limitation. The comparison measures responsiveness, not event delivery,
loss, or faster total setup. It is not a timing gate in CI.

## Implementation — 2026-09-07

Each applicable evidence watch group now owns a dedicated Node worker. Registration,
native handles and chokidar run there; paths and event types cross to the main thread,
which still owns attribution, audit writes, rule evaluation and watch health. Existing
depth, symlink, polling, initial-event and project-ignore behavior is retained. The small
development-only rule hot-reload watchers remain local; ASAR rules are not watched.

Each worker has at most 512 pending events with a 1 MiB UTF-8 path/envelope budget,
plus one unacknowledged batch of at most 32 events (also at most 1 MiB). Native watcher
internals and JavaScript object overhead are outside these bridge bounds. The main
thread acknowledges after handling a batch. Overflow drops newest events and sends a
cumulative count separately from event capacity; the client converts it to loss deltas.
`fs-chokidar.lossCount` increases and the affected root remains errored after subsequent
ready/events. Provider errors and unexpected worker exits also degrade the root. Only
fixed error codes cross the bridge; no file contents or arbitrary error strings do.

Closing invalidates callbacks immediately, then terminates the dedicated worker and
its native handles. Reinitialization closes prior workers and guards callback/preflight
continuations by generation. Shutdown invalidates delivery before closing the audit log.
Intentional close cancels queued delivery; it does not drain observations past shutdown.

Validation covers real worker add/change/unlink delivery, startup suppression, literal
project ignore names, registration failure, error/exit reporting, close-before-ready,
reinitialization races, count/byte queue bounds and sticky health loss. The existing
watch-plan and application health suites pass. Full coverage: 2,644 passed, 4 skipped
across 146 files; both typechecks, lint, renderer build and both mutation gates pass.

A rebuilt Windows package loaded workers from ASAR and reached three healthy evidence
watch groups, zero chokidar loss, and SQLite `ready`. A repeat on the synthetic-history
profile recorded `ready-to-show` at 419 ms and a largest main-thread heartbeat gap of
115 ms, compared with 514 ms / 1,539 ms on the earlier existing-index sample. Instrumented
main-thread `fs.watch` calls fell from 4,812 to zero. These are individual local samples,
not a platform-wide speed guarantee or proof of the original long episode's cause.
For the profiled worker run, the harness cleared inherited worker `execArgv`: otherwise
the parent's `--inspect-brk` kept workers paused. This adjustment is only in the local
profiling harness. Normal packaged worker readiness was also checked without the
debugger in Electron's Node mode. A final normal packaged launch (no startup debugger
flags; diagnostics attached afterward) also reached three ready groups, delivered
13 agent-config callbacks, recorded zero chokidar loss and had a ready SQLite index.
It exited cleanly. This change has not been released or installed over the user's
published 0.14.0-alpha application.

Local diagnostic profiles and raw samples are under `X:/tmp/aegis-startup-20260907/`.
They stay outside Git. The installed user's profile was not used as a fixture or
modified by these probes; every profiled app ran with its own `--user-data-dir`.
