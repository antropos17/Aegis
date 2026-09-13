# B5 follow-up — forward validated observation bytes

Implemented on `codex/etw-broker-forwarding` from merged #451 / `4fe774a`.
The broker previously decoded and validated each incoming envelope, then encoded
the unchanged observations again before forwarding to main. This work removes
that extra encoding while retaining the checks and bounded transport.

## Behavior and boundaries

`FileWire.ReadFrame` performs the existing bounded length, exact-envelope shape,
strict UTF-8, JSON depth, protocol, identity, sequence and direction checks. It
returns the parsed envelope paired with its original body. The body is owned by
that received frame, not a serialization cache attached to the mutable record.
Cloning/changing an envelope with `with` cannot silently reuse stale body bytes.

The outbound broker calls `FileForwardProfile` with this received frame. Hello,
observations and error frames keep their original body bytes, including Unicode
spelling and whitespace. Ready, health, heartbeat and stopped still receive broker
timing annotations and are encoded from the updated envelope. Identity/sequence
fields remain unchanged. The compatibility `Read` method still returns an owned
envelope to existing control consumers; inbound controls use their existing path.

Main still validates the closed payload schema, frame/depth limits and session
state. The broker has never supplied that full observation-schema guarantee.
Forwarding remains bounded to a 256 KiB body and the existing five-second
header/body/flush write deadline. The received body remains alive while its write
is pending; no pooled buffer reuse, extra queue or automatic retry is introduced.
Collector queues, record batching, mapping, process attribution, native ownership
and the main diagnostic ring retain their previous behavior.

Protocol remains `etw-file/5`; the build marker is `-5-forward`. The meaning of
broker duration remains completed outbound forwarding time, excluding input
reading/decoding and the carrying telemetry frame itself. Its observations path
now measures the preserved-body write without a redundant serializer call.

## Controlled measurement

The allocation regression initially failed against the old forwarding path:
both arms allocated 16,637,576 bytes. The implemented test reads and validates the
same 100 frames / 6,400 fixture observations in both arms. The comparison arm
uses the retained encoder; the optimized arm calls the production forwarding
profile. Input/output buffers and serializer warm-up are outside the measurement.
Five trials per arm alternate order. Only allocation reduction is asserted;
wall-time medians are reported without a flaky timing threshold.

| Release build measurement | Re-encode validated frames | Forward validated bodies |
| --- | ---: | ---: |
| Allocated bytes per 100 frames | 16,641,576 | 13,933,888 |
| Median elapsed milliseconds | 86.9696 | 58.7634 |

Allocation decreased by about 16.27% on this workload. These are cumulative managed
allocations, not peak memory or application-wide RAM. The measured elapsed region
includes decoding/validation and in-memory forwarding; no native provider, real
pipe backpressure or sustained machine-wide traffic is present. Timing varies
with runtime warm-up and machine load. This result does not establish loss-free
capture, a general application speedup or a causal reduction in the previous
50,246 live output overflow drops. E3 remains open.

## Verification

The Windows .NET 10 Release build and whitespace check passed. All 61 C# self-tests
passed, including fragmented consecutive input with exact observation bytes,
Unicode/uint64 evidence, the maximum body size, rejected malformed/foreign/replayed
input before forwarding, every telemetry kind receiving fresh annotations,
cancellation/failure accounting and the allocation comparison.

Normal-token and deliberately saturated process harnesses passed three scenarios
each on matching binaries: two clean sessions plus parent EOF with unverified
stop and blocked retry. These exercise collector → broker → actual main decoder
and supervisor. No new UAC/live load or sleep/wake check was performed, as requested.
The retained [evidence](../recon/evidence/etw-file-home-26200-broker-forwarding.json)
contains both process reports, benchmark output and source/binary hashes.
