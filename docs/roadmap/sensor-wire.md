# W1a preparation: sensor/1 JavaScript contract

Status: JavaScript preparation following W1-pipe, based on master `dbeb5edc`.
This document resolves the Q4 representation and parser decisions needed for
the JS codec and shared golden fixtures. Full W1a acceptance and the final wire
freeze still require the deferred Rust implementation and both language gates.
W1b's sensor host and W2/W3's native providers are separate work.

## Ownership and precision

Process birth is an observation, never a value recovered from `instanceId`,
epoch milliseconds, first-seen time or cached per-PID data. A watch root is built
from one carrying observation and includes `{pid,birth,witness}`. Its raw birth
and witness must both be available. Existing `instanceId` formatting, session
reconciliation and platform capability/control allowlists remain as they are.

All 64-bit integers are canonical unsigned decimal strings, at most
`18446744073709551615`: no sign, leading zeroes, whitespace or exponent. Event
sequences and macOS unique IDs are positive. Raw birth and capture time can be
`"0"`; the existing procfs parser accepts tick zero. A wire type accepting zero
does not change stronger downstream runtime validators.

Available observations carry `identityError:null` and one of these witnesses:

```json
{"birth":"12345","witness":{"kind":"linux-start-ticks","bootId":"11111111-1111-4111-8111-111111111111","startTicks":"12345"},"identityError":null}
```

```json
{"birth":"1700000000000123","witness":{"kind":"macos-unique-id","bootSessionId":"22222222-2222-4222-8222-222222222222","pUniqueId":"9007199254740993"},"identityError":null}
```

UUIDs are lowercase canonical UUID strings. Linux witness ticks equal `birth`
exactly. Unavailable observations carry `birth:null`, `witness:null` and
`identityError` equal to `read-failed`, `process-gone` or `not-supported`.
Contradictory or malformed identity is a protocol error. It cannot be relabelled
as an ordinary unread observation. Watch roots reject unavailable identity.
One event/snapshot/watch frame cannot mix witness platforms.

The host owns Linux D1 conversion context:

```json
{"bootId":"11111111-1111-4111-8111-111111111111","bootTimeSeconds":"1700000000","clockTicks":"100"}
```

The context comes from host-observed boot ID, positive boot seconds and a
successful `getconf CLK_TCK` probe. It stays pinned for the same verified boot
across sensor restarts and mode changes. A sensor cannot replace it. Conversion
uses BigInt through `bootSeconds*1000 + floor(rawTicks*1000/clockTicks)` and
rejects a nonpositive or unsafe resulting millisecond value. The existing
procfs reader shares that pure conversion without changing its observation,
boot-race, fallback or population-health behavior. No per-PID birth cache is
introduced. The generic pure Linux converter preserves existing accepted raw
tick inputs; wire validation separately enforces the u64 bound.

The existing reader exposes `getBirthContext()`, surfaced by the Linux adapter
as `getProcessBirthContext()`. It returns a fresh frozen context from that same
reader's pinned boot reference, only after its latest successful procfs pass and
final boot-ID verification. Before initialization or after identity failure it
returns null without OS I/O. Internal boot reference retention survives an outage
and is reused after successful same-boot recovery. A future host waits for this
validated context; independently probing a replacement `btime` is not equivalent.
Host context seconds and frequency are positive canonical decimals within the
existing safe-integer bounds; the sensor's capture clock never supplies them.

macOS normalization is integer `birthUsec/1000`, retaining raw microseconds and
`bootSessionId:pUniqueId` as a proposed `macosUniqueId` runtime witness. The pure
normalizer does not enable that witness in existing platform/control consumers.
W3 must integrate and qualify those consumers before advertising native support.

The owned pure helper `sensor-identity.js` exports:

- `validateSensorIdentity(value,{platform})`: returns a fresh
  `{birth,witness,identityError}` or a fixed-code error. `platform` can be omitted
  by the stateless codec and is then inferred from an available witness.
- `createWatchRoot(observation,{platform})`: requires explicit platform and an
  available identity and returns only `{pid,birth,witness}`.
- `convertSensorIdentity(observation,{platform,linuxContext})`: returns
  `{startTime,rawBirth,witness,witnessSource}`. A valid unavailable observation
  returns four null fields. Available Linux identity must match the context's
  boot ID before conversion; macOS uses its composite unique-ID witness.
- `createLinuxBirthConverter(context)`: validates/copies the host context once
  and returns a pure converter accepting freshly observed BigInt or canonical
  decimal ticks. The existing procfs pass calls this converter without changing
  its health/fallback contract. It returns a positive safe millisecond number.

The helper neither reads an OS clock nor proves observation freshness. Its
callers own those observations; it never reconstructs a missing raw birth.

For future eBPF/procfs parity use `floor(start_boottime_ns*CLK_TCK/1000000000)`;
dividing by a truncated `1000000000/CLK_TCK` is not equivalent for arbitrary
frequencies. W2 must prove exact parity on its qualified kernels.

## Framing and parser behavior

