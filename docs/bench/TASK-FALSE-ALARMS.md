# Offline ordinary-task false-alarm incidence

Status: bounded arithmetic and refusal preparation for the ordinary-task paragraph
of [METHOD.md](METHOD.md#catalogue-oracle-and-sensor-columns). This evaluator
collects nothing, starts no tasks or agents and reads no product logs. Synthetic
fixtures establish arithmetic and refusal behavior only. Native/live cohort
collection, independent oracle qualification and adjudication, three repetitions
and W8/T8 acceptance remain open. No effectiveness, throughput or overhead result
follows from this tool.

```sh
node bench/task-false-alarms.cjs --help
node bench/task-false-alarms.cjs --input evidence.json --output new-result.json
```

The input and the output parent directories must already exist as ordinary,
exclusively controlled directories. Output creation is exclusive; an existing
file, directory or link is refused. Parent junctions/symbolic links are refused.
The CLI does not make directories, remove files, derive paths from evidence,
connect to a provider or execute a corpus. Validation precedes output creation.
A write failure may leave a partial new file for inspection; there is no cleanup.
Path checks and exclusive creation are safeguards for owned directories, not an
OS containment mechanism against concurrent adversarial path replacement.

## Frozen rubric and population

Before collection, freeze `task-false-alarm-rubric/1`, eligibility and the planned
observation schedule in the externally held source/configuration evidence.
Eligibility is `started-ordinary-benign`: an ordinary authorized benign task that
actually started is eligible regardless of its eventual outcome. All started
tasks remain in the roster. The only exclusions are predeclared
`excluded-nonordinary` and `excluded-nonbenign`; task outcome never excludes one.
The rubric freeze time must precede every task start. The actual started-task
roster uses `sealedAtMs` at or after its last recorded `startedMs`; it does not
require future actual timestamps before execution. Each `startedMs` is the
recorded actual start, and each observation window resolves the pre-run schedule
relative to that start. For example, a predeclared one-hour duration resolves to
`{startMs:startedMs,endMs:startedMs+3600000}`. Planned timestamps must not be relabeled
as actual starts. A future collector must retain append-only actual-start
receipts, reconcile planned task IDs/eligibility/schedules against actual starts
and preserve the sealed roster externally, independently of outcome selection.
This offline evaluator cannot authenticate those receipts or reconciliation,
establish that an omitted start existed, or prove that a resolved window matches
the pre-run schedule. The supplied source/rubric hashes bind those declarations
without creating this missing provenance evidence.

An alarm is a delivered user-visible security warning, threat verdict or security
intervention notification associated with that task, under the frozen
`user-visible-security-alarm` rule. Informational telemetry, an ordinary tool
error, task failure, provider refusal and timeout alone are outside this alarm
definition. A future collector must freeze the concrete product event-to-alarm
mapping and bind its implementation/configuration in the supplied source evidence.

Deduplication is `same-task-alarm-key`: all deliveries/retransmissions of the same
logical alarm on one task share one opaque `alarmKey`. Distinct logical alarms
have distinct keys; keys are task-local. Raw delivery `alarmId` values are globally
unique, even for retransmissions. The collector must freeze its identity mapping
before collection. Counts report both raw deliveries and distinct keys. Multiple
false alarm keys on one eligible task contribute exactly one to the numerator.

Adjudication is `independent-evidence`: one resolved decision per task/key using
same-run independent activity/authorization evidence under the frozen rubric.
`false-alarm` means the security alarm is unjustified by that independent evidence;
`genuine` means it is justified. Task failure or an unmatched sensor observation
is not an adjudication. The oracle must not be AEGIS, its audit output or another
consumer of the alarm sensor provider. The adjudicator and oracle source IDs must
differ from the collector and alarm source IDs. Missing decisions, explicit
`unresolved` decisions, duplicate/unused decisions and foreign references are
refused as invalid evidence; they never become genuine alarms or zero alarms.
Unobserved tasks are a separate admitted incomplete state with unknown incidence.

Hashes bind the supplied content and links between sections. They cannot
authenticate source provenance, independence, truthful loss declarations, freeze
or seal timestamps, roster completeness or the correctness of alarm identity/eligibility.
Different IDs are declarations, not proof of independent measurement. Replacing
the roster and recomputing all hashes creates a different evidence packet; it
does not validate denominator deletion against the original externally held
roster. Native evidence needs that external reconciliation and review.

## Closed input schema

`require('./bench/lib/task-false-alarms.js')` exports
`evaluateTaskFalseAlarms(input)`, `hashTaskEvidence(fragment)` and `LIMITS`.
The evaluator has no filesystem, clock, subprocess or product dependency; its
only import is Node's deterministic SHA-256 implementation. All fields below
are required and objects accept exactly the listed keys.

IDs are 1–48 ASCII letters/digits/underscore/hyphen, starting with a letter or
digit. They must be opaque references, not prompt, secret, command or path text.
Hashes are 64 lowercase hexadecimal characters. Times, loss counts and counts
are finite nonnegative integers at most `1000000000000`. Time uses one monotonic
millisecond clock; exposure is converted by `observedMs / 3600000`.

| Object | Required fields and rules |
| --- | --- |
| Root | `version:'task-false-alarms/1'`, `runId`, `sourceSha256`, `evidenceKind:'synthetic'\|'native'`, `units`, `rubric`, `roster`, `collection`, `adjudication`, `hashes` |
| `units` | Exactly `{time:'monotonic-ms', exposure:'hours'}` |
| `rubric` | `version:'task-false-alarm-rubric/1'`, `frozenAtMs`, `eligibility:'started-ordinary-benign'`, `alarm:'user-visible-security-alarm'`, `dedup:'same-task-alarm-key'`, `adjudication:'independent-evidence'` |
| `roster` | `runId`, `sourceSha256`, `sealedAtMs`, `startedCount`, `tasks`; seal is at or after every actual start and count equals roster length |
| Roster task | `taskId`, `eligibility`, `startedMs`, `window:{startMs,endMs}`; unique ID; window begins exactly at start and has positive duration at most seven days |
| `collection` | `runId`, `sourceSha256`, `collectorId`, `alarmSourceId`, `rosterSha256`, `rubricSha256`, `taskCount`, `alarmCount`, `tasks`; exactly one row per started task and actual counts |
| Collected task | `taskId`, `outcome:'completed'\|'failed'\|'refused'\|'timed-out'\|'unfinished'`, `alarmInventoryComplete` boolean, `coverage`, `alarms` |
| Coverage interval | `{startMs,endMs,lostAlarms}`; positive, ordered, nonoverlapping and inside that task's scheduled window; loss is an integer or explicit `null` for unknown |
| Alarm delivery | `{alarmId,alarmKey,atMs}`; timestamp must be in an actual coverage interval, including its start and excluding its end |
| `adjudication` | `runId`, `sourceSha256`, `adjudicatorId`, `oracleSourceId`, `independence:'independent-of-alarm-source'`, `evidenceSha256`, `collectionSha256`, `decisionCount`, `decisions` |
| Decision | `{taskId,alarmKey,verdict:'false-alarm'\|'genuine'}`; exactly one per observed task/key |
| `hashes` | `{rubricSha256,rosterSha256,collectionSha256,adjudicationSha256}`; all recomputed and compared |

`runId` and product/harness/configuration source evidence `sourceSha256` must agree
across root, roster, collection and adjudication. The separately retained
independent evidence file is bound by `adjudication.evidenceSha256`; the CLI does
not discover or read it. Its completeness/provenance require external review.
The source digest should identify the externally held exact source/configuration
inventory, not a claim that this evaluator has read or verified those files.

`hashTaskEvidence` recursively sorts object keys, preserves array order and hashes
UTF-8 `JSON.stringify` without whitespace. It rejects exotic prototypes, accessors,
sparse/extended arrays, non-JSON values and unsafe numbers. Construct hashes in
this order: rubric, roster; assign both collection references; collection; assign
its adjudication reference; adjudication. Populate all four root hashes. There is
no circular hash. `inputSha256` in the result additionally binds the full packet.
External files may use a separately retained raw-byte SHA-256; it differs from
the canonical content digest when serialization differs.

Limits are 1 MiB input, depth 12, 50,000 JSON nodes, 512 tasks, 8,192 total coverage
intervals, 8,192 total alarm deliveries and 8,192 decisions. The general validator
also bounds individual containers and strings. The CLI reads at most 1 MiB plus
one sentinel byte, rejects duplicate JSON object keys, invalid UTF-8 and changing
input files, and caps output at 4 MiB. These are refusal limits, not a statement
that native captures fit them. Only the explicit input file is read.

## Result and refusal

For eligible started tasks, incidence is
`tasks with >=1 independently adjudicated false alarm / all eligible started tasks`.
Failed, refused, timed-out and unfinished tasks retain their scheduled observation
and denominator membership. An empty coverage array means unobserved; it never
means a task had zero alarms. Actual coverage must span the entire scheduled
window without gaps; every loss count must be known zero, and the alarm inventory
must be complete. Adjacent intervals are allowed. Observation hours report actual
covered wall time even when lost alarms make the observation incomplete.

The result retains the complete supplied evidence, every started task/outcome,
eligibility, scheduled/observed milliseconds and hours, raw/distinct/genuine/false
alarm counts, loss, task completeness and reasons. `counts` reports all task/alarm
counts plus eligible, excluded, complete/incomplete eligible counts. Alarm totals
include excluded tasks; `tasksWithFalseAlarm` and incidence numerator refer to
eligible tasks. Per-task values keep that distinction inspectable.

The incidence denominator always equals the original eligible started count.
`completeEligible` is diagnostic and never substitutes for it. Known false alarms
remain in the reported numerator when observation is incomplete, while the overall
incidence remains null. A task's `hasFalseAlarm` is true for an observed false alarm,
false only after complete observation without one, and null otherwise.
Admitted unresolved alarm count is zero because unresolved packets are refused.

| Condition, in precedence order | Incidence value and reason |
| --- | --- |
| No eligible started tasks | `null`, `empty-eligible-cohort` |
| Eligible tasks have no actual covered time | `null`, `empty-eligible-exposure` |
| Any eligible task is incomplete | `null`, `incomplete-eligible-cohort` |
| Complete nonempty eligible exposure | Numeric fraction, reason `null`; zero is admitted |

Per-task incomplete reasons are `unobserved`, `coverage-gap`, `alarm-loss`,
`loss-unknown` and `alarm-inventory-incomplete`. Excluded task incompleteness
remains visible but does not make the eligible cohort incomplete. Overlapping or
out-of-window coverage, mismatched counts/bindings, unknown fields, deleted task
rows and missing outcomes are invalid input rather than silently repaired data.

CLI exit 0 means help or successful new output, including a null incidence.
Stdout after a write is only `{status:'written',reason:...}`. Fixed stderr codes
and exits are `usage` (2), `input-path` (3, including read/size failures),
`input-invalid` (4), `output-path` (5, including collision) and `output-write` (6).
Errors contain no malformed text or identifying paths. The library's fixed
validation error is `task-false-alarms-input-invalid`. Output bytes have no clock
or path metadata; rerendering identical input bytes yields identical JSON bytes.

## Focused verification

```sh
node node_modules/vitest/vitest.mjs run tests/main/bench/task-false-alarms.test.js
```

The fixtures exercise a nonzero numerator with all four terminal outcomes,
task-local deduplication, outcome-independent eligibility, complete measured zero,
missing/lost observation, count/reference/hash contradictions, unresolved decisions,
bounded JSON, exclusive output, sanitized errors and parent junction refusal.
Temporary source-copy mutations at numerator, denominator and incomplete gates
provide a separate assertion-sensitivity check. Such mutation results are evidence
about these tests, not native alarm collection or W8 qualification.
