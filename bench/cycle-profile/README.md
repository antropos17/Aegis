# Live development-cycle profile

On Windows, build the normal renderer and process snapshot helper, then run:

```powershell
npm run build:renderer
npm run build:sidecar
node bench/cycle-profile/run.cjs X:/tmp/aegis-cycle-new-run
```

The output directory must be new, absolute and outside the repository. The runner
starts the real main module in Electron with a separate profile, minimized window,
notifications disabled and automatic updates disabled. ETW is not opted in; no UAC
request is made. Normal process, network, file, WSL and local-runtime observations
still run. This is a live observation of the current machine, not a synthetic test.

Capture lasts 180 seconds. The first 90 seconds are labeled startup; the later
window covers the normal ten-second schedule. Stages are grouped by call start.
The recorder wraps selected module exports through the CommonJS loader, preserving
arguments, receivers, results and promise identity. Nested/concurrent durations
overlap; do not sum them. Internal calls bypassing an exported wrapper are not
independently timed. An async context attaches child launches to their initiating
stage. Long-lived or unfinished children appear in launch counts but may have no
completed-duration row.

`report.json` holds numeric timings, fixed stage/provider labels, counts, aggregate
resources and scan completion times. It contains no monitored paths, command
arguments, process names, instance identities, return values or exception text.
`manifest.json` fingerprints the main sources, harness, renderer and development
snapshot binary. The runner pins snapshot selection to `auto` for its child and
puts child TEMP/TMP under the output directory; global settings are unchanged.

CPU samples use `process.cpuUsage()` for main and Electron cumulative counters
for its process group, normalized to one core. External PowerShell, WSL and other
helpers are excluded. Processes appearing/disappearing between samples can leave
unobserved CPU time. Working-set sums can count shared pages more than once; they
are not unique physical RAM. Event-loop delay uses a 20 ms sampling resolution.

At the deadline the app quits through its normal lifecycle. A 210-second watchdog
terminates only the child it launched if graceful exit fails. Success requires a
completed capture and at least three steady process ticks. Both successful and
failed runs retain their profile, normal application logs/audit/database and
measurement receipts. Do not publish the profile: unlike the numeric report, its
normal app records can contain local paths and agent metadata. Keep these small
verification profiles on the data drive. Remove only their confirmed disposable
TEMP files after the child exits, with a 24-hour retention target and a 256 MiB
ceiling checked by the operator. These TEMP limits are not automatic cleanup.
Timings retain at most 4,096 samples per stage; overflow is reported. Check disk
space and diagnostic growth around live runs. Instrumentation overhead has not
been calibrated against an uninstrumented run.

The initial [2026-09-15 report](../../docs/bench/live-cycle-profile-2026-09-15.md)
compares a missing-helper development profile with a correctly built one. It
identifies configuration and remaining costs; it does not claim a product-code
speedup or characterize a packaged installation.
