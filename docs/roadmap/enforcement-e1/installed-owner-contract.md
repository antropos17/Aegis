# Installed native owner inspection contract

This increment connects the installed SCM owner to the maintained session Program,
the retained enrollment lease, exact controller admission, and the existing fixed
`InspectOwned` operation. It is a Session-0 headless inspection slice. It does not
establish interactive Electron UI execution, VM lifecycle qualification, guest
containment, or completed E1. Every successful result keeps `launchAllowed:false`,
`ownershipQualified:false`, and `completeE1:false`.

## Fixed installation and service

The only production root is the CommonApplicationData path
`AEGIS\ProtectedSession`. Its ancestors, protected root, policy, enrollment, image
and role records must satisfy the existing held-file no-follow, identity, ACL and
metadata guards. Production inputs cannot choose another root, image, PID, service,
operator token, command, selection or VM target.

The only SCM name is `AegisProtectedSessionOwner`. Its registration must be an
own-process LocalSystem service, demand start, normal error control, with exactly
the quoted fixed `aegis-owner.exe` image and no command arguments. A retained SCM
object is rechecked against the original held owner PID, running state, exact
configuration and unchanged security descriptor. Untrusted service configuration,
delete, security-write or lifecycle-control grants, including generic execute,
refuse the installation. Trusted administrators and LocalSystem are the TCB.

Three build outputs are separate executables: `aegis-owner.exe`, the maintained
`aegis-session.exe`, and `aegis-main.exe`. The latter is a fixed headless controller,
not the Electron main process or interactive UI. Ordinary session probe, prepare,
enrollment inspection and v1 bootstrap behavior are preserved.

## Canonical protected policy

`owner-policy.json` is UTF-8 without BOM or whitespace, with these fields in this
exact order:

```json
{"schemaVersion":1,"installId":"<32 lowerhex>","revision":1,"epoch":"<32 lowerhex>","rootVolumeSerial":"<16 lowerhex>","rootFileId":"<32 lowerhex>","ownerImageSize":1,"ownerImageSha256":"<64 lowerhex>","supervisorImageSize":1,"supervisorImageSha256":"<64 lowerhex>","mainImageSize":1,"mainImageSha256":"<64 lowerhex>","operatorSid":"<canonical SID>","operatorAccount":"<local account>","selectionId":"<32 lowerhex>","selectionEpoch":"<32 lowerhex>","status":"active"}
```

Revision is a positive uint. Every image has an explicit size between 1 and 4 MiB.
The local account grammar is `[A-Za-z][A-Za-z0-9_-]{0,31}`. Native observations must
match the recorded root volume/file ID and original installation tuple. The
existing `enrollment.json` pins the same installId/revision/epoch and supervisor
image. `inventory.json` contains exactly the policy-selected inspection:

```json
{"schemaVersion":1,"installId":"<installId>","revision":1,"epoch":"<epoch>","selections":[{"id":"<selectionId>","epoch":"<selectionEpoch>","operation":"inspect-owned"}]}
```

The owner issues the existing canonical `main-registration.json` from the actual
retained operator token's SID, authentication LUID and Session 0, exact main image,
and inventory digest. This leaf is created once before enrollment/role acquisition.
After its creation changes root metadata, the owner releases and reacquires the
entire policy chain and requires identical policy digest, root identity and tuple.
The root metadata invariant is not relaxed.

## Operator and protected tokens

`operator.credential` is a bounded raw LocalMachine DPAPI blob of UTF-16LE password
bytes, with ASCII entropy `AEGIS-installed-owner-credential-v1`. Only LocalSystem
and trusted administrators may obtain the blob. LocalMachine DPAPI by itself does
not restrict decryption to the service account. Images and nonsensitive records
may separately grant operator read/execute access; the credential cannot inherit
those grants. Password arrays are cleared, no managed password string is produced,
and no credential, raw exception or command line is included in receipts.

The owner calls `LogonUserW` with fixed protected local account, local domain `.`,
interactive logon type 2 and default provider. The resulting actual primary token
must match the approved SID, be medium integrity, Session 0, unelevated, without
AppContainer/restriction/UIAccess or admin-capable group membership. Assigned
privileges are restricted to the explicit ordinary-user allowlist; powerful
disabled privileges also refuse. Only change-notify may be enabled.

The owner duplicates its actual LocalSystem token for the new supervisor. Only
this duplicate receives a token DACL granting the approved operator `TOKEN_QUERY`.
It grants no token duplicate, assign or impersonate authority, and the original
service token's ACL is unchanged. Both children use explicit System/administrator
process and thread ACLs, so another same-SID operator process cannot open them for
mutation. Main receives no token, credential, owner process or Job handle.

## Original ownership and private setup

Both exact children are created suspended through `CreateProcessAsUser`, with
atomic `PROC_THREAD_ATTRIBUTE_JOB_LIST` assignment. The original service retains
full private Jobs and exact created process/thread handles. Jobs retain kill-on-
close and a bounded active-process limit. Handle inheritance uses an explicit
`PROC_THREAD_ATTRIBUTE_HANDLE_LIST`: supervisor gets only its private input read
and completion output write; controller gets only its private input read. Child
environments contain controlled alphabetically ordered PATH/SystemRoot only.
Both tokens really inhabit Session 0 because Windows forbids inherited handles
across sessions. No token SessionId is silently rewritten.
Installed roles explicitly pass an empty desktop string, selecting the target
logon's noninteractive window-station rules instead of inheriting the service
desktop. No station/desktop handles are inherited and no shared station ACL is
changed. Actual target-station startup remains a disposable-host observation.

