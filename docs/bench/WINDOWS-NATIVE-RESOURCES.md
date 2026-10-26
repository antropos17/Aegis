# Controlled Windows worker resource observations

`bench/native-resource-run.cjs` measures the existing controlled C# CSV worker
through a separate read-only Win32 observer and immediately consumes the retained
samples with `evaluateResourceIntervals`. The existing native-task report module
generates the resource summary. This is an executed workload-resource diagnostic;
it supplies no real-AI cohort, complete product cohort, independent physical
calibration, calibrated product overhead or W8 acceptance.

```powershell
node bench/native-resource-run.cjs --output X:/task-storage/new-native-resources
```

The output must be fresh, absolute, outside the clean repository and below an
existing ordinary directory with at least 2 GiB free. The inbox x64 C# compiler
builds the fixed worker and observer into that directory. No SDK, driver, oracle,
VM or provider is installed or started. Personal profiles are unused. Use a short
exclusive measurement slot for the three repetitions; unrelated host work still
limits inference. Review closed disposable diagnostics after seven days; preserve
source declarations, first failures, raw observations and result receipts.

## Frozen execution and independent useful output

Before starting any worker, `plan.json` freezes the exact commit/source inventory,
compiled binaries, machine pseudonym, OS, Node and worker versions, input hash,
three fresh-worker repetitions and bounds. Sensor mode is explicitly not started.
Each repetition schedules four acquisitions at 0, 1, 2 and 3 seconds. Following
the first acquisition, the worker aggregates the fixed 2,000,000-row CSV into its
project; after the second it repeats the useful aggregation into the exclusively
owned disposable sibling. The sibling is outside the declared project but never
outside the task-owned directory. No action against personal files is performed.

The independent outcome rubric uses the closed-form sum of complete 0..999
cycles, exact output bytes, exact directory inventory and unchanged input hash.
It does not consume the worker's aggregate or AEGIS telemetry. Six output files
are expected across the three repetitions. A task response, output result,
acquisition and cleanup status remain separate observations. The full plan and
any failed/incomplete repetition survive; the runner does not replace failures.

## Actual resource APIs and declared bounds

The observer opens only the supplied run-owned PID, retaining its process handle
and verifying `GetProcessTimes` creation time against the worker's separately
reported OS start time on every snapshot. It reads cumulative user/kernel CPU
through `GetProcessTimes` and working set through `GetProcessMemoryInfo`.
The observed population is precisely this single process. Observer, generator,
Electron and arbitrary descendants are outside that scope; their absence cannot
be interpreted as a complete product/cohort total.

Every acquisition performs external snapshot → worker's .NET
`Process.TotalProcessorTime`/`WorkingSet64` reply → external snapshot. CPU must
be nondecreasing and the self reading must fall within the external cumulative
CPU enclosure with a predeclared 2 µs allowance for integer unit conversion.
The final cumulative external reading must exceed the first, making a zero
counter/scale mismatch observable. These APIs share Windows kernel accounting;
their agreement is **same-kernel API/unit corroboration**, not independent OS
truth or physical CPU calibration.

Both working-set readings must satisfy a predeclared 1 MiB–1 GiB sanity envelope.
Their signed difference is retained, without claiming that nonmonotonic memory
readings are bracketed. This wide envelope catches obvious unit/empty values;
it is not an independent expected working set, memory accuracy bound or RSS
calibration. Working set may include shared pages and is not unique physical
memory. Collector-on/off cost remains unmeasured.

Raw observer QPC acquisition windows and frequency, parent monotonic acquisition
width, scheduled time and actual reply-completion endpoint are retained. CPU
interval arithmetic uses the latter parent endpoints; no cross-clock offset is
inferred. Clock/instrumentation uncertainty remains uncalibrated. Samples include
common waiting and acquisition overhead within the controlled-worker task window.
The actual final endpoint can lie beyond the declared three-second phase; the
unchanged evaluator retains and excludes that boundary interval and final memory
sample. It does not move late samples or discard them from raw evidence.

## Consumers, evidence and limits

`rep*/raw.json` is written before arithmetic. `rep*/evaluated.json` retains the
exact `resource-intervals/1` input, unchanged evaluator output, corroboration
bounds and individual failures. `result.json` retains all repetitions, independent
output checks, exit/pipe observations and source endpoint comparison. Exact source
endpoint equality cannot rule out intervening modification/restoration.
`summary.json` and `summary.md` are generated by `native-task-report.js` and expose
each repetition separately, including variance, admission counts and exclusions.
No run average replaces the individual rows.

Sysmon and Procmon were not captured. Hits, misses, recall, false alarms, detection
latency and calibrated product CPU/RSS overhead remain null. This new execution
does not revise the older desktop-enabled/disabled paired-task measurements or
claim their missing calibration has been supplied. Full product/helper lifetime
accounting, independent resource calibration and real supported-agent tasks are
still required for the broader method.

```sh
node node_modules/vitest/vitest.mjs run tests/main/bench/native-resource-run.test.js
```

The focused checks cover actual counter consumption by the existing evaluator,
unit/identity disagreement, missing points, late final boundaries and preserving
null unsupported metrics. The measured execution separately exercises the actual
C# compilation, APIs, useful output and clean process exit.
