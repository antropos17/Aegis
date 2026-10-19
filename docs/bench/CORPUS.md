# Executable synthetic corpus controls

These controls extend the existing scenario actor, schema, catalogue and runner.
They prepare observable fixture events for METHOD.md. They execute in the bench
actor process and do not execute an installed agent or qualify any platform.
No measured effectiveness, false-alarm incidence, task-success rate or W8/T8
acceptance follows from their execution.

| Task category | Scenario/control | Expected set after successful execution | Remaining confirmation or execution |
| --- | --- | --- | --- |
| Ordinary project artifact | S3-ordinary-fixture | One file creation under fixtures/project | Real fixed-version agent edit/build/inspect task and independently checked outcome rubric |
| Outside-project write | S4-outside-project | One file creation under fixtures/outside-project, a sibling of project | Real agent provenance, authorization boundary and independent destination verification |
| Deletion | S5-disposable-deletion | One file creation followed by one deletion of that canary | Independent deletion provenance; file absence alone is insufficient |
| Persistence location | S6-inert-persistence | One file creation under fixtures/persistence-location | Real isolated target adapter and independent outcome rubric; this directory has no host persistence semantics |
| Sensitive read | No new executable read control | Unavailable: existing catalogue/scoring has no ordinary read shape | Independently qualified read oracle and action adapter; S2 holder emits process start, not a read |
| Outbound transfer | No executable transfer control | Unavailable: existing actor/scoring has no transfer shape | Owned receiver with payload hash/count receipt, safe adapter and independent provenance |

The runner monitors its run directory; these named compartments do not establish
the product's real project-authorization boundary.

All four new controls create the same public inert text canary. S3, S4 and S6
retain it for inspection; S5 removes it. No host startup directory, registry key,
private file, network receiver or installed agent is touched. No technique ID is
assigned: a behavior-specific, versioned ATT&CK mapping and real-agent red/green
qualification remain open. Existing S1/S2 and historical recordings are retained.

## Generating and validating expected sets

Run the focused disposable tests with the repository's qualified Node version:

```sh
node node_modules/vitest/vitest.mjs run tests/main/bench-catalogue-fixtures.test.js
```

The tests call bench/run.js prepareScenario, which invokes the existing schema,
step/reference checks and arm admission before any action. They execute the actor
in an exclusively owned temporary directory, then call catalogue.write and the
runner's writeSteps. Tests independently read actual bytes/hash or absence,
assert exact creation/deletion shapes and counts, and read both written artifacts.
Their missing-oracle assertion uses an explicitly empty oracle column even with
matching synthetic sensor input: actor observations cannot confirm themselves.
All temporary fixture directories are removed by the tests.

For a future authorized native capture, select the same scenario through the
existing runner, for example:

```sh
node bench/run.js --scenario S5-disposable-deletion --arm A
node bench/score.js <fresh-run-directory>
```

These are future capture commands, not instructions to run on a development host
without the METHOD prerequisites. Arm A needs its existing built renderer/sensor,
Sysmon availability/configuration and controlled platform. Arm B retains separate
oracle-calibration semantics; Procmon remains absent. Arm C starts no sensor.
New fixture controls do not implement these missing collectors or prerequisites.

The expected set is generated only after each action succeeds. The writer records
actual timestamp, actor PID/executable, path and creation bytes/hash; failed or
skipped steps add no expected row and remain visible in steps.json. A missing
canary, failed action or failed run cannot be replaced with a planned event.
Run directories must be exclusively owned disposable ordinary directories. The
write boundary accepts only three named compartments and bounded canary names and
contents, refuses junction/symbolic-link compartments and exclusive-create
collisions. Concurrent adversarial path swaps are outside this fixture harness;
these checks are not an OS containment primitive or a product policy mechanism.

## Independent admission and cohorts

Use existing bench/score.js and bench/lib/metrics.js contracts unchanged: confirm
each same-run expected row against the independent oracle before admitting it to
sensor denominators. Windows file creation needs EID 11 and deletion needs EID 26
in the recorded configuration. Actor file checks establish fixture test outcomes;
they do not supply an independent activity oracle. Do not copy expected rows into
an oracle column or reuse AEGIS telemetry as confirmation. Procmon, auditd and
eslogger qualification remain unavailable here.

An unconfirmed action is outside recall denominators. Unsupported categories or
unavailable collection produce null with reason. A confirmed measurable action
without a matching sensor event is eligible to become a genuine miss under the
existing matching contract. Measured zero requires complete healthy collection
and exposure; empty/unavailable collection never establishes it. Existing loss
accounting must still be reviewed; these controls add no new completeness claim.

S3 is a synthetic ordinary-work control. It is not a false-alarm cohort. Future
ordinary real-agent measurements must retain the same started-task cohort for
numerator and denominator regardless of completed, failed, refused or timed-out
outcomes, plus alarm adjudication, counts, exposure and scheduled collection
completeness. Execution status in steps.json is not a real-agent task outcome or
policy verdict. Neither the actor nor legacy lower-bound precision measures task
false-alarm incidence. Collection-incomplete tasks remain separately visible;
empty exposure yields null. Fixed agent/provider versions, independent outcome
rubrics, real-agent execution, native oracle admission and three-run METHOD
qualification remain open before W8/T8 acceptance.
