# Bench replay fixtures

Two real arm-A run directories, copied here **verbatim** from `bench/runs/`, which is
gitignored. They are inputs to `tests/main/bench/replay.test.js`, and they are the only
committed record of what a run directory contains.

They are **not** measurement claims. Both were produced on a developer workstation, and
`bench/README.md` is explicit that no number from such a machine may be published as an
AEGIS accuracy figure — the condition for that is a Hyper-V Gen2 gold image with a pinned
Windows build. What these fixtures pin is the file contract and the arithmetic over it,
not the sensor's accuracy.

Nothing in them is edited. The machine paths (`C:\Users\...`, `X:\Future\...`) are the
paths the run actually wrote, and rewriting them would destroy the property the tests
assert: that a rebuild reproduces the recorded report byte for byte.

Two repository settings keep that property alive, and both are load-bearing rather than
tidy:

- `.gitattributes` marks this tree `-text`, so no line-ending conversion touches it on a
  Windows checkout.
- `.prettierignore` excludes it. The `lint-staged` entry `"*.{js,ts,json}"` matches on the
  base name, so **every** staged `.json` goes through `prettier --write` wherever it lives —
  and prettier rewrites `"points": [\n 9989\n]` as `"points": [9989]`. Without that line a
  commit silently reformats these files, and a byte comparison then runs against a file the
  formatter edited rather than against the one the run wrote.

## What is here

| path | what it is |
|---|---|
| `runs/2026-08-13T19-26-29Z-S1-agent-lifecycle-A/` | A complete S1 run, all five files. Its `run-report.json` is the file that live run wrote. |
| `runs/2026-08-13T17-11-03Z-S1-agent-lifecycle-A/` | An earlier S1 run, recorded before `observed.meta.json` carried `sensor.scanInterval` and before `run-report.json` existed. Four files and no report, and replay must refuse it by name: the join window is derived from the run or it is absent, never defaulted. |
| `goldens/2026-08-13T19-26-29Z-S1-agent-lifecycle-A.golden-report.current.json` | **Derived, not recorded.** What the renderer in this working tree makes of the recording above. Regenerable, and expected to move whenever a rendered string changes. |

The empty `stage/` directory each run leaves behind is not copied — it holds nothing
replay reads, and git does not track empty directories.

## Recordings, and what they pin

Those nine files under `runs/` are **recordings**. The observation is never rewritten by
the interpretation, so none of them is ever regenerated, reformatted or corrected — not to
make a test pass, not to adopt a renderer change, not for tidiness.
`tests/main/bench/fixture-immutability.test.js` holds every one of them against a committed
sha256 and against the exact file set its run wrote, so a drift is a red test rather than a
discovery months later.

What a recording pins is what that run did. What these two do **not** pin is which report
renderer turned it into bytes, and the difference matters:

- `run-report.json` in the 19-26-29 recording is the file the live run wrote. It is
  byte-equal to the untracked original still sitting in `bench/runs/`, and its mtime is the
  minute the sensor stopped. It is evidence, and a rebuild matching it byte for byte is a
  directly observable fact about those bytes.
- The manifest names `sensor.gitSha` `7a27b5d5…` together with `sensor.workingTreeDirty:
  true`, and `bench/lib/join.js` was itself uncommitted when the run happened — it landed
  two hours later as `76525d7`. A commit plus "the tree was dirty" does not identify the
  source bytes that rendered a report.

So both recordings classify as **`legacy-unversioned`**: they predate
`manifest.reportRenderer`, and no fingerprint is back-filled into them. Replay says so by
name, and it says it separately from the byte comparison — identical bytes are identical
bytes whether or not the renderer behind them was ever identified. Runs recorded from now
on carry the fingerprint and classify as `renderer-match` or `renderer-skew` instead; see
[bench/README.md](../../../bench/README.md#the-renderer-that-rendered-it).

## Maintenance contract

**Recordings are never regenerated.** If a change to `bench/lib/join.js` or
`bench/lib/report.js` alters a rendered string, the recording keeps the bytes its run
wrote and the rebuild stops matching them. That is the finding, and replay states it —
with the first differing byte, and with what the renderer verdict does and does not
explain about it. It does not apply it.

**Goldens are derived, and they are what gets regenerated.** The file under `goldens/` is
this renderer's rendering of that recording, committed separately so the two can diverge
visibly:

```
node bench/replay.js tests/fixtures/bench/runs/2026-08-13T19-26-29Z-S1-agent-lifecycle-A \
  --out tests/fixtures/bench/goldens/2026-08-13T19-26-29Z-S1-agent-lifecycle-A.golden-report.current.json
```

Read the diff before accepting it: a golden that moved because a string was reworded is a
different event from one that moved because a number changed. `--out` writes exactly the
report and nothing else — no provenance is smuggled into the report shape — so what the
artefact is, is carried by where it lives, what it is called, and this file.

With no `--out`, replay compares and writes nothing; it prints the first differing byte.

Today the golden and the recorded report are byte-identical, which is a fact with a date
on it rather than a property: this renderer still renders that recording exactly as the
run's own renderer did. The day that stops being true, the golden moves and the recording
does not, and which of the two moved is then answerable instead of guessable.

That day has already happened once, before replay existed: `join.js` changed
`"1 matched pair(s)"` to `"1 matched pair"` without moving `SCHEMA_VERSION`, so a run
recorded before that change no longer rebuilds identically. A report's bytes are a function
of the recording **and** of the renderer that renders it — which is exactly why a run now
records which renderer that was.
