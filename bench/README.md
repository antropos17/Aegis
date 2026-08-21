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
```

Arm B needs no built renderer and starts no sensor: it executes the scenario and collects the
Sysmon oracle. On a machine with no Sysmon installed it runs to completion, records the absence,
and exits **1** — which is the honest outcome, not a harness failure. See
[The Sysmon oracle](#the-sysmon-oracle--b23).

The `--` is required; without it npm keeps the flags.

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

Present today (sub-blocks B2.1, B2.2, the arm-A capture, the first join and B2.3's Sysmon
adapter):

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
  lib/report.js                             # the join bound, the report's exact bytes, the printed summary and the renderer fingerprint — shared by both entrypoints
  lib/oracles/sysmon.js                     # normalizes Sysmon EventRecord XML; writes oracle-sysmon.ndjson and oracle-loss.json
  oracles/sysmon-bench.xml                  # the Sysmon config a run is measured under — never yet offered to a binary
  scenarios/S1-agent-lifecycle/scenario.json
  trace/schema.js                           # the trace format: version, chain seed, the closed list of record kinds, every refusal
  trace/environment.js                      # what a trace pins about the machine and the tree, and the comparison that refuses a mismatch
  trace/writer.js                           # observations → chained records → the exact bytes a trace directory holds
  trace/reader.js                           # reads a trace directory, or refuses it by name
  runs/                                     # run artefacts — gitignored, created on first run
  README.md
```

Arriving with later sub-blocks, listed so the tree's shape is legible, not so it reads as
built — nothing below exists yet:

| path | sub-block |
|---|---|
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

## The Sysmon oracle — B2.3

The oracle column runs in the two arms whose definition includes Sysmon, **A and B**, and writes
two files: `oracle-loss.json` always, and `oracle-sysmon.ndjson` when there is at least one record
to put in it. It does not reach `run-report.json`: confirming the catalogue against the oracle is
B2.5, and until then the report still scores the sensor against an unconfirmed catalogue.

`bench/lib/oracles/sysmon.js` imports nothing from `src/` and nothing from `bench/lib/observed.js`
either — that module is the sensor side, and an oracle sharing code with the thing it confirms
stops being independent. The two path helpers are duplicated on purpose.

### Three layers, and only two of them are proven

| layer | what it is | status |
|---|---|---|
| RAW | a real `Microsoft-Windows-Sysmon/Operational` channel → `Get-WinEvent` → EventRecord XML | **LIVE-UNVALIDATED** |
| NORMALIZED | EventRecord XML → canonical oracle record → `oracle-sysmon.ndjson` | proven offline |
| DERIVED | matching the oracle against the catalogue, and any metric over it | B2.5 |

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
the sensor against the catalogue only. The catalogue is still **unconfirmed** here: B2.3 collects
the oracle column into its own files, and reading that column against the catalogue is B2.5.

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
| `src/main/rule-loader.js` | `trace/environment.js` | `_loadRules` | the rules are digested AS THE PRODUCT COMPILES THEM; `_loadRules` is the entry point that does not populate the module cache, so observing an environment does not change it |

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
| `rm.hot.tick` | a Restart Manager hot-cycle answer | yes |
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

### Arriving later

`trace/clock.js` and `trace/preload.js` (the virtual clock, installed before any `src/` module
loads), `trace/harness.js` and `trace/replay-trace.js` (the replay proper), `trace/fingerprint.js`
and `trace/verdict.js` (what a run outputs, and the byte comparison), and `trace/record-trace.js`
(deriving a trace from a recorded run). Nothing in that list exists yet; it is here so the
subtree's shape is legible, not so it reads as built.

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
sub-blocks that produce them: `oracle-procmon.ndjson` (B2.6), `matched.ndjson` and `metrics.json`
(B2.5).

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
