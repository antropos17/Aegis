# Own-Node acquisition-window intervals

`require('./lib/bracketed-resource-intervals').evaluateBracketedResources(input)`
consumes the unchanged [own-process sampler](SELF_RESOURCE_SAMPLER.md) format.
It preserves separate CPU/RSS acquisition windows and derives conditional CPU
rate bounds and phase-admitted RSS values. The module has no I/O, clock, process
discovery, runtime integration or CLI. Its only scope is the calling Node process
described by the supplied raw packet.

## Inputs and source evidence

The input is a closed ordinary JSON object with exactly `raw`, `plan` and
`provenance`. `raw` is one complete `self-resource-samples/1` packet, including
its limits, API labels, clock, unknown identity/population, sample readings,
missed points, unattempted tail and termination/cleanup state. All original
fields are retained in the result. `readingMode` remains `own-process` or
`injected`; neither label authenticates supplied observations.

The consumer checks the raw format, scheduled grid, unique point accounting,
declared counts and acquisition-completeness flag. Every planned point must be
observed, explicitly missed or in the terminal unattempted tail. Inconsistent
metadata is refused; readings with acquisition errors, regressions or unavailable
values remain evidence with refusal reasons. It does not repair or sort readings.

`provenance` has exactly `sourceSha256`, a lowercase SHA-256 identifying the
caller's externally retained source/configuration inventory. The consumer
preserves this declaration without reading or authenticating that inventory.
The caller retains raw-byte hashes for the plan, input, output and driver.

`plan` has these required fields; no timing limits or phases have defaults:

| Field | Contract |
| --- | --- |
| `version`, `runId` | `bracketed-resource-plan/1`; the raw packet's run ID |
| `clock`, `durationUs` | `collector-start`; exactly the raw planned duration |
| `maxAcquisitionUs` | Positive integer up to `durationUs`, including floor uncertainty |
| `maxCpuUncertaintyUs` | Positive integer up to twice `durationUs` |
| `phases` | 1–16 ordered nonoverlapping `{id,kind,steady,startUs,endUs}` windows within `[0,durationUs]` |

Phase kinds are `warmup`, `idle`, `workload`, `burst` and `drain`; warmup cannot
be steady. Phase IDs use the raw run-ID alphabet and length. Windows may have
gaps. Times are relative to this packet's collector start, with microsecond
units. Different sampler invocations have separate relative origins.

Freeze the plan, bounds and source evidence before starting collection. This is
a caller obligation: a pasted plan, timestamp or digest cannot prove prior
declaration, truthful phase execution, source provenance or clock calibration.
The module does not join loopback outcomes, independently started collectors or
other clock domains.

## Timing enclosure and conditional rates

Each reading retains its original `beforeUs` and `afterUs`. Because the sampler
floors nanoseconds to microseconds, its conservative enclosure is
`[beforeUs, afterUs + 1)`, with width `afterUs - beforeUs + 1`. Even equal recorded
endpoints retain one microsecond of enclosure. An unsafe `afterUs + 1`, unavailable
or reversed bracket, excessive width or acquisition before its scheduler/preceding
CPU reading is refused with a closed reason.

For adjacent scheduled CPU observations A and B, elapsed-time bounds are
`min = B.lowerUs - A.upperExclusiveUs` and
`max = B.upperExclusiveUs - A.lowerUs`. The consumer retains these conservative
outer bounds and their difference, refusing nonpositive minimum duration or
uncertainty above the caller's limit. Both full acquisition windows and the
interval between them must fit one declared steady phase. Missing scheduled
points prevent a derived interval across the gap.

User and system counters are checked separately. An unavailable counter,
regression or acquisition error retains its own reason; an increasing combined
sum cannot conceal a regressing component. Safe admitted deltas are added using
integer arithmetic. Overflow yields an explicit refusal.

`rateBounds` uses exact rational fields: each bound is
`scale * numerator / denominator`, where `scale` is 100, the numerator is the
combined CPU delta in microseconds and the denominator is elapsed microseconds.
The lower rate uses maximum elapsed time; the upper uses minimum elapsed time.
The unit is `percent-one-core`. This avoids rounding an emitted floating bound
inward. A UI that converts these fractions to decimals owns its rounding policy.
Bounds are conditional on supplied counter readings and their timing enclosure;
they do not establish calibrated true CPU accuracy or instrumentation overhead.

## RSS, schedule and result boundaries

RSS has its own acquisition window. A numeric `residentBytes` is admitted only
when that whole window fits a single steady phase and the reading is available.
CPU and RSS do not acquire a fabricated common timestamp. The original
`node-process-rss` definition and shared-page caveat remain in `raw`.

The result retains raw data, plan, provenance, reading mode, per-counter reasons,
CPU intervals, separate RSS observations and every planned point's state.
`boundaries` retains the first/last CPU windows and excluded planned endpoint.
The sampler's schedule is end-exclusive: a four-second plan has points 0–3.
There is no closing scheduled point at four seconds, and the last counter cannot
establish CPU use through that unobserved tail. No closing sample, zero tail,
whole-phase estimate, percentile, cohort sum or population completeness is added.
The raw `complete` flag still describes acquisition of its scheduled points only.

Malformed input raises only `bracketed-resource-input-invalid`. Input is bounded
to 256 KiB, depth 12, 20,000 JSON values, 128-character strings and 512-element
arrays; raw sampler limits still apply. Getters, symbols, sparse/extended arrays,
cycles, shared object references and nonordinary prototypes are refused. Output
is capped at 512 KiB with `bracketed-resource-output-too-large`. Dynamic data is
numeric evidence, booleans, nulls, safe IDs and source hashes; errors contain no
input text. The caller owns storage limits and retention.

## Verification and remaining qualification

The focused `tests/main/bench/bracketed-resource-intervals.test.js` consumes the
real sampler through deterministic injected readers, exercises timing/phase and
counter refusals, schedule preservation, exact bounds and closed input limits.
A short default own-Node run can establish actual raw-to-derived execution on
that Node/OS combination with a predeclared inert workload and retained hashes.
Such a run has no machine-dependent performance pass threshold.

This format supplies no conversion to aligned `resource-intervals/1`, OS birth
identity, complete process population or simultaneous multi-process capture.
Full helper accounting, platform memory definitions, matched restored product
baselines, independent calibration and three repetitions remain prerequisites
of [the W8 measurement method](../docs/bench/METHOD.md#future-resource-capture-and-repetitions).
