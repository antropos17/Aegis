# Supervised own-Node resource session

Status: a fixed-child supervisor around the unchanged
[resource session](SELF_RESOURCE_SESSION.md). It launches only the current Node
executable and `bench/self-resource-run.cjs`. The parent owns one fresh outer
directory, while the child owns its unchanged five-file `capture/` bundle. The
parent does not inspect, repair, score or admit that bundle. All source,
measurement and W8 acceptance flags remain false.

```sh
node bench/self-resource-supervise.cjs --run-id supervised-1 --duration-ms 1000 --max-acquisition-us 1000 --max-cpu-uncertainty-us 2000 --wall-limit-ms 10000 --confirm-ms 1000 --out <new-owned-outer-directory>
```

The existing five flags retain the resource-session constraints. Two additional
required canonical decimal integer flags declare `wallLimitMs` (1–120000) and
`confirmMs` (1–10000). No default wall limit or confirmation budget is selected.
Unknown/duplicate flags, noncanonical numbers, getters, nonordinary options and
unsupported dependency seams refuse before filesystem, timer or child activity.
No executable, PID, command, profile, phase, workload or environment input exists.
Importing the CLI and asking for help acquire nothing.

## Ownership and retention

The parent creates the outer directory exclusively. Its parent must already be
an ordinary local caller-owned directory. UNC paths, linked ancestors, linked
source files and reused output directories refuse. These are non-adversarial
owned-path prerequisites, without proof of filesystem ownership or containment.

Before spawning, the parent creates owned `temporary/` and writes/closes these
fixed files:

| Parent file | Cap | Purpose |
| --- | ---: | --- |
| `supervision-plan.json` | 16 KiB | Validated limits, fixed child description, source inventory and policy |
| `supervision-pending.json` | 4 KiB | Pending declaration bound to exact plan-file SHA-256 |
| `supervision-final.json` | 32 KiB | Final observed lifecycle, bounded stream hashes and source endpoints |

Total parent-file writes are capped at 64 KiB, independently of the unchanged
child bundle quota. Source reads are capped at 64 KiB per fixed module, with a
growth sentinel, exact BigInt identity/timestamp comparison and confirmed close.
The ten-file inventory covers the parent CLI/helpers and fixed child session,
storage, sampler and evaluator. Its Node-version and disk-byte hashes identify
files read at endpoints, without authenticating loaded code, dependencies or the
runtime implementation. Equal endpoints cannot prove no intermediate changes.

Every parent artifact uses exclusive creation and bounded descriptor writes,
with successful close required before its hash is attested. No output is
overwritten, deleted or synthesized. Partial/competing parent files and partial
child capture artifacts remain in place. The owner decides retention; this tool
performs no discovery or cleanup of previous attempts.

The final receipt lists only the two confirmed predecessor files and has
`finalPublication: 'not-self-attested'`. Its own write/close cannot be certified
inside itself. A parseable final receipt can still accompany exit 6. Publication
success requires the CLI exit code or module result plus validation of the
bundle. Abrupt termination may leave only a plan and pending receipt.

## Child configuration and deadlines

Spawn uses `process.execPath`, a fixed absolute child CLI, exactly the validated
existing five flag pairs and `shell:false`, `windowsHide:true`,
`stdio:['ignore','pipe','pipe']`. Parent `execArgv` is not forwarded. Environment
starts empty except optional OS `SystemRoot`/`WINDIR`, owned
`TEMP`/`TMP`/`TMPDIR`, and `NODE_DISABLE_COMPILE_CACHE=1`. No parent `NODE_OPTIONS`,
`NODE_PATH`, coverage variables, preload variables, credentials or PATH are
copied. The child working directory is owned `temporary/`. Commands, full paths,
environment values and child PID are never published.

The parent monotonic clock starts before spawn. Its wall limit spans child
startup, process exit and stdio completion. At the deadline, cancellation,
overflow or another fatal observation, a permanent cause is latched. A later
zero exit cannot erase it. The supervisor requests `SIGKILL` at most once on its
owned `ChildProcess`, and never after observing exit. It never signals a supplied
PID, another process or a process tree.

The Node documentation distinguishes process exit from stdio closure and warns
that successful signal delivery does not establish termination. An `error` event
also does not imply exit. This implementation therefore records `spawn`, `error`,
`exit` and `close` independently, retaining exit/close code and signal agreement.
See [Node 24.20 child-process lifecycle and kill semantics](https://nodejs.org/download/release/v24.20.0/docs/api/child_process.html#class-childprocess).

A separate bounded confirmation/drain wait starts after a stop request or
observed exit; it is not extended by later events. On expiry the parent records
unconfirmed exit or closure explicitly. An unconfirmed child handle is unrefed
and owned unfinished pipes are destroyed so the CLI can return. This requests
detachment; it does not assert that the process died. Error listeners remain for
late events. A failed kill, `kill()` return or `child.killed` is never exit
confirmation.

These timers depend on a responsive parent event loop and filesystem. Spawn,
source inspection, artifact IO or a blocked parent can delay observation and
return. There is no OS containment, externally enforced hard parent deadline,
calibrated timing guarantee or product overhead qualification.

## Stream and result meaning

Each pipe uses incremental SHA-256 over at most the first 16384 bytes. No chunks
or text are retained. `observedBytes` counts delivered data, with an explicit
exactness flag if its safe-integer counter saturates; `hashBytes` counts only the
hashed prefix. Overflow latches failure. A prefix digest is not presented as a
whole-stream digest: `complete` requires observed end, no error, no overflow and
no requested destruction. Stream end, close, error and destruction-request facts
are separate. Late output cannot cause a kill after observed process exit.

`executionMode` is `real-child` for production defaults and `injected` whenever
the module's closed `spawn`/`nowNs`/`setTimer`/`clearTimer` test seam is supplied.
Injected lifecycle facts carry no native authority. The final receipt always
retains `childBundleAssessment:'not-inspected'` and all three acceptance flags
false. Parent success is a process/stream observation and publication outcome.
It supplies no evidence that raw readings, conditional intervals, phases or a
measurement were accepted.

| Exit | Meaning |
| --- | --- |
| 0 | Zero child exit and matching close observed, both streams complete, no latched failure, unchanged source endpoints, final publication closed |
| 2 | Invalid required inputs; no output or child activity |
| 3 | Deadline/cancellation/overflow, child or stream failure, nonzero/mismatched exit, or unconfirmed lifecycle |
| 4 | Initial source inventory unavailable or final sources changed/unavailable |
| 5 | Fresh outer directory refused |
| 6 | Partial parent bundle or parent publication failure |

Persistence failure dominates source refusal, which dominates lifecycle failure.
CLI diagnostics are fixed codes and publish no raw child output or error text.

`superviseSelfResources(options, deps?)` in `bench/lib/resource-supervisor.js`
returns `{exitCode,receipt}` and accepts the seven camel-case options plus an
optional `AbortSignal`. The CLI exports `main(argv)` and removes its owned signal
handlers on return. CI fixtures cover the actual shortest fixed child and
injected timeout, late exit, kill failure, cancellation, overflow, missing close,
spawn failure, environment and publication conditions. Tests are authored for CI;
local child execution and heavy verification were intentionally deferred under
the active host resource constraint.
