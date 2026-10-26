# Current-candidate Windows object-read qualification

This lane exercises the new object-policy read path in a disposable, offline
Windows 11 Enterprise Evaluation x64 guest, build 26300.9457. It accepts only
100% display scaling: the actual application window must report 96 DPI and the
Electron display scale factor must equal one. It does not use the owner's
installed application, personal profile, credentials or host Windows session.

The `windows11-x64-native-reads` target of the installer lifecycle workflow
requires `candidate=build`. Its separate job creates a real isolated Git worktree
at the workflow SHA, installs locked dependencies, runs the single-pass
object-admission controls with no source mutations, then produces a marked diagnostic package through
`packaged-desktop.mjs --etw-build-only`. The package is unpublished and has the
diagnostic metadata marker. Its executable and native helper, archived source,
tracked runtime and harness inputs, lockfile, builder configuration and successful
build receipt remain bound by the existing reboot qualification contract.

Before creating a VM or downloading its image, the controller launches the exact
marked candidate briefly on the disposable runner with a fresh owned profile,
home, AppData and temporary directory. This ordinary launch passes no ETW root,
fault, observer or capture arguments. It shares the same package/window
observation helper as the guest scenarios, retains bounded boolean observations
before strict guards, and requires normal close with exit code zero. The window
remains bound to the same owned instance while a short bounded settling interval
confirms readiness and input isolation. A missing or contradictory condition is
a failure. Only the bounded receipt is uploaded; its private profile remains
outside the evidence tree. Host success does not establish guest DPI, native
capability, reboot recovery or read-to-alert/risk acceptance.

The complete `runtimeSourcesSha256` includes the tracked compiler-only declaration
`src/shared/instance-key.d.ts`. electron-builder's default declaration filter
omits that exact file from the package; the archive-byte claim therefore excludes
only this explicitly listed declaration. Its `src/shared/instance-key.js`
companion remains required and compared byte for byte with the archive. A changed
declaration changes the complete source binding. Missing or changed executable
JavaScript/JSON and any other missing declaration still fail qualification. This
exception grants no operational event authority and does not reuse an older
candidate's receipt chain.

The transfer contains actual Git objects and shallow boundaries, a bounded
native Git runtime, the same Node executable, the immutable candidate and the
resolved locked Playwright/ASAR dependency closure. It excludes Git configuration,
hooks, credentials and external object-store references. The guest reconstructs
the exact commit in a new bare repository and a real detached worktree; it checks
the commit, tree, cleanliness and package binding before native execution.

Git's actual `--exec-path` selects the native executable and its co-located DLL
directories, including both legacy and UCRT prefixes. The transfer contains the
native executable and compiled DLL dependencies, without installation configuration,
hooks or credential data. Shim-only layouts fail. Before any VM creation or ISO
download, build preparation runs the copied executable with a sterile PATH and
an owned empty exec path through version, bare initialization, object/shallow
reconstruction, ref update and actual worktree checkout. Native executable hashes,
the original native version, source tree, cleanliness and isolation must match.
The guest uses the same reconstruction module and verifies its bytes against the
reconstructed source. Host and guest receipts retain observed command counts;
neither phase inherits the original installation's PATH or Git configuration.
The maintained manifest consumer also verifies the actual generated bundle in
hosted Windows PowerShell 5.1 before VM creation, then verifies it again after
transfer. Both boundaries retain scalar path, root, size, SHA and no-link checks.

The shared portable-Git reconstruction environment disables optional locks for
each child process, avoiding the optional index refresh performed by status.
Only its cleanliness status command has a sixty-second deadline; the other
commands retain twenty seconds. The exact porcelain/untracked check, empty-output
requirement, identity, isolation and source-byte bindings remain unchanged, with
no retry. This bounded allowance does not establish the cause of a previous
cold-guest timeout or change later independent PowerShell Git checks.

Before recovery, a bounded read-only capability probe runs the unchanged helper
in the existing elevated PowerShell Direct setup session. It records the existing
token privileges and refuses an unqualified bridge without enabling privileges.
This early check cannot replace the later collector's own probe in its actual
interactive context.

