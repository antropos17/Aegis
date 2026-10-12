# Installed VM registration inspection

The installed supervisor can inspect a VM recorded in the fixed protected
installation. This is a prerequisite for connecting the installed owner to VM
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

The canonical UTF-8 record, without a BOM or trailing whitespace, is:

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

The current installer does not create this optional record. A subsequent trusted
provisioning change must create it from independently observed owned VM/storage
identities and integrate its upgrade, rollback and uninstall handling before any
product VM preparation route is enabled. Unknown installation leaves currently
cause cleanup refusal; do not insert a record manually into an active installation
and claim supported provisioning or uninstall.

Windows contract tests compile the actual native sources with a test-only injected
authority/provider. They check stale tuples, record replacement, ordinary-owned
files, foreign/replaced VM identities, loss of authority and permanent refusal.
They prove those contracts and native rejection of an ordinary-owned file, not a
positive SCM/Hyper-V registration scenario. The existing fixed Windows lab with no
registration leaf can qualify only compatibility of process-only inspection.
Real registered-VM service, storage/network and crash qualification is still
required. No E1/E2/E3 or A1 acceptance follows from these tests.
