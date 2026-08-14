# Derived bench replay inputs

Everything under this directory is **DERIVED / MODELLED**, never **RECORDED**. These
directories were written by hand in the four-file shape `bench/replay.js` reads
(`manifest.json`, `expected.ndjson`, `observed.ndjson`, `observed.meta.json`). No process
was created, no sensor ran, no audit chain was read, and no `run-report.json` is committed
here — a replay writes one with `--out` to a throwaway path, so the input evidence and the
derived output stay apart.

The sibling `../runs/` tree is the opposite kind of thing: real arm-A runs, pinned byte for
byte by `tests/main/bench/fixture-immutability.test.js`. Nothing in this directory is
covered by that immutability contract, and nothing here may be moved into `runs/`.

Every file carries the label. `manifest.json` and `observed.meta.json` each hold a
`derived` block (`kind: "derived-model"`, `recorded: false`); every observed row carries
`bench.source: "derived-model"` instead of the `"aegis-audit"` a capture writes, and no
`auditFile` / `auditSeq` / `auditType`, because there was no audit record to read them off.
Those three therefore come out `null` in any report built from this input — a visible
marker that it is not a capture. Every modelled fact that AEGIS does **not** persist lives
under a `bench.fixture*` name, so no field here can be mistaken for one the product writes.

---

## D1-pid-reuse-same-ms

### What it is

A deterministic replay model of the residual PID-reuse / millisecond-identity bound.

Two modelled process generations, **A** and **B**, share

- the same pid — `4242`;
- the same stored birth millisecond — `1717000000000`;
- and therefore the same modelled `instanceId` — `4242:1717000000000`, the
  `"<pid>:<epochMs>"` format `src/main/process-identity.js` builds and that this work does
  not touch.

They differ only in a **fixture-only generation witness**, `bench.fixtureWitness`, modelled
as a creation time in 100 ns FILETIME ticks:

| generation | `fixtureWitness` (100 ns ticks) | floors to epoch ms | modelled `instanceId` |
|---|---|---|---|
| A | `133614736000001234` | `1717000000000` | `4242:1717000000000` |
| B | `133614736000009876` | `1717000000000` | `4242:1717000000000` |

The two witnesses are 8 642 ticks — 0.8642 ms — apart, and both floor to the one
millisecond the identity is built from. That flooring is the production rule
(`ticksToEpochMs`, `src/main/platform/process-snapshot.js`), so the arithmetic in this
model is the arithmetic AEGIS runs: **the witness can be finer than `instanceId`, and this
is the case where it is.**

### The information bound it pins

`bench/lib/join.js` joins a process expectation on `process.pid` alone — pid is the only
process join key the audit persists, and `bench.instanceId` rides along as evidence but is
never a key. The four rows are stamped so that the existing nearest-latency assignment
crosses the generations:

```
expected[0]  gen A  16:26:40.035Z          observed[0]  gen B  16:26:40.036Z
expected[1]  gen B  16:26:40.045Z          observed[1]  gen A  16:26:40.046Z
```

Every eligible pairing is scored by latency and taken in ascending order, so the join takes
`expected[0] → observed[0]` (1 ms) and `expected[1] → observed[1]` (1 ms). Both pairs cross
a generation boundary, and the report says:

```
report  process/start  2/2   p50 1 ms
report  every observed event cancelled an expectation
```

**2/2 here does not establish correct generation attribution.** It demonstrates that a
pid-only coverage metric cannot answer a generation-identity question: the metric is
perfect and the attribution is wrong in both pairs, and nothing in the persisted record
distinguishes the two situations.

### What this is NOT

- **Not a recorded Windows PID-reuse event.** Windows PID reuse inside one millisecond was
  **not reproduced**. It cannot be forced deterministically, and no claim that it can is
  made anywhere in this fixture or its tests.
- **Not an accuracy measurement**, not a recall figure about the sensor, and not a basis
  for any real-world collision rate. No frequency is inferred from a hand-written model.
- **Not Sysmon-confirmed evidence.** No oracle ran.
- **Not a sensor failure.** The sensor is not in this picture at all: nothing observed
  anything. What is characterised is the resolution of the persisted *record* and the
  reach of the *join* over it.
- **Not a proposal to change anything.** `instanceId` keeps its format, `join.js` keeps
  `process.pid` as its process key, and no tie-breaker was added. Teaching the join to read
  `bench.fixtureGeneration` would dissolve the bound instead of characterising it, and
  `tests/main/bench/derived-pid-reuse.test.js` asserts that no `fixture*` label reaches the
  report.

### What the distinct witnesses stand in for

They are **modelling devices**, not observations. A real same-millisecond reuse would carry
a stronger generation fact — the kernel `SequenceNumber` where Windows supplies it,
otherwise the 100 ns creation time — that the stored `instanceId` throws away by flooring
to milliseconds. Two distinct `fixtureWitness` values stand in for exactly that stronger
fact, solely to model the known resolution mismatch between what can be observed and what
is stored.

For the same reason the two expectation instants sit 10 ms apart while the two modelled
creation times are 0.86 ms apart: the separation exists so the nearest-latency assignment
crosses, and it is a property of the model, not a claim about how far apart two real spawns
would be stamped. The expected rows therefore carry **no** `process.start` field — the
catalogue's own convention is that a field nobody observed is omitted rather than filled
in, and here nobody observed anything. The modelled birth fact lives only in
`bench.fixtureStartTimeMs` and `bench.fixtureWitness`.

### What the production cache gate would still see

The generation-witness cache gate in `src/main/process-utils.js` compares the fresh witness
— value **and** source — against the one a cache entry was written with, and rebuilds the
entry when they differ. Given these two witnesses it would separate generation A from
generation B, because it reads the 100 ns value rather than the floored millisecond.
**The production gate may therefore distinguish these two generations even though
`instanceId` does not.** That is the resolution mismatch this case is named after, and it
is why the case is about the *stored identity and the pid-only join*, not about the cache.

### Why it is a derived replay case rather than a live scenario

A scenario under `bench/scenarios/` is executed by `bench/lib/actor.js` through a closed
set of step kinds — `copy-binary`, `spawn-process`, `wait`, `terminate-process`,
`delete-file`. None of them can ask Windows to free a pid and reissue that same pid to a new
process inside one millisecond, and nothing else can either. `bench/lib/catalogue.js`
refuses to write a catalogue line whose identity fields were not observed, so a scenario
"modelling" this would have to either fabricate observations (refused at the source) or
depend on an OS event nobody can force.

Adding this as a normal scenario would therefore imply the actor can produce an OS
condition it cannot. It lives here instead, where the file layout, the `derived` blocks and
the `fixture*` field names all say what it is.

### Running it

```
node bench/replay.js tests/fixtures/bench/derived/D1-pid-reuse-same-ms --out %TEMP%\d1-report.json
```

Always `--out` to a throwaway path. The input carries no `run-report.json` and none is
committed: this directory is the model, and a report over it is a rendering of the model.
Because no renderer ever produced a report for it, the manifest carries no
`reportRenderer` block and replay classifies the input `legacy-unversioned` — the honest
reading, since there is no recorded renderer identity to compare against and no recorded
bytes to compare with.

`tests/main/bench/derived-pid-reuse.test.js` is the gate on all of the above.