The controller then runs `admission-preflight` in the same guest. It uses the
unchanged actual object-read probe and its complete oracle, with a fresh owned
profile and a distinct evidence directory. It must confirm ordinary process
closure and independent ETW session absence before recovery starts. A failure
enters the existing VM cleanup path. This earlier result gives direct feedback
on read-to-alert/risk behavior; it cannot satisfy the final post-reboot admission
receipt or replace recovery qualification.

The first Playwright connection in each newly provisioned guest has one 90-second
deadline. It is not retried or warmed up. The private receipt retains only the
closed launch phase, elapsed time, deadline, returned state and stable failure
code; paths, endpoint values, environment data and raw exception text are not
retained. All window, event, alert, risk and process-closure guards remain
unchanged after the connection returns.

Guest window DPI is queried through a metadata command on the already running
synthetic reader, rather than starting PowerShell and compiling another helper
at this boundary. The reader loads system User32 before its ready handshake.
For the requested window it checks existence and the expected owning process
before and after `GetDpiForWindow`. Electron then rechecks the same window,
native handle, process, visibility, input isolation, dimensions and scale factor.
Both native 96 DPI and Electron scale factor one remain mandatory. A missing,
malformed, zero or contradictory result refuses qualification; there is no
fallback or retry. The metadata command does not issue the fixture's workload
reads or satisfy any read, alert or risk oracle. It uses the existing bounded
reader transport and does not expose window identifiers in failure metadata.
Controlled local tests cover this flow without calling native window APIs;
actual guest behavior, including any later system-library I/O, remains subject
to a separately authorized qualification run and the unchanged read oracles.

Fresh profiles open in Advanced mode. Before reading the actor-specific
investigation roster, the probe uses the normal Settings flow to enable
`Simple interface`, opens `Investigate`, and waits for `Investigation workspace`.
Each transition has a ten-second limit. Only the owned guest profile preference
changes; the page is not reloaded and the existing probe is installed once.

The scanner identity wait retains a fixed, bounded condition projection before
its acceptance check. `identityWait` holds a capped sample count and only the last
snapshot: availability, population reliability, identity quality, pause state,
capped projected population size, and exact actor PID/source/birth match booleans.
No names, IDs, birth values, paths or raw scanner payloads enter this projection.
An OS source and full birth must match on the same actor row. The thirty-second
deadline and strict acceptance conditions remain unchanged. A missing sample is
unknown evidence; these diagnostics do not establish the cause of an older run
whose rejected snapshots were not retained.

The issuer-preparation wait retains a capped sample count and fixed first/latest
condition snapshots before cleanup. They distinguish capture phase, preparation
availability and an exact actor match, with closed ended-session metadata and
strict pending-cleanup flags. Raw diagnostic records, actor identifiers and
arbitrary error text are excluded. A failed, stopped or recovered capture refuses
preparation immediately only when both cleanup flags are explicitly false and a
validated latest ended-session summary matches that phase. A starting, unknown
or pending-cleanup state keeps polling within the existing thirty-second budget.
Success still requires a running capture and
one prepared entry matching both actor PID and full birth. This fixes lost
failure context and waiting after a confirmed end; it does not establish the
cause of a historical native exit or qualify native reads, alerts or risk.

After issuer preparation, the probe checks operational object admission before
reserving the cohort or issuing a read. This aggregate requires an unrevoked
scope, active and continuous capture, and the exact object-bridge profile. Its
fixed boolean diagnostics distinguish those conditions and the underlying
telemetry, query, native-loss, collector-drop, decoder, mapping and sticky-fault
conditions. The first revocation cause and its detached condition snapshot are
retained until the existing fresh-session boundary, so a later healthy sample
or cleanup cannot replace the original refusal context. Identifiers, raw
counters, profile strings and arbitrary errors are excluded from this metadata.
The scenario retains a validated, immutable copy before its immediate strict
admission check and reports a closed operational refusal code. Missing or
malformed diagnostic contracts and inconsistent aggregate or first-revocation
metadata fail closed. The twelve detail flags do not replace the original
aggregate continuity decision. No extra polling, retry, automatic restart
or revocation reset is introduced; clock and event-time checks remain in the
later read oracle. A false aggregate is not a diagnosis of ABI or OS failure.

