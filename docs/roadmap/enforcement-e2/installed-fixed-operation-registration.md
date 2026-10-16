# Installed fixed inspection registration

The installed operation registration explicitly describes the existing built-in
inventory inspection. Its only operation is `inspect-owned`, its fixture ID is
`installed-inventory-inspection-v1`, and its scope is
`retained-inventory-inspection`. It grants no external guest/runtime launch
authority. `launchAllowed=false`, A1-A4 `UNREVIEWED`, and the 30/60 acceptance
position remain unchanged.

## Closed records

The administrator stages two mandatory static leaves. Their closed schemas use
the following property order and literal values. Bytes are UTF-8 without a BOM,
whitespace or trailing bytes; each record is limited to 4096 bytes.

`fixed-fixture.json`:

```json
{"schemaVersion":1,"fixtureId":"installed-inventory-inspection-v1","scope":"retained-inventory-inspection","selectionId":"<32 lowercase hex>","selectionEpoch":"<32 lowercase hex>","inventoryBytes":1,"inventorySha256":"<64 lowercase hex>","mainImageBytes":1,"mainImageSha256":"<64 lowercase hex>","supervisorImageBytes":1,"supervisorImageSha256":"<64 lowercase hex>"}
```

`registered-operation.json`:

```json
{"schemaVersion":1,"installId":"<32 lowercase hex>","revision":1,"epoch":"<32 lowercase hex>","policySha256":"<64 lowercase hex>","operatorSid":"<canonical SID>","selectionId":"<32 lowercase hex>","selectionEpoch":"<32 lowercase hex>","fixtureId":"installed-inventory-inspection-v1","fixtureManifestBytes":1,"fixtureManifestSha256":"<64 lowercase hex>","operations":["inspect-owned"],"status":"active"}
```

The displayed byte counts are placeholders: inventory and fixture manifest sizes
range from 1 through 4096, image sizes from 1 through 4194304, and revision is a
positive UInt32. Hashes describe the exact referenced bytes. Unsupported
operations, additional fields and noncanonical encodings confer no permission.

## Administrative staging and lifetime

`New-ProtectedInstallStage` serializes canonical inventory bytes once. The writer
uses those exact bytes for both `inventory.json` and its size/hash in the fixture
manifest. Main and supervisor metadata come from the existing verified binary
input manifest. The operation registration binds the exact retained policy bytes,
operator SID, installation/revision/epoch, selection ID/epoch and fixture manifest
size/hash. All three JSON outputs use the existing protected `CREATE_NEW` writes.

The external administrative input remains schema version 1 with exactly three
EXEs. The qualification transfer remains its existing fifteen-file payload; its
transport digest supplies no operation or workload authority. No helper or new
caller-controlled runtime selector is added.

The two files are original stage rows, covered by the existing identity,
descriptor and digest snapshots used for handoff, partial cleanup and removal.
`Update-ProtectedInstallRuntimeRows` may adopt only `main-registration.json`;
an unassociated operation registration or fixture manifest is refused. There are
ten initial leaves and eleven after main registration. The mutation corpus
requires five denial actions per file, three actions per each of three directories
and one credential-read denial, totaling 65. Fixed diagnostic labels include both
new file names while retaining the bounded result format.

Idle/stopped upgrade calls the stage writer with a new revision and epoch, so
inventory, manifest and registration are regenerated together against that
stage's exact policy. Rollback restores the original held stage and its bytes.
The new native reader requires both records; missing leaves do not enable an
automatic compatibility permission. Old binaries and their original rollback
stages retain their original behavior. Existing retained authority loss,
disposal and idle upgrade provide the current revocation mechanisms; this slice
introduces no live administrative revocation channel.

## Verification boundary

The existing VM record producer runs the actual stage writer with substituted
filesystem authority. It emits policy, inventory, operation and manifest paths
and Base64 bytes, together with image metadata. Optional fixture image inputs
allow native contract tests to bind the manifest to their actual executable.
It also checks ten initial/eleven runtime leaves, refusal to adopt either new
static leaf, and refusal of an unknown runtime leaf.

These local fixtures can verify serialization and native registration/admission
contracts with modeled installed authority. They do not prove a privileged
installation, SYSTEM/SCM execution, a live Hyper-V registration, hosted VM
containment or production acceptance. Exact-source passing receipts remain
necessary for the protected installed and hosted paths.