A frame is a four-byte unsigned little-endian payload length followed by UTF-8
JSON. Payload length is 1 through 8 MiB inclusive. An encoder emits compact JSON;
a decoder accepts normal JSON whitespace within that bound. The top level is
an object. Encoding validates and copies approved fields before serialization.
Unknown keys at every level, duplicate JSON keys (including escaped aliases),
UTF-8 BOM, invalid UTF-8 and lone UTF-16 surrogates are rejected.

Direct JS inputs use ordinary same-realm plain objects or null-prototype records,
and dense arrays with the standard Array prototype. Proxies are rejected before
reflection. Inspected record/options/array-index properties must be own data
properties; accessors are rejected without invocation. Closed shapes reject
unknown own keys even when nonenumerable or Symbol-valued. Arrays reject extra
own keys beyond their indices/length. Projection uses trusted array operations,
never a caller's overridden method or `toJSON`. Identity helpers may accept
unrelated carrying metadata, but only their approved own data fields are read;
unrelated metadata is neither visited nor copied.

JSON number tokens are unsigned integer spellings only: `0` or a nonzero digit
followed by digits. Tokens such as `1.0`, `1e0`, `-0` and negative values are
rejected, even if JS would coerce them to an allowed integer. Numeric message
fields are at most uint32; 64-bit values are strings. This avoids a silent JS
versus typed-Rust parser difference. Container nesting is at most 16, counting
the root object as container 1.

The new codec does not change `proc-snapshot-protocol.js`. Its decoder processes
arbitrary split/concatenated input using a callback, retaining at most one header
and one advertised payload. It does not copy/retain the whole supplied chunk or
accumulate a returned message array. Invalid framing, JSON, direction, schema,
protocol or consumer callback failure is terminal; later bytes are not guessed
back into synchronization. `finish()` rejects an incomplete header or payload.
Errors use fixed codes and do not echo payloads or exception text.

The public JS surface is `validateMessage(message,{direction})`,
`encodeFrame(message,{direction})`, and
`createFrameDecoder({direction,onMessage})`. Directions are explicitly
`host-to-sensor` or `sensor-to-host`. Validation returns a fresh projection or
throws a fixed-code error. Decoder `push(Buffer)` returns
`{decodedCount,errorCode,fatal}`; `finish()`, `pendingBytes()` and `isFatal()`
provide completion and bounded-buffer observations. Its first unknown-protocol
hello fails terminally. Hello-first/once is a host session rule, not framing.

