# Installed VM registration inspection

## Private storage ACL eligibility

New administrative registrations use version 3. Its version-two fields are
followed by `"storageProtection":"private-vm"` before `status`. The installer
calls `ObserveProtectedStorageForInstaller` on the verified native image and
refuses unprotected storage. It does not change ACLs on a selected existing VM.
Versions 1 and 2 retain their read-only compatibility paths and supply no private
storage claim.

Version-three private eligibility also requires every disk to be a standalone
Microsoft VHD or VHDX, with a fixed or dynamically expandable provider subtype.
While retaining the original file and ancestor handles, the native adapter opens
the image for information only, with zero read/write depth and
[`OPEN_VIRTUAL_DISK_FLAG_NO_PARENTS`](https://learn.microsoft.com/en-us/windows/win32/api/virtdisk/ne-virtdisk-open_virtual_disk_flag).
It verifies the returned storage provider/format and
[`ProviderSubtype`](https://learn.microsoft.com/en-us/windows/win32/api/virtdisk/ns-virtdisk-get_virtual_disk_info).
Differencing disks, missing parents, corrupt images, mismatched formats and
unavailable observations refuse the lease. Every protection recheck repeats this
observation between native file-identity, metadata and descriptor checks. DVD
attachments retain their existing ACL checks. Versions 1 and 2 remain read-only
compatibility paths without this eligibility claim. Numeric checkpoint 23 covers
both attached-file ACL and standalone-image eligibility failures.

The native lease resolves the exact VM principal locally from
`NT VIRTUAL MACHINE\<registered GUID>`. Every attached file must have a protected
allow-only DACL, a SYSTEM/Administrators owner, no effective grants to other
principals, and the required VM read access. Writable disks require VM write
access; DVD images permit that VM only read/execute/query rights. Disks support
the exact VM's full-control grant used in Microsoft's
[Hyper-V VHD permission guidance](https://learn.microsoft.com/en-us/troubleshoot/windows-server/virtualization/hyper-v-virtual-machine-not-start-0x80070005).
Every held ancestor must retain the existing protected-branch policy. Descriptor
snapshots are private copies; native rechecks observe later ACL changes. Loss of
eligibility is latched through the original observation lease.

This proves observed ACL eligibility while the files and ancestors are held. It
does not prove trusted fresh creation, the absence of earlier mapped writers,
image-content provenance, configuration/network seals,
running-VM containment, lifecycle permission consumption or guest authentication.
The supported disk policy excludes parent chains; it does not qualify creating or
operating them. All results remain read-only with `ownershipQualified=false` and `launchAllowed=false`.
The fixed qualification driver applies ACLs only to its finite newly created
files and directories after validating their exact scope; it leaves global
ancestors and unrelated VMs unchanged.

Stage-nine numeric checkpoints 21-24 identify VM-principal resolution, ancestor
protection, attached-file ACL eligibility and original VM association respectively.
The existing fixed-size private failure channel carries no descriptor, path or
provider text.

The installed supervisor can inspect a VM recorded in the fixed protected
installation. The administrative installer manages that record. This is a prerequisite for connecting the installed owner to VM
management. Preparation, agent release, lifecycle dispatch, authenticated guest
transport and production activation remain unavailable.

`InstalledOwnerSession` uses the existing `inspect-owned` admission. When
`registered-vm.json` is present under the fixed `InstalledOwnerPolicy.Root`, it
acquires a read-only inspection lease before the ordinary inventory observation.
The lease stays open through the result publication. A missing leaf retains the
existing process-only inspection and creates no VM authority. Other filesystem
errors, malformed or stale records, reparse points and unprotected files refuse
the attempt. The unchanged result has `ownershipQualified=false` and
`launchAllowed=false`; it does not claim a VM observation when no record exists.

The native preparation factory accepts the original `InstalledOwnerRegistration`.
It observes and holds the registered VM/storage before publishing routing that
releases the fixed main controller. This preparation has no caller dispatch
authority. After authentication, the fresh `CallerMainOperation.Context` consumes
the fixed read-only inventory inspection once and returns its single issued
`InspectionCompletion`. Issuance and every completion recheck require the original
published operation context and native admission, the same installed registration,
and its exact policy selection ID, selection epoch and inventory revision. The
context retains the identity of the completion it issued; constructing another
completion from copied references does not confer authority. A deadline or
authority failure closes the operation permanently, including failures during
initial issuance and completion validation. A new deadline cannot revive it.
That terminal fence binds once to the original VM registration; ordinary VM
inspection is refused before binding. It exposes no dispatch or renewal method.
An ordinary context or admission from another installed owner cannot be combined
with the registration. Subsequent observations recheck the SCM owner, held processes,
tokens, Job, pinned installation and caller selection through those original objects.
The original two-second admission age remains enforced before the one dispatch.
Completion retains the exact live pipe peer, token, held processes, Job, installation
and selection under the original supervisor deadline; it cannot authorize a second
inspection or another operation. Storage acquisition precedes admission. The native storage query independently
fences the captured VM identity and Off state before and after its topology query.
An observed failure permanently refuses the lease.

The existing `InstalledOwnerFiles.PublishMain` already compares the installed
inventory byte-for-byte with the inventory derived from the retained policy.
The explicit completion checks make that selection contract local to the original
operation and its retained lifetime. They do not establish a currently exploitable
installed inventory-selection gap. See [Installed caller operation binding](installed-caller-operation-binding.md)
for the native fixture boundary and remaining qualification work.

The legacy version 1 active UTF-8 record, without a BOM or trailing whitespace, is:

```json
{"schemaVersion":1,"installId":"<32 lowercase hex>","revision":1,"epoch":"<32 lowercase hex>","policySha256":"<64 lowercase hex>","selectionId":"<32 lowercase hex>","selectionEpoch":"<32 lowercase hex>","vmId":"<canonical lowercase nonzero GUID>","identitySha256":"<64 lowercase hex>","status":"active"}
```

The file is capped at 4096 bytes and held through `EnrollmentNative` with the
existing protected-owner/DACL, identity, no-reparse and no-write/delete-sharing
checks. Its bytes are rechecked. All installation and selection fields must
equal the retained policy; `policySha256` is the digest of the exact policy bytes.
`identitySha256` is SHA-256 of the strict UTF-8 native `VmObservation.Identity`:
the lowercase relative `Msvm_ComputerSystem` path, a newline, and the exact
realized settings `InstanceID`. This binds the recorded identity rather than
accepting whichever identity happens to be returned on first observation.

`InstalledVmInspection` exposes observation and disposal only. The existing
`inspect-owned` grant cannot authorize `Start`, `Stop` or `RequestStateChange`.
The mutable native manager remains private. Neither the record nor a matching
WMI identity qualifies VM storage, image provenance, network isolation, snapshots,
host integration routes or crash recovery.

The installer creates `registered-vm.json` in every new stage. With no VM selection,
the common installation/policy/selection fields end with `"status":"unconfigured"`
and contain no VM ID or identity digest. The supervisor validates and closes that
record without constructing a native VM manager. A missing leaf preserves
compatibility with the earlier process-only installation; neither state grants VM
authority. An unconfigured record with active-only fields is refused.

Version 2 records have common fields in the same
order and binding, with `"schemaVersion":2`; after `identitySha256` it adds
`"storageSha256":"<64 lowercase hex>"` before `status`. Version 1 active records
retain their identity-only read-only compatibility path. Unconfigured records
remain version 1. Upgrades preserve whichever binding was originally captured;
they never recapture a changed disk as the expected one.

The version 2 inspection additionally requires the VM to be Off. The native
observer reads the exact realized settings and their virtual hard-disk/DVD file
allocations, including parent-drive identity and slot. It refuses physical disks,
unsupported storage types, duplicate IDs/files, malformed or remote/ADS paths,
reparse points, hard-linked files and missing observations. Empty DVD trays are
included in the topology. The finite attachment set is sorted and serialized
with length-prefixed fields; its digest also binds each file's volume serial,
128-bit file ID, size, creation/write/change times and flags. Access time is
excluded. Each local ancestor and file is held without write/delete sharing
through the installed inspection and its result publication. Rechecks compare
the held metadata and current attachment topology before and after observations;
any observed failure permanently refuses the lease. Disposal releases the holds.

This offline binding detects a replaced attached file or changed metadata/topology.
Version-three private eligibility additionally excludes parent-backed disks.
The binding does not hash image contents or establish trusted creation, content
provenance, checkpoints, firmware, network or integration configuration.
The file holds also prevent starting the VM while this observation is retained.
A production lifecycle needs its own authority, storage design and containment
qualification; the existing `inspect-owned` grant cannot be reused for that step.

The installed failure frame retains a fixed stage-nine checkpoint (0..20):
0 ordinary observation/deadline, 1 authority, 2 VM observation, 3 recorded VM
identity, 4 Off state, 5 storage query, 6 topology validation, 7 ancestor hold,
8 file hold, 9 file metadata, 10 digest construction, 11 held precheck,
12 topology recheck, 13 held postcheck, 14 recorded storage digest,
15 second VM observation, 16 second identity/state check, 17 final authority,
18 registration acquisition, 19 native manager creation and 20 optional-record
precheck. The original private channel and bounded numeric host projection retain
this position without paths, provider exception text or file contents. It supplies
failure location and does not establish the cause or any successful observation.

`New-ProtectedInstallation -RegisteredVmId <GUID>` is an administrative, read-only
registration option. After the existing administrator and binary-input checks,
the installer loads the exact verified session image bytes and calls its fixed
native observer. The selected local VM must exist, have an exact realized identity,
supported observable attachments and be Off. The returned digests supply the binding; this step does not start,
stop, reconfigure or adopt VM storage. There is no new ordinary UI/helper wire
selector or preparation route.

Each stage creates the record with the existing protected file ACL and binds it to
that stage's exact policy bytes. Upgrade preserves the original VM ID/identity
digest and binds the new revision/epoch/policy rather than recapturing a replacement
VM. Rollback restores the previous stage including its record. Partial-install and
uninstall removal use the captured file identity, descriptor and hash through the
existing transaction. Initial stages have eight leaves; the fixed runtime main
registration makes nine. Other leaves are still refused. The mutation corpus adds
all five file mutation actions for this record, for 55 actions total.

Trusted preparation still must create the VM and independently seal owned storage,
image provenance and namespace/network configuration before enabling lifecycle or
agent release. Registering a GUID/realized identity does not establish that seal.
Provider outages, installer observation deadlines, reboot/crash and full provisioning
remain separate qualification requirements.

Windows contract tests compile the actual native sources with a test-only injected
authority/provider. Standalone eligibility refusal and permanent loss are checked
through the installed registration. Elevated Windows image controls additionally
create unattached disposable 8 MiB fixed/dynamic VHD/VHDX images, refuse child
images with present or missing parents, corruption, a mismatched extension and a
disposed original handle, and verify retained write denial and handle cleanup.
The cloud driver requires all eleven image cases before creating its VM and
records their source hashes. Local non-elevated runs explicitly skip ten image
creation cases; the corrupt-image refusal still executes.

Windows contract tests also compile the actual native sources with a test-only injected
authority/provider. They check stale tuples, record replacement, ordinary-owned
files, foreign/replaced VM identities, loss of authority and permanent refusal.
The actual stage writer is exercised with substituted filesystem authority; its
active/unconfigured records enter the compiled reader, and unknown runtime leaves
are refused. These tests do not establish privileged installation or VM authority.

The fixed Windows lab adds a registered-VM installed corpus after configuring its
fresh exact VM and before the fixture starts it. It supplies that ID to the
administrator, exercises baseline refusal, maintained inspection, all 55 mutations,
upgrade/rollback/partial-install/uninstall and independently observes the VM still
Off. This scenario needs an exact-source passing receipt before its native positive
path is qualified. Storage/network, production lifecycle and crash qualification
remain required. No complete E1/E2/E3 or A1 acceptance follows from this slice.
