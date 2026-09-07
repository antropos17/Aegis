# Windows startup investigation — 2026-09-07

The installed 0.14.0-alpha app has a reproducible source of main-thread pauses:
chokidar creates thousands of native `fs.watch` subscriptions on that thread.
This explains measured pauses after the window appears. The longer unresponsive
episode observed during the installation smoke was not reproduced in full, so its
cause remains open. No production performance fix has been applied by this investigation.

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

## Next implementation

Move native chokidar registration and watching into a worker, keeping the existing
root options and observation scope. The main process should still own attribution,
audit writes, rule evaluation and watch health. Preserve the current root lifecycle:
registration alone cannot mean `ready`; worker errors and exits must degrade every
affected root. Reinitialization and shutdown must retire the previous worker and
reject messages from an older generation.

Before adoption, verify real add/change/unlink delivery, readiness, registration
failure, crash, close-before-ready and reinitialization. Design a bounded event queue
with explicit loss reporting before bridging live traffic: moving registration must
not introduce an unbounded backlog or silently discard observations. Repeat packaged
startup measurements and existing watch-plan tests after that implementation.

Local diagnostic profiles and raw samples are under `X:/tmp/aegis-startup-20260907/`.
They stay outside Git. The installed user's profile was not used as a fixture or
modified by these probes; every profiled app ran with its own `--user-data-dir`.
