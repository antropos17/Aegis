# Warning score work — 2026-09-13

`checkDeviations()` previously computed all four risk dimensions for every mature
instance, including checks that returned no new warnings. The process scan also
computes scores separately for its renderer payload. Warning checks now compute
one score only for an instance that produced new warnings. Every warning receives
that current score before the synchronous function returns. Nothing is cached
between checks or shared between same-named instances. Thresholds, warning order,
suppression and the renderer score path are unchanged.

## Reproduction

From the repository root, with an unused report filename:

```powershell
node scripts/bench-anomaly-warnings.cjs --baseline=726743b9086d1e0217f599ce8b10445ead398c6a --report=X:/tmp/anomaly-warning-work.json
```

Only use trusted baseline commits: the script executes both actual detector
revisions in separate CommonJS instances. Both use current scoring functions,
with counters, and an in-memory baseline provider. Each fixture has 256 known
endpoints, 128 known directories and five historical sessions. Each arm warms up
for 20 checks, then runs 20 interleaved samples of five checks. The new-warning
case clears warning suppression before each check; that cleanup is inside its
timed region. First and final warning payloads must match exactly. Dimension-call
counts must match the expected workload; timing has no pass/fail threshold.

Windows x64, Node v24.11.1; median milliseconds per check:

| Instances | Case | Previous | Current | Dimension calls per check, previous/current |
| --- | --- | --- | --- | --- |
| 8 | Normal activity | 0.87018 | 0.41518 | 32 / 0 |
| 8 | Already warned | 0.63172 | 0.32984 | 32 / 0 |
| 8 | New warnings | 0.74684 | 0.78810 | 32 / 32 |
| 64 | Normal activity | 5.14908 | 2.72476 | 256 / 0 |
| 64 | Already warned | 5.10488 | 2.74270 | 256 / 0 |
| 64 | New warnings | 8.63640 | 8.52914 | 256 / 256 |

The [JSON report](anomaly-warning-work-2026-09-13.json) includes source/scoring
hashes and accumulated counts. New-warning cases retain the scoring work and do
not demonstrate an improvement. These are controlled detector measurements with
substantial endpoint/directory histories, not total app CPU measurements or a
claim about typical user workloads. The script does not enumerate processes,
start sensors, read user baselines or write application settings.

Three regression tests check skipped dimension work, current scores after new
activity, once-per-instance scoring for multiple warnings, independent same-name
instances and suppression cleanup. Two failed against the baseline because it
still scored checks with no new warnings; all pass after the change.
