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
```

The `--` is required; without it npm keeps the flags.

Exit codes: **0** the run completed · **1** a step failed to execute · **2** the invocation or the
scenario was wrong and nothing ran. A scenario is loaded and validated *before* the run directory
exists, so a wrong scenario leaves no empty run behind; a step that fails happens after, and leaves
the directory holding the catalogue of everything that did happen first.

Arms, from §10 — a run is one scenario in one arm:

| arm | what runs | measures |
|---|---|---|
| A | sensor + Sysmon | coverage and latency |
| B | Sysmon + Procmon, no sensor | oracle calibration |
| C | sensor alone | overhead |

Arm B is what makes arm A's scoring legitimate: B establishes that the catalogue is faithful
for a given deterministic scenario, and only then does A score the sensor against it.

## Layout

Present today (sub-blocks B2.1 and B2.2):

```
bench/
  run.js                                    # create a run directory, execute a scenario
  scenario.schema.json                      # draft-07; the shape of a scenario
  lib/manifest.js                           # environment snapshot; absent facts stay absent
  lib/actor.js                              # executes steps, captures what happened
  lib/catalogue.js                          # writes expected.ndjson; refuses a line it did not observe
  scenarios/S1-agent-lifecycle/scenario.json
  runs/                                     # run artefacts — gitignored, created on first run
  README.md
```

Arriving with later sub-blocks, listed so the tree's shape is legible, not so it reads as
built — nothing below exists yet:

| path | sub-block |
|---|---|
| `bench/lib/oracles/sysmon.js`, `bench/oracles/sysmon-bench.xml` | B2.3 |
| `bench/lib/sut-capture.js` | B2.4 |
| `bench/score.js`, `bench/lib/join.js`, `bench/lib/metrics.js` | B2.5 |
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

## Run artefacts

One run is one directory under `bench/runs/`, named `<UTC instant>-<scenario>-<arm>`. The
directory is created fresh and never written into twice, so a re-run cannot blend two
machines' artefacts into one record.

`manifest.json` is written today, and `expected.ndjson` plus a `stage/` directory whenever a
scenario was named. `stage/` holds the binaries the scenario copied; S1 deletes its own, so the
directory is normally left empty. The remaining files arrive with the sub-blocks that produce them:
`oracle-sysmon.ndjson`, `oracle-procmon.ndjson`, `oracle-loss.json`, `sut.ndjson`,
`matched.ndjson`, `metrics.json`.

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
