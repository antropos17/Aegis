# Read-only protected enrollment inspection

The session helper accepts `aegis-session.exe --inspect-enrollment`. It examines
the fixed `CommonApplicationData/AEGIS/ProtectedSession` installation and returns
a bounded JSON observation. It accepts no path or enrollment record from the
caller. The existing no-argument probe/prepare protocol remains unavailable for
launch.

The observer retains local directory and file handles without write/delete
sharing. It checks ancestors, reparse state, final paths, full volume/file
identities, owner and effective DACL grants. The installation and its files
require SYSTEM or Administrators mutation authority. Ancestor replacement and
security rights also permit TrustedInstaller; sibling creation and inheritance-
only ACEs are evaluated separately from rights on the held object. Unknown ACEs,
NULL DACLs and untrusted effective mutation grants refuse inspection.

The canonical UTF-8 enrollment record is limited to 1,024 bytes. It binds the
held root identity and installed helper's SHA-256, includes installation,
revision and epoch labels, and declares active or revoked status. The helper
image is limited to 4 MiB. Accepted active observations require rechecking held
identities and descriptors; handles close before returning. A close failure
changes the result to refusal.

`observed=true` reports these checks only. Every result keeps
`ownershipQualified`, `callerQualified` and `launchAllowed` false. Revision and
epoch do not provide rollback resistance, and the on-disk hash does not attest
the executing mapped image or vendor provenance. Protected provisioning,
authenticated broker admission, durable revocation and VM inventory are separate
requirements.

## Verification and operational limits

The frozen implementation is based on
`b3c70ab3774af112d61fd3c29515666280aff0e7`; manifest SHA-256 is
`ed9663326d63105c50c9f965e4fb9c48b33a29780283c74ed15eee9bd779f74f`.
Recorded Windows controls cover the real entrypoint, existing framed protocol,
strict records, identity and descriptor failures, rechecking and disposal.
Native controls hold ordinary local objects, deny competing file writes/deletion
and reject an unregistered directory. Protected-installation positive cases use
observation doubles and actual descriptor parsing; no SYSTEM installation was
provisioned by these tests.

The internal two-second budget is checked after synchronous native operations.
It cannot cancel a blocked native call. Callers requiring a hard deadline must
supervise the helper process; maintained tests use a ten-second process timeout
and 4 KiB output cap. The command changes no files, ACLs, accounts, privileges,
services or VMs.
