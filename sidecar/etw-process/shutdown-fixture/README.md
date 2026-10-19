# Dormant process-owner prerequisite

`src/main/platform/etw-process-owner.js` supervises one original disposable child
handle. Its only public launch method accepts a fixed synthetic fixture mode and
generation. The checked-in Node fixture is the only executable admitted by that
launch seam; Electron is rejected. There is no capture, application, IPC or UI
caller. `launchAllowed` is always `false`.

The deadline is absolute and monotonic, established before launch. Output,
exit and stream-close handlers check it independently of timer delivery. Output
does not extend it. One original-handle termination attempt follows a failure;
there is no PID lookup, kill retry, shell, descendant process or restart route.
The combined output limit is capped at 1 MiB and retained stdout uses one fixed
buffer. Snapshots expose fixed diagnostics and numeric receipt summaries;
stdout, stderr and exception text are discarded.

`closed` requires original process exit and closure of both output streams.
Neither `kill()` returning true, its `killed` property nor process exit alone
proves cleanup or native success. A separate bounded cleanup grace ends in
`cleanup-unknown` when that evidence is absent. This result stays sticky after
late callbacks and blocks new owners in the same module instance. A single
outstanding fixture lifetime is admitted per module instance; each owner object
can launch once. Test dependency seams reset this state only in isolated tests.

Timeouts, malformed or missing output, nonzero exit, stream errors and incomplete
terminal evidence retain `nativeStopStatus`, final counter and native losses as
unknown (`null`); both completeness flags remain false. Valid fixture frames
pass through the existing diagnostic collector. Even its successful receipt has
`evidenceScope: synthetic-supervision`; its fake native status establishes no
native ETW result.

## Linked coordinator fixture

`ShutdownFixture.csproj` explicitly links the existing coordinator, ledger,
decoder, session definitions and schema unchanged. `Program.cs.txt` supplies
fake session/consumer implementations and directly constructs `ProcessCapture`.
It never invokes `ProcessCapture.Create`, native session construction, schema
verification or ETW APIs. The `.cs.txt` extension prevents the parent helper
project's default compile glob from acquiring a second entry point.

The `normal` case finishes the fake consumer during fake stop. `blocked-stop`
blocks inside fake `IProcessSession.Stop`, before the coordinator's consumer
budget starts. A fixed stderr marker lets the test require proof that this
blocking branch was entered before the supervisor terminates that actual child.
`blocked-consumer`
lets fake stop return but leaves consumer completion pending, including after
cancellation; the unchanged coordinator emits an incomplete terminal receipt.
The fixture also requires that fake cancellation was actually requested.
`partial` and `malformed` finish the coordinator but replace its wire output.
The JavaScript fixture separately checks the supervisor's bounded handling of
permanently blocked children and output overflow. Its blocked modes simulate
supervision only and do not exercise the C# coordinator.

Build the optional linked fixture with .NET 10, a verified local TraceEvent 3.2.6
assembly, an offline NuGet configuration clearing package sources/fallbacks, and
task-owned artifacts, CLI home, NuGet and TEMP/TMP directories. No package
reference or network restore is needed:

```powershell
dotnet build sidecar/etw-process/shutdown-fixture/ShutdownFixture.csproj --configfile <offline-config> --artifacts-path <task-artifacts> -p:TraceEventAssembly=<verified-absolute-dll> --no-self-contained
```

Run the focused suite using the repository's supported Node 24 runtime:

```powershell
node node_modules/vitest/vitest.mjs run tests/main/etw-process-owner.test.js --project main --maxWorkers 1
```

By default the five compiled cases are explicitly skipped. For a compiled run,
set process-local `AEGIS_PROCESS_SHUTDOWN_FIXTURE_DLL` and
`AEGIS_PROCESS_SHUTDOWN_DOTNET` to the absolute compiled DLL and dotnet executable,
and set `AEGIS_PROCESS_SHUTDOWN_REQUIRE_COMPILED=1`. Missing inputs then fail.
Those paths are used only by test injection; the public launcher remains fixed.

## Qualification limits and retention

This proves bounded supervision and the existing coordinator's fake shutdown
behavior. It does not establish native `ControlTrace` cancellation, ETW session
absence after child termination, authenticated crash/orphan cleanup, elevation,
provider rundown, native loss accounting or production capture readiness.
Parent responsiveness and OS scheduling constrain wall-clock enforcement; the
JavaScript deadline cannot execute while its parent event loop is blocked.
Capture exposure still requires separate privileged qualification.

Keep manifests, exact commands and verification receipts. Diagnostic logs have a
2 MiB per-command cap and a five-minute command budget in the local qualification
runner. Disposable task-owned build/cache output has a 24-hour post-review
retention target and 512 MiB ceiling; inspect growth and skip locked files and
reparse points before any cleanup. This document does not install rotation or
automatic cleanup.
