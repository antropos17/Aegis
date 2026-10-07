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
before/after reproduction covers Git output and real native exits 0 and 7.
Acquiring the process handle before waiting preserves the actual exit code.

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

Cloud receipts have a fixed upload allowlist and size limit with seven-day
artifact retention. Installation images, VHDs, temporary account passwords and
answer files are excluded. Unknown or interrupted cleanup stays unconfirmed.
Actual guest results belong to their own source-bound run and must not be inferred
from the preceding firmware-only VM runs or synthetic task controls.
