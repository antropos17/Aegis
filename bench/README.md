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
```

The `--` is required; without it npm keeps the flags.

Arms, from §10 — a run is one scenario in one arm:

| arm | what runs | measures |
|---|---|---|
| A | sensor + Sysmon | coverage and latency |
| B | Sysmon + Procmon, no sensor | oracle calibration |
| C | sensor alone | overhead |

Arm B is what makes arm A's scoring legitimate: B establishes that the catalogue is faithful
for a given deterministic scenario, and only then does A score the sensor against it.

## Layout

Present today (sub-block B2.1):

```
bench/
  run.js              # create a run directory, write its manifest
  lib/manifest.js     # environment snapshot; absent facts stay absent
  runs/               # run artefacts — gitignored, created on first run
  README.md
```

Arriving with later sub-blocks, listed so the tree's shape is legible, not so it reads as
built — nothing below exists yet:

| path | sub-block |
|---|---|
| `bench/scenario.schema.json`, `bench/scenarios/<id>/scenario.json`, `bench/lib/actor.js`, `bench/lib/catalogue.js` | B2.2 |
| `bench/lib/oracles/sysmon.js`, `bench/oracles/sysmon-bench.xml` | B2.3 |
| `bench/lib/sut-capture.js` | B2.4 |
| `bench/score.js`, `bench/lib/join.js`, `bench/lib/metrics.js` | B2.5 |
| `bench/lib/oracles/procmon.js`, `bench/oracles/procmon-bench.pmc` | B2.6 |
| `bench/report.js` | B2.9 |

## Run artefacts

One run is one directory under `bench/runs/`, named `<UTC instant>-<scenario>-<arm>`. The
directory is created fresh and never written into twice, so a re-run cannot blend two
machines' artefacts into one record.

`manifest.json` is written today. The remaining files arrive with the sub-blocks that
produce them: `expected.ndjson` (catalogue), `oracle-sysmon.ndjson`, `oracle-procmon.ndjson`,
`oracle-loss.json`, `sut.ndjson`, `matched.ndjson`, `metrics.json`.

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
