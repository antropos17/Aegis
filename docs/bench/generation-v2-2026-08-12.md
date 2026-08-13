# Generation v2 — process-table observation cost (2026-08-12)

One machine, one sample, one day. These numbers are evidence that the sidecar removes
the tax it was built to remove; they are not a guaranteed runtime, and re-running on
another machine will produce different ones.

Reproduce: `npm run build:sidecar && node scripts/bench-generation.js --n 32`

## What was measured

One sample is one provider call, timed in JavaScript from the call to the resolved
`Map` the scan loop consumes — the same quantity the pre-block measurement reported
(N=32, 486 processes, p50 1284 / p95 1459 / max 1657 ms). Percentiles are nearest-rank
over N=32.

Two deliberate refinements over that earlier run:

- **The arms are interleaved round-robin**, not run in blocks, so machine drift lands
  on every arm equally. The earlier measurement had a single arm and no such concern.
- **Every sample records which provider actually served it**, and the script exits
  non-zero rather than print a comparison if a sidecar arm was served by anything
  else. The benchmark runs with `AEGIS_PROC_SNAPSHOT=strict`, which removes the CIM
  fallback entirely. Without that, a wrong binary path would have produced a
  "no speedup" table with no hint that the sidecar never ran.

Environment: `Windows_NT 10.0.26200` (11 25H2, UBR 8655) · 22× Intel Core Ultra 9
185H · node v24.11.1 · uptime 9 h · 519 processes during the run.

## Result

| arm | N | procs | p50 ms | p95 ms | max ms | min ms | mean ms |
|---|---|---|---|---|---|---|---|
| CIM (`Win32_Process`, PowerShell) | 32 | 519 | 1747.6 | 1873.6 | 2144.0 | 1564.6 | 1751.3 |
| sidecar warm (live child) | 32 | 519 | 9.1 | 11.3 | 69.1 | 7.9 | 11.0 |
| sidecar cold (spawn + handshake + exit) | 32 | 521 | 67.3 | 76.7 | 80.0 | 60.1 | 68.4 |

**p50 speedup, warm sidecar vs CIM measured in the same run: 193×.**

Reading the table honestly:

- **Compare against this run's own CIM arm, not against 1284/1459/1657.** Those came
  from a different day, a different load and 486 processes; this machine had 519. The
  interleaved CIM arm is the only fair baseline here.
- The warm arm's `max` of 69.1 ms is its **first** sample, which pays the spawn. Every
  later sample is 7.9–11.3 ms. In production the spawn happens once per app run.
- The cold arm is the one-off startup tax of the binary, not a per-tick cost. It is
  measured separately because a long-lived sidecar only pays it once — and because if
  the supervision layer ever has to restart the child, this is what that costs.
- One caveat worth recording: the **very first** execution of a freshly compiled,
  unsigned binary took ~1.8 s, almost certainly Defender scanning a new file. Later
  cold spawns settle at ~67 ms. A shipped installer's first launch may pay this once.
- Inside the sidecar, the query plus parse is ~7 ms (`us` field on each response); the
  rest of the warm figure is framing, the pipe and `JSON.parse` of a ~50 KB snapshot.

## Millisecond parity — the blocking check

`instanceId` is `pid:startTime(ms)`. If the two providers disagreed about a birth time
by even one millisecond, a mid-session fallback from the sidecar to CIM would change
an instance's identity, splitting its session and its token ledger. So this is not a
rounding note; it is a gate.

`node scripts/bench-generation.js --parity`

```json
{
  "sidecarProcs": 545,
  "cimProcs": 546,
  "compared": 542,
  "exact": 542,
  "mismatches": [],
  "oldestProcessAgeHours": 9.3
}
```

542 of 542 comparable pids agree **exactly**. (Pids present in only one snapshot are
skipped: the two observations are microseconds apart and processes come and go.)

The arithmetic says they must: the kernel's 100 ns ticks and WMI's DMTF microseconds
both floor to the same millisecond, because `floor(floor(t/10)/1000) == floor(t/10000)`.
The measurement is what makes it a fact rather than an argument.

**Stated gap:** this machine had been up 9.3 hours, so no process in the sample was
born on the other side of a daylight-saving transition. The CIM path converts through
`[DateTimeOffset]` on a `Kind=Local` value, which is offset-aware by construction, but
that specific case is **argued, not measured** here. Re-run `--parity` on a machine
with a longer uptime to close it.

## What this does not claim

- Not a claim about identity correctness. The witness gates cache reuse; two instances
  sharing a pid and a birth millisecond still collide on `instanceId`, exactly as
  RESEARCH-BASELINE section 4 requires to be stated rather than eliminated.
- Not a claim about processes born and dead between 10 s scan ticks. Any snapshot
  approach is blind to those; closing that is an ETW question for a later block.
- Not a claim that `SequenceNumber` is in use. It is not — see
  `sidecar/procsnap/README.md` for why the class is not wired.
