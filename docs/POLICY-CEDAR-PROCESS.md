# Dormant Windows Cedar process owner

Status: dormant process-owner integration after Cedar runtime #997, worker #1013
and lifecycle fix #1038 merged. There is no application, main-process or IPC
caller. Existing policy routes, action execution, approvals and
`launchAllowed=false` are unchanged. This does not complete W5/W6.

`createCedarProcessClient()` is a Windows-only private evaluator facade. It owns
one evaluation at a time without a queue, retry, ownership adoption or synchronous
fallback. Non-Windows use refuses. Its constructor dependencies are trusted
composition/test seams, not caller authentication or a user launch interface.
The private request contains only the existing bounded policy/action snapshot;
the existing adapter supplies allow/forbid, ask/default and required-review
semantics. No action executes.

## Native boundary

The framework-only .NET 10 Windows console helper uses two unnamed,
noninheritable Jobs under the normal user's token on Windows 10 or later. R4 first
snapshots the current immediate ambient Job's extended limits, UI restrictions
and CPU-rate state with `QueryInformationJobObject(NULL, ...)`. Admission permits
only structural flags `DIE_ON_UNHANDLED_EXCEPTION`, `BREAKAWAY_OK`,
`SILENT_BREAKAWAY_OK` and `KILL_ON_JOB_CLOSE`, with no enabled resource limits, UI
restrictions or CPU-rate state. Unknown flags, nonzero resource fields and failed
queries refuse. Inactive priority/scheduling fields may be zero or the observed
neutral Windows defaults (32/5); their enabling flags still refuse.

Before creating an evaluator, the helper configures and queries a new retention
Job, then assigns itself to it. This adds an association while preserving existing
associations. The retention Job has no breakaway, silent-breakaway, UI or
kill-on-close policy. It explicitly preserves the ambient exception flag. This
new immediate non-breakaway Job prevents default child creation from silently
leaving the inherited chain. Its handle is never inherited or passed in the child
handle list. It is never terminated or awaited as empty: it contains the helper
that must write the receipt. Closing it does not detach Job associations.

The second Job owns the evaluator's resource limits and kill-on-close lifetime.
The helper verifies its own retention membership and absence from the resource
Job, then verifies the suspended child in both owned Jobs. Both profiles and
memberships are rechecked inside the final revoke/resume lock. No existing Job is
mutated. Unsupported/incompatible OS assignment or creation refuses; there is no
breakaway creation flag, parent substitution or alternate launcher. Before reading private input, it rejects inherited
Node/.NET diagnostic and startup-hook environment keys. The facade launches it
with only `SystemRoot`, `WINDIR`, `TEMP` and `TMP` when present; the native child
receives only the Windows directory and `ELECTRON_RUN_AS_NODE=1`.

The configured and queried Job limits are:

| Limit | Value |
| --- | --- |
| Process committed virtual memory | 256 MiB |
| Whole-Job committed virtual memory | 256 MiB |
| Active processes | 1 |
| Per-process user-mode CPU time | 2 seconds |
| Whole-Job user-mode CPU time | 2 seconds |
| Kill on last Job-handle close | Required |
| Native monotonic wall watchdog target | 10 seconds |

Memory limits constrain committed virtual memory. They do not bound all physical,
kernel or system memory, and do not cover the facade or helper itself. Windows
checks user CPU time periodically; this is not an exact wall-time limit. The
native watchdog polls at 5 ms independently of the JavaScript event loop; OS
scheduling and bounded cleanup add latency. This is not a security sandbox,
filesystem/network isolation, an identity proof or an availability qualification
for the whole application.

Creation uses `PROC_THREAD_ATTRIBUTE_JOB_LIST`, `CREATE_SUSPENDED` and an explicit
three-handle inheritance list. The child enters the resource Job during creation
and inherits the retention chain through default parentage. Every
cap and membership is verified while it remains suspended. Creation checks the
latched revocation and monotonic deadline; the final cap query/check/resume and
watchdog revoke/terminate share a lock. A watchdog that already revoked an empty
Job cannot subsequently authorize resume. No PID is used for cleanup.

The outer lifetime owner retains the original process and Job handles even when
startup fails. Termination must confirm both an empty Job and a signalled original
process handle within 750 ms. Private pipes must prove EOF, with a 250 ms drain
and 8 KiB discard bound. An unknown query, wait, pipe or exit refuses; it cannot
be replaced by a later no-child shortcut. Disposal closes the Job only after
these observations. If the helper dies, Windows kill-on-close is the guarantee;
the facade does not turn missing confirmation into an observed closure.

## Transport and admission

Stdin/stdout use one little-endian 32-bit length frame, a fixed schema and a fixed
`evaluate` operation. The request ceiling is 8 MiB + 64 KiB + 1024 bytes; the reply
ceiling is 8 KiB. Policy/action data never enter argv, child environment, logs or
diagnostics. A second frame, output diagnostics, malformed metadata, unexpected
policy IDs or excess output refuse. The native child is always the compiled
Cedar entrypoint with fixed Node flags. There is no request executable, command,
JS path, environment selector or action execution capability.

