# Retained caller/enrollment composition — 2026-10-09

Status: inactive internal controller primitive. This composes the existing
[prepared caller](supervisor-caller-deferred-release-contract-20261009.md),
retained enrollment lease and native caller endpoint. Protected operator/main/
broker registration, protected bootstrap delivery, runtime provenance and
production activation remain incomplete. Program, IPC, protocol and launch flags
are unchanged. This grants no full E1.2/E1.5/A1 or protected launch acceptance.

## Ownership and setup

CallerSession.Prepare takes a trusted-code enrollment root, expected image size/
hash and session label. It prepares root/aegis-session.exe suspended, acquires
EnrollmentLease from that instance's private held process/Job, and creates
CallerEndpoint using the same instance's existing registration and held process.
The lease independently duplicates those exact process/Job handles and observes
their actual PID/birth, primary token, Job membership and matching process image.
Its separate internal registration has independent generation/session labels;
those labels are never equated to endpoint registration or delivered as routing.

The returned owner retains the launcher, lease and endpoint through setup.
Routing contains only the endpoint locator and the launcher's session/generation
labels. No raw Job, lease, endpoint, registration or child owner is returned by
this composition. These labels convey no bootstrap, operator or installation
authority. The caller must supply separately qualified trusted setup/delivery
before using this primitive in a protected controller.

Partial acquisition failure closes every acquired resource and reaches the
launcher's existing confirmed owned stop. A failed prepare returns no owner.
Optional composition factories are defined in the CallerSession compilation unit
as partial launcher/instance methods; standalone launcher fixture/compiler input
lists remain unchanged. The production session compiler explicitly includes this
unit. Test-only file observation injection is guarded by ENROLLMENT_LEASE_TEST
and is absent from the production methods.

## Release, admission and revocation

Release admits one attempt while prepared. Under the composition gate it checks
current enrollment, launcher identity/image/Job/thread context and live owned
endpoint, then delegates to the existing launcher release, which rechecks its
fences and requires exactly the initial suspension. The first failed attempt
terminally closes ownership. A repeated release refuses without another native
resume and leaves a successfully released child owned until cleanup.

Accept is permitted once after release. It checks retained ownership before and
after the endpoint's existing native caller authentication, checks the returned
native context, and returns a nonserializable composed Context. Any admission
failure, including wrong phase, deadline or repeated admission, terminally closes
ownership. This dispatches no operation and grants no effect from received bytes.

Context.CheckCurrent holds the composition gate throughout its owner/enrollment/
launcher/endpoint checks and the native pipe-context fence. Owner revocation,
metadata/identity loss, token/peer change, disconnect, extra input or expired
native context refuses and closes all retained ownership. RequestId remains a
routing label; obtaining it does not substitute for CheckCurrent.

Revoke/Dispose deny future release/admission, close endpoint and lease, and
always reach child disposal even if earlier closure throws. Child disposal uses
the existing independently queried root-exit and Job-empty requirements. Closure
failure remains terminal and throws caller-session-cleanup-unconfirmed on later
disposal; it does not certify stopped state or permit reuse.

Lock order is composition gate, then each existing inner owner in turn. Launcher
factory/current/release methods take instance before its registration; endpoint
methods take endpoint before peer registration. Lease checks take lease and its
separate retained owner. No inner owner calls back into the composition, and no
caller holds two different inner-owner gates across separate checks. Before
publication, prepare owns a private unshared object and acquires the resources
without an externally reachable composition gate.

The composition serializes its own checks, dispatch of initial resume and revoke.
It does not make OS metadata/token queries and ResumeThread one atomic operation,
protect against hostile process/handle access or qualify the remaining external
check-to-effect gaps. Existing synchronous native calls are not cancelled by
their post-call observation budgets. Admission can hold the composition gate
through the endpoint's connection/read budgets; concurrent revocation waits for
that call to settle. Existing two-second lease/context/connection/read and owned
stop budgets are unchanged. No dispatcher, recovery or immediate UI control slot
is implemented here.

## Native fixture scope

The behavioral baseline uses the separate existing Prepare, EnrollmentLease and
endpoint primitives. An actual applied enrollment-root Hidden-attribute change
makes the retained lease refuse, while a manually unfenced launcher release
still creates the actual payload marker. This demonstrates the missing composed
fence; it does not violate the old standalone launcher contract. Baseline source,
binary, observation and failing assertion are retained before implementation.

The dedicated fixture uses actual suspended child/process/token/Job/image pins,
native file opens/identities/reads/metadata rechecks, a native local pipe, actual
client/server process verification and impersonation authentication. Only
protected-descriptor acceptance is modeled through the existing test-only file
seam. A separate fixture compiled without ENROLLMENT_LEASE_TEST executes the
real production Acquire path, observes absent injection methods and must refuse
the ordinary root.
No account, installed service, file ACL, VM, external network or host setting is
provisioned. The existing disposable pipe creation primitive retains its own DACL.

Fixture-only setup is a plaintext setup.txt in an owned disposable control
directory outside the pinned enrollment root. Its locator/session/generation and
parent PID are routing labels selected by fixture code. The child locates and
holds that parent only for this controlled client/server test. The control path
and mode arrive through inherited fixture environment variables. None of this
qualifies protected bootstrap delivery, secret delivery or production authority.
The trusted child creates root/descendant/frame markers outside enrollment.
Closed-writer canonical PID polling uses the existing sharing-race correction.

Controls independently observe suspension, no marker before release, held image/
record pins, correct post-release marker and authenticated child frame, then root
exit, retained Job empty and descendant exit after cleanup. Negative controls
cover applied root metadata before release and after returned admission, native
endpoint closure, cancellation, missing record, strict real-root refusal,
premature/deadline admission and duplicate release. A bounded check/revoke barrier
observes serialization and refusal of the returned context after revocation.
These are local same-principal controls with explicitly modeled descriptor
acceptance; they do not provide protected E1 qualification.

The frozen worker baseline has one behavioral failure on payload=true after
the applied metadata change and independent confirmed stop. The final dedicated
suite passes eleven controls; unchanged launcher/endpoint/lease neighbors pass
59 controls in three files, without skips. The fixture compiles optimized x64
variants with warnings as errors and the existing 65,536-byte bound, including
a no-test-injection variant. The actual production session helper builds with the
maintained flags at 61,952 bytes, SHA256
5f79b3d8b5e5b51ad16b53b64031adeb4fae2f78bda0ff7a01c6d0fdd0517a6d.
Other sidecars also build. Full repository coverage and independent final review
are scheduled separately by the root; these focused results do not replace them.

| Evidence | Bounded command receipt |
| --- | --- |
| Behavioral baseline | 2026-10-09T08-19-32-001Z-caller-composition-baseline.json |
| Final dedicated native controls | 2026-10-09T08-34-21-422Z-caller-composition-final.json |
| Native neighbors | 2026-10-09T08-34-57-073Z-caller-composition-adjacent.json |
| Actual production sidecar build | 2026-10-09T08-34-55-269Z-caller-composition-build.json |

Source-bound packets and receipts are under
X:/tmp/aegis-caller-composition-20261009-evidence/caller-worker. Focused commands
use named X-drive TEMP/TMP and the existing eight-MiB log cap. Closed disposable
caller-composition diagnostic directories receive manual review after seven days
or above 32 MiB, with locked files/reparse points skipped. Frozen packets, native
observations, hashes, verification receipts and previous failures remain retained.
This is a finite retention policy, not automatic rotation or growth prevention.
