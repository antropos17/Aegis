# Offline paired task latency

`bench/paired-task-latency.cjs` evaluates a supplied, bounded JSON packet. It does
not collect observations, launch tasks, contact a provider or run AEGIS. The pure
CommonJS entry point is `evaluatePairedTaskLatency(input)` in
`bench/lib/paired-task-latency.js`. Existing event-delivery latency and resource
scorers keep their contracts. This scorer supplies no measured task latency,
overhead, native qualification or W8 acceptance. `launchAllowed` remains `false`.

```sh
node bench/paired-task-latency.cjs --help
node bench/paired-task-latency.cjs --input evidence.json --output new-result.json
```

The output must not exist. Both paths require existing ordinary parent
directories; symlinks, junctions, UNC paths, alternate data streams and multiply
linked input files are refused. Use owned directories without concurrent path
replacement. Ancestor checks and exclusive creation do not authenticate a
filesystem or establish containment against an adversarial directory owner.
An interrupted write can leave a partial new output; select another new path
after inspecting that file. The input is never overwritten.

Exit status is `0` for help or a written result, including null estimates; `2`
for usage; `3` for input path/read/size; `4` for malformed evidence; `5` for output
path/collision; and `6` for output write errors. Errors expose fixed codes.
An exit of zero does not imply comparability or qualification: inspect
`comparison.status`, each repetition's `reasons` and each metric's `reason`.

## Closed input contract

The root has exactly `version`, `evidenceKind`, `units`, `planSha256`, `plan` and
`pairs`. Version is `paired-task-latency/1`; kind is `synthetic` or `supplied`;
units are `monotonic-ms`. Unknown keys are invalid at every level. All integers
are safe, nonnegative and at most 1,000,000,000,000. Timeouts, scheduled exposure
and clock resolution are positive integer milliseconds. SHA-256 declarations
are 64 lowercase hexadecimal characters. IDs match
`[A-Za-z0-9][A-Za-z0-9_-]{0,47}`.

Input is limited to 1 MiB, 128 tasks, three declared pairs, two arms per pair and
128 rows per arm (768 rows total), depth 12 and 50,000 JSON nodes. Plain JSON
strings are at most 128 characters, object keys at most 64 characters. The API
rejects accessors, class instances, cycles, sparse arrays and unsafe numbers
before copying input. The CLI also rejects duplicate JSON object keys and invalid
UTF-8. Output is deterministic, contains no generated time or host path, and is
limited to 4 MiB by the CLI.

`plan` has exactly these fields:

| Field | Meaning |
| --- | --- |
| `planId` | Declared immutable plan ID |
| `common` | Common comparison identities, described below |
| `treatment` | Exactly `{disabled:{monitoringEnabled:false},enabled:{monitoringEnabled:true}}` |
| `tasks` | Nonempty unique planned task roster |
| `pairs` | Exactly three unique `{pairId,order}` declarations in chronological order |

Every `order` is `['disabled','enabled']` or its reverse. First arms must alternate
across the three pairs. Observed `pairs` have the same chronological sequence;
each is `{pairId,order,arms}`. A missing observed pair or changed order is retained
as a comparison failure and suppresses all repetition estimates. Missing arms
and rows are represented explicitly in the planned output. Duplicate or
substituted pair/task/arm IDs and malformed declared plans reject the packet.
No replacement run is silently selected.

`common` has exactly eleven SHA-256 fields: `agentSha256`, `providerSha256`,
`modelSha256`, `binarySha256`, `harnessSha256`, `osImageSha256`, `privilegeSha256`,
`oracleSha256`, `generatorSha256`, `instrumentationSha256` and
`configurationSha256`. Each observed arm has exactly `{arm,common,treatment,rows}`.
Its `common` must equal the planned common declaration. Its closed `treatment`
must equal the selected planned arm. `configurationSha256` identifies the common
configuration **excluding** the explicit `monitoringEnabled` treatment. Supplying
two different whole-configuration hashes is insufficient and is refused as a
comparison mismatch. Instrumentation is common to both arms.

Each task has exactly `{taskId,definitionSha256,rubricSha256,fixtureSha256,
seedSha256,eligible,timeoutMs,scheduledMs}`. Eligibility is frozen before looking
at outcomes. Ineligible tasks remain in the planned row/outcome inventory and are
excluded from the latency denominator by that declaration. Every planned row,
including an ineligible one, must be present and bound to the plan.
`planSha256` uses the canonical `hashTaskEvidence(plan)` helper from
`bench/lib/task-false-alarms.js`. Each observed row has exactly:

| Field | Values |
| --- | --- |
| `taskId`, `taskSha256` | Planned ID and canonical `hashTaskEvidence(plannedTask)` |
| `scheduledMs` | Exact planned scheduled exposure |
| `started` | Boolean; false exactly when outcome is `not-started` |
| `outcome` | `completed`, `failed`, `refused`, `timed-out`, `unfinished`, `not-started` |
| `clock` | `null` or `{startDomain,endDomain,resolutionMs,startMs,endMs}` |
| `evaluation` | `{independent,oracleSha256,success,behavior,evidenceSha256}` |

An unstarted row has a null clock. Other rows may have a null clock when timing
is unavailable. Clock domain IDs and positive resolution describe that row's own
monotonic clock. `endMs` must be at least `startMs`. Elapsed time uses subtraction
only within one domain. Different runs can use unrelated domains and origins:
no cross-run offset is needed to compare their elapsed durations. Mixed
start/end domains produce unknown elapsed time. Version 1 accepts no calibration
mapping; do not subtract across domains or invent a correction. Resolution is
retained without claiming precision beyond the supplied clock.