`onMessage` is synchronous; ordinary return values are ignored. Returning a
Promise/thenable is `callback-failed`. Rejection observation is best effort when
intrinsic `then` can attach a handler, including ordinary native promises and
an overridden own `then` property. An exotic throwing constructor/species can
prevent handler attachment; that rejection remains the callback owner's
responsibility. [ECMAScript's then operation](https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-promise.prototype.then)
performs species construction before installing promise reactions. The codec
does not mutate returned promises or install global rejection suppression.
Calling `push()` or `finish()` recursively during
delivery is terminal `decoder-reentrant`; the outer call also reports that
failure. `decodedCount` counts successful synchronous deliveries in that call.
Previously delivered frames are not rolled back when a later frame fails.
Successful `finish()` returns `{decodedCount:0,errorCode:null,fatal:false}` and
closes input; repeated successful `finish()` is idempotent. A subsequent push
is terminal `decoder-closed`. A fatal decoder keeps its original error code,
clears pending bytes and never delivers another frame.

The closed error vocabulary is `message-invalid` (schema/options),
`protocol-unsupported`, `frame-length-invalid`, `utf8-invalid` (including BOM),
`json-invalid` (syntax, duplicates, numeric spellings, depth, lone surrogates),
`chunk-invalid`, `frame-truncated`, `callback-failed`, `decoder-reentrant`,
`decoder-closed`. Construction/encoding/validation errors throw a fixed-code
error; decoder push/finish report the result shape above.

## Finite limits and field vocabulary

| Field | Limit |
| --- | --- |
| Frame payload | 8 MiB |
| JSON nesting | 16 containers |
| Events, snapshot processes or watch roots | 4,096 per frame |
| Sensitive path prefixes | 1,024 per request |
| Path or executable | 4,096 UTF-8 bytes, nonempty, no NUL |
| Process name | 256 UTF-8 bytes, nonempty, no NUL |
| Sensor/kernel/OS version | 128 UTF-8 bytes, nonempty, no NUL |
| Request ID | Positive uint32 JSON integer |
| PID / PPID | Positive int32 / nonnegative int32 JSON integer |
| Port | 0 through 65,535 JSON integer |
| argc | Nonnegative uint32 JSON integer; argument text is absent |

Snapshot processes and watch roots reject duplicate PIDs. Event batches may
contain many observations of the same PID and are ordered by unique contiguous
sequence numbers. Path prefixes and announced modes are unique.
Empty snapshots/watch roots/prefix lists are valid; an event batch is nonempty.
All object shapes have exactly their documented keys. Unknown request fields,
argv, environment, prompt/content fields and free-form errors are rejected.
Paths, executable names, process names and endpoints remain sensitive metadata;
closed shapes cannot establish the truth or content safety of a hostile peer.

Modes are Linux `ebpf`, `fanotify`, `procfs`, and Darwin
`endpoint-security`, `libproc`. The exact capability object has Boolean `exec`,
`exit`, `fork`, `fileOpen`, `tcpConnect`, plus `identity` and `witness` strings.
Linux uses `bpf-start-boottime-ticks` identity in `ebpf` and `procfs-ticks` in
the other modes, with `boot-id` witness. Darwin uses `pbi-start-usec` and
`p-uniqueid`. Boolean capabilities describe actual active-mode observations;
they are not forced true by a mode name. Baseline `libproc` cannot announce
`fileOpen:true`: sampled descriptors/FSEvents do not prove every open operation.
W1b verifies emitted event kinds against the announced active capabilities.

Mode reasons: `startup-fallback`, `permission-denied`, `attach-failed`,
`read-failed`, `recovery`, `requested`. Loss reasons: `ring-full`, `queue-full`,
`verifier-limit`, `read-failed`. Open access: `read`, `write`, `read-write`,
`execute`. Health states reuse `STARTING`, `HEALTHY`, `DEGRADED`, `FAILED`,
`DISABLED`, `UNSUPPORTED`; detail codes are `starting`, `ready`,
`permission-denied`, `read-failed`, `loss-observed`, `sensor-failed`, `disabled`,
`unsupported`. Request errors are `request-failed`, `root-mismatch`,
`permission-denied`, `read-failed`, `unsupported`, `request-too-large`.

## Sensor-to-host messages

- `hello`: exact `{t,proto,platform,mode,modes,caps,versions,pid}` with
  `t:'hello'`, `proto:'sensor/1'`, platform `linux` or `darwin`, and unique
  nonempty `modes` containing `mode`. Every mode belongs to that platform.
  `versions` is `{sensor,kernel,clockAnchor}` on Linux or
  `{sensor,os,clockAnchor}` on Darwin.
- `mode`: exact `{t,mode,caps,reason,seq}`. Its positive `seq` is the first
  event sequence in the new mode and does not consume a sequence number.
- `evs`: exact `{t,from,to,events}`. Positive endpoints are contiguous;
  `to-from+1` equals array length and every event's sequence equals `from+index`.
- `loss`: exact `{t,from,to,count,reason}`. Positive endpoints and count obey
  `count === to-from+1` without Number conversion.
- `snap`: exact `{t,id,procs}`. Process rows are
  `{pid,ppid,name,birth,witness,identityError}`.
- `health`: exact `{t,state,detail}` using the closed vocabularies above.
- `err`: exact `{t,id,code}` using the closed request error vocabulary.
- `ack`: exactly `{t,id}` after a successful `watch`, `paths` or `stop`.
  This preparation makes success explicit; absence of an error is not an
  acknowledgement. A snapshot reply acknowledges its own request.

Every event has `{seq,kind,pid,ppid,birth,witness,identityError,ts}`.
Additional fields are `exe,argc` for `exec`; `path,access` for `open`; and
`family,daddr,dport,saddr,sport` for `connect`. IP `family` is 4 or 6 and both
addresses must match it; zone identifiers are excluded. For `fork`, `pid` is
the child PID and `ppid` is the parent PID; identity belongs to the child. `exit`
describes the exiting PID and its last independently observed parent; it adds
no exit-status field in this version. Neither kind has additional fields.
An unread birth at exit stays unavailable; a cached earlier birth cannot fill it.

`ts` is capture time in epoch microseconds. Its start-of-process clock anchor
is `{clock,monotonicUsec,unixUsec}` in `hello.versions.clockAnchor`, with both
values u64 decimal strings. Clock is `boottime` on Linux (CLOCK_BOOTTIME) and
`mach-continuous` on Darwin. The selected clock includes suspend time. Sensors
anchor once and derive capture timestamps from elapsed monotonic time; mode
changes retain the anchor. This capture anchor is separate from the host's D1
birth-conversion anchor. Host skew estimates do not qualify capture accuracy.

## Host-to-sensor messages

- `watch`: exact `{t,id,roots,descendants:true}`; each root is exactly
  `{pid,birth,witness}` with available matching identity. Replacement is atomic.
  An invalid observed generation produces `err/root-mismatch` and retains the
  prior watch set; a partial replacement is not represented as success. `ack`
  follows only a successful replacement.
- `paths`: exact `{t,id,prefixes}` replacing the complete prefix set.
- `snap` and `stop`: exactly `{t,id}`.

W1b owns hello-first/once, child-PID verification, request/response correlation,
operational watch acknowledgements, active modes/caps, cross-frame sequence
continuity, coverage/loss accumulation, restart policy and process custody.
Sequences start at 1 per sensor process, survive mode changes, and never wrap.
A missing range requires a matching loss frame; an unexplained gap is an error.
Snapshot/health/request frames do not consume event sequence numbers. A Rust
implementation must pass the same binary/JSON goldens and parser edge cases
before W1a is accepted or W1b starts.
