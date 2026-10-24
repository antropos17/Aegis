# macOS read boundary

This crate is a separately reviewed unsafe boundary. Its parent sensor and the
wire crate retain `unsafe_code = "forbid"`. The boundary has no registry
dependencies and denies unsafe operations inside unsafe functions. Only
`src/system.rs`, compiled for macOS, calls unsafe foreign functions. There is no
binary, entitlement request, root escalation or mode activation.

`NativeReader` returns owned `BsdInfo`, positive `u64` unique IDs, bounded
`PidSample` values and lowercase boot-session UUIDs. Every PID sample explicitly
has `PopulationCompleteness::BestEffort`. All calls are fresh. The consumer must
bracket BSD reads with two unique-ID reads and the whole snapshot with two
boot-session reads. A matching bracket proves the sampled process generation
across those reads; it cannot prove the process is still alive afterward.

The FFI passes writable byte slices and their checked lengths to synchronous OS
calls. Pointers never escape the call. Buffers are initialized. Response bytes
are interpreted only after exact-size checks; native-endian integer conversion
uses fixed, statically bounded ranges. No pointer is cast to a Rust reference or
dereferenced by Rust. The boot sysctl uses a static C string, a writable length
and a null replacement pointer, so it cannot change kernel configuration.

BSD and unique-ID reads require exactly 136 and 56 bytes respectively. The PID
list uses a fixed 16,388-byte caller buffer: a full response or oversized reported
length fails without retry. An underfilled response does not prove completeness:
Apple's kernel sizes its internal list from `nprocs + 20` before taking its list
lock, so concurrent births can exceed that internal allocation. The explicit
best-effort marker must survive every adapter, and absence alone must never
produce an authoritative exit. Kernel PID zero is
excluded. Duplicate, negative-encoded or out-of-range PIDs fail. PID arguments
must be 1 through `i32::MAX`. Mismatched returned PID, invalid microseconds,
overflowing birth arithmetic and zero unique IDs fail. Process names use at most
32 registered-name bytes or 16 fallback command-name bytes, stopping at the first
NUL. Invalid UTF-8 in these display bytes uses replacement characters; the kernel
can truncate a multibyte character at its byte limit. Empty names remain
`unknown`. Display conversion does not change numeric identity validation. UUID
reads require exactly 36 hexadecimal/hyphen bytes and one NUL terminator. Error values
contain no process names, paths or arbitrary OS text.

## Primary sources and API limits

Sources inspected on 2026-10-19 at Apple XNU commit
`f6217f891ac0bb64f3d375211650a4c1ff8ca1ea`:

- [proc_info.h](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/sys/proc_info.h)
  declares BSD PID/parent/name fields and unsigned 64-bit start seconds/usec.
- [proc_info_private.h](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/sys/proc_info_private.h)
  declares flavor 17 and the 56-byte unique-info structure. `p_uniqueid` is at
  byte 16. The structure is in a private header; availability and distribution
  policy need separate qualification. The current tail fields differ from older
  revisions; this wrapper reads only the verified unique-ID prefix.
- [libproc.h](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/libsyscall/wrappers/libproc/libproc.h)
  supplies the foreign declarations. Its macOS 10.5 annotation for the generic
  functions does not establish flavor-17 availability on any specific OS.
- [kern_sysctl.c](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_sysctl.c)
  defines the read-only `kern.bootsessionuuid` value. Permission denial or absence
  fails; a random UUID, hardware UUID or boot time is never substituted.
- [proc_info.c](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/proc_info.c)
  implements the internal PID-list allocation and copy-out behavior; caller
  buffer capacity cannot establish a complete population. Its BSD-info reader
  copies raw process-name bytes and forces a NUL at each name field's final byte.

The MIT-licensed `libproc` 0.14.11 published crate, VCS revision
`9c5b669ca414918eadc81e70ec654505a0c8a93f`, was also inspected. Its safe flavor
enum stops at 12 and its `pidinfo` accepts any positive returned byte count. Its
generated bindings include the public header. Adding that dependency alone
would not implement the required safe flavor-17 read with exact-size checks.
This crate declares the small ABI independently; it does not copy Apple headers.

Windows layout and injected-backend tests establish only this wrapper's byte
contract and rejection behavior. They do not establish Apple SDK layout,
symbol linkage, real errno behavior, permissions or live generation semantics.
Before declaring macOS 13+ support, compile/link on the intended SDKs and 64-bit
architectures, compare `sizeof`/`offsetof` against those actual headers, and
record a bounded owned-child birth/unique-ID/boot-session run with source, OS and
architecture. On an unavailable query the consumer must retain null identity.
No Endpoint Security, kqueue, FSEvents, file-open or TCP capture is implemented.
