# Cloud Hyper-V execution evidence — 2026-10-07

Latest completed useful-task result: [run 37733668154](https://github.com/antropos17/Aegis/actions/runs/37733668154)
at `6af571947a5af0e3c099951077a61de223e3f91b` passed the complete fixed Windows 11
lab corpus: admitted Node read/edit/test, shell and descendant controls, local
Git, measured host routes, dummy-API Claude read/edit/test, a separate native
test witness, receiver closure, both owner-requested cancellation cases and exact
VM/media cleanup. The successful corpus is
lab evidence; production launch and full enforcement qualification remain disabled.
The final section records the earlier successful corpus; the
[cancellation evidence](cloud-cancellation-evidence-20261008.md) records this
extended run, its source-bound raw receipt and limits.

Earlier [cancellation attempts](cloud-cancellation-evidence-20261008.md)
preserve setup and preparation failures. Run 37730935469 at
`6edb480147062e25ccdc21f51f9fca90f36be6bb` passed the prerequisite useful-task
corpus, then refused cancellation preparation before either case ran. A concrete
ACL constructor defect was reproduced and corrected. Exact VM cleanup and host
canaries passed; the raw failed receipt is preserved. A later fixed signature
deadline and its successful same-source retry are recorded separately.

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

## Actual documented-profile runtime result

The [documented-profile run](https://github.com/antropos17/Aegis/actions/runs/37716443944)
at `9e6d6be8` passed hosted preflight and all five CI contexts. Independent Astra
review matched all 51 repository source hashes and the separately pinned Git
archive. Its 90,969-byte raw receipt is retained in the twenty-two-entry index
with SHA-256 `4aa9764190336a1b0ec3c34c38d5d780a27fc90219dc9cf9ab72a583eae20388`.

The original minimal private-object profile naturally exited `node --version`
with `0xC0000142`. The documented noninteractive profile naturally exited zero.
Both used the same account, API, original flags, owner/token session zero,
QUERY-only token admission and single-member initial Job. Both confirmed root
exit, empty Job and private-object handle closure before the next launch.

The normal runtime then resumed under the dedicated nonadministrator account
and completed caller authentication. Its next `runtime-held-job-recheck` failed
with HResult `-2146233087` while the held root was still alive. This stage groups
inventory, image and birth checks; the receipt does not identify the failing
predicate. `runtimeInitializedBeforeProject` was absent and project release
remained false. Successful caller authentication is narrower evidence than full
runtime admission.

Cleanup confirmed retained-root exit 137, empty Job and private-object closure.
The host receiver recorded `shutdownReason: stop`, no expiry, exit zero and
independent closure after Job closure. Its guest network client was not run.
Native VM stop, independent Off, exact removal and post-removal host canaries
passed. After-task canaries, the fixed project, Git, Claude and the separate test
witness were not reached. No full enforcement acceptance or production launch
permission follows from this run.

## Actual pinned CLI chronology repair

A separate local disposable corpus used the exact pinned Claude 2.1.292 binary,
an owned project and a dummy-credential loopback receiver. The baseline refused
request three because the CLI groups completed Read/Edit calls into one assistant
message and their results into one user message. The protocol now validates
paired ordered batches while retaining exact tool IDs, names, inputs, global
sequence, role checks, result validation and sticky failure. Independent Astra
review passed the frozen three-file change and independently ran 58 pure
controls. The maintained Windows PowerShell 5.1 caller also passed on the
integrated files.

The actual candidate CLI exited zero, completed four responses and three tool
results, produced the expected edit and passed its task-observed Node test.
The unchanged receiver still refused closure with `http-invalid` and no FIN
event. A separate observation-only repeat recorded `ECONNRESET` 24 milliseconds
after response four finished: all four requests and responses had completed,
the socket byte count did not advance, and actual close was observed. The
receiver still exited one. This establishes the next repair target without
accepting the complete local corpus or claiming guest containment. A reset after
a partial additional HTTP request must remain refused.

## Reviewed startup inventory and receiver closure repairs

The post-authentication inventory failure was reproduced locally: the suspended
Node process began alone in its Job, and Windows added the exact system
`conhost.exe` before runtime authentication completed. The original strict
inventory rejected that change with the same HResult. This local reproduction
is a hypothesis for the hosted failure until the next guest receipt records the
new bounded census.

The trusted runtime owner now seals startup inventory once after authentication.
It preserves every original held identity and permits at most one late console
host at the exact system-directory path, with matching SID/session, no elevation
and no Administrators group under any attributes. Complete Job accounting must
show no exited or missed process; a second stable census and retained birth
checks precede commitment. The later release ACK still requires strict inventory
validation. Separate failure stages identify startup sealing, Job, image and
birth checks. Failed observations never release project code.

Independent Astra review passed the frozen ten-target repair. Local evidence
includes 14 native runtime cases, the actual console census, a native wrong-SID
refusal, 13 synthetic token-group cases, two receipt cases, ten JavaScript runtime
cases and five actual-parser stage projections. The local owner's deny-only
Administrators membership causes the added console host to be refused as
required; positive late-console admission under the guest's standard account
still requires the hosted run. Token, cleanup and diagnostics callers also passed.

The actual runtime fixture is 76,800 bytes and retains its 80 KiB bound. Measured
x64 diagnostics/token/cleanup/Claude/witness compositions are respectively
66,048/70,656/71,680/71,168/73,728 bytes. Diagnostics and token admission/cleanup
now agree on an 80 KiB bound for their exact fixed DLL only; source/log limits
remain 64 KiB. The final runtime source list adds only its new startup fixture.

The separate receiver repair requires actual closure and complete per-socket
request/response accounting before accepting the observed ECONNRESET. Bounded
raw framing rejects partial or additional requests even when coalesced with the
last valid request. Native and PowerShell consumers require disjoint EOF/reset
counts summing to observed closed connections. Job-before-STOP, expiry and
zero-forced-close requirements remain enforced. Independent Astra review passed
the six-target repair and reran 21 framing/socket controls with zero skips.

One pinned local Claude repeat completed the fixed read/edit/test corpus with
four completed responses, one observed reset/close, no forced closure and
receiver exit zero after STOP. This used local Node 24.11.1 and owned scratch
paths with dummy credentials. It is separate from hosted Node 22.23.3, guest
containment and independently observed process execution. Production launch and
full enforcement gates remain unchanged.

The combined maintained Windows PowerShell 5.1 preflight subsequently passed
on both integrated repairs in 37.4 seconds with 13,444 bytes of untruncated
output. It executed the final 21 receiver controls together with the native
startup, loader, token, cleanup, network, Git, Claude and witness fixture checks.
Changed receiver JavaScript files also passed ESLint. This combined local check
does not replace the next actual VM observation.

## Actual initialized runtime and useful task progress

Run [37719625461](https://github.com/antropos17/Aegis/actions/runs/37719625461)
at `c13159e6` passed hosted preflight and all five CI contexts. Independent Astra
review matched all 51 repository-source hashes and the declared Git archive pin.
The 112,205-byte receipt, SHA-256
`88de5fc81742f2d000bfcbb6885ba938dceb1bd5e3aac1d8b4a97df8f138abc2`,
is retained in the twenty-three-entry index. The overall cloud run failed later
in the fixed task; that result is preserved.

Actual runtime authentication and startup sealing succeeded. The initial held
Job contained one process; both later censuses and total/active/retained counts
were two. The one late system console host passed exact native image, principal,
session, elevation and all-attributes administrator checks. Its held PID was
2564 and birth was 134359019121272120. The owner recorded sealed/complete,
initialized runtime before project code, and successful project release.

The task then read and edited the admitted project and passed its Node test.
Ten loopback calibration cases matched receiver observations. Its shell/descendant
positive control failed, producing native exit1. The task's single childExitCode0
field belongs to the last Node child and does not prove the preceding CMD
command succeeded. Subsequent protected-resource, host-path, Git and Claude
phases were not completed.

The raw host-route projection retains client=null and an unavailable client/oracle
result. Reaching the later task stage implies from the fixed execution order
that route-client.cjs had passed its local gate, but its result was not retained
or admitted by the independent host oracle after aggregate task failure.
No completed route-corpus or E3 acceptance follows from that inference.

Retained root exit, empty Job, private desktop closure, loopback receiver closure
and independent host receiver STOP were confirmed. VM operations settled; exact
Off/removal and unchanged post-removal canaries were observed without cleanup
failure. The after-task canary check was unreached.

Independent Astra accepted only the exact E2.1 observational milestone for this
authorized disposable lab: owned VM configuration and initialized guest Job/runtime
were observed before releasing project code. E2 overall, E1/A1, persistent
protected production ownership, complete host integration-route mediation, the
full useful-task corpus and launch remain unaccepted.

A subsequent local reproduction identified CMD argument quoting: the original
Node spawn marshaling changed embedded command quotes. The fixed CMD producer
passed actual read/write/delete positive controls on disposable paths where the
baseline commands failed without effects. The next repair also checks the first
shell result before launching the next child, preserving causal exit reporting.

The five-file shell repair received independent Astra approval against freeze
`474aed3aaf0a80b27f7075b6bf55b7d063d648fca2d49c01aa175d749830dcb4`
and patch `e29d0d86bafb84b4af5e21a28d78bd9e2be4e166d38d5023697d568971ca1aaf`.
The integrated checkout passed its explicit Windows PowerShell 5.1 runner:
three actual native controls and all 25 task-source controls. Changed JavaScript
passed ESLint. The maintained cloud preflight now includes that runner. This
local verification establishes the quoting correction and causal failure
reporting; the next actual guest run must establish subsequent task completion.

## Complete fixed Windows 11 lab corpus

Run [37721808584](https://github.com/antropos17/Aegis/actions/runs/37721808584)
completed successfully at `713b492a3007d4308dcaab5a98eb9cecc75f0781`.
All five required CI contexts passed in
[37721812634](https://github.com/antropos17/Aegis/actions/runs/37721812634).
The original 161,631-byte receipt has SHA-256
`bed68baf8a9a019e7472673af0a0226998ca6fb21e0c4ed3482180b7e1079c2e`
and is retained unchanged in the twenty-four-entry receipt index. An earlier
incomplete packaging run, 37721777609, was cancelled before guest execution:
the repository-wide `*.ps1` ignore had excluded the new shell wrapper. The
subsequent explicit wrapper commit restored all five reviewed source files.

The standard-user task completed admitted read/edit/Node test and working CMD
and Node-descendant positive controls. All four protected dummy-resource probes
were refused with EPERM. Direct probes of both host paths reported absence in
the guest namespace; their shell read/write/delete commands exited one without
process failure. Descendant commands exited zero after their individual caught
attempts. These exit values alone do not prove prevention: independent host
canaries remained unchanged after the tasks and after VM removal.
The fixed Git 2.56.0.windows.2 corpus completed 13 commands in 1,651 milliseconds,
including modification, diff, local commit and final clean state with no remotes.
All ten loopback calibration controls passed in 90 milliseconds and closed.

The independent host-route receiver observed its three IPv4 positive controls
and no guest delivery on the measured TCP, UDP and DNS routes. Guest attempts
completed with ENETUNREACH for TCP/UDP and ECONNREFUSED for DNS. The receiver
closed all sockets, observed STOP, exited zero without forced termination and
was stopped after confirmed guest Job closure. The exact VM had zero network
adapters before and after the attempts. Host IPv6 routes were unavailable;
deliberate guest-exposure controls and complete integration-route coverage were
not performed. This result does not qualify E3.

The actual pinned Claude Code 2.1.292 CLI completed the fixed read/edit/test
task through the dummy local API in 13,545 milliseconds, with observed exit
zero, no stderr, timeout or output limit, exact edited bytes and test exit zero.
The independent receiver completed exactly four ordered responses and three
successful tool results. Its one connection closed through the reviewed
completed-reset path; STOP was observed, no socket was forcibly closed, and the
receiver exited zero after task Job closure.

A separate admitted standard-user native witness independently verified the
edited result and pinned inputs, exited naturally with zero, retained its
inputs through confirmed Job closure and closed its handles. It did not observe
the earlier test process invoked by Claude; that distinction remains explicit.
All three task runtimes authenticated and sealed their startup inventories
before project release. Native Jobs and private desktops closed. Exact VM
`4241969d-2218-458b-9755-519514ebd3c2` reached observed Off state and was removed,
with settled absence, unchanged host canaries and no cleanup failure.

The receipt retains `claudeAcceptancePassed=false`, `E6Qualified=false`,
`A1Qualified=false` and `launchAllowed=false`. Actual provider authentication,
protected production registration/dispatch and the complete containment,
cancellation, crash, transport and installation matrices are separate from
this fixed disposable corpus.

Independent Astra review matched all 51 repository-source hashes to the exact
commit (47 hosted CRLF transformations and four literal matches), checked the
Git archive pin and independently executed the actual-source first-phase and
witness validators against the receipt. It accepted E6.4 only: the fixed
disposable read/edit/test task with independent canaries. Previously accepted
E1.3, E2.1 and E6.5 were corroborated; other task and full gate verdicts were
preserved. No additional native fixture, CLI or VM was run during that review.
