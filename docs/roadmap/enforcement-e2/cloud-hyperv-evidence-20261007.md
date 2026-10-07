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
Repository attributes disable newline conversion only for these evidence files.

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

Cloud receipts have a fixed upload allowlist and size limit with seven-day
artifact retention. Installation images, VHDs, temporary account passwords and
answer files are excluded. Unknown or interrupted cleanup stays unconfirmed.
Actual guest results belong to their own source-bound run and must not be inferred
from the preceding firmware-only VM runs or synthetic task controls.