Effective cached `stream`, `child_process`, `net` and `worker` diagnostics,
inspection and known startup hooks refuse before the facade snapshots private
values or creates a child. The evaluator entrypoint repeats admission checks
before private reads. A trusted embedding host is still necessary; checks cannot
undo instrumentation that already ran or authenticate a compromised host.

A decision remains provisional until a complete native receipt attests to the
queried limits, whole-Job closure and clean helper exit. The facade independently
checks its elapsed deadline. Cancellation/deadline failure revokes stdin; after
one second it may terminate an unresponsive helper. That loss yields denial and
does not supply a Job-closure receipt. Admission stays occupied indefinitely
after unknown closure. A separate sticky transcript flag invalidates retained
prefix bytes after output overflow, stream errors, diagnostics or malformed
closure evidence. Clean helper exit cannot rehabilitate that transcript or open
admission. `close()` permanently closes the facade; it is not a cleanup receipt.
Timeout/cancellation alone leaves transcript integrity intact: an eventual
genuinely valid closure receipt may release admission, while the already
delivered denial remains unchanged.

The native receive path checks control-pipe liveness and rejects queued parent
bytes during child polling and again after final output drain, exit and metadata
validation. The terminal `PeekNamedPipe` observation defines the acceptance
cutoff. It refuses a second frame already queued then, including when the child
had already exited or bytes arrived during final drain. It cannot predict bytes
that arrive after that observation.

## Explicit build binding

`CedarJob.csproj` requires an owner-generated, task-local MSBuild props file via
`-p:CedarLayoutFile=...`. No machine paths or generated pins are checked in. The
file must supply `CedarRuntimePath`, `CedarRuntimeHash`, `CedarEntryPath`,
`CedarEntryAsset` and `CedarEntryHash`. Paths and SHA-256 observations are compiled
into assembly metadata. For development the asset is the entrypoint file; for an
ASAR layout the asset is the whole ASAR, with the fixed internal evaluator entry.
The runtime is the pinned installed Electron executable; no runtime is copied or
provisioned. Absence of the props file fails the build, and invalid/changed pins
refuse evaluation.

The observed installed runtime, load folders, dependency closure and build inputs
must remain owner-trusted and stable. Hashing a path before `CreateProcess` or
`require` is not atomic file authentication. Transitive development files are not
authenticated by the entry-file hash. A future portable packaged layout and the
actual product caller remain unqualified.

An unnamed inherited Job handle is unavailable to the helper. It cannot directly
prove child membership in each unowned ancestor, enumerate all ancestor policies
or establish full opaque host-policy equivalence. Matching NULL-query profiles
are consistency observations, not identity proof for an unnamed ancestor. The
contract relies on documented association/default-parent inheritance and trusted
absence of simultaneous external reassignment. Direct membership/readback proof
covers the two owned Jobs. A fixed fixture-only 128 MiB per-process limit on the
new retention Job witnesses one stricter applicable chain limit; it does not
authenticate every unowned ancestor restriction. There is no wrapper or alternate
launcher, and fixtures use the same production admission/creation path.

`CedarJob.Fixture.csproj` is a separate qualification binary. Only that build
includes fixed inert allocation, CPU, sleep and descendant attempts plus
suspended/revoked/expired/unknown-wait/unknown-pipe fault controls. It cannot
choose an arbitrary executable or command. Its allocation case requests at most
256 MiB in 4 MiB chunks. Each external fixture has a 14-second harness deadline;
only one resource child may run at a time.

## Historical evidence and limits

The new facade's focused tests cover framing, private transport, provisional
allow, busy/closed admission, cached diagnostics, cancellation/deadline,
unknown closure/caps, helper loss, diagnostics and malformed/excess replies.
These use synthetic child-process controls and do not establish native resource
enforcement. Temporary source-copy mutations separately check refusal paths.

The R2 pipe-only fixture exercises the production receive/drain/cutoff code with
actual Windows anonymous pipes and an explicitly synthetic already-exited
process state. Clean control succeeds; queued input before receive, input queued
during final drain and known owner-pipe loss refuse. It creates no evaluator
process or Job. Removing the terminal check in copied source makes the queued
input cases fail their refusal assertions. This is transport evidence only and
does not itself establish native resource enforcement.

R1/R2 observed the original blanket nested-Job refusal. Immutable R3 queried flags
`0x3C00`, including `SILENT_BREAKAWAY_OK`, and refused before creating an owned Job
or evaluator. Those historical packets remain unchanged and blocked. R4 narrows
the admitted ambient-policy contract and adds the production retention Job. The
actual local ambient snapshot was `0x3C00`, neutral inactive priority/scheduling
32/5, and zero queried resource/UI/CPU-rate fields. That observation is specific
to this runtime/launcher, not universal evidence about structural flags.

