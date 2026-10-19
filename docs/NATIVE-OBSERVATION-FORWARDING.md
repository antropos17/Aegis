# Native observation forwarding prerequisite

The sensor host adds a closed `nativeObservation` capsule to its trusted sink
envelope. Each host owner creates one random epoch, retained across child
restarts. A session copies its launch-time Linux D1 context and validated hello
clock anchor, then projects each admitted BASE_EVENT with that historical context,
the actual child generation and raw sequence/birth/capture values.

The capsule excludes operation paths, executable names, arguments and actor
labels. Existing event and identity fields keep their existing contents; the
whole sink envelope is not claimed secret-free. Replay uses serialized historical
metadata through the existing custody helper rather than current process or clock
state. Clock anchors are uncalibrated evidence, not validated event time.

Hello PID, required wire clock anchor, active mode/capabilities, contiguous
sequence and batch identity preflight retain their existing gates. Sink admission
still requires a synchronous exact `true`; rejection accounts for the unaccepted
suffix and terminates that session. No source-gap receipt, FileEvent/risk mapping,
source authentication or actor attribution is added.

The production coordinator still refuses all native events with
`unsupported-admission`, accepted zero and coverage lost. This prerequisite is a
child of the owner-pending native-custody PR; it neither resolves that review nor
activates production delivery.

## Verification

The affected batch passed **135 tests across nine suites**: eight new tests
(seven observation and one host-persistence case), plus macOS capsule assertions
in an existing test. Four targeted mutants failed behavioral assertions and were
restored: child-scoped epoch, mutable D1, mutable anchor and leaked operation
metadata. Scoped lint/format and configured main types passed; `checkJs:false`
and the absence of changed-file `@ts-check` limit the JS-body type claim.

An owned fake-child protocol fixture uses the actual host, capacity-one security
buckets, spill bytes, graceful shutdown, restart replay and canonical audit JSONL.
It checks complete capsules, stable delivery IDs, detached mutations, null actor
attribution and tamper rejection. This establishes graceful replay behavior; it
does not establish abrupt-crash durability for every memory-admitted event.

Independent source/security and test/evidence reviews passed. No native event,
real collector, Electron application or provider was launched. Native acceptance,
clock accuracy, authenticated source ownership and complete W1b remain open.
