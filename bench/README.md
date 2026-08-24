# Bench V1

Bench exists so AEGIS can state accuracy numbers that a third party can reproduce.
Until it exists, no numeric confidence or accuracy figure may be published anywhere in
the project (`memory-bank/RESEARCH-BASELINE.md` §3, §10).

## Method

For each scenario the bench **generates an expected-event catalogue as a by-product of
running a deterministic script**, then confirms every row of that catalogue against an
independent oracle (Sysmon, Procmon), and only afterwards compares it with what the AEGIS
sensor recorded.

Two rules are non-negotiable and are the reason the harness is shaped this way:

- **Never diff two live streams.** The catalogue is the fixed point; both the oracle and
  the sensor are scored against it, never against each other.
- **A sensor is never its own oracle.** Nothing in the MEASUREMENT column imports from `src/` —
  see [Trace replay and the `src/` boundary](#trace-replay-and-the-src-boundary) for the
  name-by-name split, and for the one subtree where the rule does not apply because it is the
  system under test rather than a measurement of it. Where a scenario needs ground truth about
  process identity, that truth comes from Sysmon EID 1 ordinality — never from the
  process-snapshot provider AEGIS itself reads.

The actor's catalogue states intent and the fact of execution. It never confirms itself:
every row it writes is confirmed by an oracle before any metric counts it.

## Windows-only

Sysmon, Procmon, the Restart Manager path and `reg query` are all Windows facilities. The
bench does not run on Linux or macOS and does not pretend to: on another platform the
manifest records each Windows fact as **absent with a reason**, rather than substituting a
plausible value.

Nested virtualisation is unsupported on GitHub runners and the required contexts all run on
`ubuntu-latest`, so **the bench never runs in CI**. What CI does cover is `bench/` source
quality: `npm run lint` and `npm run format:check` both walk this tree.

## Numbers from a development machine are not accuracy figures

**No number produced by a run on a development machine may be published as an AEGIS
accuracy figure.** The condition for publishing is a run on a Hyper-V Gen2 gold image with a
pinned Windows build (§10: "Hyper-V Gen2 gold image first"). Building the harness on a
workstation is fine — a harness is not a claim; a number is. A development machine cannot
pin its build: it updates.

Committed run records live in `docs/bench/`, written by hand from a run's output so the
prose around the numbers survives a re-run — the precedent is
`docs/bench/generation-v2-2026-08-12.md`.

## Running

```
npm run bench:run                                        # defaults: no-scenario, arm A
npm run bench:run -- --scenario S1-agent-lifecycle --arm A
npm run bench:s1                                         # the line above, without the -- trap
npm run bench:run -- --scenario S1-agent-lifecycle --arm B   # oracle only: no sensor, no renderer
node bench/replay.js bench/runs/<run id>                 # rebuild that run's report from its files
node bench/replay.js bench/runs/<run id> --out <file>    # write the rebuild elsewhere
npm run bench:score -- bench/runs/<run id>               # confirm the catalogue, then score the sensor
node bench/score.js bench/runs/<run id> --out <dir>      # write the score elsewhere
```

Arm B needs no built renderer and starts no sensor: it executes the scenario and collects the
Sysmon oracle. On a machine with no Sysmon installed it runs to completion, records the absence,
and exits **1** — which is the honest outcome, not a harness failure. See
[The Sysmon oracle](#the-sysmon-oracle--b23).

The `--` is required; without it npm keeps the flags.

`bench/score.js` needs no sensor, no scenario, no oracle channel and no built renderer either:
it reads one recorded run directory and writes `matched.ndjson` and `metrics.json` beside the files
it derived them from. See [The metrics](#the-metrics--b25).

In arm A a run takes roughly three minutes: about ninety seconds of it is waiting for the sensor's
scan cadence to settle, then the scenario, then three more scan ticks and a flush drain.

`bench/replay.js` needs no sensor, no scenario and no built renderer: it rebuilds one recorded run's
`run-report.json` out of the four files that run left behind, in well under a second. See
[Replaying a recorded run](#replaying-a-recorded-run).

Exit codes: **0** the run completed · **1** a step failed to execute, the sensor could not be run
or read, the run report could not be derived, or an arm-B run collected no oracle record · **2** the
invocation or the scenario was wrong and
nothing ran. A scenario is loaded and
validated *before* the run directory exists, so a wrong scenario leaves no empty run behind; a step
that fails happens after, and leaves the directory holding the catalogue of everything that did
happen first.

Arms, from §10 — a run is one scenario in one arm:

| arm | what runs | measures |
|---|---|---|
| A | sensor + Sysmon | coverage and latency |
| B | Sysmon + Procmon, no sensor | oracle calibration |
| C | sensor alone | overhead |

Arm B is what makes arm A's scoring legitimate: B establishes that the catalogue is faithful
for a given deterministic scenario, and only then does A score the sensor against it.

## Layout

Present today (sub-blocks B2.1, B2.2, the arm-A capture, the first join, B2.3's Sysmon
adapter and B2.5's metrics):

```
bench/
  run.js                                    # create a run directory, execute a scenario, run the sensor
  replay.js                                 # rebuild one recorded run's report from its files; no sensor
  score.js                                  # confirm one recorded run's catalogue against the oracle, then score the sensor; no sensor, no channel
  scenario.schema.json                      # draft-07; the shape of a scenario
  lib/manifest.js                           # environment snapshot; absent facts stay absent
  lib/actor.js                              # executes steps, captures what happened
  lib/catalogue.js                          # writes expected.ndjson; refuses a line it did not observe
  lib/sensor.js                             # runs AEGIS across a run; readiness, ticks, stop
  lib/observed.js                           # writes observed.ndjson out of the product's audit log
  lib/join.js                               # joins the two, shapes run-report.json; no I/O at all
  lib/report.js                             # the join bound, the report's exact bytes, the printed summary and the renderer fingerprint — shared by both entrypoints
  lib/metrics.js                            # confirms the catalogue against the oracle and scores the sensor over what came back confirmed; no I/O at all
  lib/oracles/sysmon.js                     # normalizes Sysmon EventRecord XML; writes oracle-sysmon.ndjson and oracle-loss.json
  oracles/sysmon-bench.xml                  # the Sysmon config a run is measured under — never yet offered to a binary
  scenarios/S1-agent-lifecycle/scenario.json
  trace/schema.js                           # the trace format: version, chain seed, the closed list of record kinds, every refusal
  trace/environment.js                      # what a trace pins about the machine and the tree, and the comparison that refuses a mismatch
  trace/writer.js                           # observations → chained records → the exact bytes a trace directory holds
  trace/reader.js                           # reads a trace directory, or refuses it by name
  trace/clock.js                            # the virtual clock as a value, and the switch that puts it in front of the real one
  trace/clock-env.js                        # which environment variables name a clock, and the bootstrap that applies them
  trace/preload.js                          # the `node --require` entrypoint; acts on load, throws loudly when the environment names no clock
  trace/wiring.js                           # builds the product's module graph out of seams it already exports, and tears it down
  trace/harness.js                          # pushes one trace through detection and attribution, record by record
  trace/replay-trace.js                     # the replay entrypoint; writes the product's own records as verdict.ndjson
  runs/                                     # run artefacts — gitignored, created on first run
  README.md
```

Arriving with later sub-blocks, listed so the tree's shape is legible, not so it reads as
built — nothing below exists yet:

| path | sub-block |
|---|---|
| `bench/lib/oracles/procmon.js`, `bench/oracles/procmon-bench.pmc` | B2.6 |
| `bench/report.js` | B2.9 |

## Scenarios

One scenario is one directory under `bench/scenarios/`, holding a `scenario.json` validated against
`bench/scenario.schema.json` before a run starts. The schema is draft-07 because the repository pins
`ajv ^6`, which understands no later draft — the same version and the same precedent as
`rules/_schema.json`.

| field | what it is |
|---|---|
| `id` | must equal the directory name, or a run directory would misname what was run |
| `title` | one line a reader can hold in their head |
| `arms` | which of A/B/C the scenario is meaningful in; `--arm` outside that set is refused |
| `oracles` | which independent sources must confirm the catalogue (adapters: B2.3, B2.6) |
| `proves` | what a passing run establishes, so a number cannot later be read as answering a question the scenario never asked |
| `expect` | the observable events the scenario intends to produce, each with an id, a category and a type |
| `steps` | declarative steps, executed in order |

A step is `{id, kind, expect, with}` — a named kind with named parameters, never a script, because
the catalogue has to be derivable from what the step did. `expect` names one entry of the `expect`
block, and the actor refuses to run a step whose kind emits a different category or type from the
expectation it claims. Every expectation must be claimed by a step and every emitting step must
claim one: an expectation nothing produces is a promise the run never keeps.

### Step kinds

The closed set lives in `bench/lib/actor.js`, **not** in the schema. Only the actor can execute a
kind, so only the actor can say which kinds exist; a kind it does not implement fails the run by
name before any step runs, and is never skipped. What the schema owns is the shape of each known
kind's parameters — and a unit test asserts the two lists stay identical, so a kind added to one and
forgotten in the other cannot go unvalidated.

| kind | parameters | emits |
|---|---|---|
| `copy-binary` | `from` (`%VAR%` expanded), `agentId`, `agentName` | `file.creation` |
| `spawn-process` | `fromStep` (a `copy-binary` step), `args` | `process.start` |
| `wait` | `ms` | nothing |
| `terminate-process` | `fromStep` (a `spawn-process` step) | `process.end` |
| `delete-file` | `fromStep` (a `copy-binary` step) | `file.deletion` |
| `seed-secret-file` | `dir`, `name` | `file.creation` |
| `hold-secret-file` | `fromStep` (a `copy-binary` step), `dir`, `name`, `ms` | `process.start` |

`wait` emits nothing on purpose: no oracle can confirm the passage of time, and a catalogue row
nothing can reach is decoration.

`copy-binary` does not take the agent name on trust. `agentName` must be one of the names
`src/shared/agent-database.json` gives `agentId`, or the run fails — the stimulus is *drawn from*
the database rather than resembling it. That file is read as an input datum and never as evidence:
no claim about what happened comes from anything AEGIS ships.

### The run-scoped home, and the two kinds that need it

`platform/restart-manager.js` `buildSensitiveGroups` enumerates **`os.homedir()` and nothing
else** — the credential dirs and the agent-config dirs directly under it, plus `~/.env*`. A file
staged in a run's `stage/` is never a candidate, so the Restart Manager read-detect branch cannot
be reached from a scenario at all unless the scan has something in scope. The only two ways to
give it one are to seed the developer's REAL home, or to move the home.

The bench moves the home. When a scenario holds a `seed-secret-file` step, `bench/run.js` creates
`<run>/home/` and `bench/lib/sensor.js` points the sensor's `USERPROFILE` (and `HOME`) at it. On
Windows `os.homedir()` reads `USERPROFILE`, so the product enumerates the run's own directory and
the account's real `.ssh`, `.gnupg` and `.claude` are neither read, held, nor created by anything
the run starts. It changes what the sensor observes, so it is recorded rather than assumed — the
capture record carries it, and a run without one says so by its absence.

`seed-secret-file` writes one file with fixed, inert bytes. **Nothing about the content makes it
sensitive**; what does is the directory matching a rule the product already ships, which is the
same thing that would make a real one sensitive. A directory the rules do not match is skipped by
`buildSensitiveGroups` and the group never registers, so the scenario would prove nothing.

`hold-secret-file` spawns the staged binary and has it HOLD that file open for `ms`. Three things
about it are load-bearing:

- **A hold, not a read.** The Restart Manager reports the processes holding a registered resource
  at the instant it is asked — the product's own words are "a HOLD at the tick, NEVER a transient
  open→read→close". A step that opened and closed the file would leave nothing for a tick to find.
- **The holder is the staged binary, never the actor.** `_scanRmHolders` maps a holder pid onto an
  agent and drops any pid that is not one, so an actor-held file would be observed by RM and then
  correctly discarded.
- **Its lifetime bounds itself**, the same guarantee ping's `-n` count gives `spawn-process`: an
  actor that dies before cleanup cannot leave a process holding a file forever.

### S2 — a Restart Manager hold

`node.exe` is staged as `claude.exe`, an inert file is seeded into the run home's `.ssh`, and the
staged process holds it open for 40 s while several scan ticks pass. It was recorded on
2026-08-21: `file-access` / `holding`, `severity: sensitive`,
`attribution: {status: "confirmed", evidence: ["rm-holder-pid"]}`, against the run's own
`home/.ssh`.

`.ssh` and not `.claude`, and the difference was measured rather than assumed. An earlier run of
this scenario seeded `.claude`, and the record came back
`evidence: ["rm-holder-pid", "self-config-path"]` with `severity: normal` — a holder named
`claude.exe` holding its own config dir also trips the self-access exemption. Both records are
correct product behaviour; only the second isolates the code the scenario is for.

### What a scenario cannot reach, and why that is a finding

Two attribution branches are **not reachable from any scenario**, and the reasons are properties
of the product rather than limits of a machine. They are written here because a bench that quietly
lacked coverage of them would read as one that had it.

- **A network connection with no owning agent** (`no-owner-match` on the TCP path).
  `network-monitor.js` calls `_getRawTcpConnections(agents.map((a) => a.pid))` — the table is
  queried WITH the agents' own pids — and builds its `pidMap` from the same list, so every
  returned row has an owner. The `agent: ''` branch says so itself: "Unreachable in practice …
  Kept as a guard, not as a fallback that invents data." No scenario, no step kind and no machine
  changes that. The trace FORMAT expresses the state, and a replay exercises it; what cannot exist
  is a trace derived from a live run.
- **`populationReliable: false`.** It is `state === HEALTHY` in `process-scanner.js`, so leaving it
  needs the process sensor to fail. No step kind can cause that, and a run does not start until
  the sensor reports a completed scan — at which point the leaf is HEALTHY by definition. Making
  it reachable is a sensor-runner option, not a scenario.

### S1 — agent lifecycle

`ping.exe` is copied to `claude.exe` inside the run's own `stage/` directory, spawned against the
loopback interface, left alive for 35 s — the default scan interval is 10 s, so at least three ticks
see it present rather than only its start and its end — then terminated and deleted. It is harmless
by construction: 45 KB, loopback only, and its `-n` count bounds its own lifetime if the actor dies
before the terminate step.

That 35 s is measured against the *configured* interval, which is why arm A waits for the sensor's
cadence to settle before the first step rather than starting at its first completed scan — see
[Arm A](#when-the-run-may-start-and-when-it-may-stop).

## The catalogue

`expected.ndjson` is written by the actor **as a by-product of executing the steps**, one line per
event, never ahead of the run. Each line is built from what was captured at the moment the step
ran — the pid the OS handed out, the absolute path the copy landed on, the instant read off the
clock. A hand-written catalogue is a guess about a machine, and a guess is not a basis for scoring.

The field names are the minimal ECS subset the plan calls for: `@timestamp`, `event.kind`,
`event.category`, `event.type`, `event.action`, then `process.*` or `file.*`, then a `bench` block
naming the scenario, the step and the expectation the step claimed.

Three rules the catalogue enforces in code rather than by convention:

- **It refuses a line it did not observe.** A missing pid, a pid that is not a positive integer, a
  timestamp that is not a real UTC instant, an empty path — each throws, naming the field and the
  step, instead of becoming a plausible-looking row a later metric would count.
- **A field that was not observed is omitted, not set to `null`.** This is the opposite convention
  from `manifest.json` on purpose: a manifest entry is a slot that exists whether or not the probe
  won, so absence has to be spelled out, while an ECS document is a bag of observed fields and a
  `null` in one reads as a measured null.
- **Nothing reconstructed is written as if observed.** `process.args` is recorded because it is
  exactly the argv the actor handed `CreateProcess`; `process.command_line` is absent because the
  actor never saw the string the OS assembled, and a re-quoted guess at it could be mistaken for an
  observation by the join in B2.5. Where Node reports a terminating signal instead of an exit code
  — which is what a `kill()` on Windows produces — the signal is recorded under
  `bench.terminationSignal`, because ECS 8.11 has `process.exit_code` and no field for it.

A step that fails to execute is recorded as failed, the remaining steps are skipped, and the run
fails. It emits nothing: the catalogue must never contain a row that reads as if a step had
succeeded. The catalogue that survives a failed run holds exactly the events that did happen.

Everything above is still only intent plus the fact of execution. The catalogue never confirms
itself — every row is confirmed against an independent oracle before any metric counts it.

## Arm A — what the sensor recorded

In arm A with a scenario, `run.js` runs AEGIS itself across the steps and writes what it recorded to
`observed.ndjson`, in the same ECS subset as the catalogue.

The source is the product's own hash-chained audit log — `userData/audit-logs/aegis-audit-<day>.json`
— and **not** a bench-only channel inside the main process. A capture path that exists only while
the bench is running measures the bench. Nothing was added to `src/` for this: the run reads what
AEGIS already writes when nobody is benching it.

### Running the product

AEGIS is started as `electron .` on a **run-scoped Electron profile** under the OS temp directory,
via the stock `--user-data-dir` switch. That changes where the product writes, never how it observes,
and it buys three things a bench needs: the audit file is written by this run alone, so its hash
chain starts at GENESIS and a verdict on it is a verdict on our own records; the run does not inherit
whatever `scanIntervalSec` the developer last saved, nor append to their real audit trail; and the
single-instance lock lives in the profile, so a bench run does not collide with an AEGIS the user
already has open. The profile is deliberately **not** inside the repository — `src/main/file-watcher.js`
watches the project directory, so an audit write there would raise a file event, which is logged to
the audit, which is a write.

The run needs a built renderer (`npm run build:renderer`). Without `dist/renderer/index.html` the
main window never reaches `ready-to-show`, the deferred subsystems that own the sensors never start,
and the sensor refuses rather than letting the run act into a dead app.

### When the run may start, and when it may stop

Readiness is the sensor's own report, never a sleep. AEGIS logs `DEBUG [scan] process {ms, agents}`
after a completed process-scan tick, and mirrors it to stderr while unpackaged. One such line means
the sensor is alive. **Two of them under 20 s apart** mean something more, and it is what the run
actually waits for: AEGIS spends its first minute on a startup schedule that scans at three times the
configured interval, so a run that begins at the first tick acts into a ~37 s gap — and S1's subject,
alive for 35 s, is then never in front of a scan at all. That is a harness artefact, and it produced
an arm-A run that could not observe a process start or end no matter how well the sensor worked.

Afterwards the sensor is given three more completed ticks. Not one: AEGIS reports a process end only
after `session-tracker.js`'s grace of two consecutive scans that missed it, so 2 + 1 is the smallest
number that lets the product reach its own conclusion.

Stopping is a kill, and that is a limitation rather than a preference — AEGIS has no external
graceful-shutdown path, since its window `close` handler calls `preventDefault()` and hides to tray,
so only `taskkill /F` ends it and `/F` skips `before-quit → audit.shutdown()`. The kill is therefore
preceded by a drain longer than the audit logger's 5 s flush interval, which is what makes the last
records durable.

`expected.ndjson` is written **after** the sensor is stopped. The run directory sits inside the
watched project directory, so writing the catalogue while the sensor is live puts a file creation the
harness made for itself into the sensor's own answer.

### The mapping

| audit record | ECS shape | what the audit does NOT carry |
|---|---|---|
| `agent-enter` | `process.start` | image name, executable path, OS birth time |
| `agent-exit` | `process.end` | exit code, terminating signal |
| `file-access` / `config-access` + `created` | `file.creation` | owner pid, size, hash |
| `file-access` / `config-access` + `deleted` | `file.deletion` | owner pid |

pid is the only join key the audit gives a process event; path is the only one it gives a file event.
The display name AEGIS resolved (`"Claude Code"`) is **not** written into `process.name`: it is not
the image name, and a join would read it as one. It rides `bench.agent`, next to `bench.instanceId`
and the sensor's own `bench.attribution` verdict. `instanceId` encodes the OS birth time as
`"<pid>:<ms>"` and is carried verbatim, never parsed — reconstructing an instant out of an identity
string would be a derivation dressed as an observation.

Everything the sensor observed with no home in that subset — network connections, anomaly alerts,
`modified` and `accessed` file events — is not written, because a fifth shape would stop being the
same subset as the catalogue. It is **tallied by type and action** in `observed.meta.json` and
printed at the end of the run, so what was left out is visible rather than absent.

The window is `[the first step, the sensor's stop] ± 250 ms`. It opens at the first step and not at
the run's `startedAt`, because between the two the sensor is started and waited for, and its start-up
burst is a fact about the machine rather than about this scenario. The epsilon is small on purpose:
both processes read one clock and every audit timestamp is taken after the thing it describes, so
both ends are inert by construction and a generous value would only pull that burst in.

### What fails a run

`bench/lib/observed.js` re-implements the chain check rather than importing
`src/main/audit-hashchain.js`: a sensor is never its own oracle, and a disagreement between the two
cannot be a finding if both sides run the same code. A unit test pins the re-implementation against
records AEGIS actually wrote, hashes included.

- **A broken chain** — an interior line that does not parse, a seq that is not its line number, a
  hash that does not recompute. The run exits 1 and takes no record out of the file. Not "skip the
  record and carry on": a quietly shortened observation set reads exactly like a sensor that saw less.
- **A `buffer-overflow-drop` marker inside the window.** That is the product stating on disk that it
  threw records away, from the interval the run is about to call observed.
- **Zero observations.** An empty `observed.ndjson` is indistinguishable from "the sensor ran and saw
  nothing", so none is written; the reason goes to `observed.meta.json` instead.
- **A sensor that will not start.** Refused before any step runs — an arm-A run whose sensor never ran
  is an arm-C run under the wrong name.

The one thing that is not a refusal is an unparseable **last** line: the kill can land mid-append, and
a torn trailing line leaves a valid prefix. It is dropped and the drop is recorded, so a run that may
be missing one observation says so.

### Reading a capture

`observed.meta.json` is written in arm A whether the capture succeeded or refused, and holds the
profile path, the audit files read, the window, every completed scan tick, the tally of what did not
become an observed line, and the failure reason if there was one. Two of its fields answer questions
a coverage number cannot answer by itself:

- **`sensor.ticksWhileProcessAlive`** — scans that fell inside the scenario's own process lifetime.
  Zero means the process was never in front of the sensor, and anything missing about it is not a
  coverage result.
- **`sensor.steadyCadence`** — false means the steps ran against the startup schedule, and every
  figure from that run describes that regime rather than the configured one.

### What the sensor cannot see, and why

Two observations in arm A exist only because of where things sit, and both are worth knowing before a
number is read as a property of the sensor:

- **File creation and deletion are seen because the run directory is inside the repository.**
  `src/main/file-watcher.js` watches the project directory to a depth of 5, and
  `bench/runs/<id>/stage/claude.exe` is four levels down. A stage directory outside the repository
  produces no file events at all.
- **The readiness signal exists because the app runs from source.** `logger.js` mirrors to stderr only
  while `isDev` — that is, `!app.isPackaged`. Benching a packaged build would need a different signal.

## The Sysmon oracle — B2.3

The oracle column runs in the two arms whose definition includes Sysmon, **A and B**, and writes
two files: `oracle-loss.json` always, and `oracle-sysmon.ndjson` when there is at least one record
to put in it. It does not reach `run-report.json`, and that has not changed: `run-report.json`
still scores the sensor against an UNCONFIRMED catalogue and says so. Confirming the catalogue
against this column is a separate artefact written by a separate entrypoint — `metrics.json`, from
`bench/score.js`. See [The metrics](#the-metrics--b25).

`bench/lib/oracles/sysmon.js` imports nothing from `src/` and nothing from `bench/lib/observed.js`
either — that module is the sensor side, and an oracle sharing code with the thing it confirms
stops being independent. The two path helpers are duplicated on purpose.

### Three layers, and only two of them are proven

| layer | what it is | status |
|---|---|---|
| RAW | a real `Microsoft-Windows-Sysmon/Operational` channel → `Get-WinEvent` → EventRecord XML | **LIVE-UNVALIDATED** |
| NORMALIZED | EventRecord XML → canonical oracle record → `oracle-sysmon.ndjson` | proven offline |
| DERIVED | matching the oracle against the catalogue, and any metric over it | built (B2.5), and no stronger than the layer above it |

`readChannelXml` is the ONE function that crosses the raw boundary, it is injectable, and **no
test in this repository has ever executed it**: the machine this was built on runs Windows 11 Home
with no Sysmon installed. A green suite is not a claim about EVTX ingestion. **No binary `.evtx`
file is fabricated anywhere** — a synthetic EVTX container would test our imitation of the Windows
Event Log rather than Windows. The normalizer is tested against clearly-labelled synthetic XML in
the documented shape, and `tests/main/bench/oracle-sysmon.test.js` says so in its own docblock.

Two design choices in the reader exist to keep .NET's clock out of the pipeline. It emits
`$_.ToXml()` and never the `TimeCreated` property, which `Get-WinEvent` hands back as a `DateTime`
with `Kind=Local`; and it does **not** filter by time, because a `-FilterHashtable`
`StartTime`/`EndTime` would mean building .NET `DateTime`s out of our instants. The window is
applied in JavaScript over the XML's own `System/TimeCreated@SystemTime`, where it is testable.

### The event set

RESEARCH-BASELINE §10's oracle column — 1/2/3/5/11/22 — plus **26 FileDeleteDetected**, ratified
2026-08-14. Four have a shape in the catalogue's ECS subset; the rest are real observations the
subset has no room for and are **tallied, not dropped**, exactly as `observed.js` tallies what the
audit records that the subset cannot hold.

| event | treatment |
|---|---|
| 1 ProcessCreate | `process/start` |
| 5 ProcessTerminate | `process/end` |
| 11 FileCreate | `file/creation` |
| 26 FileDeleteDetected | `file/deletion` |
| 2, 3, 22 | counted under `records.shapelessByEventId` |
| 23 FileDelete | **never a deletion** — see below |
| 255 Error | its own loss signal |
| anything else | `refused.unsupportedEventId` |

**23 is not 26.** Microsoft documents 23 as additionally saving the deleted file into
`ArchiveDirectory`, and 26 as "similar behavior but without saving the deleted files". The bench
config enables 26 and never 23, so a 23 arriving at the parser means the running configuration is
not the one the manifest names — it is recorded as exactly that finding and never accepted as a
deletion observation. Whether an installed binary requires or touches `ArchiveDirectory` when 26 is
configured is **LIVE-UNVALIDATED**: neither primary page settles it, and nothing is invented here.

### What a normalized record keeps

Only what that event carried. A field the event did not expose is **omitted**, never nulled — the
B2.2 convention. **Nothing is copied between events**: an EID 5 record gets no command line, no
parent and no exit code, because Sysmon's terminate event has none, and the EID 1 that shares its
`ProcessGuid` is not merged into it. `process.name` is `basename(Image)`, a string derivation of an
observed field and the image name the product's own audit never persists.

`ProcessGuid` is **opaque**. It is retained verbatim and compared only for EQUALITY between Sysmon
events. It is never parsed, never decoded into a timestamp, and never turned into an AEGIS
`instanceId`. Guid equality pairs an EID 5 to its EID 1; **pid is not a fallback key**, because two
generations sharing one pid are two generations and pairing them by pid would manufacture a
lifecycle the OS never had. A terminate whose guid matches no creation in the window is UNPAIRED,
and two creations sharing one guid are AMBIGUOUS. That accounting lives beside the records, in
`oracle-loss.json`, and is never written back into them. EID 1 ordinality remains the truth about
process identity; guid equality is an additional fact beside it.

### The two timestamps

`System/TimeCreated@SystemTime` and EventData `UtcTime` are two representations written by two
layers, and **no delta between them is computed here**. `@timestamp` is `SystemTime` truncated —
never rounded — to the catalogue's millisecond format; the untruncated original stays in
`bench.timeCreatedSystemTime` and Sysmon's own `UtcTime` stays verbatim in `bench.utcTime`, in
Sysmon's own format, unparsed.

A `SystemTime` that does not end in `Z` is **REFUSED, not converted**. The offset arithmetic that
turns `…T08:00:00-04:00` into `…T12:00:00Z` is exactly the arithmetic that turns a reader's local
time zone into four hours of apparent latency, so it does not exist in this module.

**This module declares no epsilon.** The ~2 s figure in RESEARCH-BASELINE §10 is a tolerance for
comparing Sysmon's own two representations; guest-clock uncertainty is a different quantity and is
unmeasured. The two are never merged. The oracle window is `[the run's startedAt, the moment
collection began]`, both read off the harness's own clock, so nothing the scenario caused can fall
outside it and no tolerance has to be invented to pull it in.

### `oracle-loss.json`

Written on every path, including — especially including — the one where nothing was collected.
**It never reports a loss of zero.** What can be counted is counted; what cannot be established
offline is an explicit `{value: null, unavailable}`, the manifest's own convention.

- **`records`** — read, normalized, out of window, and the shapeless tally. With no read at all it
  is the absence itself, not a row of zeroes that would read as a clean collection.
- **`refused`** — malformed documents, foreign providers, missing required fields, non-UTC
  timestamps, and unsupported event ids. Each names an index and a reason.
- **`config.filterAccounting`** — an event this config excludes is never emitted, so it is not
  lost; but Sysmon publishes no filter-hit counter, so a run cannot count what it declined to see
  either. Records intentionally filtered out and records that never occurred are indistinguishable
  from here, and neither is reported as loss.
- **`eventRecordIds`** — the collected ids, and the gaps. **A gap is not a loss count**: the id is
  assigned per channel, and every Sysmon event this run did not collect legitimately consumes one.
- **`sysmonErrors`** — EID 255, reported as itself and never folded into another count.
- **`channelRetention`** — `null` with a reason. Whether the channel wrapped during a run would
  come from the log configuration, and no such probe runs here. Absent, not zero.

### Arm B is a PARTIAL calibration, and says so

Arm B is defined as **Sysmon + Procmon**, and B2.6 does not exist. There is no new report field for
that: the manifest's `oracles.procmon` entry is `unavailable` with the reason, `armDescription`
names both oracles, and `run.js` sweeps `oracles` alongside `host` and `sensor` for absent facts
and prints them at the end of the run. A B run therefore states which of the two columns it
produced at the moment of measurement rather than looking complete.

Arm B exits **1** when it collected no oracle record — it produces nothing else, so an empty
oracle column is an empty run, exactly as an empty observation set is in arm A. Arm A keeps its own
exit code: it still has a sensor column, and its missing oracle is recorded as an absent fact.

`manifest.oracles.sysmon` is the reserved `{version, configPath, configSha256}` contract and
nothing is added to it. `configSha256` is taken over the config file's **exact bytes** at
`configPath` — never over the path, never as a committed constant, because `.gitattributes` puts
this file under `text=auto` and a hard-coded digest would go red on a checkout with other line
endings while naming the same configuration. `version` comes from a read-only probe for an
installed Sysmon service and **is never invented**: no string off a web page, no default. Where the
probe does not answer, the entry is absent with the reason, and the path and digest name the
configuration the run *would* have used rather than evidence that it was applied.

## The join — `run-report.json`

At the end of an arm-A run the catalogue and the observation set are joined, and the result is
written to `run-report.json`: per category, how many events were expected, how many the sensor
accounted for, and how long it took. This is the first row of the measurement matrix and it scores
the sensor against the catalogue only, and the catalogue is still **unconfirmed** here. That is not a
gap left open: `run-report.json` is deliberately the sensor-versus-catalogue row of the matrix and
nothing in it moved when B2.5 landed. Confirmation lives one artefact along, in `metrics.json` —
see [The metrics](#the-metrics--b25) — where a recall figure is taken over the confirmed rows only.

`bench/lib/join.js` **reads and writes nothing**. It takes two arrays and the window parameters and
returns an object; `run.js` owns every byte that touches the disk. A unit test asserts the module
requires no filesystem API at all, because a join that could reach for a fact it was not handed
could also disagree with the files the report claims to be about.

### What joins to what

| category | key | why that key and no other |
|---|---|---|
| `process/start`, `process/end` | `process.pid` | pid is the only join key the audit gives a process event |
| `file/creation`, `file/deletion` | `file.path`, case- and separator-normalised | path is the only one it gives a file event; the product does not persist the owner of a file event |

**Nothing joins on a name.** AEGIS persists the display name it resolved — `"Claude Code"` — and
never the image name, `claude.exe` (B2.3). They are different strings about different things, and a
join that treated one as the other would manufacture matches out of a naming coincidence. The
display name rides `bench.agent`, where no join reads it.

Path normalisation folds separators to `\` and the whole string to lower case, because
`X:/dev\project\AEGIS` and `x:\dev\project\aegis` name one file on the platform the bench runs
on. That is a Windows fact rather than a general one: a bench on another platform would need a
different rule, not this one relaxed.

The window is `[expected.@timestamp, expected.@timestamp + maxLatency]`. **One observed event cancels
at most one expectation**, and one expectation is cancelled by at most one observation: every
eligible pair is scored by its latency and taken in ascending order, so the nearest pairing wins and
a later expectation may take an observation an earlier one could also have used. Ties break on file
order, so the report is reproducible from the two files it was derived from.

### Where `maxLatency` comes from

`maxLatency` is **three scan intervals**, and the interval is read off the run rather than written
into the code. Two sources, in order, each one a thing that happened:

1. `scanIntervalSec` in the run-scoped profile's `settings.json` — the configuration the sensor
   loaded. AEGIS writes that file as soon as it persists anything, and seeing an agent is enough.
2. The median gap between the scan ticks the sensor itself reported **after its cadence settled**.
   Only after: before that it is on the startup schedule at three times the configured interval, and
   those gaps describe the wrong regime. No run has needed this source yet — every arm-A run so far
   found the settings file — so it is pinned by a unit test rather than by a run.

Neither answered → the interval is **absent and stays absent**. There is no third source, because
the third source would be a literal. The report is still written, every recall in it reads
`unavailable`, and the run exits 1: a recall figure is a statement about a window, and a window
nobody derived is not one.

It is not in `manifest.json`, and cannot be: `manifest.collect()` runs before the sensor starts, so
the profile it would have to read does not exist yet, and a value copied out of the product's
defaults would be `src/` contributing to its own measurement record. It is recorded in
`observed.meta.json` as `sensor.scanInterval` — `{value, source}`, the manifest's own convention —
and again in the report as `join.maxLatencySource`.

Three intervals is **not** generous for `process/end`. AEGIS reports an end only after
`session-tracker.js`'s grace of two consecutive scans that missed the process, so that category's
floor is already two intervals plus the scan that concludes it. A `process/end` that lands past the
bound is a miss produced by the window, which is why every miss in the report names the nearest
observation there was and the signed distance to it — including a **negative** one. The actor stamps
around the step and the audit stamps inside its own `log()` call, so an observation stamped a few
milliseconds before its expectation is a stamping artefact, and the report says that instead of
counting it as a sensor failure.

### What the report says

- **Per category** — `expected`, `matched`, `missed`, and `recall` both as the string `matched/expected`
  and as a number. Where a number would be a lie the number is `null` and a `recallUnavailable`
  line says why: a category the catalogue never expected is `0/0`, not a recall of 0.
- **Latency** — every pair's `observedTs − expectedTs` in milliseconds, and per category a `p50` and
  a `max` over the matched pairs. With one or two pairs — which is what one S1 run produces — the
  `basis` field says those figures **are the points themselves, not statistics over a sample**.
- **`unmatchedObserved`** — observations inside the run window that cancelled nothing, each with the
  reason it could not. They are not debris: an unmatched observation is either sensor noise or
  activity on the machine the scenario did not cause, and both are findings.
- **`processObservable`** — `false` when no completed scan tick fell inside the scenario's own
  process lifetime. Then the process categories read `0/N (structurally unobservable)` with a null
  recall number: the process was never in front of the sensor, so this is not a coverage result and
  it is named rather than dissolved into the general `missed`. **The run is still valid and still
  exits 0** — what failed is the phase alignment, not the sensor, and not the run. If such a run
  matched something anyway, the category carries a `note` saying the tick accounting and the
  observation disagree.

**There is no confidence figure in this report and there will not be one.** Every number it carries
is a count of rows or a difference of two timestamps.

## The metrics — B2.5

`bench/score.js` takes one recorded run directory and writes two files into it: `matched.ndjson`,
one line per catalogue row carrying both of its verdicts, and `metrics.json`, the counts over them.
`bench/lib/metrics.js` does the arithmetic and, like `join.js`, **reads and writes nothing** — a
unit test asserts it names no filesystem API and that nothing under `src/` appears anywhere in its
module graph.

It needs no sensor, no scenario, no oracle channel and no built renderer, and it is a pure function
of the bytes in the directory: the same run scored twice produces byte-identical output, because
nothing about the moment of scoring reaches the files.

### Two arcs, and there is no third

```
              expected.ndjson   (the catalogue — the fixed point)
                  /                            \
   confirmation  /                              \  visibility
  oracle-sysmon.ndjson                      observed.ndjson
```

Both columns are scored against the catalogue and never against each other. **No figure anywhere in
`metrics.json` is derived by matching the oracle against the sensor**, and one refinement was
rejected on exactly that ground rather than left unmentioned — see
[the rejected refinement](#the-refinement-that-was-rejected).

The two arcs are independent in a way worth knowing: confirmation does not use the join window at
all, so a run whose `sensor.scanInterval` came back absent still produces a complete confirmation
column, with only the sensor column unavailable.

### What confirms a catalogue row

| category | Sysmon event | key | what that event cannot settle |
|---|---|---|---|
| `process/start` | 1 ProcessCreate | `process.pid` **and** `process.executable` | an EID 1 carrying no `Image` cannot satisfy the key and confirms nothing. **pid alone is not a fallback**: two generations sharing one pid are two generations |
| `process/end` | 5 ProcessTerminate | `process.pid` alone | Microsoft's field list for EID 5 is `UtcTime`, `ProcessGuid`, `ProcessId` — there is no image to key on, and `sysmon-bench.xml` logs terminations machine-wide, so a same-pid coincidence inside the window cannot be separated. `ProcessGuid` is carried beside the confirmation as evidence and is never a key; pairing an EID 5 to its EID 1 is `oracle-loss.json`'s lifecycle accounting and is deliberately not re-derived |
| `file/creation` | 11 FileCreate | `file.path` | EID 11 carries no hash, so the sha256 and size the catalogue observed are corroborated by nothing. It reports create and overwrite; an append produces no EID 11 |
| `file/deletion` | 26 FileDeleteDetected | `file.path` | 23 is never read as a deletion — `lib/oracles/sysmon.js` refuses it at the source |

These are **not** `join.js`'s keys. Those are the bounds of the audit, which persists a pid for a
process event and a path for a file event and nothing else. The oracle is not information-starved in
the same way, so `process/start` takes two independent fields and a same-pid coincidence cannot
confirm it.

**No window and no epsilon.** The oracle window is `[the run's startedAt, the moment collection
began]` and the catalogue is written inside it, both ends read off the harness's own clock — so
everything the scenario caused lies inside both columns by construction and nothing has to be pulled
in by a tolerance. The ~2 s figure in RESEARCH-BASELINE §10 is a tolerance between Sysmon's *own two
representations*; guest-clock uncertainty is a different quantity, it is unmeasured, and the two are
never merged. Each confirmation records `stampDeltaMs`, oracle minus catalogue — an observation, and
explicitly **not** a latency and not a measured clock offset. No bound anywhere is derived from it.

**Cardinality**, the same rule the join uses: one oracle record confirms at most one catalogue row
and one row is confirmed by at most one record; the smallest absolute stamp delta wins, ties break on
file order.

**Path comparison, and a finding.** `lib/catalogue.js` and `lib/observed.js` write every path
through the recording rewrite in `lib/paths.js`; **`lib/oracles/sysmon.js` writes none.** So on a
live run the catalogue names a staged binary under the recorded clone root and the oracle names it
under the real one, and a comparison that skipped the rewrite would fail on every path key of every
run while looking like an oracle that saw nothing. B2.5 closes it on the comparison side: both sides
are folded through `neutralizePath` and then through `join.normalizePath`, over values read from
disk, and neither file is modified. The write-side asymmetry is left standing on purpose — it belongs
to the oracle writer and closing it changes that artefact's bytes — and is recorded in
`metrics.json` under `oracle.pathComparison`, which also names the residual: the rewrite moves the
clone root of the tree doing the scoring, so a run scored on a different machine holds oracle paths
that cannot be folded onto its catalogue.

### Oracle coverage bounds what may be scored at all

A category is **measurable** in a run when the oracle collected, an event of this column observes
that category, and the configuration **the run itself recorded** enabled that event —
`oracle-loss.json` `config.enabledEventIds`, beside the config's sha256. The authority is that
record and never `bench/oracles/sysmon-bench.xml`: the committed file can have changed since the run,
and a coverage claim read off it would describe a configuration nothing was measured under.

An unmeasurable category carries `null` in every figure and a `reasonCode`. **It is never scored 0.**
A zero is a measurement, and no measurement was made — the same distinction `manifest.json` draws
between "we read 320 processes" and "we could not read the process count".

Two ways to be unobservable, and they are not the same:

- **No event exists.** Sysmon has no file-read event at all: EID 11 reports create and overwrite and
  nothing else, and no event in the §10 oracle column observes a read or an append. Were the
  catalogue's ECS subset to grow a `file/read` or `file/append` shape, it would be **unmeasurable
  under this oracle** — not undetected. `ORACLE_BLIND` in `lib/metrics.js` names both with the
  reason, and the static set is checked *before* the configuration, so a category no event observes
  never reads as one that could be switched on.
- **The event exists and the run did not enable it.** That one names the EID and the config digest,
  and says that the absence of a confirmation is evidence about the configuration rather than about
  the machine.

Where a run's configuration excludes a category and oracle records of it are in the file anyway, the
coverage block carries a `contradiction` line: nothing is guessed, and no row is confirmed off a
record the recorded configuration says could not have been emitted.

### The lifecycle of a catalogue row

| state | condition | where it counts |
|---|---|---|
| **confirmed** | exactly one oracle record confirmed it | `confirmed`; **the only rows that become ground truth** |
| **unconfirmed** | the oracle collected, the category is measurable, and no record confirmed it | `unconfirmed`, listed with its reason; **excluded from every recall and precision denominator**, and never a sensor miss |
| **unmeasurable** | its category is not measurable in this run | the whole category is `null` |

The reason codes are a closed list: `oracle-not-collected`, `category-unmeasurable`,
`category-not-scored`, `row-carries-no-oracle-key`, `no-oracle-record-for-key`,
`oracle-record-taken-by-a-nearer-row`.

**"Failed to execute" is not on that list, and cannot be.** A step that fails emits no catalogue row
at all — see [The catalogue](#the-catalogue) — so it is a state of a *step* and never of a row.
`lib/actor.js` returns a status per step and `run.js` prints it without writing it, so **no file in a
run directory carries step outcomes**. `metrics.json` records that as an explicit
`scenarioSteps: {value: null, unavailable: …}` naming the missing artefact, rather than inferring it
from a catalogue that is shorter than its scenario. Closing it would be a `steps.json` written by
`run.js`; that is not part of B2.5.

Two oracle-side counts sit beside the row counts and are never folded into them:
`oracleRecordsUnusable` (records of the category carrying no key — an EID 1 with no `Image`) and
`oracleRecordsOutsideCatalogue` (records that confirmed no row: real observations the scenario did
not claim).

### The figures, per category

Everything below is **per category**. There is no accuracy figure, no F1 and no headline number in
`metrics.json`, and there will not be one — every figure is a count of rows or a ratio of two such
counts.

**Confirmation — how much of the catalogue an independent source stood behind.** This is what arm B
exists to establish.

```
catalogued(c)       = catalogue rows of category c
confirmed(c)        = rows an oracle record confirmed
unconfirmed(c)      = catalogued(c) − confirmed(c)
confirmationRate(c) = confirmed(c) / catalogued(c)
```

`null` when the category is unmeasurable, and `0/0` with no number when the catalogue holds no row of
it — a rate over nothing is not 0.

**Visibility — what the sensor did about the rows that ARE ground truth.** The vocabulary is MITRE
ATT&CK Evaluations', borrowed rather than invented (§10).

```
groundTruth(c) = confirmed(c)                                   ← the denominator
detected(c)    = ground-truth rows the sensor recorded inside
                 [expected, expected + maxLatencyMs]            → detection category Telemetry
notDetected(c) = groundTruth(c) − detected(c)                   → detection category None
recall(c)      = detected(c) / groundTruth(c)
latencyMs(c)   = p50 and max over the detected pairs, with the same `basis` string join.js uses
```

`General`, `Tactic` and `Technique` — the Evaluations' Analytic Coverage tier — are **not used**.
What a bench run compares is the product's audit record against an expected event, which is
telemetry; labelling it with an analytic tier would claim an interpretation nothing here measures.

Every `None` carries a modifier saying which kind of `None` it is. `delayed-beyond-bound` is the
Evaluations' `Delayed` under this bench's own window. The other two —
`stamped-before-the-expectation` and `observation-taken-by-a-nearer-expectation` — have no
Evaluations counterpart, so they are named locally and **marked as local** rather than dressed in a
standard name they do not come from.

**Precision — a LOWER bound, and labelled as one.**

```
truePositives(c)        = detected(c)
matchedUnconfirmed(c)   = observations that cancelled an UNCONFIRMED row   ← excluded from both sides
unaccounted(c)          = observations that cancelled nothing
precisionDenominator(c) = truePositives(c) + unaccounted(c)
precision(c)            = truePositives(c) / precisionDenominator(c)
```

The partition is exact by construction: every observation of the category is a true positive, a
`matchedUnconfirmed`, or `unaccounted`.

It is a lower bound because every unaccounted observation is charged against precision, and some of
them are real machine activity the scenario did not cause rather than sensor noise. This bench does
not separate the two.

### The refinement that was rejected

Splitting `unaccounted` into "real activity" and "sensor noise" by asking whether the **oracle** also
saw each one would tighten the denominator and make precision a measurement rather than a bound.

**It is refused.** That question is a diff of two live streams, and the catalogue is the fixed point
precisely so that no metric is ever computed that way. The rejection is carried in `metrics.json`
under `rejected.oracleVsSensorCorroboration`, so it is a decision on the record rather than a gap a
later reader closes by accident.

### What score.js refuses, and what it writes anyway

A directory nobody can fully read produces **no output at all**, exits 1, and names the reason: a
missing, unreadable or unparseable file · an NDJSON line that does not parse, by file and line
number · `manifest.json`, `observed.meta.json` and `oracle-loss.json` disagreeing about `runId`,
`scenario` or `arm` — that directory was assembled out of two runs, and a score across it would
confirm one run's catalogue against another run's oracle · an accounting that counts normalized
records with no `oracle-sysmon.ndjson` holding them · a capture record carrying no
`sensor.scanInterval` or no `sensor.ticksWhileProcessAlive` · **arm C**, whose definition holds no
oracle column at all, so a score over it would be the sensor marking its own work.

Two absences are the opposite case and **are** written, because they are results:

- **An oracle that ran and collected nothing.** Every category comes back unmeasurable, no row is
  ground truth, and no sensor figure may be read as coverage. Exit 1. The absent
  `oracle-sysmon.ndjson` is named in the provenance rather than left out of it — an empty file would
  be indistinguishable from "the oracle ran and saw nothing", which is a different claim.
- **A join window that could not be derived** (`sensor.scanInterval` present and `null`). The
  confirmation column is complete; every sensor figure reads `unavailable`. Exit 1 — the same
  outcome the live run and the replay give.

**Arm B** is scored as a confirmation column with no sensor block at all: that is what the arm is.
Its `matched.ndjson` rows carry the oracle verdict and a null detection category.

### A recorded score is evidence

A directory that already holds a `metrics.json` is **compared against, never overwritten**: the
rebuild is reported as identical or as differing, with the first differing byte, and nothing is
written. `--out <dir>` puts a fresh score somewhere else, which is how the committed fixtures under
`tests/fixtures/bench/derived/` are scored without being touched. A verification that overwrites its
own target is not one.

`metrics.json` carries the sha256 of every file it was built from, so a score can be walked back to
the exact bytes it was taken over. Digests and not modification times: a digest is a fact about the
bytes and survives a copy, and nothing about the moment of scoring may reach the output.

### What is committed, and what it does not establish

Three DERIVED models under `tests/fixtures/bench/derived/` — `M1-fully-confirmed`,
`M2-unconfirmed-rows` and `M3-category-unmeasurable` — are the inputs to the gates on all of the
above. They are hand-written directories, not recordings: no process was created, no sensor ran, and
**no Sysmon binary was installed, configured or queried**. The RAW layer of the oracle stays
LIVE-UNVALIDATED and nothing here changes that; what these models pin is the arithmetic and the
honesty conditions on it, never the accuracy of the sensor. Their own README states each case.

`tests/main/bench/metrics-mutation.test.js` is the injection proof on the one rule the block turns
on: it removes the confirmed-rows-only filter from a throwaway copy of `lib/metrics.js` and requires
`M2`'s figures to move — recall from `1/1` to `2/3`, `notDetected` from `0` to `1`, the precision
denominator from `2` to `3`. Those are the exact values `metrics.test.js` asserts, so the mutant
turns committed assertions red rather than merely producing different numbers.

## Trace replay — the format

Two different things in this repository are called replay, and they are not the same thing:

| | what it replays | what it needs |
|---|---|---|
| `bench/replay.js` | one recorded RUN's `run-report.json`, rebuilt from the four files that run left behind | nothing from `src/`; no sensor, no scenario, no renderer |
| `bench/trace/` | one recorded stream of OBSERVATIONS, pushed back through the product's own detection and attribution code | the `src/` modules named below, and a pinned environment |

A **trace** is an INPUT: what the sensors saw. Event Schema v1 — the product's audit record —
is the OUTPUT: what the product decided. Nothing in a trace describes a verdict, and the point
of the format is that the same bytes in produce the same verdicts out, so two sensor versions
can be diffed against one recording instead of against each other.

### Trace replay and the `src/` boundary

The rule the measurement column keeps is unchanged and is not weakened here: an oracle that
shares code with the thing it confirms is not independent, so a disagreement between them
cannot be a finding. Trace replay is not an oracle — it is the system under test, re-executed —
so the rule is lifted for it, name by name and in both directions:

| subtree | may import `src/` | why |
|---|---|---|
| `lib/oracles/*`, `lib/observed.js`, `lib/join.js`, `lib/catalogue.js`, `lib/actor.js`, `lib/manifest.js`, `lib/sensor.js`, `lib/report.js` | **no** | the measurement column; this is where `observed.js` re-implements the chain check rather than importing it |
| `trace/*` | **yes, read-only** | there is nothing to replay without the detection code itself |

What `trace/` loads today, exhaustively — a list, not a glob, so a module that starts being
loaded and is not named here is a change to this table:

| module | loaded by | what is used | why not a copy |
|---|---|---|---|
| `src/main/audit-hashchain.js` | `trace/schema.js`, `trace/environment.js` | `canonical`, `computeHash` | one hashing algorithm rather than a third implementation of it |
| `src/main/attribution.js` | `trace/environment.js` | `EVIDENCE_CODES` | the closed list is pinned into a trace, so a change to it is a refusal on READ instead of a silent diff |
| `src/main/rule-loader.js` | `trace/environment.js`; reloaded by `trace/wiring.js` | `_loadRules`; `reloadRules` | the rules are digested AS THE PRODUCT COMPILES THEM; `_loadRules` is the entry point that does not populate the module cache, so observing an environment does not change it. `reloadRules` is the product's own public reload |
| `src/main/audit-logger.js`, `src/main/baselines.js`, `src/main/config-manager.js`, `src/main/file-watcher.js`, `src/main/network-monitor.js`, `src/main/scan-loop.js` | `trace/wiring.js` (lazily, inside `wireGraph` — replay AND recording) | the published seams: `init(state)`, `_setDepsForTest`, `_resetForTest`, `_setSettingsPathForTest`, `_setBaselinesPathForTest`, `audit.init`/`shutdown`, `dedupFileEvent`, `logAuditForFile`, `doNetworkScan` | this IS the system under test — there is nothing to replay or record without the detection code itself. Loaded lazily so requiring the orchestration declaration does not pull the product |
| `src/main/platform/index.js` (transitively the platform module `pinnedSourceFiles` names — `win32.js` / `darwin.js` / `linux.js` — and that module's OWN dependency graph: on win32 `restart-manager.js`, `process-snapshot.js` and what they require; `posix-shared.js` elsewhere) | `trace/recorder.js` (lazily, only when a recording takes the default real providers) | `getFileHandles`, `getHotSensitiveHolders`, `getRawTcpConnections` | a recording wraps the REAL providers record-and-pass-through, and these are literally the un-injected defaults `file-watcher.js` and `network-monitor.js` hold. The two DNS defaults live in module-private closures and are MIRRORED in `recorder.js` instead — a named drift point, see "Recording a trace" |

Deriving a trace from a recorded run is the one place that does NOT move: an audit file the
product wrote is still verified with `lib/observed.js`'s own re-implementation, because that
check is evidence about the sensor. The trace's own chain is our format, not a claim about the
sensor, so it uses the algorithm above.

### The chain seed is the trace format's own

`trace.ndjson` is hash-chained the way a daily audit file is — `sha256(prevHash + canonical(record))`,
one link per line, seq equal to the line number — with two deliberate differences:

- **The seed.** `TRACE_GENESIS`, not the audit `GENESIS`. With a shared seed, keeping the two
  chains apart would rest on the top-level-`seq` gate both of today's verifiers take before they
  hash anything (`src/main/audit-hashchain.js` `verifyChain`, `lib/observed.js` `readChain`) — a
  gate `bench/` neither owns nor can freeze. With distinct seeds, no record of one file is ever a
  valid record of the other, at any position and under any future verifier. A verdict file keeps
  the audit seed, because the product writes it.
- **The preimage.** A trace's sequence number lives at `bench.seq` and is INSIDE the hash; the
  audit rule deletes a top-level `seq` before hashing. Moving a record therefore breaks a trace
  chain and is invisible to an audit chain.
- **The scope.** An audit chain restarts every day, inside one daily file. A trace chain runs the
  whole file; a trace has no days.

One more difference, and it is the one most likely to be inherited by accident: `lib/observed.js`
tolerates an unparseable LAST line of an audit file, because a live process appends to it and a
`taskkill /F` can land mid-write. A trace is written once, offline, from a recording that already
finished, so the same damage means the file is broken and is **refused**. A trace reader that
inherited that tolerance would silently drop the final observation of every trace it read.

### What a trace directory holds

```
<trace id>/
  trace.header.json    # the environment this recording pins; pretty JSON
  trace.ndjson         # the records, one per line, hash-chained
```

`.ndjson` and not `.jsonl` because every neighbouring artefact here is `.ndjson`; the bytes are
the same format and a second extension in one directory reads as a second format.

The **header** pins what a verdict silently depends on, and a reader compares every entry
against the tree and the machine it is about to replay on:

- `platform`, `pathSep`, `nodeVersion`, and `tz` — path resolution, the separator, the `win32`
  branch of `findOwningAgent`, the audit file's own name and the baseline hour bucket all read
  one of these.
- `clock.epochMs` — where the virtual clock starts.
- `digests` — content, not versions. A version string goes stale silently; a digest does not.
  The rules are digested three ways: the per-file content, the **enumeration order**
  (`classifySensitive` takes the FIRST matching rule, so the same files enumerated differently
  are a different tree for this purpose), and the compiled rule objects the loader produced. The
  agent database, `src/shared/constants.js`, `src/main/attribution.js` and the platform module
  that would actually be loaded each get one. Line endings are folded to LF before hashing —
  `.gitattributes` puts this tree under `text=auto`, so a byte digest would refuse a checkout
  that holds exactly the same content. Nothing else is normalized.
- `evidenceCodes` — the closed attribution list, in declaration order, compared element for
  element.
- `scope` — what this trace does NOT cover, in the manifest's own `{value, unavailable}`
  convention. A missing key is a refusal, not a default: "this trace does not cover process
  ticks" and "nobody said" must not collapse into one record.
- `neutralization` — a trace may be committed, so the clone root and the OS account name are
  rewritten (`lib/paths.js`, the same transform `manifest.js` applies). It is applied to EVERY
  string in every record, not to a list of path-shaped fields: an agent's `cwd` and an event's
  path have to move by one map, or `cwd-containment` stops matching and the trace quietly
  measures a different attribution than the one recorded.

### Record kinds

The closed list lives in `trace/schema.js`, **not** in a JSON Schema — the same choice
`lib/actor.js` makes for step kinds, and for the same reason: only the code that can execute a
kind can say which kinds exist.

| kind | what it carries | observation |
|---|---|---|
| `fs.event` | one chokidar event: `created` / `modified` / `deleted`, and a path | yes |
| `handles.tick` | a per-pid handle scan, as the platform provider answered it | yes |
| `rm.hot.tick` | a Restart Manager hot-cycle answer: `{pid, group, reason?}` per holder — `group`, not a path, because that is the field `_scanRmHolders` reads and writes into the event's `file` | yes |
| `net.tick` | a TCP table read plus the DNS answers that resolved its addresses | yes |
| `clock.advance` | the virtual clock moves forward | no |
| `population.set` | the agent population the sensors are handed from here on | no |

A kind marked **no** observed nothing. Those carry ECS `event.kind: "state"` and no
`event.category` or `event.type`: ECS has no category for "the harness moved its clock", and
inventing one would dress a replay parameter up as a measurement — the same reasoning that keeps
`lib/actor.js`'s `wait` step out of the catalogue. The observation kinds additionally carry
`bench.ambient`, holding `populationReliable` and `isOtherPanelExpanded`. Those are per-record
and not per-header on purpose: `populationReliable` decides whether attribution may look for an
owner at all, and it changes during a run.

`handles.tick` and `rm.hot.tick` may appear in either order — they are independent.
`scanAllFileHandles` diverts to the Restart Manager only when `getSensitiveHolders` is set
(`rmEnabled`), phase 1 never injects it (a header's `scope.rmFullPath` records why), and
`isHotReadScanActive` reads only `getHotSensitiveHolders`. What they DO share is
`_state.knownHandles`, so a path one tick already reported produces no event from the
other — the product's own words at `scanHotFileHolders`: "Shares _state.knownHandles with
the full scan → cross-cycle dedup". A trace author needs to know that, because the silence
it causes is the product working rather than the trace failing. It is a note, not a refusal:
there is nothing here a reader could legitimately reject.

The one-way switch is real, but it belongs to the FULL Restart Manager path —
`scanAllFileHandles` under `getSensitiveHolders`, which `_setDepsForTest` assigns only on a
truthy override and only `_resetForTest()` unsets, taking the watcher's debounce state with
it. Phase 1 excludes that path and says so in `scope.rmFullPath`; it has no record kind, so
there is no ordering for a reader to enforce.

### Refusals

Every refusal names one reason from a closed list in `trace/schema.js` and writes nothing: a
trace half-read is an input nobody recorded, and a verdict derived from one would name a run that
never existed. `schema-version`, `header-malformed`, `platform-mismatch`, `tz-mismatch`,
`digest-mismatch`, `evidence-codes-mismatch`, `scope-incomplete`, `unknown-kind`,
`record-malformed`, `chain-broken`, `envelope-mismatch`, `empty-trace`, `file-unreadable`.

A trace declaring a HIGHER `traceSchemaVersion` is refused, which is the opposite of what a
reader of the product's audit log must do — there `seq` is monotonic and skipping a record breaks
every hash after it, so an unknown field set has to be read past. A trace is an input, and a
partially understood input produces a verdict about some other input.

A **platform mismatch is refused, never converted.** `path.resolve`, `path.sep` and the
`process.platform === 'win32'` branch of `findOwningAgent` all differ, so a Windows trace
replayed on Linux would only look faithful. The practical consequence is that the suites which
can run in CI are the format, chain and refusal ones; verifying a recorded Windows trace stays a
local command, exactly as the rest of the bench does.

### The virtual clock

A replay reads the wall clock in more than twenty places, and one of them has no injection
point at all: `src/main/audit-logger.js` stamps `new Date().toISOString()` on every record it
writes. Its `init({now})` hook covers day rotation only. `src/main/baselines.js` reads
`new Date().getHours()`. Both are globals, and a global has to move before the module that
closes over it is compiled — which is why the clock arrives through `node --require` and not
through a seam:

```
AEGIS_TRACE_CLOCK_EPOCH_MS=<header.clock.epochMs> AEGIS_TRACE_TZ=<header.tz.name>   node --require bench/trace/preload.js <entrypoint>
```

Nothing in `src/` is patched. `Date` is replaced by a **proxy** over the real constructor, so
`Date.parse`, `Date.UTC`, `Date.prototype`, `instanceof` and calling `Date()` without `new` all
keep working, and `new Date(x)` with an argument is untouched — it names an instant the caller
already has. `performance.now()` reads as milliseconds since the clock's own epoch.

`setTimeout` and `setInterval` are **not** touched. A replay never starts the product's scan
intervals — cadence comes from the trace, as `clock.advance` records — and the one live timer
left is the audit logger's flush, stopped by calling the product's own `shutdown()`.

Time moves forward only, and only when a record says so. Going backwards is refused rather than
clamped: holding the clock still instead would let the watcher's 2 s debounce and the scan
loop's 30 s dedup window answer questions about an ordering the recording never had. Two
observations may share a millisecond, because machines do that.

**The failure this is shaped around is a preload that did not run.** A misspelled `--require`,
an unset variable, a wrapper that dropped the flag — each looks exactly like a preload that
worked, right up until the verdict cannot be reproduced. So the clock stamps a global marker and
`isInstalled` / `installedEpochMs` refuse by name without it; `readEpochMs` accepts only a string
of digits, because `Number('')` is `0` and `Number(' 12 ')` is `12`, so a lax parse would turn an
unset variable into the Unix epoch and a typo into a plausible instant and both would *run*; and
the throw is not caught, so Node exits non-zero before an entrypoint can produce a verdict on the
wrong clock. The suite spawns the negative case — same script, no flag — because a gate that only
ever exercises the working path proves the command ran, not that it inspected anything.

The time zone is applied **before** the clock, and that order is load-bearing: `process.env.TZ`
decides what the local-time getters answer, which is what `audit-logger.js` builds a daily file's
*name* out of.

### Replaying a trace

```
AEGIS_TRACE_CLOCK_EPOCH_MS=<header.clock.epochMs> AEGIS_TRACE_TZ=<header.tz.name>   node --require bench/trace/preload.js bench/trace/replay-trace.js <trace dir> [--out <dir>]
```

`npm run bench:replay -- <trace dir> [--out <dir>]` runs exactly that: the wrapper
(`bench/trace/bench-replay.js`) reads the two values out of the trace's own header, sets the
environment, and spawns the entrypoint under the preload. Every decision about the trace —
validation, refusals, the verdict — stays in `replay-trace.js`.

Both variables come out of the trace's own header, and the zone is passed back **verbatim**:
the runtime canonicalizes zone names, so `TZ=Etc/UTC` makes `Intl` report `UTC`, and a header
naming the alias would be refused for a difference that is not one. A header always carries what
the runtime reported, so the round-trip holds.

Exit codes follow `bench/run.js`: **2** the invocation was wrong and nothing ran · **1** the trace
was refused or the replay could not complete · **0** the replay finished and the verdict was
written.

`--out` aside, a replay REPLACES its output directory, where `bench/run.js` refuses to write a run
directory twice. The difference is what the two things are: a run observed a machine at an instant
that will not come back, while a replay is a pure function of the trace and the tree — an older
output is not evidence, it is a stale copy of something reproducible.

**The verdict is the product's own bytes.** `verdict.ndjson` is a byte-for-byte copy of the daily
audit file the replay's Electron profile received — Event Schema v1, hash-chained, `seq` and all.
Re-emitting it from parsed objects would make the verdict a rendering of the product's output
rather than the output, and the whole claim a trace replay makes is about those bytes.

### How the product is driven, and the one duplication that had to be watched

Every entry point the harness uses is one the product already exports: `init(state)`,
`_setDepsForTest`, `_resetForTest`, `reloadRules(dir)`, `_setSettingsPathForTest`,
`_setBaselinesPathForTest`, `audit.init` / `audit.shutdown`. **Nothing in `src/` is patched.** The
watcher says as much about the entry point that matters most — the comment above
`bindWatcherEvents` notes that `handleWatcherEvent` "is exported and called directly with no root
context by the attribution/ignore suites".

Every fact a sensor would have gone to the OS for is served from the record being replayed: the
handle list, the Restart Manager holders, the TCP table, the DNS answers, and whether the process
population may be trusted. A provider called with nothing recorded for it is **refused**, not
answered with an empty list — the two are different observations.

What could not be borrowed is the last step. `handleWatcherEvent` does not write to the audit log;
it pushes onto `activityLog` and calls `_state.onFileEvent`. The path from a detection to an Event
Schema v1 record is closed OUTSIDE the watcher, in three places, and none of them is exported:

| site | what it does |
|---|---|
| `main.js`, the `onFileEvent` handler | `dedupFileEvent` → `logAuditForFile` |
| `scan-loop.js` `doFileScan` | `scanAllFileHandles` → `dedupFileEvent` → `logAuditForFile` |
| `scan-loop.js` `doHotReadScan` | `scanHotFileHolders` → `dedupFileEvent` → `logAuditForFile` |

So the harness performs those steps itself, through the product's own exported `dedupFileEvent`
and `logAuditForFile` — it re-implements neither the dedup nor the record shape. A hand-made copy
drifts silently by default, which would leave the bench green while replaying yesterday's wiring,
so the copy is **guarded structurally rather than by a promise**:
`tests/shared/bench-trace/orchestration-drift.test.js` derives each sequence from the product's
own source at test time and holds it against `harness.ORCHESTRATION`, and then drives the shipped
harness with recording steps to check that the declaration describes what actually runs. Either
side moving alone is red, and the suite includes a case proving the extractor can fail.

The guard is one-sided, and that is worth stating: it lives under `tests/`, so a developer editing
`scan-loop.js` learns about the harness when CI goes red rather than while typing. A comment at
each product site pointing back here would close that half; it is two lines in `src/`.

### Recording a trace

Nothing else in this repository can produce a trace's records: an arm-A run writes only the
product's DECISIONS — the audit log `lib/observed.js` reads back — never the sensors' INPUTS, so
a trace cannot be derived from `observed.ndjson` or `observed.meta.json`; the information is
simply not there. `trace/recorder.js` is the missing input tap. It wires the SAME product graph
through the SAME published seams the replay uses (`wiring.wireGraph` is one function serving both
postures), in the mirror posture: the providers are REAL, and every answer a sensor consumes is
also written down, record-and-pass-through, bytes unchanged — the wrapper hands the product the
provider's own return value and buffers a JSON snapshot of it.

**What a recording is, and is not.** A recording is the system under test observing itself. It
proves REPLAYABILITY — that the same bytes in produce the same verdicts out, checked by replaying
the derived trace against the audit bytes the recording run itself wrote — and it proves nothing
about accuracy: no independent oracle confirms that the sensors saw what a machine did, which is
the measurement column's job and stays on the other side of the `src/` boundary. The committed
suites drive the recorder over SCRIPTED providers (determinism is the point); the real-provider
default (`src/main/platform`, plus a DNS mirror of `network-monitor.js`'s own module-private
defaults — the one named drift point in this subtree) is exercised only by a live local recording.

**A recording runs on the virtual clock**, under the same preload as a replay, and
`setUpRecording` refuses without it. The product stamps `new Date().toISOString()` on every audit
record, so a recording on the wall clock could never replay to its own verdicts byte for byte.
Cadence therefore comes from the scripted session — `advanceClock` is recorded as
`clock.advance`, exactly the record a replay moves its clock by — not from the machine's timers.

**The tap appends; the writer derives.** During the run every observation is appended raw to
`observations.ndjson`, one validated JSON line at a time, beside `recording.meta.json` (the clock
epoch, the settings, and the environment OBSERVED AT RECORDING TIME — so the derived header pins
the tree the recording actually ran against, and a tree edited between record and derive becomes
a digest mismatch at replay, not a silently re-pinned header). `trace.ndjson` and
`trace.header.json` are then derived OFFLINE by `deriveTrace` through the existing `writer.js` —
chained, neutralized, validated — never streamed live. No new record kinds exist for recording:
everything the recorder can observe is one of the six kinds `schema.js` already declares, every
observation is validated against its kind BEFORE it is appended, and an answer the format cannot
express (a handle scan that threw, a forward answer with no recorded reverse to hang it on) is
marked unrecordable and fails `deriveTrace` by name — a recorder must not be able to produce a
trace the reader refuses, and must not quietly drop what it could not record. The tap is proven
inert the only way it can be: the same scripted session, with the tap and without, must write
byte-identical audit logs (`tests/shared/bench-trace/recorder-roundtrip.test.js`).

A recording can only observe what its platform can produce. The hot Restart Manager source
exists on win32 and nowhere else, and `file-watcher.js` holds the RM sensor at UNSUPPORTED on
the other platforms — `scanViaRestartManager` refuses to tick it there (sensor-health allows
neither HEALTHY nor FAILED from UNSUPPORTED), so an `rm.hot.tick` can be recorded on win32 only.
That is the product's own rule, not the recorder's: a POSIX session scripting hot holders anyway
would be recording an observation its platform never makes.

One consequence of neutralization is worth stating: a trace may be committed, so the writer
rewrites the clone root and the OS account name in every record. A recording whose observed paths
live under either of those therefore replays to a verdict naming the RECORDED tree, which is
byte-identical to the recording's own audit log only when the session's paths sit outside both
rewrites — the round-trip suite stages its session that way on purpose.

### Arriving later

`trace/fingerprint.js` and `trace/verdict.js` (the run report and the byte comparison against a
committed golden). Nothing in that list exists yet; it is here so the subtree's shape is legible,
not so it reads as built. (`trace/record-trace.js` used to be listed here as "deriving a trace
from a recorded run" — that derivation is impossible, see "Recording a trace" above, and the
recorder that replaced it exists.)

## Replaying a recorded run

A live run derives its report from arrays it is holding in memory when the sensor stops, which made
a recorded run an archive rather than an input: the only way to get a report was to run the sensor
again, on a machine, against a scenario. `bench/replay.js` makes the directory the input.

```
node bench/replay.js bench/runs/2026-08-13T19-26-29Z-S1-agent-lifecycle-A
```

It reads four files out of that directory and hands the same two arrays and the same window
parameters to the same `bench/lib/join.js` the live run used, so the report it produces is the
report that run produced — byte for byte where the renderer is also the same one, because nothing
in a report records the moment it was generated. No sensor is started, no scenario is loaded, no
`src/` module and no `settings.json` is opened, and no built renderer is needed.

| file | what replay takes from it |
|---|---|
| `manifest.json` | `runId`, `scenario`, `arm` — the run's identity — and `reportRenderer`, which renderer produced its report |
| `expected.ndjson` | the catalogue, one ECS document per line |
| `observed.ndjson` | the observation set, in the same subset |
| `observed.meta.json` | `sensor.scanInterval`, `sensor.ticksWhileProcessAlive`, and the same three identity fields, which the manifest is checked against |

The join window is **not re-derived here**. It is `sensor.scanInterval` exactly as the capture
record wrote it, put through the same three-intervals rule a live run uses (`bench/lib/report.js`,
which both entrypoints share so the bound has one definition). Two consequences:

- A capture record that carries the interval as ABSENT produces a report whose every recall reads
  `unavailable`, and exit **1** — which is what the live run wrote and what it exited.
- A run recorded before that field existed is **refused**, not scored. The window is derived from
  the run or it is absent; there is no third source, because the third source would be a literal.

### What replay refuses

Each of these exits **1** with a named reason and writes no report at all — a partial report over a
directory nobody can fully read would be a report about a run nobody recorded.

- Any of the four files missing, unreadable, or not parsing.
- An NDJSON line that does not parse, named by file and line number. Not skipped: a dropped
  catalogue line is an expectation that silently stops being expected, and a dropped observed line
  credits the sensor with less than it recorded.
- An event carrying no `@timestamp`, which `join.js` refuses for both sides.
- `observed.meta.json` with no `sensor.scanInterval`, or no `sensor.ticksWhileProcessAlive` — an
  absent tick count would quietly become "there was no process lifetime to speak about" instead of
  the count the run measured.
- `manifest.json` and `observed.meta.json` disagreeing on `runId`, `scenario` or `arm`: that
  directory was assembled out of two runs, and a report joined across it would name one and count
  the other.
- An empty `observed.ndjson`. A live run never writes one, for the reason in
  [What fails a run](#what-fails-a-run).

What it does **not** refuse is a catalogue row whose category the report does not score. That row is
listed under `missed` with that reason and counted as no coverage failure, exactly as in a live run.

### A recorded report is evidence

A run directory that already holds a `run-report.json` is **compared against, never overwritten**:
the rebuild is reported as identical or as differing — with the first differing byte — and nothing
is written. `--out <file>` puts the rebuild somewhere else. The recorded report is the evidence the
rebuild is being checked against, and a verification that overwrites its own target is not one.

A difference is a real finding, and not always a defect: a report's bytes are a function of the
recording **and of the renderer that renders it**. That has already happened once — the
`latencyMs.basis` string went from `"1 matched pair(s)"` to `"1 matched pair"` without
`SCHEMA_VERSION` moving — so a run recorded before that change no longer rebuilds identically,
while every number in it is unchanged. Replay states that instead of applying it.

### The renderer that rendered it

Which renderer produced a recorded report used to be unrecoverable. `sensor.gitSha` cannot answer
it: every arm-A run so far was measured against a dirty tree, and `workingTreeDirty: true` says in
so many words that the commit named is not the code that ran. So a run now records the renderer
itself — `manifest.reportRenderer`, written by `bench/run.js` out of a fingerprint
`bench/lib/report.js` freezes while it is being loaded:

```json
"reportRenderer": {
  "schemaVersion": 1,
  "algorithm": "sha256",
  "joinSha256": "<64 hex>",
  "reportHelperSha256": "<64 hex>",
  "covers": "...",
  "source": "..."
}
```

Content hashes and not a commit, so a dirty tree is captured honestly rather than pointed at. Taken
**once, at load**, and frozen: a bench run acts for minutes against a tree its author may still be
editing, and a hash taken when the report is finally written would describe a file the run had that
long to change.

What that read is, exactly: a read of the **disk**, not of the loader. `join.js` is already in the
module cache by the time `report.js` hashes it, and `report.js` reads its own file while executing.
So under a concurrent modification of the working tree the digests describe the file bytes at that
moment, which can differ from the bytes Node compiled. Closing that gap would take loader
introspection; short of it, a disk read taken at load is the closest observation available, and the
block's own `source` field states it in those terms rather than claiming the loaded bytes.

**What it covers:** `bench/lib/join.js` and `bench/lib/report.js` — the report object, the join
window, and `serializeReport`, the single definition of a report's bytes that the live run and a
replay both call. `join.js` requires nothing, so those two files are the whole closure rather than a
sample of it. **What it does not cover:** the Node version, the platform, and everything in
`bench/run.js` and `bench/replay.js` outside that shared serializer. The fingerprint is not a proof
that two reports must be identical; it is the identity of the code that renders them.

Replay reads the block back and prints **two verdicts, neither read off the other** — whether the
rebuild reproduced the recorded bytes, and which renderer produced them:

| verdict | what the recording says | what replay may claim |
|---|---|---|
| `renderer-match` | the fingerprint is this renderer's | byte equality here is historical byte equality: same inputs, same renderer, same bytes |
| `renderer-skew` | the fingerprint names other source bytes | the byte comparison stands on its own. Identical bytes are still identical bytes; a difference is stated with skew named as a candidate explanation and not as its cause |
| `legacy-unversioned` | no `reportRenderer` block at all | the same, minus even the candidate: the recorded report is still preserved evidence and equality with it is still directly observable, but which renderer wrote those bytes was never recorded, and nothing is invented retroactively to close the gap |

The cell worth having is `renderer-match` with a **difference**: skew in the two fingerprinted files
is ruled out — and that is the whole of what the fingerprint can rule out. What is left is the
recording itself, or the surface the fingerprint does not cover: the Node version, the platform, and
any code outside those two files. Replay says exactly that and picks none of them.

`--out` writes exactly the report the current renderer built, and nothing else: no envelope, no
provenance smuggled into the report shape, no `join.SCHEMA_VERSION` moved. What such a file is, is
carried by where it is put and what it is called — see the goldens below.

### The committed recordings

`bench/runs/` is gitignored, so two real arm-A runs are committed under `tests/fixtures/bench/runs/`
instead: one complete run whose live-written report is the byte-for-byte target, and one recorded
before `sensor.scanInterval` existed, which pins the refusal above against a real artefact rather
than a synthetic one. Both predate `manifest.reportRenderer` and therefore classify as
`legacy-unversioned`.

They are **recordings**: nine files that carry one documented redaction of machine-identifying
values and are otherwise never regenerated, reformatted or corrected, and
`tests/main/bench/fixture-immutability.test.js` holds each one against a committed sha256 and
against the exact file set its run wrote. Where a golden for the current renderer is wanted, it is a
separate derived artefact under `tests/fixtures/bench/goldens/`, named so that it cannot be mistaken
for a recording. They are not accuracy figures, and `tests/fixtures/bench/README.md` carries their
provenance and the maintenance contract.

## Run artefacts

`bench/runs/` is gitignored. It is the raw local output of `bench/run.js` and is
never the committed record. What the repository is allowed to hold is:

- `bench/scenarios/` and `bench/scenario.schema.json` — the scripts
- `tests/fixtures/bench/runs/` — redacted recordings used by replay tests
- `tests/fixtures/bench/goldens/` — the current renderer's derived report
- `docs/bench/` — gold-image write-ups, when those exist

Paths written into those committed files go through `manifest.neutralizePath`:
the clone root becomes `X:\dev\project\AEGIS` and `\Users\<account>\` becomes
`\Users\user\`.

One run is one directory under `bench/runs/`, named `<UTC instant>-<scenario>-<arm>`. The
directory is created fresh and never written into twice, so a re-run cannot blend two
machines' artefacts into one record.

`manifest.json` is written today, and `expected.ndjson` plus a `stage/` directory whenever a
scenario was named. `stage/` holds the binaries the scenario copied; S1 deletes its own, so the
directory is normally left empty. In arm A there are three more: `observed.ndjson`, what the sensor
recorded; `observed.meta.json`, how it was run and what did not become a line of it; and
`run-report.json`, the two joined. In arms A and B there is `oracle-loss.json`, and
`oracle-sysmon.ndjson` whenever the oracle collected anything. The remaining files arrive with the
sub-blocks that produce them: `oracle-procmon.ndjson` (B2.6). `matched.ndjson` and `metrics.json`
are written by `bench/score.js` rather than by a run, so a run directory holds them only once it
has been scored.

The Electron profile a run created is **left behind** in the OS temp directory, and its path is in
`observed.meta.json`. It holds the audit file `observed.ndjson` was derived from, which is the
evidence for every line of it.

### Absent, never guessed

Every manifest field is `{value, source}` when the probe succeeded and
`{value: null, unavailable: <reason>, source}` when it did not. That distinction is the
point: "this run started with 320 processes" and "we could not read the process count" must
not collapse into the same record. `run.js` prints the absent facts at the end of a run so a
degraded environment is visible at the moment of measurement rather than at analysis time.

Two fields worth knowing about:

- **`host` is platform only.** CPU model, thread count, memory size, OS edition and
  build number are not written. They identify a workstation and do not belong in a
  file that can be committed. A published accuracy figure still names the gold-image
  Windows build in `docs/bench/`, not in `manifest.json`.
- **`sensor.workingTreeDirty`** means the measured sensor is not exactly the commit named in
  `sensor.gitSha`. It is recorded, not refused: running against uncommitted work is
  legitimate while building the harness, and dishonest only if left unsaid.
- **`reportRenderer`** is the sha256 of the two files that turn this run into
  `run-report.json`, frozen while they were loaded. It is not a `{value, source}` probe
  because it is not a fact about this machine: it is the identity of the code that writes
  the report, which `gitSha` above cannot supply for exactly the reason the line before this
  one gives. See [The renderer that rendered it](#the-renderer-that-rendered-it).
