# Current-candidate Windows object-read qualification

This lane exercises the new object-policy read path in a disposable, offline
Windows 11 Enterprise Evaluation x64 guest, build 26300.9457. It accepts only
100% display scaling: the actual application window must report 96 DPI and the
Electron display scale factor must equal one. It does not use the owner's
installed application, personal profile, credentials or host Windows session.

The `windows11-x64-native-reads` target of the installer lifecycle workflow
requires `candidate=build`. Its separate job creates a real isolated Git worktree
at the workflow SHA, installs locked dependencies, runs the object-admission
control/mutation gate, then produces a marked diagnostic package through
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

The probe requires the actual object event UUID to reach audit custody, the
sensitive alert journal, the separate object baseline, preload delivery and a
higher displayed score in the real Observatory roster. Each workload links its
own native binding to a consumed object event. The same actor must have zero
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
