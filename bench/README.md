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
- **A sensor is never its own oracle.** Nothing under `bench/` imports from `src/`. Where a
  scenario needs ground truth about process identity, that truth comes from Sysmon EID 1
  ordinality — never from the process-snapshot provider AEGIS itself reads.

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
node bench/replay.js bench/runs/<run id>                 # rebuild that run's report from its files
node bench/replay.js bench/runs/<run id> --out <file>    # write the rebuild elsewhere
```

The `--` is required; without it npm keeps the flags.

In arm A a run takes roughly three minutes: about ninety seconds of it is waiting for the sensor's
scan cadence to settle, then the scenario, then three more scan ticks and a flush drain.

`bench/replay.js` needs no sensor, no scenario and no built renderer: it rebuilds one recorded run's
`run-report.json` out of the four files that run left behind, in well under a second. See
[Replaying a recorded run](#replaying-a-recorded-run).

Exit codes: **0** the run completed · **1** a step failed to execute, the sensor could not be run
or read, or the run report could not be derived · **2** the invocation or the scenario was wrong and
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

Present today (sub-blocks B2.1, B2.2, the arm-A capture and the first join):

```
bench/
  run.js                                    # create a run directory, execute a scenario, run the sensor
  replay.js                                 # rebuild one recorded run's report from its files; no sensor
  scenario.schema.json                      # draft-07; the shape of a scenario
  lib/manifest.js                           # environment snapshot; absent facts stay absent
  lib/actor.js                              # executes steps, captures what happened
  lib/catalogue.js                          # writes expected.ndjson; refuses a line it did not observe
  lib/sensor.js                             # runs AEGIS across a run; readiness, ticks, stop
  lib/observed.js                           # writes observed.ndjson out of the product's audit log
  lib/join.js                               # joins the two, shapes run-report.json; no I/O at all
  lib/report.js                             # the join bound and the printed summary, shared by both entrypoints
  scenarios/S1-agent-lifecycle/scenario.json
  runs/                                     # run artefacts — gitignored, created on first run
  README.md
```

Arriving with later sub-blocks, listed so the tree's shape is legible, not so it reads as
built — nothing below exists yet:

| path | sub-block |
|---|---|
| `bench/lib/oracles/sysmon.js`, `bench/oracles/sysmon-bench.xml` | B2.3 |
| `bench/score.js`, `bench/lib/metrics.js` | B2.5 |
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

`wait` emits nothing on purpose: no oracle can confirm the passage of time, and a catalogue row
nothing can reach is decoration.

`copy-binary` does not take the agent name on trust. `agentName` must be one of the names
`src/shared/agent-database.json` gives `agentId`, or the run fails — the stimulus is *drawn from*
the database rather than resembling it. That file is read as an input datum and never as evidence:
no claim about what happened comes from anything AEGIS ships.

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

## The join — `run-report.json`

At the end of an arm-A run the catalogue and the observation set are joined, and the result is
written to `run-report.json`: per category, how many events were expected, how many the sensor
accounted for, and how long it took. This is the first row of the measurement matrix and it scores
the sensor against the catalogue only — an unconfirmed catalogue, until B2.3's oracle confirms it.

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
`X:/Future\AEGIS` and `x:\future\aegis` name one file on the platform the bench runs on. That is a
Windows fact rather than a general one: a bench on another platform would need a different rule, not
this one relaxed.

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

## Replaying a recorded run

A live run derives its report from arrays it is holding in memory when the sensor stops, which made
a recorded run an archive rather than an input: the only way to get a report was to run the sensor
again, on a machine, against a scenario. `bench/replay.js` makes the directory the input.

```
node bench/replay.js bench/runs/2026-08-13T19-26-29Z-S1-agent-lifecycle-A
```

It reads four files out of that directory and hands the same two arrays and the same window
parameters to the same `bench/lib/join.js` the live run used, so the report it produces **is** the
report that run produced — byte for byte, because nothing in a report records the moment it was
generated. No sensor is started, no scenario is loaded, no `src/` module and no `settings.json` is
opened, and no built renderer is needed.

| file | what replay takes from it |
|---|---|
| `manifest.json` | `runId`, `scenario`, `arm` — the run's identity |
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
recording **and of the `bench/lib/join.js` that renders it**. That has already happened once — the
`latencyMs.basis` string went from `"1 matched pair(s)"` to `"1 matched pair"` without
`SCHEMA_VERSION` moving — so a run recorded before that change no longer rebuilds identically,
while every number in it is unchanged. Replay states that instead of applying it.

### The committed recordings

`bench/runs/` is gitignored, so two real arm-A runs are committed under `tests/fixtures/bench/`
instead: one complete run whose live-written report is the byte-for-byte target, and one recorded
before `sensor.scanInterval` existed, which pins the refusal above against a real artefact rather
than a synthetic one. They are inputs to `tests/main/bench/replay.test.js`, they are not accuracy
figures, and `tests/fixtures/bench/README.md` carries their provenance and the maintenance contract
that comes with a byte-exact golden file.

## Run artefacts

One run is one directory under `bench/runs/`, named `<UTC instant>-<scenario>-<arm>`. The
directory is created fresh and never written into twice, so a re-run cannot blend two
machines' artefacts into one record.

`manifest.json` is written today, and `expected.ndjson` plus a `stage/` directory whenever a
scenario was named. `stage/` holds the binaries the scenario copied; S1 deletes its own, so the
directory is normally left empty. In arm A there are three more: `observed.ndjson`, what the sensor
recorded; `observed.meta.json`, how it was run and what did not become a line of it; and
`run-report.json`, the two joined. The remaining files arrive with the sub-blocks that produce them:
`oracle-sysmon.ndjson`, `oracle-procmon.ndjson`, `oracle-loss.json`, `matched.ndjson`,
`metrics.json`.

The Electron profile a run created is **left behind** in the OS temp directory, and its path is in
`observed.meta.json`. It holds the audit file `observed.ndjson` was derived from, which is the
evidence for every line of it.

### Absent, never guessed

Every manifest field is `{value, source}` when the probe succeeded and
`{value: null, unavailable: <reason>, source}` when it did not. That distinction is the
point: "this machine reported build 26200" and "we could not read the build" must not
collapse into the same record. `run.js` prints the absent facts at the end of a run so a
degraded environment is visible at the moment of measurement rather than at analysis time.

Two fields worth knowing about:

- **`host.windowsBuild`** comes from `reg query`, not `os.release()`, because the UBR — the
  component that separates two machines both calling themselves 26200 — exists only in the
  registry. `productName` is recorded verbatim even when it disagrees with `os.version()`
  (Windows 11 machines routinely report `Windows 10 <edition>` under that key). The manifest
  records what each source said and never reconciles two sources into one invented answer.
- **`sensor.workingTreeDirty`** means the measured sensor is not exactly the commit named in
  `sensor.gitSha`. It is recorded, not refused: running against uncommitted work is
  legitimate while building the harness, and dishonest only if left unsaid.
