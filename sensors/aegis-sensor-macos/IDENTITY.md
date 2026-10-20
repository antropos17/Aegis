# Fresh macOS identity contract

This crate contains a portable consumer of fresh libproc observations and a
safe adapter to the separately reviewed `native/` read boundary. It does not
activate a capture mode, launch a sensor binary or change the Darwin JavaScript
adapter. The wrapper is a registered workspace member and a macOS dependency;
the same package is a development dependency for portable adapter tests.

`read_native_snapshot()` is the library entrypoint. On macOS it creates the
stateless native reader and performs fresh boot/population/unique/BSD reads
through the consumer below. Other operating systems return
`ContractError::Read(ReadError::NotSupported)` without OS reads or synthesized
observations. The adapter maps the wrapper's fixed errors, preserves exact raw
birth fields and carries `BestEffort` population through to the result. Invalid
native data and population overflow abort the pass rather than becoming empty
or ordinary unavailable observations. The private test seam uses the wrapper's
real `BsdInfo`, `PidSample` and `NativeError` types.

`LibprocReader` is the OS boundary. Its implementation must read the boot-session
UUID, population, unique ID and complete BSD information from the OS on each
call. It must reject short responses and never cache a birth or unique ID. The
portable consumer reads boot/population, then unique/BSD/unique per PID, then boot
again. A changed unique ID means the previously sampled generation disappeared:
the result has null birth/witness and `process-gone`. No name or parent from that
racing read is retained. A changed or unread boot aborts the entire snapshot.

The raw birth is checked integer `seconds * 1000000 + microseconds`. Microseconds
must be below one million and the result must fit `u64`; zero remains accepted
by the wire contract. The host separately derives milliseconds by integer
division. Available identity includes the full boot-session UUID and positive
64-bit unique ID. It never reconstructs raw birth from epoch milliseconds.

Watch matching compares PID, raw birth and the complete Darwin witness. Both a
different unique ID with the same birth and a different raw birth in the same
millisecond are rejected. An unread observation cannot satisfy a watch. A fresh
successful sample does not guarantee the process remains alive after the call.

Ordinary provider read errors become `read-failed`, `process-gone` or
`not-supported`, with both identity fields null. Their name is the literal
placeholder `unknown`, and parent PID is zero. Malformed or contradictory native
data is a contract error, never relabelled as an ordinary unavailable identity.
Population read failures, duplicate/invalid PIDs and population over 4096 abort
the pass. Consumers must freeze sessions during such failures.

Enumeration is best-effort sampling. Both native `PidSample` and portable
`Snapshot` carry an explicit `PopulationCompleteness::BestEffort` marker. Each
consumer must preserve it. Processes may start or exit during a pass,
and an underfilled libproc buffer does not prove population completeness. A
missing PID cannot by itself establish an authoritative exit. kqueue exit
notifications and native event capture remain separate work.

The uncertainty marker is an internal provider contract. It is not a wire-field
extension. A future transport/host integration must preserve that uncertainty
before treating a snapshot as session-reconciliation input; this crate does not
connect best-effort samples to such a consumer.

The Windows tests exercise fresh read order, wire precision, same-millisecond
PID reuse, boot/unique races, null/unavailable semantics, malformed data and
integer boundaries. Mutation checks remove raw-birth comparison, witness
comparison and the unique-ID bracket, and each must fail a behavioral test.
These tests do not qualify macOS ABI, SDK linking, live permissions, real PID
reuse or the roadmap's macOS 13+ live acceptance run. No file-open, FSEvents,
kqueue, TCP or Endpoint Security coverage is advertised.

Apple ARM64 all-target checks and clippy compile the actual macOS adapter and
FFI declarations. They run on the Windows host with the installed Rust target
standard library: they do not link an Apple SDK, run native tests or qualify
macOS behavior. A native SDK/link and recorded live run remain necessary.