LocalSystem has no logon SID. The installed endpoint accepts only a retained
`InstalledOwnerRegistration` guard that rechecks the exact SYSTEM server,
original SCM owner and approved held operator process. Its pipe ACL grants fixed
SYSTEM server rights and the actual operator token's logon SID client rights.
Ordinary endpoint construction continues to require the original logon-SID checks;
there is no general SYSTEM fallback or received authorization flag.

The canonical 248-byte installed setup begins `AEGISO02`, followed by lowercase
hex: reduced owner process handle, supervisor query-only Job handle, exact main
query/synchronize handle, zero reserved field; observed owner/supervisor/main
PID/birth tuples; session/installId/epoch; uint revision. The setup consumes exactly
one frame plus EOF. Import validates noninheritance and exact granted access, native
process observations and actual Job membership. Program additionally requires
LocalSystem, the original SCM owner/image/policy, its native original parent PID,
one-member supervisor Job, approved main identity/image, and original tuple.
Received PID fields never open a process.

Program acquires the production enrollment lease from its held self process and
imported original query Job, binds the exact server registration and acquires the
maintained `CallerMainOperation`. Its private completion is `AEGISC02` plus freshly
issued locator/session/generation labels (104 bytes). The service then duplicates
only the reduced exact supervisor handle into its already-held suspended main,
supplies typed `AEGISM02` input containing v1 routing plus the fixed selection,
and releases main once. Ordinary v1 input/EOF semantics remain unchanged.

One literal main-role `inspect-owned` message passes the existing exact-process,
token-impersonation, role, selection and reversion checks. Installed owner/service,
principal/image, enrollment/revocation and total deadline are rechecked immediately
before the fixed observation. Main keeps its authenticated connection alive until
original-owner cleanup. No VM management operation is dispatched.

Results use `AEGISR02`, 8 hex length bytes and at most 1024 display-data bytes on the
original supervisor-to-owner anonymous pipe, followed by EOF and successful exact
supervisor exit. `AEGISF02` reports only a bounded fixed stage number. Stages 1-12
mean setup, installed registration, enrollment lease, main-operation acquisition,
tuple proof, completion, caller admission, installed recheck, inspection, counter,
result and completion. No exception text is serialized.

## Deadline, cleanup and immutable receipts

Program has a monotonic 10-second total budget. The service supervises one
12-second total attempt; expiration and SCM stop both terminally dispose the
original Jobs. Each stop independently confirms root exit and queried Job empty.
The initial RUNNING observation interval lasts 250 ms and consumes that same
12-second budget. A missing native SCM witness makes qualification unavailable.
Cleanup reaches both Jobs even if another resource fails; uncertainty remains
sticky, forbids success and never authorizes reuse. Synchronous native observations
are post-call budgeted; original-owner supervision is the process-level bound.

Protected sibling `AEGIS\Receipts` contains immutable epoch-qualified leaves:
`owner-result-<installId>-<epoch>-<revision>.json` and
`inspection-count-<installId>-<epoch>-<revision>.txt`. Any prior same-epoch receipt
refuses before creating/releasing children. Leaves use native CreateNew/no-follow,
never overwrite prior evidence, and all outputs are bounded. Reinstall/upgrade
uses a fresh tuple; qualification verifies fresh receipt timestamps and exact
source/binary hashes. Reusing a prior success or returning to an already-consumed
epoch cannot establish another successful attempt.

The maintained Program persists count `1` only after actual fixed inspection.
Owner success separately requires the exact private result, original successful
supervisor exit, count 1 and confirmed cleanup. Receipts include actual operator
and protected owner tuples, observed births/PIDs, original tuple, exact policy
image hashes, fixed phase/stage, inspection count and Job cleanup. The counter may
be 1 even when a later result/cleanup check fails; that is not a successful session.

Local refusal fixtures create real native original handles/Jobs and invoke the
maintained Program under the uninstalled current account. They verify refusal,
zero effects, both owned Jobs empty and unrelated canary survival. They do not
establish a protected installation positive. Actual protected descriptors, SCM,
token behavior, same-SID sibling/manufactured setup/service mismatch/revocation,
upgrade/rollback and crash/reboot/storage recovery require disposable Windows lab
evidence. A baseline old maintained Program must be built and enrolled under its
own actual hash to establish the original behavioral red without modeled files.

Native API contracts follow Microsoft's [CreateProcessAsUser](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessasuserw),
[window-station connection](https://learn.microsoft.com/en-us/windows/win32/winstation/process-connection-to-a-window-station),
[process attributes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute),
[LogonUser](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-logonuserw),
[DuplicateTokenEx](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-duplicatetokenex),
[OpenProcessToken](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-openprocesstoken),
[SCM service configuration](https://learn.microsoft.com/en-us/windows/win32/services/service-configuration),
and [service access rights](https://learn.microsoft.com/en-us/windows/win32/services/service-security-and-access-rights).