R4's initial actual Cedar permit completed with an exact allow receipt and
confirmed resource closure. Inert committed allocation was refused with Win32
error 1455 after 248 MiB at the 256 MiB private cap (peak process 266,690,560
bytes). The stricter owned retention fixture refused after 120 MiB at its 128 MiB
cap (peak 132,173,824 bytes). These are committed-memory observations with ample
available host memory, not physical-memory or global stress claims. CPU control
terminated at an observed 3.0625 seconds of user time under a queried 2-second
periodically checked limit; the independent wall control terminated at an observed
10.151 seconds under its 10-second target. Neither figure is an exact scheduling
guarantee.

Descendant refusal, whole-resource-Job closure, four suspended pre-resume refusal
controls and suspended helper-loss cleanup passed. The latter retains an original
process handle and checks creation time before killing the helper; it observes
that child's termination without inventing a missing helper closure receipt.
Injected unknown-wait and unknown-pipe controls refused even with otherwise
observed exit. These two are synthetic uncertainty controls, not observed OS
failures. Pure ambient-profile controls and copied-source UI/CPU guard mutations
create no Job or child; they demonstrate only admission sensitivity.

A separate loader-only check ran the actual installed Electron 44.7.2, embedded
Node 24.21.0 and official Cedar 4.13.0 from retained complete/missing-WASM ASARs.
It observed permit, forbid, ask, required review, malformed-policy denial and
missing-WASM `cedar-unavailable`, with one frame and clean exit per case. R4 also
ran these six cases through the actual native capped ASAR facade, asserting each
exact decision, reason, policy-ID list, closed receipt and clean helper exit.
These qualify the retained fixture layouts and local resource path. They do not
establish application packaging, all opaque host policies, provider behavior or
production acceptance. The historical JavaScript/transport checks remain bound to
their unchanged R2 sources; historical mutants remain historical. The corrected
WASM asset length is 4,318,628 bytes. Three production layout builds each emitted
one CS0414 warning; fixture and mutant builds emitted zero warnings. The errata
correct the sealed packet's length and zero-warning summary without changing it.

Official semantics: [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects),
[extended committed-memory limits](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information),
[basic limits and periodic user-time checks](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information),
and [creation attributes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute).

Inherited-chain semantics also use [Nested Jobs](https://learn.microsoft.com/en-us/windows/win32/procthread/nested-jobs)
and [the immediate-Job NULL query contract](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-queryinformationjobobject).

## Integration provenance (2026-10-20)

The integration merges master `e94542f30ea4f13f597b17df4392feb8f79dc7b2`
into process-owner source `97f234e8740279121168cdef8d0c1dad99ea06a0`.
The thirteen implementation/project/test files are unchanged; this document is
updated for integration provenance. Of the eight historical preserved
dependencies, only `src/main/cedar-worker-client.js` changed on master,
through #1038. Its first candidate is retained until natural exit code 0;
subsequent invalid behavior, deadline expiration and cancellation deny. This
integration preserves that implementation and its real-worker regressions.

The process entrypoint imports `evaluateRequest` from `cedar-worker-thread.js`
directly and never imports `cedar-worker-client.js`. The seven unchanged
dependency files are `cedar-worker-thread.js`,
`cedar-runtime.js`, `cedar-schema.js`, `cedar-translator.js`,
`execution-policy.js`, `execution-binding.js` and `action-policy.js`, all under
`src/main/`. This includes the shared worker-thread validation/evaluation path.
This source comparison supports reusing the unchanged historical implementation
observations; it does not turn the old native receipts into current-runtime
qualification.

Master now declares Electron 44.8.0 and js-yaml 5.5.0. The R4 native and ASAR
observations above used Electron 44.7.2 / embedded Node 24.21.0 and Cedar 4.13.0;
they remain historical evidence for those retained fixture layouts. No native
matrix or ASAR qualification on Electron 44.8.0 is claimed by this integration.
The immediate-ambient and two-owned-Job observations do not prove every opaque
ancestor policy. The suspended helper-loss witness establishes termination of
that observed child, without supplying a missing helper closure receipt or a
universal parent-loss guarantee. Product packaging, activation, provider behavior
and full W5/W6 acceptance remain open.

The merged-input local check passed 62 tests across `policy-cedar-process`,
`cedar-worker-client` and `cedar-worker-thread`, including #1038's real-worker
regressions, with one concurrent worker. Scoped ESLint/Prettier and the derived
count gate passed. Node was 24.20.0; test setup confirmed Electron 44.8.0 ready.
These checks exercise JavaScript contracts and real worker threads; no native
helper or capped ASAR matrix was rerun. Required hosted CI remains the merge gate.
