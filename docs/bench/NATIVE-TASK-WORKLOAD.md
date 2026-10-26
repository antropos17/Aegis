# Controlled native task workload

`bench/native-task-run.cjs` executes a fixed C# CSV aggregation worker and consumes
the same-run evidence with the existing paired task-latency and false-alarm
evaluators. This supplies an executed native-program diagnostic baseline. The
worker is a controlled program, not an AI agent; it makes no provider/model call.
It does not close the real-agent corpus, qualified OS-oracle capture or W8/T8.

The [2026-10-26 script-generated result](windows-native-task-pairs-2026-10-26.md)
and [JSON](windows-native-task-pairs-2026-10-26.json) retain the first executed cell.
The tested clean source commit is recorded in those files; later documentation
publication does not relabel the execution as a measurement of a newer product.

```powershell
npm run build:renderer
npm run build:sidecar
node bench/native-task-run.cjs --output X:/task-storage/new-native-task-run
```

Use a new absolute output directory outside the repository under an existing
ordinary parent. The command refuses dirty source, ancestor links, existing output
and less than 2 GiB free output space. It compiles the fixed worker with the inbox
Windows x64 C# compiler; no SDK, integration, driver or oracle is installed. Its
profile and home are run-owned. Personal application/agent settings are not used.
Raw artifacts are private. Review closed disposable diagnostics after seven days,
preserving failures, source/input declarations and receipts; deletion is not automatic.

## Frozen tasks and independent outcome

Before task starts, `plan.json` records the commit, bench-source hashes, compiled
worker hash, renderer/helper artifact hashes, pseudonymous machine ID, OS/CPU,
agent version, configuration, fixture-byte hash and all three alternating pairs.
`expected.ndjson` contains the twelve planned file-creation effects. The generated
input has 2,000,000 CSV rows: row index and its remainder modulo 1,000. The ordinary
task aggregates it into a project summary. The control performs the same useful
aggregation and writes its summary to an owned sibling outside the declared
project. That destination is prohibited by the fixture's rubric, while still
being inside the exclusively owned disposable run. It is never a personal target.
No persistence, credential or trap is activated.

The C# actor parses the actual input. A separate Node outcome oracle uses the
closed-form sum of complete 0..999 cycles, checks exact output bytes and directory
inventory, and rehashes the source after each task. It does not use AEGIS telemetry
or the actor's reported aggregate to define success. These checks establish the
useful file result, not which OS process caused every file event. Native readiness,
exit and per-task replies remain separate execution evidence.

Each arm uses a fresh persistent worker. Enabled arms start the actual desktop
entrypoint with a disposable home/profile, a fixed custom signature for the native
worker, one-second scanning, notifications disabled and no explicit ETW read opt-in.
The production scanner must observe that worker and report a reliable process
population before work begins. A minimum five-second warmup is common to arms;
actual warmup is retained. Application startup is outside task clocks. This is a
short diagnostic cell, not METHOD.md's longer steady phases or startup benchmark.

The parent monotonic clock measures command dispatch through independently
verified completion, including common oracle work. Integer milliseconds have a
declared one-millisecond resolution. Each task has a 30-second completion/exposure
budget. There is a fixed 500 ms end-of-arm display drain. A failed arm and every
planned unstarted row are retained; the runner does not select a replacement run.

## Existing evaluator consumers and interpretation

The runner directly calls `evaluatePairedTaskLatency` with three predeclared
alternating disabled/enabled pairs and independently evaluated task rows. The
retained `latency.input` can be passed to that existing evaluator again. Its
conditional supplied-evidence status is preserved; hashes do not authenticate an
OS image or establish calibrated overhead. `osImageSha256` identifies declared
development-host OS metadata, not a sealed image. The common configuration hash
binds the profile template and product artifacts; expanded per-arm settings are
retained in their disposable profiles.

Enabled ordinary tasks also enter `evaluateTaskFalseAlarms`. The complete
user-visible alarm inventory, independent adjudication and scheduled alarm
exposure are unavailable. Their coverage stays empty and inventory incomplete;
the result is null incidence. The outside-project control is explicitly excluded
from that benign-task denominator. Failed ordinary tasks stay in it.

The real preload's file-event callback retains only run-owned paths with a bounded
1,024-record buffer and eviction count. These records are reported as raw captured
fixture events, never sensor hits. Sysmon and Procmon are separate unavailable
columns because same-run capture was not configured. Qualified hits, misses,
recall, false alarms and detection/response latency remain null. The method runs
observation-only monitoring and selects no prevention route. The controlled
outside effect is reported regardless of telemetry.

CPU and RSS overhead stay null: complete product/helper lifetime accounting,
instrumentation calibration and independent resource reference are not qualified.
The actor's own cumulative CPU ticks and working-set bytes are retained as raw
diagnostics only. The three separate task-pair estimates and observed latency
range expose variation; cache state, background host work and short samples limit
generalization. Use an exclusive local measurement slot for the three pairs.

## Reproduction and checks

`result.json` holds execution records, independent checks, both existing evaluator
packets/results and unavailable surfaces. `summary.json` and `summary.md` are
generated by `bench/lib/native-task-report.js`; numbers must be copied only from
that script-produced result. Exact task timings vary. Semantic outcomes and null
qualification fields must reproduce on matching inputs; publish each repetition's
timings rather than silently averaging away variation.

```sh
node node_modules/vitest/vitest.mjs run tests/main/bench/native-task-run.test.js
```

The focused cases cover the independent expected output, a real Windows C#
protocol/file-outcome control, failure retention by the existing latency model,
incomplete alarm exposure and unavailable sensor/overhead publication. They do
not require provider calls or source mutations. Same-run Sysmon/Procmon collection,
real supported-agent tasks and complete alarm/response accounting remain future
measurement work, not permission to install or start an oracle/VM automatically.
