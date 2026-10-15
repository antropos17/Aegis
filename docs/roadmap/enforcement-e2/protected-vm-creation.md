# Protected fresh VM creation

The elevated Windows PowerShell 5.1 installer accepts an optional final `VmImage`
argument to `New-ProtectedInstallation`. It is a hashtable containing exactly
`path` (a canonical local file path), `bytes` (an Int64, 1 through 16 GiB), and
`sha256` (64 lowercase hexadecimal characters). The administrator must establish
that digest through a trusted distribution channel. Computing a hash of an
untrusted download does not establish its authenticity. The installer does not
download an image or accept image/VM selectors through ordinary IPC.

The request is mutually exclusive with the existing inspection-only
`RegisteredVmId` argument. Image admission holds the exact source file without
write/delete sharing and verifies its full streaming digest before creating an
account, installation root or VM. The copy uses CreateNew with its final private
DACL, hashes the copied stream, flushes it, and verifies the private destination.
It never adopts an existing destination or disk. System and Administrators own
the private installation namespace. The returned VM's SID receives read access
to the immutable image and read/write access to its new standalone VHDX. VHDX
creation uses `CreateVirtualDisk` with an explicit private descriptor, no source
or parent and fixed 64 GiB dynamic parameters. Attachment uses VMMS WMI resource
settings directly. The high-level disk attachment cmdlet broadens directory
permissions on the tested host and is excluded from this transaction. Only
creation-bound IDs may have their final ACL sealed, before any guest startup.

Within `C:\ProgramData\AEGIS\Vm`, the installer creates an append-only sequence
of bounded intent, pending, settlement and ready records. Every provider mutation
has a flushed pending record before submission. Only the successful create
response supplies the VM GUID. A command timeout, lost result or unconfirmed
removal retains the namespace/account and uncertain association; an absent query
after a timeout cannot authorize cleanup. There is currently no restart/recovery
API for those retained transactions. A new installation refuses that existing
namespace, service or account. Administrators must investigate retained effects
before any manual recovery.

The generated Generation 2 VM has a fresh dynamic 64 GiB standalone VHDX, fixed
4 GiB RAM, two processors, Secure Boot, no network adapters, no checkpoints and no
automatic startup. Its only media paths are the private disk and admitted image.
Native private-storage inspection checks the resulting association. The installer
retains read-only file holds on both attachments. This API creates an **Off VM**;
it does not authorize guest startup, release an agent, or qualify a running writable
disk. A future runtime transaction needs its own live storage/configuration,
settled lifecycle and authenticated guest-transport contract.

Upgrade and rollback preserve the original namespace, VM GUID and storage binding.
They recheck the association rather than recapturing a changed VM. Uninstall
checks the finite captured tree before effects, requires independently observed
Off state and confirmed exact-GUID absence after removal, then deletes only
identity-checked closed descendants. Unknown children or changed identities stop
cleanup. It never recursively deletes a pathname selected by a caller.

Local Windows fixtures exercise streaming admission, ACL retention, CreateNew,
source write exclusion, pending-record ordering, refused provider results and
unknown settlement without VM/service/account effects. The existing
`cloud-hyperv-native` qualification additionally runs the actual elevated
installer on a disposable hosted Windows runner. Its inert media fixture tests
copying and attachment, not OS boot. It checks new private resources, wrong-hash
refusal before effects, attachment write exclusion, unknown-child refusal,
upgrade/rollback preservation, uninstall and failed-install cleanup. The bounded
receipt retains source and payload hashes. Passing this corpus does not grant
A1–A4, E1–E11 or production acceptance; `launchAllowed` remains false.

The provider adapter uses the documented Microsoft Hyper-V
[New-VM](https://learn.microsoft.com/en-us/powershell/module/hyper-v/new-vm),
[CreateVirtualDisk](https://learn.microsoft.com/en-us/windows/win32/api/virtdisk/nf-virtdisk-createvirtualdisk),
[AddResourceSettings](https://learn.microsoft.com/en-us/windows/win32/hyperv_v2/addresourcesettings-msvm-virtualsystemmanagementservice),
[Set-VM](https://learn.microsoft.com/en-us/powershell/module/hyper-v/set-vm) and
[Set-VMFirmware](https://learn.microsoft.com/en-us/powershell/module/hyper-v/set-vmfirmware)
interfaces. Worker termination does not establish cancellation of accepted VMMS work.
