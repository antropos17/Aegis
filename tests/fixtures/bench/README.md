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
paths the run actually wrote, and rewriting them would destroy the property the golden
test asserts: that a rebuild reproduces the recorded report byte for byte.

Two repository settings keep that property alive, and both are load-bearing rather than
tidy:

- `.gitattributes` marks this tree `-text`, so no line-ending conversion touches it on a
  Windows checkout.
- `.prettierignore` excludes it. The `lint-staged` entry `"*.{js,ts,json}"` matches on the
  base name, so **every** staged `.json` goes through `prettier --write` wherever it lives —
  and prettier rewrites `"points": [\n 9989\n]` as `"points": [9989]`. Without that line a
  commit silently reformats the golden file, and the byte comparison then runs against a
  file the formatter edited rather than against the one the run wrote.

| directory | what it is |
|---|---|
| `runs/2026-08-13T19-26-29Z-S1-agent-lifecycle-A/` | A complete S1 run, all five files. Its `run-report.json` was written by the live run and is the golden target: replaying the other four files must reproduce it byte for byte. |
| `runs/2026-08-13T17-11-03Z-S1-agent-lifecycle-A/` | An earlier S1 run, recorded before `observed.meta.json` carried `sensor.scanInterval` and before `run-report.json` existed. It holds four files and no report, and replay must refuse it by name: the join window is derived from the run or it is absent, never defaulted. |

The empty `stage/` directory each run leaves behind is not copied — it holds nothing
replay reads, and git does not track empty directories.

## Maintenance contract

The golden `run-report.json` is a rendering, and `bench/lib/join.js` owns every string in
it. **When a change to `join.js` alters a rendered string, this fixture's
`run-report.json` must be regenerated and the diff reviewed** — otherwise the next person
meets a red byte-equality test with no way to tell whether the code or the fixture is
wrong.

Regenerate by replaying with `--out` and moving the result in, so the difference is read
before it is accepted:

```
node bench/replay.js tests/fixtures/bench/runs/2026-08-13T19-26-29Z-S1-agent-lifecycle-A
```

With no `--out`, replay compares and writes nothing; it prints the first differing byte.
That output is the diff to review. If the change is intended, rebuild the file with
`--out` pointed at it.

This has already happened once, before replay existed: `join.js` changed
`"1 matched pair(s)"` to `"1 matched pair"` without moving `SCHEMA_VERSION`, so a run
recorded before that change no longer rebuilds identically. A report's bytes are a
function of the recording **and** of the `join.js` that renders it.
