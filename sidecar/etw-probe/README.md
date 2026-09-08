# Kernel-File measurement probe

Standalone Windows B1 experiment for provider
`edd08927-9cc4-4e65-b970-c2560fb5c289`. It is not wired into AEGIS or its installer.
Requires .NET 10 SDK to build, .NET 10 runtime to run. TraceEvent is pinned to 3.2.6.

From the repository in a **normal terminal**:

```powershell
dotnet build sidecar/etw-probe/EtwProbe.csproj -c Release
sidecar/etw-probe/bin/Release/net10.0-windows/EtwProbe.exe self-test
sidecar/etw-probe/bin/Release/net10.0-windows/EtwProbe.exe fixture-check X:/tmp/aegis-etw-fixtures-new
sidecar/etw-probe/bin/Release/net10.0-windows/EtwProbe.exe preflight X:/tmp/aegis-etw-preflight-new
```

Use new output directories each time. Preflight reads registered TDH metadata and
OS version/edition without starting ETW. Fixture-check exercises six synthetic
workloads and the ready/go/done/save protocol without elevation.

Then, in **PowerShell as administrator**, run the already-built probe:

```powershell
& 'X:/Future/ESCAPE/AEGIS/sidecar/etw-probe/Run-Matrix.ps1' -OutputRoot 'X:/tmp/aegis-etw-matrix-20260908'
```

The eleven short runs take roughly two minutes, depending on session startup and
drain time. The runner does not install packages, rebuild, change tracing policy,
request elevation or stop other trace sessions. Each capture has a unique session
name, two child processes and its own newly created synthetic 1 MiB files. Ctrl+C
stops the owned session and children through the probe's cleanup path. If a process
is forcibly terminated, inspect the exact GUID session name in `run.json` before
manually stopping that session; never stop all ETW sessions.

## Experiments and artifacts

`Run-Matrix.ps1` compares READ-only, names/read, lifecycle, target-PID filtering,
preopened handles, asynchronous reads, warm mapped reads and three churn eviction
policies. These are candidate configurations, not a ratified minimal set.
Every comparison gets a fresh map and two separate actors: target and control.
The PID-filter run requests only the target PID; compare control delivery against
the unfiltered lifecycle run. Zero delivery alone does not prove filtering works.

Each run retains:

- `environment.json`, registered `kernel-file.manifest.xml`, and `run.json` with
  options, owned session name and actor PIDs.
- `events.json`: bounded selected samples, raw QPC plus relative milliseconds,
  header PID/TID, payload TID, optional live thread-owner lookup, opaque per-run
  pointer aliases and fixture-relative candidate path evidence.
- `schemas.json`: delivered event IDs/versions and field names, without values.
- `summary.json`: all delivered provider event counts, decode/retention/map losses,
  collector CPU milliseconds, lifetime peak working set, collection duration and
  native session loss/buffer counters queried before stop.
- Actor `*-operations.json`: successful API operations, QPC intervals, caller TIDs
  and byte counts. Ledgers are written only after the parent stops ETW.

Exit 0 means collection completed without the reported degradation conditions; it
does **not** prove Read coverage, correct identity or adequate configuration.
Exit 5 retains degraded measurements; 3 means elevation missing; 2 means failure
(type/HRESULT only). An unavailable counter is null, never a measured zero.

The fixture files and selected metadata are retained; no raw ETL is persisted.
Callbacks see machine-wide events when unfiltered, but persist no unrelated path
values, command lines, file contents or raw kernel pointer values. Path matching
accepts only exact target/control fixture paths; unsupported device/SUBST/UNC
translations stay unresolved. Aggregate counts include unrelated activity.

## Interpretation limits

The ledger witnesses application API completion, not a one-to-one oracle for event
15 emission. Async continuation TID can differ from the issuing TID. Header PID
is not declared authoritative. `ThreadOwnerAtCallback` queries the live thread
table and can race thread exit/reuse; it is a separate observation, not event-time
identity. Selected samples can omit a read with both unknown path and non-actor
header PID; global event counts still include it. Therefore this harness alone
cannot prove absence or settle authoritative issuer attribution.

Object/key maps are experimental. Rebinding to an unrelated observed name
invalidates fixture evidence; disagreements remain conflicts. Dropped naming
events can still leave stale associations. Maps and samples are capped and report
overflow. Close/cleanup/no-eviction runs do not constitute a lifecycle proof.

QPC values use the same host clock as `Stopwatch.GetTimestamp`; convert differences
with `stopwatchFrequency` from the environment record. Collection duration includes
startup after enabling and one second of tail drain. CPU measures the collector
over that interval, excludes provider-wide kernel cost, and includes callback
thread queries. Peak working set is the collector process lifetime peak.
Loss is queried before stopping: final drain/stop losses are not measured.

Warm buffered or mapped reads do not prove Fast I/O, cold page faults or coverage
of every mapping path. For npm/build load, run a 30-second idle capture manually
while running a known project workload in a separate **normal** terminal; record
its duration and command separately. Do not run project build scripts elevated.
Repeat representative runs at least three times and on Home, Pro and Hyper-V
targets before generalizing. See the [evidence checklist](../../docs/recon/kernel-file-etw-measurements.md).