After normal process closure, audit custody is checked against the canonical
on-disk envelope: type, actor PID/instance, empty access path, and the event and
binding IDs stored under `details`. Exactly one matching row is required. The
private receipt records only owned-row and matching-row counts; raw audit files
and the guest profile remain excluded from upload.

Before each guest driver, desktop preparation validates the exact disposable
guest and normal token, the active Default desktop, absence of consent UI, and
the signed same-session Start/Search or desktop foreground witness. Search may
receive up to three Escape down/up pairs within the existing ten-second total
budget. The first two attempts observe for a one-second interval before another
fully revalidated attempt; the final attempt keeps the remaining budget. Start
retains its single-attempt behavior. A missing foreground is unknown and grants
neither closure nor input authority. Scope, consent, desktop and full foreground
identity are checked again before every input. No forced activation, process
termination, policy change or unverified input target is used.

Each dismissal record counts one submitted pair. `closedObserved` means that
the pinned overlay witness later disappeared in a validated foreground sample;
it does not attribute closure to that particular Escape. Pending records for
the same witness become closed only after that observation. READY still needs
a fresh verified desktop sample; partial input or an overlay that persists
through the budget remains a failure. Local callback fixtures verify this
control flow without native desktop or keyboard execution. They do not establish
why an earlier Windows overlay persisted or qualify a subsequent guest run.

Desktop receipts also retain `windowVisibility`: a sample count capped at 512
and only the first and latest sanitized observations. The fixed eight fields
describe window existence, style visibility, known/cloaked state, known/non-empty
bounds, monitor intersection and later foreground-handle equality. Failed or
missing queries remain unknown; paired known flags are false and their values
are null. Every completed read is recorded before later refusal checks,
including the native dismissal's immediate owner revalidation. A read that never
returns adds no sample. Existing dismissal records keep their five-field shape.

These are read-only observations after the exact guest/environment guards.
Style visibility does not prove unobscured pixels; monitor intersection can use
a minimized window's earlier bounds; matching foreground handles is a sampled
comparison rather than an atomic identity guarantee. No titles, handles, PIDs,
paths, coordinates, error text or observation history enter this projection.
The projection never authorizes readiness, closure or input. It remains inside
the existing 4096-byte desktop receipt bound. Local fixtures and compilation
without native calls verify its collection and integration.

A verified Search foreground with known DWM cloaking is excluded from Escape.
The decision loop waits read-only within the existing ten-second budget for a
fresh, independently verified foreground. Cloaking alone never proves closure
or desktop readiness. The native dismissal revalidates this exclusion before
input. Unknown or uncloaked Search, style visibility alone, Start behavior and
the three-action limit retain their existing rules. A persistent cloaked Search
still causes refusal; no focus change or activation is attempted. Local mocked
observations verify this policy, while its actual guest behavior requires a
separately authorized qualification run.

Recovery uses the existing `etw-reboot.mjs` prepare/resume drivers. A limited
interactive task must produce a valid PREPARED receipt before the controller
requests Windows Restart inside the exact owned VM. A fresh later boot is
observed before resume. The guest gets two bounded lab logons; after restart its
autologon password/count are removed and automatic logon is disabled. Each phase
uses fresh explicit consent through the verified Microsoft consent process and
the exact guest's keyboard, while UAC policies remain enabled. The ordinary
installer lanes and their capture scopes are unchanged.

Each phase task must be fresh. The controller observes a new run and repeated,
stable terminal state/result samples before reporting a task that ended without
its required receipt; queued and pending scheduler results cannot satisfy this
condition. Bounded progress messages identify the current phase and elapsed
time. These checks reduce failure-reporting latency while retaining the existing
phase deadlines, receipt requirements and exact cleanup rules.

