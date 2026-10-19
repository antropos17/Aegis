# Controlled Node loopback outcome rubric

Status: opt-in execution/outcome preparation. This library sends one fixed public
inert canary from a Node HTTP client to its own receiver, bound exclusively to
`127.0.0.1` on an OS-selected ephemeral port. The receiver checks actual bytes by
SHA-256 and exact same-run receipt count without AEGIS or catalogue telemetry.
This supplies controlled Node loopback outcome evidence only.

It supplies no real-agent execution, PID attribution, authenticated source,
exfiltration measurement, OS oracle, scenario declaration, technique mapping,
sensor denominator, calibrated overhead, reproducibility or W8/T8 acceptance.
The [future method](METHOD.md#task-corpus-and-independently-checked-outcomes) and
[existing corpus](CORPUS.md) retain their broader requirements. There is no CLI,
UI, provider, native capture, actor/catalogue/scoring/schema change or runtime
integration. No expected row is generated or copied into an oracle column.

## Use and boundary

```js
const { runLoopbackControl } = require('../../bench/lib/loopback-control');
const receipt = await runLoopbackControl({
  runId: 'control-1',
  nonce: 'nonce-1',
  durationMs: 1000,
});
```

Options are a closed ordinary data object: required `runId` and `nonce`, optional
`durationMs` and Node `AbortSignal`. IDs are 1–64 ASCII letters, digits, dots,
underscores or hyphens, starting with a letter or digit. Unknown keys, accessors,
symbols and nonordinary prototypes are rejected as `loopback-input-invalid`.
Duration defaults to 1000 ms and must be a safe integer from 50 through 3000 ms.

There is no payload, file, path, host, port, URL, endpoint, method or header input.
The client always uses POST `/` and constructs only the public inert v1 canary
with the validated run ID and nonce. The receiver independently constructs that
same expected byte sequence, hashes the actual complete received body, checks
its length and compares its hash. Nonces distinguish controlled runs; they do
not authenticate a sender or prove agent provenance. Reusing IDs/nonces does
not create a new authentication boundary.

Both modules use a fixed numeric IPv4 address. Node's listener internally enters
`dns.lookup('127.0.0.1', ...)`; [Node 24.20.0's numeric-IP fast path](https://github.com/nodejs/node/blob/v24.20.0/lib/dns.js)
returns before `getaddrinfo`. No hostname, DNS query, LAN or external destination
is selected. The tests observe that any lookup argument remains this literal.
This is source/API evidence, without claiming packet capture or an OS network
oracle. Socket creation remains inside ordinary Node HTTP APIs.

## Separate observations and refusals

The `loopback-control/1` result contains separate `sender` and
`loopback-receiver/1` observations. Only safe IDs, SHA-256 hashes, closed labels,
numeric counts/limits, booleans and explicit nulls appear. No body, headers,
addresses, ports, error text, filenames, command line, environment or user data is
published. Persistence and immutable source provenance are caller-owned.

Sender `attempted` means the fixed HTTP request was attempted. `writeFinished`
and `sentBytes` record the request's `finish` event: the bytes were handed to the
OS, without proving receiver delivery. The owned sender then half-closes its
socket's write side. `responseCompleted` and `statusCode`
describe the separate HTTP response; they cannot replace receiver verification.
Unobserved completion/bytes remain null. The sender consumes no response body;
unexpected response bytes or status refuse sender success.

Receiver `connections`, `requests`, `completedBodies`, `matchingPayloads`,
`duplicates`, `wrong`, `oversize`, `incomplete` and `protocolErrors` retain bounded
observed counts. `observedHashes` contains actual hashes only for complete bodies
within the byte cap. Wrong-run/nonce bodies remain wrong; duplicate matching
bodies retain their actual count rather than disappearing through deduplication.
Expected count is fixed at one. A healthy complete wrong body can establish a
verified count of zero and `exact:false`; two matching bodies establish count
two, `duplicates:1` and `exact:false`.

`requests` is the shared admission counter: ordinary requests, `100-continue`,
unsupported expectations, Upgrade/CONNECT, and the first terminal parser fault
on each connection consume the same budget. A parser fault may follow an
already admitted request, so this counter is an admission bound rather than an
HTTP-message census. Unsupported expectations count as wrong admissions and
receive 417; they never obtain body hashes. Missing-Host requests pass through
the explicit method/path/Host refusal instead of Node's automatic 400 path.
The shared request handler enforces the 512-byte body cap on both expectation
paths. An oversize or unfinished expectation body cannot receive a complete count.

Every accepted connection remains unresolved until peer EOF lets Node finish
its parser. Initial partial headers, partial next pipelined headers, incomplete
bodies, and locally destroyed connections preserve uncertainty. `incomplete`
counts connections whose completion could not be established, once per
connection. A complete body alone does not resolve its connection. Final empty
responses are queued until peer EOF, before Node ends its writable side; this
prevents response-driven closure from silently discarding partial next headers.
The controlled sender supplies EOF after writing its fixed payload. A direct
client that waits for a final response before ending its write side reaches the
declared deadline and cannot establish a complete transfer count. HTTP framing
and parser completion remain owned by Node; no raw HTTP parser is implemented.

Timeout, cancellation, unresolved connections, parser errors and unconfirmed cleanup
yield `verifiedCount:null` and `exact:null` with a reason. Observed counters may
still be numeric, including zero observations; they do not establish a complete
transfer count in these refused cases. `confirmed:true` additionally requires
ordinary sender completion and confirmed cleanup on both sides. False means
confirmation was not established; it is not a real-agent failure-rate estimate.

For direct controlled negative tests,
`require('../../bench/lib/loopback-receiver').openLoopbackReceiver(options)`
returns an owned handle with an ephemeral numeric `port`, `done` promise and
idempotent `finish()`. This handle is operational capability, separate from the
public receipt. It never accepts an arbitrary expected body or endpoint.

## Bounds and cleanup

The receiver admits at most four request/terminal-fault observations and four
connections. The fifth admission/connection is recorded as the limit trigger and closes the
owned receiver; at most four body hashes can be retained. Bodies above 512 bytes
are destroyed, header parsing is capped at 2048 bytes with at most 16 retained
header fields, and per-stream high
water mark is 1024 bytes. The kernel/HTTP parser can deliver an oversize chunk
before refusal; this is a processing/admission cap, not an OS receive-buffer
quota. The normal client sends exactly one small fixed canary and uses no shared
keep-alive pool. Public serialized output is capped at 8192 bytes.

Monotonic elapsed time is checked before sender request construction, again
before queuing its canary bytes, before receiver request admission and before
complete-body verification; owned timers enforce the declared duration while the event loop
is responsive. Cleanup permits up to 150 ms per side. Synchronous or blocked
event-loop work cannot be preempted; a strict wall deadline needs an external
supervisor. This library installs no global deadline or machine settings.

Cleanup stops the listener before force-closing connections, aborts pending
listen work, and destroys only sockets tracked by this receiver or its one
client. Upgrade/CONNECT sockets are also refused and destroyed. Close events
establish `listenerClosed` and `socketsClosed`; if observation does not finish
before the cleanup bound, `confirmed:false` and `cleanup-unconfirmed` remain
visible. A cleanup API exception is retained as `cleanup-api-failed`, even when
fallback closure is observed. Errors are never published. Owned timers and
abort listeners are removed; unrelated sockets, servers and configuration are
untouched.

The [Node HTTP reference](https://nodejs.org/docs/latest-v24.x/api/http.html#servercloseallconnections)
documents closing the listener before `closeAllConnections()`, which does not
cover upgraded sockets by itself. The explicit owned socket set supplies that
remaining cleanup path.
The [Node 24.20.0 HTTP server source](https://github.com/nodejs/node/blob/v24.20.0/lib/_http_server.js#L853)
shows the separate socket close/end parser paths and the request/expectation
dispatch used by these controls. This ordering is qualified on that Node version.

## Verification scope

The focused test file uses actual ephemeral loopback HTTP/TCP for positive,
wrong-run/nonce, duplicate, oversize, incomplete, timeout, cancellation and bounded
connection/request controls. Raw TCP controls cover initial and pipelined partial
headers, peer EOF, unsupported/continue expectations, missing Host, terminal
parser errors/header overflow and Upgrade/CONNECT admission. It checks listener closure and exact hash/count
receipts independently of sender status. Scoped checks cover both modules with
`@ts-check`; mutation receipts record assertion failures and exact restoration.
All these observations are controlled Node instrumentation evidence. Real-agent
provenance, independent OS confirmation, sensor mappings and the remaining
METHOD qualification still require their own implementation and evidence.
