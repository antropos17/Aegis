# Generation v2 — process-table observation cost, re-measured (2026-08-13)

A second run of the measurement recorded in `generation-v2-2026-08-12.md`, on the same
machine one day later. That file is left exactly as it was: this is an additional
sample, not a correction of it.

Nothing in the provider chain changed between the two runs. The only code touched on
this branch is two JSDoc comments that named the wrong birth-time source; no executable
line differs.

Reproduce: `npm run build:sidecar && node scripts/bench-generation.js --n 32`

## What was measured

One sample is one provider call, timed in JavaScript from the call to the resolved `Map`
the scan loop consumes — the same quantity both earlier measurements reported.
Percentiles are nearest-rank over N=32, arms interleaved round-robin, every sample
recording which provider actually served it. The run was made at idle with agents
running, under `AEGIS_PROC_SNAPSHOT=strict`, so a sidecar arm that had been served by
CIM would have aborted the run instead of printing a table.

Environment: `Windows_NT 10.0.26200` (11 25H2, UBR 8655) · 22× Intel Core Ultra 9 185H ·
node v24.11.1 · uptime 29 h · 421 processes during the run.

## Result

| arm | N | procs | p50 ms | p95 ms | max ms | min ms | mean ms |
|---|---|---|---|---|---|---|---|
| CIM (`Win32_Process`, PowerShell) | 32 | 421 | 612.1 | 801.6 | 932.8 | 508.1 | 638.4 |
| sidecar warm (live child) | 32 | 421 | 11.9 | 16.8 | 115.2 | 7.9 | 14.9 |
| sidecar cold (spawn + handshake + exit) | 32 | 423 | 60.6 | 72.8 | 83.9 | 55.7 | 61.9 |

**p50 speedup, warm sidecar vs CIM measured in the same run: 51×.**

The warm arm's `max` of 115.2 ms is its **first** sample, which pays the spawn; every
later sample is 7.9–16.8 ms. In production that spawn happens once per app run.

## Three runs side by side — and what actually moves

| run | date | procs | CIM p50 / p95 / max | snapshot p50 / p95 / max | within-run p50 speedup |
|---|---|---|---|---|---|
| pre-block CIM baseline (RESEARCH-BASELINE §4) | 2026-08 | 486 | 1284 / 1459 / 1657 | — | — |
| first block measurement | 2026-08-12 | 519 | 1747.6 / 1873.6 / 2144.0 | 9.1 / 11.3 / 69.1 | 193× |
| this run | 2026-08-13 | 421 | 612.1 / 801.6 / 932.8 | 11.9 / 16.8 / 115.2 | 51× |

Read this table honestly, because the interesting line is the CIM column, not the
speedup column:

- **The CIM arm is not a stable quantity.** The same command on the same machine
  measured p50 1747.6 ms one day and 612.1 ms the next — a factor of 2.9 — with the
  process count moving only from 519 to 421. Whatever else drives it (WMI service
  state, background load, repository size on the disk it walks), it is not something
  this benchmark controls. Anyone quoting a single CIM figure as *the* cost of the old
  path is quoting one draw from a wide distribution.
- **The snapshot arm is stable.** p50 9.1 ms and 11.9 ms across the same two days, p95
  11.3 and 16.8. That stability, not the headline multiplier, is the result worth
  keeping.
- **Therefore the speedup ratio is the least durable number here.** 193× and 51× are
  both true, of their own runs. The claim that survives both is the weaker and more
  useful one: *the snapshot path costs about ten milliseconds and the CIM path costs
  hundreds to thousands, at every sample taken so far.*
- Cross-day comparison against 1284 / 1459 / 1657 remains the wrong comparison, for the
  same reason it was wrong on 08-12: different day, different load, different process
  count. Each run's own interleaved CIM arm is its only fair baseline.

## Millisecond parity — the blocking check, re-run

`instanceId` is `pid:startTime(ms)`. If the two providers disagreed about a birth time
by even one millisecond, a mid-session fallback from the sidecar to CIM would change an
instance's identity, splitting its session and its token ledger. This is a gate, not a
rounding note.

`node scripts/bench-generation.js --parity`

```json
{
  "sidecarProcs": 419,
  "cimProcs": 420,
  "compared": 419,
  "exact": 419,
  "mismatches": [],
  "oldestProcessAgeHours": 29.2
}
```

419 of 419 comparable pids agree **exactly**, on a machine up 29.2 hours — three times
the 9.3 h uptime of the 08-12 parity sample, so the agreement now covers a wider spread
of process ages. (Pids present in only one snapshot are skipped: the two observations
are microseconds apart and processes come and go.)

**Stated gap, unchanged:** 29.2 hours still does not span a daylight-saving transition,
so the DST case for the CIM path's `[DateTimeOffset]` conversion of a `Kind=Local` value
remains argued rather than measured. Re-run `--parity` on a machine whose uptime crosses
one to close it.

## What this does not claim

- Not a claim about identity correctness. The witness gates cache reuse; two instances
  sharing a pid and a birth millisecond still collide on `instanceId`, exactly as
  RESEARCH-BASELINE section 4 requires to be stated rather than eliminated.
- **Not a claim about processes born and dead between scan ticks.** Any snapshot path is
  blind to a process whose whole life fits between two 10 s ticks — it is never in a
  snapshot, so it gets no witness, no birth time and no identity. This measurement does
  nothing about that blind spot; closing it is an ETW question for a later block, and
  the decision was deliberately deferred until snapshot cost had been measured.
- Not a claim that `SequenceNumber` is in use. It is not. The runtime capability probe
  reported `{"class":"class5","sequence":false}` on this build, and the witness rode on
  the 100 ns creation time throughout — see `sidecar/procsnap/README.md` for why the
  class stays unwired rather than guessed at.
- Not a general performance figure. One machine, two days, one workload.
