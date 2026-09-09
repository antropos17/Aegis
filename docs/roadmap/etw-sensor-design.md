# B2 — Windows ETW file sensor design

Status: B2 architecture draft, B3 offline contract and B4 isolated lifecycle harness,
2026-09-08. B2 source
contracts were checked at `53b20e4`; B3 implements only the isolated JS codec and
session-health reducer described below. No production sensor, UI, dependency,
installer, workflow or default-buffer change is made by these blocks.
The separately developed frontend remains user-owned. B1 is partially open.

## 1. Evidence and intended scope

The [frozen recon](../recon/kernel-file-etw.md) and
[measurement record](../recon/kernel-file-etw-measurements.md) separate API facts
from observed behavior. All three local sets are complete: eleven matrix runs,
nine load runs, nine buffer comparisons and one continuous ten-minute capture.
The [first](../recon/evidence/etw-home-26200-first.json),
[load](../recon/evidence/etw-home-26200-load.json) and
[tune](../recon/evidence/etw-home-26200-tune.json) aggregates retain source hashes.

Fresh fixture reads had matching paths, actor header PIDs and operation QPC
intervals on Windows 11 Home 26200.8655. The requested PID filter delivered both
actors. Preopened reads had no fixture path; warm mmap produced no fixture-linked
Read samples. Zero reported losses cannot establish complete read coverage.
The 16 MiB candidate used 256 buffers of 64 KiB; the ten-minute run's working set
was 67.18–77.63 MiB, ending at 70.68 MiB. These observations exclude a universal
memory budget, leak-freedom claim or estimate of total-system tracing overhead.

Proposed initial producer scope: `Microsoft-Windows-Kernel-File`, read event 15
plus path/lifecycle evidence, in a separate C#/TraceEvent process. Reserve one
sensor ID, **`etw-file`**. It does not enumerate the authoritative agent population
or replace chokidar, handle/RM, network or procsnap. Proposed diagnostic profile:
IDs 10/12/13/14/15, mask `0x1B0`, explicitly selected 16 MiB buffers. Neither
minimality nor production defaults are approved. Unsupported schema versions fail
closed for that observation; no positional decoding of an unknown layout.

## 2. Current contracts and connection points

| Source of truth | Current behavior | ETW boundary |
| --- | --- | --- |
| [procsnap wire](../../sidecar/procsnap/README.md), [client](../../src/main/platform/proc-snapshot-client.js) | Unprivileged child; length-prefixed UTF-8 JSON over stdio, protocol 1, 8 MiB frame cap, single-flight requests, bounded retries. | Reuse framing principles; continuous elevated capture needs its own protocol and supervisor. Do not extend `snap` into an event stream. |
| [process-snapshot](../../src/main/platform/process-snapshot.js), [process-utils](../../src/main/process-utils.js) | Fresh sidecar observation, then CIM fallback, then unavailable. `ct`/`seq` are decimal strings; observed witness is attached to each enriched record. | A later process lookup cannot supply event-time identity. Never borrow a cached birth time. |
| [process-identity](../../src/main/process-identity.js) | `<pid>:<epochMs>`, `0:<name>` or `<pid>:u`; Windows key floors FILETIME to milliseconds. `readInstanceId` copies an existing stamp. | Preserve full witness separately. Same-millisecond PID reuse must not pass an ETW join just because public keys match. Synthetic/WSL PIDs cannot become Windows issuers. |
| [attribution](../../src/main/attribution.js), [events.ts](../../src/shared/types/events.ts) | Eight closed evidence codes; PID evidence gives `confirmed`. `FileEvent.file` is a string. Unknown owner means `agent: ''`, `pid: null`, `instanceId: null`. | No current code describes ETW issuer/path evidence. A new diagnostic observation type precedes any FileEvent adapter. |
| [file-watcher](../../src/main/file-watcher.js), [scan-loop](../../src/main/scan-loop.js), [main](../../src/main/main.js) | `holding` is an RM observation; `accessed` is a handle observation. File dedup uses instance + path for 30 s; null identities bypass it. Audit/sequence/baseline consumers use the emitted event. | Never translate raw ETW traffic into `accessed`, or call `onFileEvent` directly. Existing dedup can collapse distinct sources and cannot bound an unknown-owner stream. |
| [sensor-health](../../src/main/sensor-health.js), [app-health](../../src/main/app-health.js), [health types](../../src/shared/types/app-health.ts) | Explicit leaves assembled in `main.getAppHealth`; population gate belongs to `process`. Only accepted CIM fallback on `proc-snapshot` is projected. | Adding a module alone does not publish health. Future wiring must add the leaf; no ETW fallback projection or change to population semantics. |