The durable setup driver observes app/helper process ownership through one
asynchronous, read-only Windows process snapshot. It projects only the owned
roots and bounded descendant graph before returning data. The operation has a
single thirty-second budget, bounded output and strict validation; timeout,
denial or malformed observations remain failures rather than an empty process
population. Existing process-exit and session-absence oracles remain required.

Only after recovery PASS does the final object-read probe start. It uses the maintained
native synchronous/asynchronous reader, discovered as Aider by the real process
scanner, with an independent PID, issuing thread, full process birth, QPC interval
and pending-I/O witness. This actor is synthetic; the result does not establish
an installed agent's integration. The first read primes a retained object;
subsequent reads in the same handle lifetime require the pre-read policy ACK and
the later zero-loss telemetry watermark.

The reader transport retains its twelve-second response deadline, sixteen-KiB
combined lifetime output budget and eight-frame queue ceiling. It counts raw
stream bytes before retaining a partial line, owns one expected response at a
time, and refuses malformed, unsolicited or unavailable responses with a closed
metadata snapshot captured before cleanup. Cleanup still requires exit zero and
drained child streams within one ten-second deadline. These local transport
controls do not identify the cause of an earlier guest refusal or prove native
read, alert or risk acceptance.

The probe requires the actual object event UUID to reach audit custody, the
sensitive alert journal, the separate object baseline, preload delivery and a
higher displayed score for the selected worker in Observatory. Before and after
reading that score, the marked main projection must contain exactly one Aider
with the fixture's PID, instance key and full process birth in a reliable,
unpaused population. The visible worker selection and PID must match that actor,
and its displayed state must be current. An additional Aider, capped population,
changed generation or unavailable selection refuses qualification; a grouped
maximum cannot supply the risk witness. Each workload links its own native
binding to a consumed object event. The same actor must have zero
retained path observations and zero competing legacy file deliveries during the
probe, so an unrelated file alert cannot satisfy the risk check. Labels describe
the bound object; the access pathname remains unobserved. Raw kernel addresses
and raw filesystem identifiers are excluded from public event/alert projections.

The read-only native observer retains the original main/broker/collector/guard/
fallback process objects and observes their zero exit codes, plus the custodian's
zero exit. The separate consent host must report exactly one collector launch,
one zero child exit and no live children. Normal stop and independent session
absence are also required. Missing, contradictory or unknown evidence fails the
lane. Diagnostic marker differences and synthetic workload limits remain in the
private receipts; this lane does not authorize a release or complete the wider
Windows process-event workstream.

The object probe explicitly selects the maintained fixture's
`deny-delete-share` mode and records its source digest. The default sharing mode
used by existing recovery scenarios remains unchanged. After the real read
evidence and displayed risk are captured, the issuer exits with code zero while
capture continues. A bounded native rename probe then measures the owned `.env`
file's release, retrying only Windows sharing/lock violations for at most fifteen
seconds. Its first actual result and elapsed time are retained. Immediate success
is reported as no observed delay; it cannot establish that a lock delay occurred.
This control does not establish bounds for every filesystem driver or metadata
operation.

Source preparation and syntax inspection do not constitute execution. The first
successful current-source cloud receipt is required before claiming native
acceptance. Unsupported ABI/profile probes, lost events, mapping resets, stale
identity, incomplete custody, unconfirmed cleanup or stuck metadata operations
must remain failures or explicit unqualified boundaries.

Input staging is bounded to 30,000 files/1,800 MiB and a compressed bundle of at
most 1 GiB. Commands and receipts use the existing bounded runners. At most four
setup captures and twelve consent captures leave the guest controller. Evidence
upload is limited to 100 files/32 MiB with seven-day retention. Profiles, fixture
contents, answer media and lab passwords are excluded from upload. The controller
records disk samples and confirms the owned VM is off and removed before deleting
its exact disposable disk/media leaves. Remaining task storage is scoped to the
ephemeral hosted runner.
