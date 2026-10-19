# Offline resource interval arithmetic

Status: preparation library and derived fixtures only. This implements a bounded
arithmetic slice of [the future W8 method](../docs/bench/METHOD.md#future-resource-capture-and-repetitions).
It collects nothing and supplies no W8 measurement, calibration, overhead,
accuracy, three-run reproducibility or T8 acceptance. Existing benchmark outputs
and percentile conventions are unchanged.

`require('./lib/resource-intervals').evaluateResourceIntervals(input)` accepts one
closed `resource-intervals/1` run and returns independent deterministic JSON data.
It imports only the small pure `resource-input.js` validator, with no `src/`,
filesystem, clock, subprocess, native, Electron or VM dependency. There is no new
CLI, publisher, runtime switch or control route.

## Input contract

All fields below are required; objects have exactly these keys. IDs are 1–64
ASCII letters/digits/dot/underscore/hyphen, beginning with a letter or digit.
Records are ordinary JSON objects/arrays; accessors, unknown fields, duplicate
IDs/members, sparse arrays and extra array keys are rejected. Errors contain only
`resource-input-invalid` or `resource-output-too-large`.

| Field | Contract |
| --- | --- |
| `version`, `runId` | Exact version `resource-intervals/1`; one immutable run ID |
| `cadenceUs` | Exactly `1000000`, the method's proposed one-second schedule |
| `sampleWindow` | `{startUs,endUs}` inclusive planned scheduled endpoints; a whole number of cadence steps, at most 2048 points |
| `units` | Exactly `{wall:'us',cpu:'us',memory:'bytes'}`; no implicit conversion |
| `provenance` | `{collectorId,clockId,sourceSha256}`: IDs plus lowercase SHA-256 |
| `memory` | `{platform,definition,api,sharedPages}`; mapping below, API ID, exact `may-double-count` caveat |
| `phases` | Ordered nonoverlapping `{id,kind,steady,startUs,endUs}` windows; positive duration |
| `cohorts` | Unique IDs separating product, workload, oracle, generator and instrumentation as applicable |
| `lifetimes` | Unique `{id,pid,cohort,startUs,endUs}`; `endUs:null` means still live |
| `samples` | Ordered raw `{id,scheduledUs,actualUs,populationKnown,members}` records |
| Sample member | `{lifetime,userUs,kernelUs,residentBytes}`; counters/bytes are safe nonnegative integers or explicit `null` |

Phase kinds are `warmup`, `idle`, `workload`, `burst` and `drain`. The caller
predeclares the steady flag; warmup cannot be steady. Phase windows may have gaps.
Memory snapshots use `[startUs,endUs)`; CPU intervals can end exactly at the phase
end, provided the entire interval belongs to that single steady phase.

The planned sample window makes missing first/last observations detectable as
well as interior gaps. Every supplied scheduled time must lie on that grid.
Missing planned points are retained in `missingScheduledUs` and as excluded
`scheduled:<time>` references in overlapping phase estimates. Declared windows
are arithmetic inputs; this library does not qualify actual phase durations.
All members in a sample declare that sample's same actual capture boundary.
Unaligned per-member timestamps are not accepted; a future collector must prove
alignment or mark its population unavailable rather than re-labeling observations.

Every time and non-null counter is a finite nonnegative safe integer. PID is
1–2147483647. Lifetime windows use the same monotonic clock, are start-inclusive
and end-exclusive, and may not overlap for the same PID. The caller must supply a
new lifetime ID for every actual process lifetime, based on qualified lifecycle
identity observations. An ID or timestamp supplied to this library does not
authenticate an OS process. It never joins on PID, infers birth, caches identity
or reconstructs an unobserved lifetime. A complete lifetime catalog and truthful
population flags are caller prerequisites, including transient helpers.

`populationKnown` declares completeness at the observation; it is not inferred
from an empty member list. Missing known members and known between-sample churn
remain incomplete. Sampling/API/lifecycle collectors, actual population discovery,
source hash provenance and their qualification are separate future work.

Memory definitions are Windows `win32/working-set`, Linux `linux/rss` and macOS
`darwin/resident-size`. The recorded API ID and definition are preserved beside
every run. Totals add per-process resident values and may double count shared
pages; they are not unique physical memory and do not establish comparability
between different OS definitions/APIs.

The hard input limits are 16 phases, 16 cohorts, 256 lifetimes, 2048 samples,
16384 observed member rows and 2 MiB serialized input. Additionally,
`samples.length * max(lifetimes.length, cohorts.length) <= 16384` bounds expansion
when known members are missing. Serialized output is capped at 8 MiB. Limits are
refusal boundaries, not evidence that a future production workload fits them.

## Intervals, memory and refusals

`intervals` retains each adjacent sample pair, its actual boundaries, phase,
per-lifetime values/deltas and cohort values. Each value is accompanied by a
nullable closed reason. One-core CPU is
`100 * (deltaUserUs + deltaKernelUs) / deltaActualUs`. User and kernel counters
must each be nondecreasing; a positive combined delta cannot hide one regressing
counter. Cohort CPU sums exact admitted lifetime deltas over the same adjacent
wall interval before division. It never sums unaligned percentages. Values can
exceed 100%. Raw exact deltas remain available alongside derived floating values.

Reversed/duplicate clocks, missing scheduled samples, crossing phases, nonsteady
phases, missing counters/members, lifetime churn and unknown populations give
`null` with a reason. Counter precision is never repaired by rounding. Integer
sum overflow or an unrepresentable derived value is refused as `numeric-overflow`.
The evaluator does not sort times or counters to conceal a bad observation.

`memorySamples` retains each instantaneous member/cohort total. All expected
active members must have valid samples in a known population before a group
total is numeric. Member values may remain numeric while the cohort is incomplete;
this does not turn a partial sum into a complete total. A known empty population
is not emitted as zero. A complete observed population whose counters/bytes are
actually zero can yield measured zero in these derived fixtures.

Raw input samples, definitions, cohorts, lifetime catalog, phases and provenance
are copied into the result. Global excluded boundary intervals remain available
even when they belong to no single phase. Valid and excluded member values are
both retained. The library does not publish or redact arbitrary raw records;
this closed format accepts numeric evidence and safe IDs, not paths or contents.

## Estimates

`estimates` contains separate per-run, phase and cohort entries for
`cpu-one-core-pct` (`percent-one-core`) and `resident-bytes` (`bytes`). Each retains
the raw valid/excluded sample references and values/reasons, their counts,
`p50`, `p95` and an overall reason. p50 averages the middle pair for an even
population; p95 is nearest rank `ceil(95*n/100)`. A half-integer median that cannot
be represented without losing its fractional part is refused.

Any excluded member/population observation within the phase makes that estimate
incomplete: both percentiles are `null`, while valid raw samples remain visible.
Memory estimates also retain within-phase lifetime-churn interval exclusions.
An expected overlapping lifetime without any valid admitted observation adds
`unsampled-lifetime` evidence; a missing short-lived helper cannot disappear into
a complete phase estimate. Empty observations give null percentiles and a reason.
Nonsteady phases are recorded separately with null estimates.

Boundary intervals are excluded from steady sample populations; they are not
pooled into a neighboring phase. One invocation accepts exactly one run and only
raw counter/member fields. There is no interface for run averages, pooled
repetitions, paired-baseline overhead, calibration or three-run variance admission.
Independent input provenance remains necessary; arithmetic cannot detect a
caller falsely relabeling fabricated values as raw observations.

## Verification scope

`tests/main/bench/resource-intervals.test.js` is discovered by the existing main
Vitest project. It uses disposable in-memory derived data and performs no capture.
The fixtures cover lifetime reuse/churn, incomplete populations, boundaries,
monotonic schedules/counters, units/precision, resident definitions, raw quantiles,
empty/zero distinctions and closed bounds. Fixture success establishes arithmetic
and refusal behavior only. Future W8 execution still needs qualified collectors,
complete helper accounting, controlled images, independent baselines/calibration,
three repetitions and the remaining acceptance protocol in `METHOD.md`.
