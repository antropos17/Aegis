# Linux procfs sensor

This is the first W2 delivery: fresh process snapshots over `sensor/1` and a
Linux entrypoint. `hello` announces `mode:procfs`, only that mode, identity
`procfs-ticks`, witness `boot-id`, and five false event capabilities. No exec,
fork, exit, file-open or network event stream is implemented. Fanotify, eBPF,
capability installation and the JavaScript platform switch remain later work.

The binary takes no arguments and uses `/proc`, framed stdin requests and framed
stdout replies. Stderr contains fixed error codes. A malformed or truncated
frame ends the service; a clean EOF between frames ends successfully. On other
operating systems the binary exits 2 with `unsupported`, without a Linux hello.

`snap` replies contain the full observed population, independent of watches.
`watch` checks every supplied root against fresh procfs ticks and the same boot
ID, then atomically replaces the requested root set. This mode retains those
requests but emits no lifecycle events or descendant stream. An invalid root
returns `root-mismatch` and preserves the prior set. `paths` returns
`unsupported`; `stop` flushes its acknowledgement and exits without processing
later requests in the same input stream.

## Identity and failure behavior

The stat parser finds delimiters in raw bytes so names can contain spaces,
parentheses, newlines and non-UTF8 bytes. PID, PPID and numeric/state fields use
ASCII parsing. Only the displayed name uses lossy UTF-8: invalid sequences
become U+FFFD, empty names display as `(unnamed)`, and names are truncated at a
UTF-8 boundary to at most 256 bytes. Display conversion never changes identity.
It verifies the PID, PPID and field 22, retains ticks
as a u64 and emits its exact decimal string with the matching boot-ID witness.
Zero ticks and values above JavaScript's safe integer limit retain their
precision. The sensor computes no epoch birth value. The host's pinned D1
context owns that conversion; no per-PID birth observation is cached here.

Every snapshot checks boot ID before and after its pass. A PID that vanishes
while enumerating is skipped. Permission failures, malformed records, an empty
population or a boot-ID change produce `err/read-failed` and failed health,
without a successful empty snapshot. Successful recovery reads a fresh pass.
The host must freeze sessions when it receives an error. No atomic, simultaneous
whole-system snapshot is claimed: each record is an observation during the pass.

Individual stat reads are capped at 16 KiB, boot ID at 64 bytes, and successful
snapshots at 4,096 process rows. An enumerated population above that wire limit
returns `request-too-large`; it is never truncated into a successful snapshot.
Input frames and schemas are bounded by `aegis-wire`'s sensor/1 contract.
No command lines, environment values or file contents are read.

The native hello samples `CLOCK_BOOTTIME` using rustix's safe `time` API and
SystemTime for its capture anchor, once at startup. Their sequential sampling
does not establish a measured capture-error bound. This capture anchor is
independent of D1 birth conversion and never supplies boot epoch or CLK_TCK.

## Verification and remaining acceptance

From `sensors/`, with the pinned toolchain and committed dependency lock:

```sh
cargo fmt -p aegis-sensor-linux -- --check
cargo clippy -p aegis-sensor-linux --all-targets --locked -- -D warnings
cargo test -p aegis-sensor-linux --locked
cargo build -p aegis-sensor-linux --locked
```

Windows fixture tests exercise complete wire request/reply paths, exact raw
birth/witness values, PID reuse, unavailable reads, boot races, bounds and watch
replacement, including mixed populations with legal non-UTF8 process names.
They prove the modeled contract only. Native Linux build and
procfs behavior, CLK_TCK/D1 runtime parity, restricted proc mounts, capture clock
accuracy and load/overhead remain open until an actual Linux run records the
commit, kernel, toolchain and observations. Full W2 acceptance also requires
the later fanotify/eBPF deliveries and their event/short-lived-process gates.

Primary references used for this implementation are the
[Linux stat field specification](https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html),
[kernel procfs documentation](https://docs.kernel.org/filesystems/proc.html),
[PR_SET_NAME implementation](https://github.com/torvalds/linux/blob/master/kernel/sys.c),
[raw comm emission in proc_task_name/do_task_stat](https://github.com/torvalds/linux/blob/master/fs/proc/array.c),
[CLOCK_BOOTTIME definition](https://man7.org/linux/man-pages/man2/clock_gettime.2.html)
and [rustix clock_gettime API](https://docs.rs/rustix/1.1.5/rustix/time/fn.clock_gettime.html).