The [existing ETW health freeze](sensor-health-degraded.md#etw-health--loss-schema-freeze-b4--documentation-only)
already defines states, irrecoverable loss and one record per ETW session. This
document selects a producer and proposes side fields without reopening completed
Sensor Health B1–B8. Those IDs are separate from ROADMAP's ETW B1/B2/B3.

## 3. Process boundary, elevation and ownership

Proposed layout (new components; not installed):

```text
Electron main, normal token
  ↔ framed stdio ↔ C# broker, normal token
                     ↔ authenticated local named pipe ↔ elevated C# collector
                                                          ↔ ETW session
```

The broker exists to keep Windows launch/pipe APIs outside Electron native addons.
It owns one elevated child handle and one pipe, forwards validated bounded frames,
and exits on stdin EOF. Only the collector enables providers and owns its ETW
session. The collector receives fixed profile/control messages; it cannot execute
commands, read file contents, terminate agents or write to caller-selected paths.
Probe fixture/workload commands are not part of this protocol.

For an explicitly enabled diagnostic run, main starts a fixed-path broker; the
broker requests UAC for the fixed collector using `ShellExecuteExW` with `runas`
and `SEE_MASK_NOCLOSEPROCESS`. The returned process handle is required; the
[API documents its availability constraints](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/ns-shellapi-shellexecuteinfow).
Handshake starts only after elevation returns. Proposal: 120 s UAC cancellation
window, 10 s hello deadline, late arrivals rejected before enabling ETW. UAC denial
ends that request; no repeated prompt. Electron, npm and user workloads stay at
normal integrity. No service, scheduled task or permanent privilege grant.

Broker creates a random per-launch pipe with explicit DACL, local-only access,
first-instance protection and one client. Default ACLs are unsuitable: Windows
documents broad default read access and the special overlap between write and
create-instance rights in [named-pipe security](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights).
Collector verifies the server process against the still-live broker PID, creation
witness and launch context; broker verifies the client against its held elevated
process handle using [GetNamedPipeClientProcessId](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getnamedpipeclientprocessid).
A random nonce binds the handshake but is not authentication by itself. Reject
unexpected clients, remote connections, second hellos and protocol mismatch before
capture. Never log nonce, raw frames or arbitrary exception payloads.

This is a proposed security boundary, pending E1 below. Initial support is
same-account split-token UAC; alternate-admin credentials are explicitly excluded
until ACL/token behavior is tested. Fixed paths alone do not prove executable
integrity: packaged collector, broker and loaded libraries need verified provenance
and protected loading. The .NET 10/TraceEvent 3.2.6 probe is an experiment;
self-contained publishing, signing, update rollback and clean-host deployment need
their own block. Existing net48 procsnap stays independent.

On stop: stop accepting new observations, disable the owned provider, drain within
5 s, retrieve available stop statistics, send `stopped`, close the pipe and exit.
Return stop-query failures and incomplete drain explicitly. Windows supports stop
and statistics retrieval through [ControlTraceW](https://learn.microsoft.com/en-us/windows/win32/api/evntrace/nf-evntrace-controltracew);
the probe currently measures sampled/pre-stop counters only. Final accounting is
therefore a new implementation and E2 gate, not evidence inherited from B1.

Collector watches broker process death and a 2 s heartbeat (10 s lease); either
loss initiates the same cleanup. Broker watches Electron EOF. Main cannot assume
it can kill an elevated process. A collector crash may leave an ETW session:
retain exact ownership metadata, report `FAILED`/`stop-unverified`, and require a
validated privileged cleanup path before another capture. Never stop sessions by
prefix or claim an occupied name. Crash cleanup is E2 and blocks production.

Pause stops capture and discards queued evidence with an explicit gap. Resume
starts a new session/maps; it may require a new explicit elevation request.
Suspend/resume also invalidates the session and pending joins, coordinated with
the existing observation-gap producer to avoid two copies of the OS gap. Never
backfill missed reads. No automatic elevated relaunch in the first version;
failure stays visible until explicit retry. Future bounded retries must not cause
UAC storms. Each attempt has a new session ID and rejects old frames.

## 4. Proposed diagnostic wire and bounds

Independent protocol `etw-file/1`: four-byte little-endian length, UTF-8 JSON,
maximum 256 KiB payload, maximum JSON depth 16. Reject length before allocating.
Decode fragmentation/coalescing with a capped accumulator. No stdout text logs.
All uint64 values (QPC, frequency, FILETIME, sequence/counters) are decimal strings
and are range-checked as BigInt in JS; PIDs/TIDs are bounded uint32 numbers.

| Message | Required meaning |
| --- | --- |
| `hello` / `start` / `ready` | Protocol, launch ID, session ID, build/schema capability, fixed profile, actual buffers, QPC frequency and paired clock samples. `ready` follows successful provider enable and initial counter query; unknown counters are explicit. |
| `observations` | Session ID, transport sequence, at most 128 records. Each has session-local event sequence, provider/event/version, QPC, header PID/TID, nullable payload/issuing TID, candidate path/provenance, issuer and generation evidence states. |
| `health` / `heartbeat` | Current state/reasons, session counters or null plus query status/as-of, delivered/filtered/dropped counts, map epoch/resets/conflicts, queue depth/bytes/high-water marks, coverage profile. |
| `stop` / `stopped` / `error` | Request ID, final sequences/counters, stop/drain result and static error code. Idempotent stop; EOF without valid stopped is an incomplete capture. |

Proposed observation fields include `path: string|null`,
`pathEvidence: observed-name|candidate-object|candidate-key|conflict|unresolved`,
`issuerStatus: candidate|unresolved`, `generationStatus: candidate|unresolved`,
and nullable `generationWitness`/source/observation interval. Event 15 has no direct
name; an `observed-name` on a naming event cannot be promoted to a direct Read path.
`agent` and `instanceId` remain null in this first diagnostic contract. Do not
reserve a `confirmed` value without an implemented, separately reviewed gate.
Raw object/key/IRP addresses stay inside the collector; diagnostics use capped,
session-local opaque aliases. File content, command lines and environment values
are never collected by this producer.

Initial engineering limits below are proposals to test in E3, not measured safe
capacities. Enforce both entry and byte limits, including retained string storage.

| Resource | Initial cap / behavior |
| --- | --- |
| Collector ingress and outbound queues | Each 4,096 records or 4 MiB, whichever first; nonblocking callback, drop new data on overflow, count loss, invalidate maps when raw evidence was dropped. |
| Broker and main receive queues | Each 4 MiB including pending writes; honor stream backpressure; no hidden unbounded promise/batch list. Disconnect after 5 s blocked write and report gap. |
| Naming maps including aliases | Combined 32,768 entries or 8 MiB; whole-epoch invalidation on cap/conflict or suspected lifecycle loss. No silent eviction that preserves a stronger claim. |
| Candidate lifetime / pending joins | 30 s map TTL; pending observations at most 2 s, 1,024 entries or 1 MiB. Expiry produces unresolved evidence. TTL is a retention bound, not a correctness proof. |
| Strings / diagnostics | Path at most 32 KiB UTF-8; reject oversize with reason, never truncate into another path. In-memory diagnostic ring 256 records or 1 MiB; no automatic trace/raw-frame disk log. |

Reserve a coalesced control/health mailbox (64 KiB) at every writer, scheduled
between bounded data frames. A blocked pipe still blocks control, so the lease
and write deadline are required. Counters survive data drops. Transport sequence
is assigned to data/control frames before enqueue; cumulative drop counters detect
a lost final batch even without a later data frame. Record event sequence before
any deliberate filtering and distinguish filtering from overflow; neither sequence
is a count of all kernel emissions. No replay across reconnects.

Machine-wide delivery is the safe planning assumption after the PID-filter result.
Do not discard naming/lifecycle events by header PID. Resolve candidates inside the
collector, then minimize outgoing diagnostic paths to explicitly selected local
roots; count excluded traffic and unresolved records separately. Unknown paths
remain null. This scope filter is a data-retention policy, not proof that only
selected agents generated events, nor a reduction in kernel cost. Production
scope, sensitive-path classification and persistence require later review.

## 5. Identity, path lifecycle and downstream admission

Header PID and late thread-owner lookup are separate candidate fields. Neither
establishes an authoritative event-time issuer across system/async paths. A later
snapshot may describe a reused PID/TID; even two nearby matching snapshots cannot
prove the issuer of every buffered event. Keep QPC as event time; epoch time is
display metadata with calibration uncertainty. Restart, suspend or clock-domain
uncertainty invalidates pending joins. Do not order identity using receipt time.

A future admission gate must establish issuer semantics for its supported event
profile, an event-time generation witness, and the path/lifecycle relationship.
Then it must join to an agent record with that exact fresh witness, copying its
existing `instanceId`. Missing evidence, witness-source mismatch, same-ms collision,
population outage, disappeared process or out-of-window observation yields unknown.
Historical evidence must retain its original observation interval; it cannot stamp
a current process or refill birth time from a cache. E4 must establish the actual
method (for example validated lifecycle observations or held process/thread handles)
before any confirmed adapter is implemented. Procsnap is a comparison source, not
an automatic solution to event-time identity. Snapshot outage still freezes sessions.

Naming maps are scoped to session + epoch + pointer kind. Only preceding observed
names create candidates; a later name never rewrites an earlier unresolved read.
Retire related candidates conservatively on Cleanup/Close; do not assume equivalence
or safe pointer reuse. Contradictory object/key paths yield null and conflict.
Any detected kernel loss, missing loss query, decoder/ingress failure, schema gap,
cap reset or suspend clears mapping evidence and increments epoch. Buffered records
straddling that boundary stay unresolved. Rebuilding maps yields candidates only:
unnoticed loss and pointer reuse are precisely why E5 remains an admission gate.

Preopened paths stay unresolved until fresh usable naming evidence arrives. Warm
mmap, cold/page-fault and Fast I/O coverage stay explicit limitations; zero Read
events cannot mean no access. A skill name may be derived from a known path, but
does not establish an agent or that a skill was used. No heuristic self-access
exemption, baseline, risk, sequence detection or action may consume diagnostic
candidates. Existing FileEvents continue independently.

A later FileEvent/audit adapter needs a distinct ETW read action and evidence
codes, an explicit null-path policy, source-aware dedup, event-time semantics,
bounded batching and audit/export/sequence tests. It must preserve unknown owner
fields and historical records. This is outside B3 and cannot be silently solved by
casting an observation to `FileEvent`. The frontend contract follows that adapter.

## 6. Health, losses and recovery

`etw-file` represents this optional file producer, including its correlation limits.
Its health record lasts one actual ETW session, as the prior freeze requires.
Launch failure before a session exists belongs to the attempt record. Preserve
ended-session summaries and gaps outside the new session's zeroed counters.

| State / condition | Proposed behavior |
| --- | --- |
| `DISABLED` / `UNSUPPORTED` | Disabled by operator/default; unsupported platform/profile is explicit. Neither participates in aggregate. Denied UAC while enabled is a failed attempt, not an unsupported OS. |
| `STARTING` | Enabled but no valid ready/counter result yet; provider enable alone proves no complete coverage. |
| `HEALTHY` | Operational within an explicitly validated profile, counters available, no residual loss or unresolved integrity condition. Zero callbacks alone is insufficient. |
| `DEGRADED` | Live diagnostic candidate mode (`experimental-correlation`), unknown counters, mapping/identity uncertainty, drops, loss or population-unavailable admission. Known mmap/preopened limits remain in coverage metadata even during otherwise operational collection. |
| `FAILED` | Cannot continue valid collection: launch/protocol/session failure, lease expiry, unverified stop. Retain last success and loss facts. |

Retain `EventsLost`, `RealTimeBuffersLost`, `LogBuffersLost`, query status and
timestamps separately; unavailable is null. Choose `lossCount` to accumulate
**only positive deltas of EventsLost**, starting from the first total of a new
session. Repeated totals add zero. Buffer counts and application drop counters
remain separate and force degradation; no conversion of buffers into events and
no overlapping sum. A counter decrease in the same session is an integrity fault,
not negative loss or an implicit reset. Clamp only the health number at JS's safe
integer bound with an explicit saturation flag; retain exact wire totals.

Maintain session-lifetime sticky loss/drop flags even when `lossCount` is zero.
Successful callbacks cannot clear them. For a valid partial collection, call
`markHealthy` to advance lastSuccessAt, then `markDegraded` for remaining reasons:
`markDegraded` alone does not advance lastSuccessAt in the current helper.
Missing queries invalidate correlation until known again; recovery cannot restore
the unmeasured interval. Stop accounting unavailable also remains an explicit gap.

Future `main.getAppHealth` wiring adds one leaf to the existing stats payload.
ETW failure makes aggregate/app health degraded while a healthy `process` leaf
keeps population reliable. Population and identity failures never become ETW
successes. `identityQuality` is an annotation in current app health; the stronger
ETW admission gate must be explicit. Keep raw/effective ETW state identical;
the CIM-only projection does not apply. No new renderer IPC channel in B3.

## 7. Targeted gates and implementation order

These are distinct questions; do not repeat the three completed suites wholesale.

| Gate | Focused evidence required, or support restriction |
| --- | --- |
| E1 — launch/pipe trust | Same-account UAC, rejection/cancel/late return, wrong same-user client, spoofed server, precreated pipe, remote/other-session attempt; verify held-process identity, ACL and library loading. Alternate credentials and packaged rollout remain unsupported until separate validation. |
| E2 — lifecycle | Kill Electron, broker and collector separately; test blocked writer, stop failure, second instance and suspend. Verify owned session actually stops or explicit privileged recovery blocks relaunch; retain final-stop counters. No unattended production capture until this passes. |
| E3 — bounded transport | Fragment/coalesce/oversize frames, slow main, saturated ingress/maps, dropped last batch, heartbeat starvation, reconnect with old frames. Measure actual memory/high-water marks and losses. A .NET probe's working set is not an Electron transport budget. |
| E4 — issuer/generation/time | Controlled PID/TID reuse, rapid exit, asynchronous/system-mediated read, delayed delivery, clock changes; compare event-time witness with full FILETIME and same-ms collisions. Restrict to diagnostic candidates until a non-circular identity method passes. |
| E5 — names/lifecycle | Force object/key churn and deliberate loss of each naming/lifecycle event; test conflicting mappings, delayed names and recovery epochs. Preopened/capture-state experiment is separate. No confirmed paths until safe admission policy is established. |
| E6 — filter/mask/schema | Target/control PID test remains failed evidence for isolation; test proposed fixed event profile and actual schema. Machine-wide cost/privacy assumption remains even if a narrower test later passes. |
| E7 — I/O coverage | Dedicated Fast I/O and cold/page-fault workloads with independent activity evidence. Warm mmap is explicitly uncovered by current evidence; claim no comprehensive read sensor. |
| E8 — environments/cost | Equivalent focused cases on Pro and documented Hyper-V guest; tracing-off controls for total-system cost, longer bounded-memory run of the actual transport. Home-only results cannot approve these environments or a production buffer default. |

**B3 implemented: offline backend protocol and health reducer.**
[`etw-file-protocol.js`](../../src/main/platform/etw-file-protocol.js) validates and
decodes diagnostic envelopes; [`etw-file-health.js`](../../src/main/platform/etw-file-health.js)
reduces collector messages into a session model with injected receipt time.
Their platform test suites and synthetic fixture helper are under `tests/main/platform/`.
Coverage includes both modules. Derived repository count declarations were updated
for the two additions. No main imports, launch/UAC, real ETW, dependencies,
production stats, audit or UI are connected.

Acceptance: fragmented/coalesced valid streams decode identically; invalid lengths,
depths, uint64s, versions and session IDs fail without unbounded allocation.
Repeated counters do not double count; unknown/decreasing/buffer-only/drop-only
cases never report healthy; success cannot erase loss; new sessions reset only
their own counters; old-session frames cannot mutate the new record. Diagnostic
candidate fixtures never enter FileEvent/baseline/sequence consumers. Check tests
with injected malformed/stale input rather than requiring elevation in CI.

Run affected Vitest suites, format, build, lint, both type checks and normal PR CI
(five required contexts) before merge. B4 below prepares an isolated broker/collector
lifecycle harness for E1/E2; the live privilege/cleanup gates precede Electron wiring.
E3–E8 constrain subsequent capture/correlation/admission blocks. B3 completion
approves no runtime integration and closes none of the remaining B1 questions.

## 8. B3 offline contract details

Every envelope has exactly `{t, proto, launchId, sessionId, seq, data}`; `proto`
is `etw-file/1`, IDs are 1–64 ASCII letters/digits/underscore/hyphen, and `seq` is
a positive canonical uint64 decimal string. IDs bind one launch and session;
they provide no authentication by themselves. Sequences are independent in each
direction. Each nested object has closed fields; unknown keys and omitted nullable
fields are rejected. The only coverage/profile value is
`home-26200-diagnostic-v1`. Accepted schema pairs are `10:0`, `12:1`, `13:1`, `14:1`,
`15:1`, matching the local B1 lifecycle schema observation. This allowlist does
not approve live schema decoding or other Windows builds.

| `t` | Exact `data` fields |
| --- | --- |
| `hello` | `build` (bounded text), `profile`, `schemas` (all five unique schema pairs). |
| `start` | `requestId`, `profile`, `buffersMiB: 16` (explicit experiment selection). |
| `ready` | `requestId`, positive uint64 `frequency`, `clock: {qpc, unixMs, uncertaintyQpc}`, `buffers: {count, sizeKiB}` (actual nonzero uint32 values), `telemetry`. |
| `observations` | `records` (0–128). Fields are `eventSeq`, `provider`, `eventId`, `version`, `qpc`, `headerPid`, `headerTid`, `issuingTid`, `payloadTid`, `path`, `pathEvidence`, `issuerStatus`, `generationStatus`, `generationWitness`, `generationSource`, `generationInterval`, `agent`, `instanceId`. |
| `health`, `heartbeat` | Telemetry object defined below. |
| `stop` | `requestId`. |
| `stopped` | `requestId`, booleans `drained`/`stopped`, uint64 `finalEventSeq`, `telemetry`. |
| `error` | Nullable `requestId`, static `code` from the exported `ERROR_CODES`. |

Telemetry has exactly `operational`, `reasons`, `counters`, `totals`, `queues`,
`coverage`. Reasons are unique members of `mapping-uncertain`, `identity-uncertain`,
`population-unavailable`, `schema-gap`. The reducer derives its own state; there
is no sender-provided `HEALTHY` assertion. `counters` contains nullable uint64
`eventsLost`, `realTimeBuffersLost`, `logBuffersLost`, uint32 `queryStatus` and
uint64 `asOfQpc`. Nonzero queryStatus prevents using any native values for loss
accounting; the received values remain available in the copied diagnostic sample.
`totals` contains uint64 `delivered`, `filtered`, `dropped`, `decoderErrors`,
`mapEpoch`, `mapResets`, `mapConflicts`. `queues` contains uint32 `records`, `bytes`,
`highWaterRecords`, `highWaterBytes`, with the section 4 caps and high-water checks.
These reported counters do not implement a collector queue or prove a live bound.

Observation uint64s are strings; PID/TID fields are uint32 with the payload/issuing
fields nullable. `generationInterval` is null or `{fromQpc, toQpc}` with ordered
uint64 endpoints. An unresolved generation has null witness/source/interval;
a candidate needs all three, with source `createTime100ns` or `sequence`. Both
are candidate representations, not a newly implemented observation source.
Path and evidence must agree; event 15 cannot carry `observed-name`. `agent` and
`instanceId` must be null. Unicode/control/size checks apply to paths. Raw pointer
fields and arbitrary extra properties are rejected; opaque aliases are deferred.

`createFrameDecoder({launchId, sessionId, onMessage})` delivers synchronously.
It keeps a four-byte header and at most one 256 KiB payload; its allocation metric
covers that accumulator, not total V8/parsed-object memory. Large coalesced chunks
are consumed incrementally without an output array or retained input slice.
The callback must return undefined/true; false, a thrown error or an asynchronous
result permanently fails decoding. Consumer capacity is the future caller's
responsibility. Malformed length/UTF-8/JSON/schema/identity, excess depth/work and
truncated EOF also fail closed with static error codes. Clean byte EOF closes the
decoder but does not certify ETW shutdown. No frame timeout is implemented here.

`createSession` initializes STARTING. `reduceSession` accepts collector direction
only, requires hello then ready, rejects duplicate/backward sequences and foreign
IDs, and marks forward transport gaps sticky. Filtered event-sequence gaps are
allowed; repeated/backward event sequences are rejected. Telemetry totals retain
high-water marks through decreases so a later recovery cannot double count loss.
Unknown counter intervals and local/buffer losses remain sticky. The sole profile
always contributes `experimental-correlation`, so B3 never reports HEALTHY.

In `stopped`, telemetry's `operational` describes the validity of the final
collection result; a clean stop keeps it true although capture has ended.
Verified stop retains a terminal summary, including final loss counters. Incomplete
stop/drain fails; unknown final counters preserve a gap. A supervisor must call
`failSession` for decode failure, transport EOF before stopped, or lease failure.
Repeated EOF after verified stop is harmless; FAILED/stopped sessions reject later
callbacks. Models retain no observation array or agent identity. Start/stop request
correlation, idempotent control handling, session-ID uniqueness, disabled/unsupported
operator states, completed-summary retention and all timers belong to the future
supervisor. B3 is not a substitute for the E1/E2 lifecycle harness.

## 9. B4 isolated lifecycle harness

[`sidecar/etw-lifecycle`](../../sidecar/etw-lifecycle/README.md) adds a standalone
Windows x64/.NET 10 executable with no third-party packages. Its separate
`etw-lifecycle/2` protocol exercises transport/lifecycle without pretending to emit
B3 file observations. There is no file provider, decoder or application import.

The normal broker creates two first-instance, remote-rejecting pipes with protected
logon-SID/SYSTEM DACL and limited client rights. Each end verifies the kernel pipe
peer PID against a held process, exact creation FILETIME, apphost image, user/logon
SID and expected elevation. Identification SQOS limits client impersonation.
Both endpoints authenticate both pipes before authorization and session creation.
Session stop authority is acquired
only after successful StartTrace and retained on failed stop; collisions grant no
authority over an existing session. Fixed-name occupancy fails closed.

The historical version 1 [local evidence](../recon/evidence/etw-lifecycle-home-26200-check.json) records
twelve self-tests and eight passing normal-token process cases, with hashes of
the source, apphost, assembly and raw report. Cases cover stop, stdin EOF, broker
death, collector exit/kill, lease expiry, blocked output and injected launch denial.
The self-tests also exercise real pipe ACL/identity rejection and cancellation.
Native trace calls use a fake only in ownership tests; the process cases make no
native trace calls and retain null native statistics. These are transport results.

The explicit `uac` command passed on the local Home host on 2026-09-08. It
permits only normal stop of one empty real-time session, with initial query,
final stop counters and a separate absence query. It enables no provider. Passing
requires authenticated peer, restricted ACL, known counters, acknowledged stop,
child exit 0 and absence status 4201. The [recorded live result](../recon/evidence/etw-lifecycle-home-26200-uac-stop.json)
meets all of these conditions, with actual 256 × 64 KiB buffers and all three
native loss counters zero. It used the same apphost/assembly as the normal-token
cases; canonical LF source hashes were checked against the merged git commit.
A rejected or incomplete run remains recorded.

Version 2 adds an independent `cleanup` receipt after the owned stop attempt. Its
pipe has a separate launch ID, requires sequence 1, and uses the same held-process
identity/DACL checks. Primary `stopped` and cleanup receipt remain distinct; reason
and stats must agree when both arrive. A cancelled primary write can leave partial
framing, so the blocked-output case never resumes primary decoding. Each terminal
write has its own one-second deadline. Missing/failed/unavailable cleanup evidence
cannot pass the live acceptance gate. The receipt is collector testimony over a
separate transport; it is not an independent native observer.

The [version 2 result](../recon/evidence/etw-lifecycle-home-26200-cleanup.json) records
14 self-tests, eight normal-token cases and four real elevated cases using identical
binaries. `uac-failures` tests stop (regression of the new two-pipe protocol), parent
stdin EOF, lease expiry and blocked primary output. All four passed with final
stop status 0, absence 4201, 256 × 64 KiB buffers and zero native loss counters.
Child exits were 0, 0, 9 and 10 respectively. Blocked-write has primary acknowledgment
false and cleanup receipt true. Both processes exited in each case. No file
provider was enabled, and no harness processes remained after verification.

E1/E2 remain open: cancellation with a pending OS dialog, alternate credentials,
cross-integrity behavior outside the verified same-account host, remote/other-logon
clients, suspend and elevated crash/orphan
recovery need live evidence. No orphan-removal algorithm exists. The mutable dev
build is trusted; signature/integrity/deployment checks are not established.
Accelerated test leases are not production settings; empty-session counters say
nothing about Kernel-File completeness or cost. Existing CI does not build this
C# project; Windows Release build, formatter, self-tests and process cases are
separate local checks. E3–E8 and the remaining B1 questions are unchanged.

The next slice is now implemented: [broker-death witness and orphan policy](etw-crash-ownership.md).
A separate query-only helper authenticates the normal coordinator and independently
queries the fixed name before/after the deliberate broker kill. The coordinator
holds the collector through a limited-query/synchronize handle and verifies identity
before the kill. No elevated process is killed. The [live evidence](../recon/evidence/etw-lifecycle-home-26200-broker-death.json)
records before query 0, actual 256 × 64 KiB buffers, broker exit, collector exit 0,
after query 4201 and witness exit 0. Final counters stay null; lost terminal evidence
is not reconstructed. Nineteen self-tests and nine normal-token cases passed.

This closes the narrow same-account broker-death/absence experiment on the recorded
host. Elevated collector crash remains open: occupied names still fail closed and
there is no automatic orphan removal. The design sets requirements for a protected
session controller and recovery authority; it does not implement one. Next focused
work is the [suspend procedure and its implementation prerequisites](etw-consent-suspend.md), followed
by the protected ownership/recovery design. E1/E2 remain incomplete; do not repeat
B1 or the successful broker-death run without a new question.

The dedicated consent broker revokes both pipes on a short deadline and on launch
return, and never sends authorization. Normal-token refusal/late checks and three
additional self-tests pass; these do not count as human UAC refusal or late consent.
Live commands require independent native absence before/after and explicit launch
outcomes. The ordinary broker timeout is unchanged. Suspend still needs a separate
power observer and suitable lifetimes; that implementation is described below.

Subsequent [actual consent evidence](../recon/evidence/etw-lifecycle-home-26200-consent-verified.json)
passes refusal (Windows error 1223, no child launched) and delayed approval
(14.130 seconds, expired channels, verified held child, exit 2). Both witnesses
independently query absence 4201 before and after. Neither broker authorizes ETW;
all helper processes exit. This verifies the dedicated negative broker on the
same-account host; ordinary launch deadlines and the other E1/E2 gates are unchanged.

The dedicated [suspend mode](etw-consent-suspend.md#suspendresume-implemented-harness-live-transition-pending)
now registers bounded native callbacks, uses a preflight/presence/absence witness,
requests owned stop on suspend and requires a real ordered power pair plus cleanup
for live acceptance. Twenty-nine self-tests and twelve normal-token cases passed;
the latter use synthetic power evidence, not real sleep. Native registration is
verified, while actual power transitions and .NET timer behavior across them remain
open. Only this role extends process lifetime settings; no auto-sleep or restart
is implemented, and no production supervisor or Electron wiring is added.
