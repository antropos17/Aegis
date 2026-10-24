# W8 measurement method — future qualification protocol

Status: **FUTURE qualification protocol; documentation draft only.** This is the
Wave 1 method draft in [the completion plan](../roadmap/completion-plan.md#w8--measurement).
Execution and publication belong to later W8 work on merged master after the
required sensor and explanation work. This document supplies no measurements,
accuracy or overhead figures, W8 acceptance or T8 completion.

## Existing evidence and reusable tooling

[Q9](../roadmap/completion-baseline.md#q9--benchmark-method-corpus-and-oracles)
inventories the baseline boundary: two process-based synthetic scenarios,
a renamed lifecycle process and a renamed Node process holding an inert file.
The [fixture corpus](CORPUS.md) adds four bounded write/deletion controls in
exclusively owned run directories. These six controls do not constitute a
real-agent task corpus. Reuse
`bench/scenario.schema.json`, `bench/lib/actor.js`, `bench/lib/catalogue.js` and
their existing validation. The schema defines scenario shape; the actor checks
executable step kinds and expectation compatibility before execution. Preserve
`expected.ndjson` and `steps.json` provenance, including failed/unexecuted steps.
Extend supported actions, observation mappings and independent confirmation
together before scoring a new category; declaring a scenario does not implement it.

These are existing entrypoints, verified against `package.json` and their source:

```sh
npm run bench:run -- --scenario S1-agent-lifecycle --arm A
npm run bench:run -- --scenario S1-agent-lifecycle --arm B
node bench/replay.js <recorded-run-directory> --out <new-report-file>
npm run bench:score -- <recorded-run-directory> --out <new-score-directory>
```

The first two execute the legacy Windows harness; they are not commands to run
this future protocol. Replay rebuilds `run-report.json`; score confirms catalogue
rows and derives `matched.ndjson` and `metrics.json`. `npm run bench:replay`
selects `bench/trace/bench-replay.js`, a different trace workflow. Existing scenario
and scoring validators remain authoritative for their formats; they are not a
general W8 receipt admission validator. This draft adds no schema or validator.

The [W1-pipe method](w1-pipe-method.md) measures a synthetic production batcher
with an acknowledging consumer. Its requested burst rate does not establish native
sensor or Electron throughput. The [cycle profiler](../../bench/cycle-profile/README.md)
and [September 27 observation](windows-post-sprint-live-2026-09-27.md) retain their
historical scope: development-host cycle/resources, external helpers excluded,
instrumentation uncalibrated. Neither implements the protocol below.

## Task corpus and independently checked outcomes

Future corpus cells fix agent name/version, model/provider version where available,
settings, allowed tools, privileges, sensor mode, fixture/input hashes and workload.
Use real fixed-version agents for ordinary project tasks and unsafe-action tasks.
Keep the current synthetic controls for harness checks, with separate labels.

| Task class | Disposable stimulus | Independent executable outcome rubric |
| --- | --- | --- |
| Ordinary work | Edit, build or inspect a fixture project | Compare expected files/tests and allowed side effects with a frozen rubric |
| Sensitive read | Read an inert secret canary in the disposable home | Independently verify actual read activity and the task's expected result |
| Outside-project write | Write a canary beyond the fixture project within the owned sandbox | Independently check destination/content hash and action provenance |
| Deletion | Remove a disposable fixture | Independently verify absence and deletion provenance |
| Outbound transfer | Send inert canary bytes to an owned receiver | Receiver checks payload hash, connection and receipt count |
| Persistence location | Place an inert fixture in an isolated persistence target | Independently inspect the target; never activate durable host persistence |

The rubric must run without consuming AEGIS telemetry or policy decisions. Record
task completion, failure, refusal, timeout and unexpected side effects separately
from event detection and from policy denial. A denial does not prove task success
or successful execution of the attempted unsafe action. Preserve attempted,
executed and independently confirmed counts; unavailable provider execution stays
unavailable. The actor's catalogue alone is insufficient independent confirmation.

Predeclare a scenario-to-technique matrix with technique ID, ATT&CK version,
source reference, mapping rationale and executable positive/negative controls.
Publish red/green outcomes only after execution, retaining genuine misses. This
is a prospective mapping requirement; no existing scenario is assigned an invented
technique or claimed to provide current ATT&CK coverage by this draft.

## Catalogue, oracle and sensor columns

[Offline ordinary-task evaluator and input contract](TASK-FALSE-ALARMS.md).

The sequence remains catalogue -> independent oracle confirmation -> sensor
scoring. Confirm each catalogue row from the same run before admitting it to a
sensor denominator. Keep oracle columns separate; never diff live streams or use
AEGIS, its audit output or another consumer of the same sensor provider as its
own independent oracle.

| Platform | Future controlled environment and oracle columns | Current limitation |
| --- | --- | --- |
| Windows | Hyper-V Gen2 gold image with pinned Windows build; separate Sysmon and Procmon evidence/configuration/loss columns | Sysmon adapter is LIVE-UNVALIDATED; Procmon has only [offline CSV staging](PROCMON-IMPORT.md), with capture/export qualification and scoring admission absent |
| Linux | Pinned image/kernel; independent auditd configuration, availability, privileges and loss accounting | auditd adapter and native qualification remain future work |
| macOS | Pinned OS/image; independent `eslogger` when available, with privileges/entitlements and loss accounting | Adapter and native qualification remain future work; unavailable collection needs a reason |

Retain legacy arms: A = sensor + Sysmon; B = Sysmon + Procmon without the sensor
for oracle calibration; C is defined as sensor alone for overhead, but currently
starts no sensor and provides no calibrated baseline. Current B lacks Procmon
collection and is partial. A separate B execution cannot confirm actual reads in
A. The legacy Sysmon mapping cannot confirm ordinary file reads; retain existing
read cells as unmeasurable.
A future same-run independently qualified file oracle for A is **UNIMPLEMENTED**;
it requires a reviewed capture/confirmation design and must retain separate oracle
columns and B calibration. Procmon file activity proves file activity; it does
not prove that Windows emitted a `Kernel-File` Read (15) event. A second reader of
that provider cannot independently establish its emission or loss.

Existing Sysmon deletion confirmation uses EID 26. Do not enable EID 23 archival
deletion as a substitute. [Microsoft's event descriptions](https://learn.microsoft.com/en-us/sysinternals/downloads/sysmon)
distinguish archived deletion (23), deletion without archival (26) and raw-device
access (9); raw-device access does not supply ordinary per-file read truth.
Existing scoring covers process start/end and file
creation/deletion with the keys and limitations in `bench/lib/metrics.js`.

| Evidence state | Treatment in future results |
| --- | --- |
| Confirmed measurable action, complete healthy collection, no matching sensor record | Genuine sensor miss, with category/mode and matching rule |
| Failed or unexecuted action | Execution failure; outside sensor recall denominator |
| Executed catalogue row without oracle confirmation | Unconfirmed, with reason; outside sensor recall denominator |
| Oracle cannot observe category, unavailable platform or unsupported mapping | Unmeasurable; `null` and reason |
| Oracle/sensor loss, collection gap or unresolved accounting contradiction | Explicit incomplete/loss result; refuse complete coverage claims |
| Healthy measurable collection with no observed false alarms or losses | Measured zero with exposure, completeness and source evidence |

Report per-category recall only over independently confirmed measurable actions.
For ordinary tasks, define eligibility independently of task outcome: use the
same started benign-task cohort with complete scheduled observation for both
the numerator (tasks with at least one false alarm) and denominator (all eligible
tasks). Retain completed, failed, refused and timed-out outcomes, alarm counts,
task counts and observation hours. Count collection-incomplete tasks separately;
refuse an overall complete incidence claim when the cohort is incomplete. Freeze
the alarm definition, duplicate handling and independent adjudication before
collection. Empty eligible exposure gives `null` with reason. This measurement
is distinct from `1 - precision`; legacy lower-bound precision mixes unrelated
activity and sensor noise and cannot supply it.

## Time and latency

Record each timestamp's source, clock domain, resolution and capture point.
Legacy confirmation has no epsilon: it uses its recorded collection window and
keys. `stampDeltaMs` is oracle timestamp minus catalogue timestamp; it is neither
latency nor measured clock offset. The historical Sysmon `SystemTime` versus
`UtcTime` discrepancy is a timestamp representation issue, not a measured
guest/host offset. Preserve historical results and these distinctions.

Future cross-clock joins require measured calibration before and after each run,
an uncertainty bound and a predeclared refusal threshold; record drift and refuse
latency claims when calibration is missing or exceeds that threshold. Never infer
a clock correction from matched action timestamps. Define latency from verified
action time to the named delivery point, retaining negative, ambiguous and
out-of-bound observations with reasons. Sensor capture, audit persistence and UI
delivery are separate endpoints. The existing sensor join's three scan intervals
are its own matching bound, not a universal latency budget for other modes.

## Future resource capture and repetitions

The following values are protocol settings proposed for future implementation,
not observed performance. Freeze them with the collector implementation before
the first qualification run. Each fixed commit/platform/mode/agent/workload cell
requires three independent repetitions, each with a fresh application process,
profile and disposable project restored from the same fixture/image state.

| Phase per repetition | Planned duration | Planned capture |
| --- | ---: | --- |
| Startup/warmup | 90 seconds | Record separately; exclude startup from steady estimates |
| Idle | 300 seconds | No agent task; ordinary monitoring remains active |
| Scripted agent workload | 300 seconds | Fixed task script and seeds; record actual completions/timeouts |
| Burst | 30 seconds | Target 20,000 events/s; record actual offered and delivered counts/rates |
| Drain | Up to 60 seconds | Stop offering; measure time/counts until all tracked queues settle or deadline expires |

Sample cumulative process CPU counters and resident memory every 1 second using
a monotonic scheduler. Preserve scheduled/actual sample times and interval
boundaries. Admit CPU intervals only when the entire interval lies in one steady
phase; intervals crossing startup or phase boundaries are excluded with reasons.
For each process lifetime, one-core CPU percent is
`100 * delta(user CPU + kernel CPU) / delta(monotonic wall time)` in matching units.
One busy core is 100%; parallel processes may exceed 100%. Compute group CPU from
the summed lifetime CPU deltas over the same wall interval.

Track lifetime identity and cohort for AEGIS main, every renderer/GPU/utility,
every sensor and every transient helper, including native, PowerShell and WSL
children. Retain each member and cohort aggregate. Agent/workload processes,
oracles, generator and calibration collectors have separate cohorts. Capture
short-lived helpers through qualified lifecycle accounting; missing helpers,
samples or unresolved churn make that resource estimate incomplete, never zero.
An empty Electron metrics response cannot establish zero resident memory.

Record the resident-memory definition, API and units for each OS: Windows working
set, Linux resident set and macOS resident size, including source-specific scope.
Publish definitions beside comparisons; summed process RSS/working sets can
double count shared pages and do not measure unique physical memory. Require a
known population and valid member samples before publishing a group total.

For each burst retain target and actual offered rate, actual duration, per-second
counts, scheduler lateness, catch-up behavior, all loss/drop counters, queue
high-water marks and final drain state. Future admission requires the full planned
count, average offered rate at least 98% of target, maximum scheduler lateness at
most 1 second and completed drain; otherwise label the burst incomplete. Preserve
the observed rate even on failure. These proposed W8 controls require their own
implementation; the W1 synthetic harness alone cannot establish them end to end.

Report absolute product/cohort footprint separately from paired baseline delta.
For each repetition pair the enabled product run with a restored, workload-matched
product-disabled baseline, keeping oracle/generator instrumentation equivalent.
Predeclare alternating enabled/disabled order across the three pairs. Record
baseline validity and comparable task execution; changed task behavior invalidates
the workload delta. Measure instrumentation cost in separate matched collector
on/off calibration runs using an independent resource reference, with uncertainty.
Keep raw enabled, baseline and calibration observations; an uncalibrated collector
cannot support a calibrated overhead claim. Legacy arm C supplies neither control.

The [offline paired task scorer](PAIRED-TASK-LATENCY.md) retains planned outcomes
and computes completion-latency estimates separately for each repetition. It
collects no tasks and supplies no measured or calibrated overhead acceptance.

## Estimation, variance and refusal

For this future protocol, p50 is the median of sorted valid samples, averaging
the middle pair for even counts; p95 is nearest rank at `ceil(0.95 * n)`. Retain
raw numeric samples, valid/excluded sample counts, units and provenance. Compute
each phase/category/cohort estimate per run; latency uses confirmed matched pairs.
Empty or incomplete populations yield `null` with a reason. Never calculate a
sample p95 from three run averages or pool repetitions into one sample population.
Legacy `join.js` p50 uses nearest rank; the historical cycle profile uses a
middle-pair median. Their existing outputs keep their original conventions.

Show all three per-run p50/p95 estimates and their minimum, maximum and range.
Before collection freeze a versioned variance plan for every metric, phase,
cohort and percentile, declaring finite nonnegative `A` (metric units) and `R`
(dimensionless fraction), rationale and calibration uncertainty. Require
`max - min <= A + R * abs(median(three run estimates))`. Refuse a reproducibility
claim if this bound fails, any required estimate is incomplete, or fewer than
three valid repetitions exist. A zero median requires explicit `A`; the relative
term then contributes zero. There are no default bounds: absent predeclared
bounds means qualification is not ready. Failed runs remain in the record;
replacement-run reasons and all IDs are disclosed. Do not select tolerances or
discard outliers after seeing results.

The [offline reproducibility evaluator](REPRODUCIBILITY.md) applies this rule to
three declared repetitions with explicit per-cell bounds. It retains failed or
incomplete repetitions and does not select replacement runs. Its hash and time
checks validate agreement between supplied declarations; they cannot establish
prior freezing, authentic capture or complete disclosure of the run history.

## Reproducibility, privacy and execution prerequisites

Future immutable run IDs and comparison group keys must bind commit, clean source
or exact source hashes, harness/binary/configuration/input hashes, agent/provider
versions, mode, privileges, OS build/kernel and controlled image identity. Include
actual versions and unavailable facts with reasons. Check input hashes before and
after capture; a change invalidates the cell. Current manifests record platform
without all controlled-image fields; these additional receipts remain future work.
Future admission must validate receipt versions, identity agreement, counts,
population completeness, calibration and declared loss before publishing tables.

Generate numeric receipts and dated tables with scripts in `bench/`; author the
explanation around them. Deterministic offline rerender from fixed inputs and
renderer hashes should reproduce exact bytes. A new live run instead has measured
variance and must satisfy the predeclared comparison contract. Keep fresh outputs,
preserve historical recordings/goldens and never overwrite the evidence being
verified. Replay equality establishes reconstruction, not live effectiveness.

Use disposable homes/projects and inert secret canaries. Public receipts contain
numeric evidence, safe fixture IDs and hashes, without real prompts, command
arguments, monitored contents, credentials or identifying paths. Keep raw traces,
normal app profiles and oracle data private with bounded access and retention.
Before future execution, reserve a task-owned data-drive directory and require
at least 10 GiB free before each individual capture. Each enabled, disabled or
calibration capture has its own immutable ID, 2 GiB raw-output quota and
20-minute wall deadline. An enabled/disabled pair can therefore consume up to
40 minutes and 4 GiB; calibration captures are separate. Reserve capacity and
check free space across all retained captures and repetitions: an initial
10 GiB check does not cover the whole experiment. Check free space/output growth
before, every 30 seconds during, and after each capture; stop the owned capture
on quota/deadline/space breach and mark it incomplete. These are proposed
operator/collector controls, not installed rotation.
Review closed disposable raw files after seven days; preserve receipts and evidence
under review, skip locked files/reparse points and never clean unrelated data.

Before collecting, the bench owner must implement/qualify missing action and
oracle adapters, full helper accounting, baselines/calibration and reproducible
table generation. The platform owner supplies controlled images, privileges and
available Sysmon/Procmon, auditd or `eslogger`; provider and provisioning actions
need the corresponding owner authorization. Prepare exact commands for that
selected implementation before execution. No native collector, VM provisioning or
provider command is invented here. Until those prerequisites and three-run
evidence exist, publication and W8/T8 acceptance remain pending.
