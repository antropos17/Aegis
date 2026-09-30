# Host-only sealed import developer fixture

Date: 2026-09-30. This implements part of the independent-copy direction in the
[Windows guest ADR](windows-vm-boundary-adr.md). It does not provision or import
into a guest. There is no production caller, protected output inventory or launch
authority. Full A1-A4 remain UNREVIEWED and `launchAllowed=false`.

## Selected input and authority

The checked-in Windows x64 fixture reads a selected disposable dummy tree on a
local fixed NTFS volume. The public qualification collector selects fixed corpus
modes; it accepts no project command or arbitrary source selector. Compiler input
is the checked-in fixture, never project content. There is no Git invocation,
project execution, credential helper, hook or archive extraction.

This fixture adapts the existing AppContainer input/workspace inspection pattern:
no-follow opens, queried attributes/standard information, stream inspection and
handle-based reads. Its guest-oriented contract requires full `FileIdInfo` volume
plus 128-bit identity and handle-based extended directory enumeration; it has no
64-bit fallback. The original AppContainer implementation and static-import
scanner are unchanged.

## Capture and seal

Pin the local volume root and every selected-source ancestor without delete
sharing. Pin each enumerated directory and read entries from that actual handle.
Before reading a leaf, compare its opened full file identity with the identity
from its parent's enumeration and require the same queried volume. Reject
reparse points, type changes, delete-pending files, multiple links, unsupported
metadata, alternate streams and unsupported names. Read only bounded bytes from
the identity-bearing handle, hash them, and inspect the same handle again.

Before publication, reopen every captured file without write/delete sharing and
match full volume/identity, size, streams, link count and SHA-256. Retain these
leaf handles through publication. Reinspect pinned directories and ancestors;
reenumerate the exact directory entry sets. A same-byte replacement with a new
identity must fail. An inability to query or retain the necessary observations
fails closed.

The manifest records schema/profile, canonical relative names, directory names,
file sizes, hashes and payload offsets. Actual source identities remain transient
native validation evidence; host paths, volume IDs, file IDs and principals are
not serialized into the transferable manifest. The receipt contains only fixed
status labels, counts, hashes and explicit unqualified boundaries, without source
contents or user paths.

The `.git` entry is refused before traversal or reading, including its hooks and
configuration. Known credential/configuration/profile names are also refused.
This is a restrictive dummy-corpus admission rule: a name denylist cannot establish
that arbitrary project bytes contain no secret.

## One complete publication

A single binary bundle embeds the complete canonical manifest followed by bounded
file payloads. A separate loose manifest could expose incomplete publication;
the embedded representation publishes both together. Create an exclusive fresh
stage under the selected, pinned output parent, write all bytes, flush, and read
the actual stage back through its held handle. Compare its full identity and
complete bundle hash before a native handle-relative rename to one fixed final
name, with replacement disabled. Reopen the published name and check full identity against the verified
stage while that stage handle is retained without write/delete sharing. A collision must preserve existing
bytes. Failed cleanup remains explicit and cannot become a successful seal.

The fixture uses user-mode `NtSetInformationFile(FileRenameInformation=10)` for
the rename relative to a retained parent. The initial Win32
`SetFileInformationByHandle(FileRenameInfo)` attempt returned error 87 on the
tested positive case with a non-null parent. There is no pathname/copy fallback.
The x64 buffer uses offsets 8/16/20, conservative allocation, a zero replacement
flag and authoritative returned NTSTATUS. See Microsoft's
[native rename contract](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_rename_information)
and [NtSetInformationFile](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-ntsetinformationfile).

## Budgets and independent checks

| Resource | Admission bound |
| --- | --- |
| Regular files | 128 |
| Imported directories, including root | 32 |
| Depth | 8 |
| One file / aggregate bytes | 64 KiB / 1 MiB |
| Manifest | 64 KiB |
| Relative name / component | 240 / 64 ASCII characters |
| Ancestors | 32 path segments |
| Native build / invocation | 30 seconds each |

The independent JavaScript oracle decodes the actual bundle, checks canonical
manifest shape, payload boundaries and hashes, and compares the positive corpus
with separately known bytes. Native tests create real junction, hardlink and ADS
objects and real source replacements/mutations in disposable directories. Injected
API/identity failures are labeled separately from those actual filesystem effects.
Evidence records red-before-fix failures and the later source hashes, counts,
command exits and tool versions; it supplies no review verdict.

## Remaining limits

This is a bounded local observation and copy, not a whole-filesystem snapshot.
Preexisting writable memory mappings and a hostile same-principal host are not
qualified. Handles constrain the measured operation, but after they close this
user-writable output has no protected ownership authority. Rename atomicity does
not establish power-loss durability of directory publication. The binary oracle
is not a guest extractor or host export implementation.

Actual disposable host/image selection, protected supervisor/broker inventory,
guest peer/bootstrap admission, VM lifecycle, network denial, provider credentials,
recovery and host export remain separate unavailable or unreviewed gates. No
Windows features, VMs, accounts, services, ACLs, registry, firewall, WFP, WSL or
provider settings are changed by this work.

Measured directory stream profile: on this NTFS host, a directory without named
streams returned ERROR_HANDLE_EOF (38) from its stream query. A native receipt records the
observed profile. Synchronous handles omit FILE_FLAG_OVERLAPPED. An
unexpected pending rename exits the fixture failed without unwinding
native buffers/handles; its test is synthetic. Exact success also requires
zero IO_STATUS_BLOCK status/information on this measured profile.
