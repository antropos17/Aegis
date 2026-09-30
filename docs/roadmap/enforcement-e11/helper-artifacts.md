# Offline helper artifact compatibility

Run `node scripts/qualification/qualify-helper-artifacts.mjs` without arguments.
The command generates inert bytes, disposable Ed25519 keys and a bounded source /
destination fixture. It checks offline admission and byte retention only; no helper,
installer, service, account, VM, firewall, provider or original project is started.
Every report retains launchAllowed=false. Real release/key custody/native boundary
qualification and A4 remain unavailable.

## Trusted admission boundary

createHelperArtifactAuthority selects a copied expected tuple and up to four
owner-selected Ed25519 public keys before receiving imported bytes. The tuple is
exact helper name, version, protocol=1, platform and architecture. A supplied key
ID can only select an existing trusted key; the manifest never supplies key material.
An optional independently retained baseline binds version, byte length and SHA-256.
Signed same-version changed bytes and downgrade targets are refused.

admit copies bounded manifest/signature/artifact bytes, verifies the exact copied
manifest using crypto.verify(null,bytes,key,signature) and exactly64signature bytes,
then parses strict JSON using inventory-config. No normalization precedes signature
verification. A signed UTF-8 BOM is supported by this chosen format. Invalid UTF-8,
decoded duplicate keys, unsupported schema, extra fields, ambiguous compatibility,
unsafe integers, changed/truncated payload and hash mismatch are refused. Existing
update-verification was inspected for its cryptographic sequence; its installer
schema, ordinary JSON parsing and stat-then-stream file check are not reused.

Manifest schema is aegis-helper-artifact/v1 with exactly schema/keyId/helper/version/
protocol/platform/architecture/bytes/sha256. Helper/key IDs use a finite32character
lowercase name profile; versions use finite valid x.y.z[-alpha[.n]]. Platform is
win32/linux/darwin, architecture x64/arm64. Manifest cap8KiB, artifact cap4MiB.

The opaque, frozen acceptance is a developer offline snapshot. It binds owner
revision, copied bytes, tuple and expiry60s. At most8tickets /8MiB artifact bytes
are retained. status/admit/consume prune expired state; close/revoke immediately
zero and release pending buffers. consume requires the actual owner handle and
current revision, records one attempt before revision validation and returns fresh
owned copies. Wrong revision, serialized/cross-owner tickets, revoke, expiry and
replay are refused. No acceptance survives a new authority/process. These bounds
do not establish protected host memory or monotonic trusted host time.

## File capture and inert publication

readHelperArtifactFiles accepts only a trusted absolute canonical source root and
key ID; filenames are fixed manifest.json/signature.bin/helper.bin. Imported paths
are not accepted. It rejects linked roots/leaves, bounds each retained-handle read,
compares full available dev/ino/size/mtime/ctime before/opened/after/path observations,
and rechecks owner authority/directory identity after asynchronous boundaries.
Ordinary replacement between inspection and read, file growth and revocation are
refused. Captured bytes are owned snapshots; source mutation after capture cannot
change admitted/published bytes and does not establish source-current authority.
Hostile same-principal races or memory mappings remain outside this fixture.

The qualification publishes one self-contained inert upgrade.bundle using a
synced/readback stage and exclusive hard link under its exact generated destination.
It never replaces a retained helper or writes an original project. Independent
oracles compare original source/candidate/final bytes and retained.bin +unrelated.txt
sentinels. Rejected upgrades, interruption before publication and failed rollback
collision preserve both sentinels. Failure after possible publication reports
outcome-unknown and never retries the consumed acceptance. Existing bundle collisions
preserve the prior generated artifact; cleanup addresses only owned regular entries.

The finite corpus covers valid admission, unknown signing key, signature substitution,
same-version changed bytes, downgrade and every tuple mismatch, missing/truncated
sources, stale acceptance, copied-source substitution, interruption, failed rollback,
quota, imported paths and linked source. Behavioral tests also cover duplicate signed
keys, BOM, exact signature bytes, expiry/close/revoke/serialization, aggregate retained
byte quota and bounded inspect/read races. Artifacts are never executed or interpreted
as commands. CLI output contains metadata only, no source paths, keys or raw content.

Fixture cleanup validates its exact generated root, refuses links, and caps depth2 /
48entries. Publication bundle cap6MB; TEMP/TMP are task-owned and external check
receipts measure source/storage/log bounds. Installer execution, provisioning,
reboot/uninstall survivors, signed production releases, protected signing custody,
native helper identity, hostile storage and power-loss recovery remain not-run.
