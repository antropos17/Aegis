# Installed VM registration inspection

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

The native factory accepts the original `InstalledOwnerRegistration` and a
retained `CallerMainOperation.Context`. The context must have been acquired with
that exact installed registration object. An ordinary context or admission from
another installed owner cannot be combined with the registration. Each observation
rechecks the SCM owner, held processes, tokens, Job, pinned installation and caller
selection through those original objects, before and after the native query.
An observed failure permanently refuses that lease.

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

New administrative registrations use version 2. Its common fields have the same
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
It does not hash image contents, validate VHD parent chains or seal storage ACLs,
image provenance, checkpoints, firmware, network or integration configuration.
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
