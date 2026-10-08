# Cloud Hyper-V execution evidence — 2026-10-07

The disposable GitHub-hosted Windows Server 2025 runner performed actual VM
operations. The earlier read-only provider observation is now complemented by
executed PowerShell and native C# lifecycle paths.

| Run | Source revision | Actual observation |
| --- | --- | --- |
| [PowerShell lifecycle](https://github.com/antropos17/Aegis/actions/runs/37656883851) | `212b6636d047cdf2d1e62cc179691754f6b04bb9` | Create, start, independent Running observation, stop, independent Off observation, exact-ID removal and absence; 20.082 seconds |
| [Native WMI lifecycle](https://github.com/antropos17/Aegis/actions/runs/37660475538) | `70389b5287b3527ee1bdc24bd36f45392cc45637` | Native start and stop both returned 4096 with captured management jobs; both settled before independently confirmed Off, removal and absence; 19.391 seconds |

Each run owned one fresh Generation 2 VM with fixed 512 MiB memory, one vCPU,
zero disks and zero network adapters. These two runs did not boot a guest OS.
The native receipt records the verified success path, source/compiler/binary
hashes and operation summaries; it does not retain every raw WMI poll.
Independent review matched the receipt's input hashes against its immutable Git
revision and accepted these scoped observations.
The [receipt index](evidence/20261007/index.json) preserves downloaded JSON bytes,
their SHA-256 hashes, source revisions and run links, including failed attempts.
Repository attributes preserve these evidence bytes and the pinned public Claude
provenance inputs without newline conversion.

`OwnedVmLifecycle` keeps an unresolved operation before submitting a provider
mutation. Return code 4096 requires polling the returned exact local management
job; successful settlement and a separate VM-state observation are required.
Unknown provider outcomes prevent conflicting stop/removal operations. The
lifecycle owner is volatile and created by trusted fixture code; a VM GUID does
not establish protected production ownership or durable recovery authority.

## Repeatable cloud lab

The manual `enforcement-native-qualification.yml` workflow provides distinct
`native-fixtures`, `cloud-hyperv`, `cloud-hyperv-native` and `cloud-windows11` modes.
Only the selected job runs. The Windows 11 lab uses Windows PowerShell 5.1 and a
fresh fixed run-specific root on the runner's data disk. The local entrypoint
refuses ordinary development hosts.

The guest lab pins Microsoft's Enterprise Evaluation 26H2 amd64 ISO to
8,225,329,152 bytes and SHA-256
`bc3f24086ebadc94489066b5ad78089e2cf5c3491e90e790bb81a2b199c10e38`,
verified before mounting the read-only installation ISO. The source is the
[Microsoft evaluation download](https://www.microsoft.com/en-us/evalcenter/download-windows-11-enterprise)
and its [published authenticity check](https://support.microsoft.com/en-us/servicing/os/windows/docs/2026/09/verify-the-authenticity-of-a-windows-11-enterprise-evaluation-iso-file).
The host never mounts the guest VHD. Windows Setup partitions and installs the
fresh disk inside the VM using a separate answer DVD.

The initial guest attempt at `7dbd688e` stopped during host source verification,
before downloading media or creating a VM. Windows PowerShell 5.1 returned a
null `Start-Process` exit code despite Git producing the correct HEAD. A local
before/after reproduction covered Git output and real native exits 0 and 7.
The first repair acquired the process handle before waiting; a later hosted run
showed that this still missed a short-process startup race, described below.

Two subsequent guest attempts retained their failures and cleanup observations:

| Run | Source revision | Observation |
| --- | --- | --- |
| [VM name scope failure](https://github.com/antropos17/Aegis/actions/runs/37663627029) | `5f848ee87badc8f520b8c85608e630e5363ea901` | Published ISO hash and exact WIM metadata passed; the stage label shadowed the VM name before creation. Renaming the stage parameter fixes the reproduced PowerShell scope defect. |
| [Firmware keyboard failure](https://github.com/antropos17/Aegis/actions/runs/37664454992) | `46031fa0bd19baaf68e892f4c1ae0ea0a9f8f3c4` | Created and started the intended Gen2 VM with 4 GiB RAM, two vCPUs, a 64 GiB virtual disk, Secure Boot, vTPM and zero NICs. The keyboard call failed; native stop settled, Off was observed and the exact VM was removed. The original keyboard error cause was not identified. |

The keyboard revision `91226373793c9ca48c3f26c95f44d7708e7a1908`
records bounded provider diagnostics and treats only the initial fixed Setup key
window as optional. Every key requires a current exact-VM Running observation and
one matching local keyboard device. Uncertain keyboard dispatch prevents further
keys; exact guest OS/profile readiness and the useful task remain mandatory.
Independent review passed 19 PowerShell controls; ten compiled pure keyboard
controls cover query/identity/return handling without invoking the provider.

The [next guest run](https://github.com/antropos17/Aegis/actions/runs/37666683151)
at that revision reached the media-detachment gate after PowerShell Direct,
Windows 11 EnterpriseEval build 26300.9457, setup-profile, disk and transferred-file
hash checks. Five of six fixed key attempts completed; the final keyboard return
was zero. These guest checks are established by the verified failure path; this
receipt did not retain a separate guest observation. The run failed at
`answer-dvd-ejection-unconfirmed` before invoking the standard-user bootstrap.
Native stop, Off, exact VM removal and unchanged host canaries were confirmed.

Revision `73bdaa2563109a8fc29ade99ed6f3e85368478cc` removes the two owned DVD
devices and obtains a fresh exact-VM inventory before releasing the task. Unknown
device mutations or lost worker results prevent conflicting cleanup. Structured
guest readiness and failure phases now survive subsequent errors. Thirty-three
PowerShell controls passed independently; the affected native launcher compiled
with warnings as errors and three pure controls verified child-exit-code handling.
The real DVD change requires its own completed cloud observation.

The [retry at 73bdaa25](https://github.com/antropos17/Aegis/actions/runs/37669955669)
stopped before downloading an ISO or creating a VM: the original PowerShell
`Start-Process` path again produced no observed exit code for Git. Retaining a
handle after that command returned had not fully resolved short-process startup.
Revision `e8342e2b0057c953ede2fb6eee50b11ebb3df510` creates the process directly
through .NET, retains its creation handle, and drains both output pipes with
separate 64 KiB limits and a deadline. Independent PowerShell verification passed
45 controls, including 15 real native cases; the actual compiler call also passed.
One local comparison did not reproduce the old hosted failure, which remains
preserved in its original receipt.

The [run at e8342e2b](https://github.com/antropos17/Aegis/actions/runs/37672123338)
passed real host source verification, compilation, pinned media checks and VM
creation/start. No PowerShell Direct session was established within the bounded
guest-readiness wait. Its structured progress records no completed guest profile,
OS, transfer or task check. Native stop settled, Off and exact removal were
confirmed, and the host canaries were unchanged after removal. Independent review
matched all thirteen source hashes. Successful keyboard delivery does not establish
that the firmware consumed a key at its boot prompt; the failure cause is unknown.

The subsequent diagnostic change permits an initial key-dispatch window of at
most sixty seconds and sixty attempts. It retains at most two early 320 × 240
RGB565 display observations, bound to the exact VM and realized settings, and
closes capture before any credential-bearing session attempt. Readiness samples
also record the exact owned VHD's file size without mounting it. Keyboard WMI timeout
requests are clipped to the remaining window; they do not prove provider
cancellation or a hard operating-system return deadline. Independent host and
guest observations remain necessary to establish boot and task completion.

Task failures now retain a fixed stage, observed numeric exit and native closure
observations. Child output is read only after confirmed Job closure and is parsed
against the fixed task's bounded result shape. Native failure, unknown exit or
closure, malformed results and changed administrator canaries force failure even
when child JSON claims success. Independent review reproduced and then verified
the repair of a duplicate-control acceptance defect: a successful report requires
the four distinct protected-file controls and both complete seven-case host-path
probe groups. These parser checks do not make guest-written observations trusted
host evidence.

The [run at 55cf6b59](https://github.com/antropos17/Aegis/actions/runs/37679061829)
passed host preparation and native start, then stopped at the seventeenth key
attempt after the combined VM-name/Running guard failed. The receipt does not
retain the failing VM name or numeric state, so it cannot establish the cause or
prove a transient reboot. Both earlier thumbnail calls returned zero but failed
the exact pixel-size check; no image was retained. Guest setup was not attempted.
Native stop, independent Off, exact removal and unchanged host canaries after
removal were confirmed. All five required CI contexts passed this revision.

The next repair separates the exact local VM identity from its typed numeric
state. An observed non-Running state on that same VM stops further optional key
dispatch when no native operation is pending; independent PowerShell Direct
readiness is still required. Missing, foreign or malformed VM observations during
keyboard admission remain fatal. Thumbnail failures retain only fixed data-type categories, array shape and
requested dimensions; the exact RGB565 byte-count requirement is unchanged.

The [run at 2b4eb387](https://github.com/antropos17/Aegis/actions/runs/37681388752)
established a PowerShell Direct session, the setup profile and Windows 11
EnterpriseEval build 26300.9457. Transferred files matched their hashes, and fresh
exact-VM observations confirmed both installation DVDs were removed before the
bootstrap call. That remote call failed without returning a guest task receipt.
Its submission flag records the call boundary; it does not establish bootstrap
entry or standard-user process creation. The exception cause is unknown. Native
stop, Off, exact removal and unchanged host canaries after removal were confirmed.
All fourteen source hashes matched the committed revision, whose five required
CI contexts passed. Both thumbnails contained 153604 bytes and were refused by
the strict 153600-byte check; no interpretation of the extra bytes is assumed.

The [run at 430b9d29](https://github.com/antropos17/Aegis/actions/runs/37684569298)
again established the exact Windows build, profile, PowerShell Direct, transferred
hashes and fresh removal of both DVDs. The fixed, hash-verified bootstrap returned
under the unchanged Restricted execution policy. Its native launcher refused at
`held-token-admin` with `SecurityException` HRESULT `0x8013150A`, before task
release. Job closure was not confirmed; later VM removal does not establish that
earlier observation. Independent host canaries after the task attempt and removal,
native stop, Off and exact removal passed. Astra matched all fourteen source
hashes; all five required CI contexts passed this revision.

A local native reproduction explains the membership-check failure: the .NET
`WindowsPrincipal` check duplicates a primary token, while the launcher requested
query access alone. Requesting query and duplicate access permits that check
without changing privileges. The SID, nonadministrator and elevation guards remain
mandatory. Four current-process controls reproduce the old exception, compare
the corrected membership observation and refuse invalid or closed process handles.
The combined maintained entrypoint passes the preceding 151 controls and these
four controls. Actual standard-user task completion requires the cloud retry.

The [run at e5093a3e](https://github.com/antropos17/Aegis/actions/runs/37687929852)
confirmed the token repair on the dedicated guest account: its held SID matched
the expected account, enabled administrator membership and elevation were false,
and image, birth and the one-member initial Job passed before release. Independent
review matched all fourteen immutable source hashes and accepted the narrow E1.3
provisioning item. The useful task did not run successfully: Node exited with
`0xC0000142` and produced no result. The receipt confirms actual Job closure,
native stop, independent VM Off/removal and unchanged host canaries both after
the task attempt and removal. CI passed all five contexts on that revision.
The loader failure's cause requires separate investigation; this result does not
qualify initialized runtime, useful task or the complete guest boundary.

The combined runtime revision resumes only a fixed trusted Node bootstrap. An
OS-authenticated pipe client reports readiness after core-module and event-loop
initialization; the owner rechecks the retained PID, birth time, image and original
Job inventory before writing the fixed release acknowledgement. A separately
owned administrator receiver starts after runtime admission and before project
release. Its held identity, outside-task-Job membership, bounded output and final
exit are checked independently of the task-written result.

Ten guest-local loopback calibrations cover IPv4/IPv6 TCP, UDP, private DNS,
OS localhost lookup and persistent TCP exchanges. The receiver must report exact
counts and clean stream endings and must close after task Job closure within its
deadline. Missing readiness, native identity, receiver or cleanup observations
force failure. These positives do not qualify direct-egress denial, foreign host
integration routes or full E3. Independent review passed 148 focused controls;
integration additionally passed the maintained entrypoint, twelve task-source
controls and lint. Actual combined guest observations require a separate run.

The first [combined run at 35da8749](https://github.com/antropos17/Aegis/actions/runs/37688899156)
stopped at the pinned image-download stage with `TaskCanceledException` after the
ten-minute budget. No VM was created and no guest task or network check ran;
operation settlement remained `not-submitted`. This receipt does not diagnose
the network's cause or validate the combined guest path. CI passed all five
required contexts on the same source revision.

The next loader repair creates a fresh private window station and desktop with
an explicit task-SID access list, restores the parent's station before launch,
and retains its handles through confirmed task Job closure. It does not change
an inherited desktop's permissions. A bounded owner-side `node --version`
positive separates basic image loading from the standard-user launch. Missing
creation, restoration, owner-positive or post-Job handle-closure observations
prevent success. Actual local controls reproduce `0xC0000142` on a newly denied
desktop and exit zero on a newly allowed one; the cloud failure's cause still
requires a source-bound guest run. The local nonadministrator could not create
a named station, so that check remains explicitly unavailable locally.

Independent review caught and corrected a fixture-only local working-directory
assumption before cloud dispatch. The maintained entrypoint then passed with
native warnings treated as errors, 62 diagnostic assertions, 51 network controls,
three actual desktop controls and the existing bootstrap/token/runtime checks.
Twelve task-source cases also passed. Host Node discovery now selects one exact
application from PATH before inspecting and hashing it, avoiding an array error
when multiple installations are present. These local results do not replace the
cross-principal cloud run.

The [private-desktop revision run](https://github.com/antropos17/Aegis/actions/runs/37692352150)
at `571c8843` completed Windows setup, profile readiness, hash-checked transfer
and removal of both installation DVDs. Its new owner-side Node positive refused
before desktop creation, standard-user process creation or runtime admission.
The receipt records no owner exit observation and only a generic failure HResult;
it cannot establish whether the three-second probe deadline or another condition
caused the refusal. Native stop, independent Off, exact VM removal and both host
canaries passed. Independent review matched all 25 source hashes, and all five
CI contexts passed that source. This run supplies no cross-principal desktop or
useful-task acceptance.

The next candidate adds bounded owner-probe diagnostics with a separate
15-second cold-start budget before either receiver starts. The guest loopback
receiver's 17.5/18-second fences remain unchanged. Independent host-side TCP,
UDP and private-DNS receivers require successful host positives, exact VM
identity and zero adapters before and after guest attempts. A pinned MinGit
archive supplies a fixed thirteen-command scratch workflow after those probes;
its configuration, hooks, templates, transports and helpers are constrained.
Guest helper loading verifies the retained bytes before executing them under
the unchanged PowerShell policy.

Separate controls passed 24 task cases, 42 archive cases, three actual local Git
workflows and four owner-probe cases. The integrated local Windows preflight
stopped at `native-process-deadline`; it is incomplete. The cloud workflow must
pass that complete entrypoint before creating its VM. These local results do
not establish actual guest Git or host-route denial.

The [combined run at 73d19f0a](https://github.com/antropos17/Aegis/actions/runs/37695888853)
passed the complete hosted preflight, installed Windows, verified transferred
hashes and detached both DVDs. The new host-route ownership guard then refused
before task submission. The generic refusal does not identify its failing
predicate; the route guard requires an exact configuration-root match while the
existing creation/configuration path permits provider-created child directories.
No owner-Node, desktop, task, guest route or Git observation was produced. Native
stop, independent Off/removal and post-removal host canaries passed; the separate
after-task canary check was not reached. Independent review matched 33 source
hashes and the pinned Git archive. All five CI contexts passed `a5ae2e30`, whose
only delta removes an unused test variable without changing runtime code.

The [owned-configuration revision run](https://github.com/antropos17/Aegis/actions/runs/37698380607)
at `979dc3e0` passed the complete hosted preflight and all five CI contexts.
It observed the exact owned VM under its provider-created configuration child
directory, Running with zero adapters, before and after the route attempt.
The owner Node positive exited zero in 2,671 milliseconds. Private desktop
creation and parent-station restoration passed. Host-side IPv4 TCP, UDP and
private-DNS positives were observed; IPv6 was unavailable.

The native launcher refused at `held-token-open`, after Job assignment and before
SID observation, runtime resume or project release. That stage includes both
`OpenHeldToken` and `WindowsIdentity` construction, so the generic HResult does
not identify the failed operation. Early cleanup could not confirm Job closure
because the inventory had not yet been constructed. The outer Git refusal label
masked this earlier native failure; no guest route, Git or useful-task result
was produced. Zero guest packets therefore supply no denial qualification.
The host receiver closed through its input-close refusal path after about
45 seconds; its `expired` field does not prove the 120-second timer fired.
Native Off, exact VM removal and post-removal host canaries passed. The after-task
canary check was not reached. Independent review verified all 33 source hashes
and the pinned Git archive. This receipt adds observations without changing any
full enforcement acceptance gate.

The [split-token-diagnostics run](https://github.com/antropos17/Aegis/actions/runs/37702024365)
at `577cc431` passed the complete hosted preflight and all five CI contexts.
Its distinct `held-token-open` stage records `OpenProcessToken` returning false
with Win32 error 5 for requested access 10 (`QUERY | DUPLICATE`). The retained
process was still live and suspended; token construction was not reached.
This establishes access denial for the combined request without identifying
which requested right or token security condition caused it.

The repaired early cleanup independently observed retained-root exit 137, zero
active members before and after an empty Job query, stable Job totals and private
desktop closure. The host receiver stopped after Job closure and exited zero
without force or expiry. Native Off, exact VM removal and post-removal host
canaries also passed. The bootstrap retained the native cause and marked task,
network and Git checks not-run. A subsequent host-controller attempt to read the
unwritten route result produced a generic outer failure; it supplied no guest
route observation. The after-task canary check was not reached. Independent
review matched all 33 source hashes. These cleanup observations add no useful-task
or full-boundary acceptance.

## Fixed Claude second phase

The [first integrated Claude revision run](https://github.com/antropos17/Aegis/actions/runs/37704784399)
at `a7aa59f4` passed the full hosted preflight and all five CI contexts. The
pinned Windows image download, hash and WIM metadata passed. Runtime staging
then failed with a PowerShell `PropertyNotFoundException` before VM creation.
No cross-account token, guest task, Git or Claude result was observed in this run.
The original receipt is retained; failure does not establish successful cleanup
of a VM that was never created.

The verifier's ancestor traversal was then reproduced through the actual captured
ScriptBlock call under Windows PowerShell 5.1 with inherited StrictMode. A raw
`DirectoryInfo` returned by `Parent` or `Directory` lacks the provider-added
`PSIsContainer` property. Typed `FileInfo`/`DirectoryInfo` traversal preserves
the ancestor checks. Five focused controls passed, including the original
failure and refusal of reparse points and a changed source pin. The repaired
verifier also checked the actual installed pinned Claude binary, public signed
metadata and Authenticode under the same strict shell without downloading or
launching Claude. The cloud receipt itself does not identify an exception line;
the next actual run must establish whether staging now completes.

The [strict-provenance revision run](https://github.com/antropos17/Aegis/actions/runs/37706481144)
at `c83ca8e5` passed hosted preflight and all five CI contexts. It downloaded
the pinned Claude binary and verified its signed manifest, exact hash and
Authenticode on the hosted runner. Actual Windows installation, profile readiness
and PowerShell Direct then passed. Guest transfer validation refused the manifest
before task submission; no new token or project execution occurred. Independent
review matched all 47 source hashes. Native Off, exact VM removal and post-removal
host canaries passed. The receipt does not identify the rejected filename.

Independent review accepted the narrow E6.5 version/scope bookkeeping item:
the exact installed Claude baseline and public artifact provenance are recorded,
local dummy-credential API tests are identified, and real-provider authentication
and online execution remain explicitly unrun. This does not accept guest CLI
execution, useful-task completion or full E6.

This revision requests only `TOKEN_QUERY` and reads native
`TOKEN_GROUPS` through a bounded parser. Any Administrators SID, including a
disabled or deny-only entry, causes refusal. It retains the exact SID, elevation,
held process, Job, desktop and initialized-runtime checks. Twenty local token
controls and eleven native cleanup controls passed; these same-principal checks
do not establish access to the dedicated guest user's token.

The host controller also preserves the earliest native failure after stopping
its receiver and observing the exact VM again. It reads route results only after
a typed positive project-release observation. Fifty-six pure PowerShell controls
cover the bootstrap and connected host-controller path; actual guest observations
remain source-bound to the next cloud run.

The lab includes a separate Claude corpus after the first task and
both of its receivers have exited with verified native observations. It pins
Claude Code 2.1.292 for Windows x64 to 254,858,400 bytes and SHA-256
`eb95bb65955f8b1702e800815f9a2c0388a5de0f196c354c7ee1dd5cb9a2ba23`.
The hosted runner verifies the signed public manifest and Authenticode before
transferring the binary. A fresh guest work directory and separate Job reuse the
held identity and initialized-runtime admission checks. The fixed local API stub
uses dummy credentials and a separate 45-second receiver lifetime; the Claude
process has a 30-second budget. The first phase's receiver fences stay unchanged.

Independent source review matched the complete download, compiler, transfer,
ACL, admission, receiver and result path. Fifty-seven pure PowerShell controls
passed, and five warning-as-error compilation checks stayed within the existing
binary limits. These observations do not establish actual guest Claude execution.
Task-observed edits and test output remain explicitly distinct from a trusted
test-process observation, which is still unknown. Full E6 acceptance and production
launch permission remain false even if this fixed local corpus later succeeds.

The subsequent revision adds a separate fixed verification process after the
Claude Job and API receiver have closed. The native owner retains the Node
process identity and read-only handles to the trusted test inputs and exact
edited source. The same standard-user process runs three fixed assertions;
success requires natural exit zero before Job termination, empty Job observation
and confirmed input and desktop cleanup. This does not observe the earlier test
process requested by Claude. Task-written observations cannot grant success.

Independent source review found no blocker within this scope. Integrated controls
passed 46 synthetic result assertions, five actual disposable file-pin controls
and nine JavaScript models. Five legacy compiler compositions passed without
warnings or larger output limits. Actual guest execution of this separate
verifier is not yet established; no full enforcement gate changed.

Cloud receipts have a fixed upload allowlist and size limit with seven-day
artifact retention. Installation images, VHDs, temporary account passwords and
answer files are excluded. Unknown or interrupted cleanup stays unconfirmed.
Actual guest results belong to their own source-bound run and must not be inferred
from the preceding firmware-only VM runs or synthetic task controls.

## Actual QUERY-only admission and runtime failure

The [transfer-repair revision run](https://github.com/antropos17/Aegis/actions/runs/37708585872)
at `e8048a44` passed hosted preflight and all five CI contexts. Independent
review matched all 50 source hashes. Public Claude provenance, installed Windows
26300.9457 EnterpriseEval, profile readiness, all transferred hashes and removal
of both DVDs passed. The original receipt and its SHA-256 are retained in the
twenty-entry evidence index.

The held process token opened successfully with requested access 8 (`QUERY`).
The observed SID matched the dedicated guest account; the all-attributes group
scan found no Administrators SID, elevation was false and the initial Job
contained exactly one member. These are actual cross-account observations of
the token repair. The owner Node version probe exited zero in 2,920 milliseconds.

The private desktop was created and the parent's station restored. After resume,
the task process exited with `0xC0000142` before authenticated runtime readiness.
Project release remained false. The receipt does not identify the failing DLL
or establish a console, desktop-permission, session or environment cause.
The ordinary task exit field was unobserved; the actual failure exit code comes
from the retained process handle during cleanup.

Retained-root exit, empty Job and private-desktop handle closure were confirmed.
The host receiver stopped after Job closure and exited zero without force or
expiry. Native VM stop, independent Off, exact removal and post-removal host
canaries passed. The after-task canary was not reached. Task, network, Git,
Claude and the separate test witness were not executed. No further task or full
enforcement gate is accepted from this run.

The next revision compares fixed `node --version` launches through the actual
secondary-logon API, first with the original flags and then with `DETACHED_PROCESS`.
Each uses a fresh private desktop and held Job, exact account and image checks,
and matching owner/token session IDs. Confirmed cleanup is required between
attempts; detached natural exit zero and cleanup are required before selecting
that mode for the existing authenticated runtime. The separate Claude owner
repeats its own detached positive. These loader controls do not establish full
runtime initialization or authorize project release. Object permissions and
existing receiver deadlines are unchanged. Independent static review passed;
compilation, existing binary-size bounds and actual guest behavior require the
next hosted run.

## Actual fixed loader comparison

The [loader comparison run](https://github.com/antropos17/Aegis/actions/runs/37712277094)
at `637e9cd5` passed hosted preflight and all five CI contexts. Independent
review matched 51 repository source hashes and the separately pinned Git archive.
Its 81,440-byte raw receipt is retained in the twenty-one-entry index.

The original fixed `node --version` process passed the held identity, QUERY-only
token, nonadministrator, image, birth and initial Job checks. Owner and task
token session IDs both equalled zero. After resume it naturally exited with
`0xC0000142`; retained-root exit, empty Job and private desktop closure were
confirmed. This narrows the failure to startup before project or runtime
admission without identifying the failed DLL or proving an access-rights cause.

The `DETACHED_PROCESS` candidate was rejected by `CreateProcessWithLogonW` with
Win32 error 87 before a child was created. No candidate token, resume or exit
was observed. Its sentinel exit value is not a process result. No original
task, network probes, Git, Claude or separate test witness executed.

Host STOP after Job closure was unconfirmed. The receiver closed at about 38
seconds after the owner closed stdin without a positive STOP assertion. The
current receiver labels that EOF path `expired`; this does not establish that
its 120-second timer elapsed. The secondary route failure remains retained.
Independent VM Off, exact removal and post-removal canaries passed; after-task
canaries were unreached. No task acceptance or full enforcement gate changed.

The next controlled comparison keeps the supported API and original flags,
account, image, environment and Job checks. It compares fresh task-specific
private objects with the original access profile and Microsoft's documented
noninteractive user-object profile. This changes only those disposable objects,
including their task-specific DACL/ownership rights; inherited and default
objects stay outside the experiment. A successful version probe must still be
followed by authenticated runtime admission before project release.

Independent review approved the frozen comparison and receiver-reason changes
within that scope. Local Windows PowerShell 5.1 checks passed 25 loader predicate
models, four native descriptor controls, four result projections, four
current-principal desktop loader controls and eleven retained-process cleanup
cases. The documented private desktop exited zero; the denied desktop returned
`0xC0000142`. Full named private-station creation was unavailable locally with
Win32 error 5, so these observations do not establish the guest account path.
The receiver change passed 48 PowerShell controls and eight Node tests,
including actual child-process STOP, EOF, malformed-control and timer outcomes.

The fixed cleanup fixture compiled to 67,072 bytes. Its executable admission and
cleanup bound is now 80 KiB for that exact compiler-owned output; other files
retain their 64 KiB bound. The five measured x64 compiler compositions were
60,928, 65,536, 67,072, 65,536 and 66,560 bytes. The maintained runtime fixture
uses AnyCPU and actually produced 66,048 bytes; its exact executable now has a
matching 80 KiB admission and cleanup bound as well. Source and log limits stay
at 64 KiB. These output-size accommodations do not qualify guest execution or
change receiver/input limits.