Evaluation has an independent-check boolean, planned oracle hash,
`success: true|false|null`, `behavior: 'matches'|'differs'|'unknown'` and an evidence
SHA-256 or `null`. An eligible successful-completion row requires `completed`,
independent `true`, success `true`, behavior `matches`, a non-null evidence hash
and known elapsed time. Outcome alone never proves independently checked success.
Timeouts and scheduled exposure bind the planned cohort. `timeoutMs` is the
maximum elapsed budget for successful completion, and `scheduledMs` is the
maximum scheduled exposure available for that completion, each measured from
that task's own start. A known eligible row declared `completed` with
`success:true` must have elapsed time at most both budgets. Exceeding either
budget suppresses the repetition's whole-cohort estimates with
`completion-timeout-exceeded` and/or `completion-exposure-exceeded`. Equality is
admissible. Version 1 defines no grace interval, rounding allowance or tolerance;
a future tolerance would need an explicit predeclared contract. Clock resolution
does not silently widen these limits. Unknown elapsed time remains unknown and
already suppresses the estimates.

Neither budget substitutes for an observed duration. Raw rows, outcomes and
terminal elapsed time remain as supplied even when a successful-completion claim
contradicts a budget. Failed, refused, timed-out and unfinished outcomes keep
their elapsed time and are not relabeled or assigned a deadline duration.

## Estimation and evidence limits

Every repetition retains both arms, all planned rows (missing rows have
`row:null`), raw outcomes, clocks and evaluations, terminal elapsed values and
counts for every outcome. Its denominator is the frozen eligible task count.
Missing planned rows, task/exposure/identity/treatment mismatches, non-successful
eligible outcomes, unverified success/behavior or unknown eligible timing make
that repetition's complete-cohort completion p50, p95 and paired ratio null.
No available/completed-only subset replaces this population. No zero or deadline
is imputed. A valid repetition can still be inspected when another repetition
has a failed task; the whole comparison status then remains `not-comparable`.
An empty eligible cohort produces null estimates; an empty planned roster is
invalid.

For comparable repetitions, per-task `deltaMs` is enabled minus disabled;
`ratio` is enabled divided by disabled, and `percentChange` is delta divided by
disabled times 100. Each arm's completion p50 is the ordinary median (mean of
the middle two for even populations); p95 is nearest rank `ceil(0.95*n)` in
sorted task durations. `pairedRatio.p50` is the median of individual task ratios,
not a ratio of arm medians. Zero baseline duration leaves that task's ratio and
percentage null and the complete-cohort paired ratio null with `zero-baseline`;
the arm's duration percentiles and signed deltas remain available.

Each of the three repetitions is reported separately. There is no pooled
latency, p95 of run means, run-average replacement, uncertainty estimate or
reproducibility/variance acceptance. Apply the independent repetition and
variance requirements in [METHOD](METHOD.md#future-resource-capture-and-repetitions)
to actual collected evidence separately.

Admission is explicitly `conditional-supplied-evidence`. Hashes bind the supplied
packet; they cannot prove a prior freeze, authenticity, omitted observations,
correct configuration declarations, genuine independent checking or complete
instrumentation. A `synthetic` packet exercises arithmetic only. A `supplied`
label also carries no measured-evidence authentication. Both retain
`launchAllowed:false` and provide no native/provider/agent-execution acceptance.

## Small synthetic input example

Save this as `example.cjs` in the repository root and run it once with Node to
create a new `example.json`. It writes only synthetic JSON; the scorer still
requires that explicit file. The repeated hashes are placeholders.

```js
const fs = require('node:fs');
const { hashTaskEvidence: hash } = require('./bench/lib/task-false-alarms.js');
const sha = 'a'.repeat(64);
const common = Object.fromEntries(
  ['agent', 'provider', 'model', 'binary', 'harness', 'osImage', 'privilege',
    'oracle', 'generator', 'instrumentation', 'configuration']
    .map((key) => [key + 'Sha256', sha]),
);
const task = {
  taskId: 't1', definitionSha256: sha, rubricSha256: sha,
  fixtureSha256: sha, seedSha256: sha, eligible: true,
  timeoutMs: 1000, scheduledMs: 1200,
};
const plan = {
  planId: 'example', common,
  treatment: { disabled: { monitoringEnabled: false }, enabled: { monitoringEnabled: true } },
  tasks: [task],
  pairs: [0, 1, 2].map((i) => ({
    pairId: 'p' + i,
    order: i % 2 ? ['enabled', 'disabled'] : ['disabled', 'enabled'],
  })),
};
const input = {
  version: 'paired-task-latency/1', evidenceKind: 'synthetic',
  units: 'monotonic-ms', planSha256: hash(plan), plan,
  pairs: plan.pairs.map((pair) => ({
    ...pair,
    arms: ['disabled', 'enabled'].map((arm) => ({
      arm, common, treatment: plan.treatment[arm],
      rows: [{
        taskId: 't1', taskSha256: hash(task), scheduledMs: 1200,
        started: true, outcome: 'completed',
        clock: { startDomain: arm, endDomain: arm, resolutionMs: 1,
          startMs: 100, endMs: arm === 'enabled' ? 220 : 200 },
        evaluation: { independent: true, oracleSha256: sha, success: true,
          behavior: 'matches', evidenceSha256: sha },
      }],
    })),
  })),
};
fs.writeFileSync('example.json', JSON.stringify(input, null, 2), { flag: 'wx' });
```

Each example repetition has disabled p50/p95 100 ms, enabled p50/p95 120 ms,
paired ratio 1.2 and signed delta +20 ms (+20%). Those are synthetic numbers.
