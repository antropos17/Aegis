# Inactive enrolled main-role inspection

This slice connects retained enrollment evidence, native main-role admission and
one fixed `inspect-owned` observation. Program, Electron main/preload, installed
provisioning, VM management and launch flags remain inactive. It does not qualify
full E1/A1 or a protected cross-account installation.

`CallerMainOperation.Acquire` accepts the original borrowed EnrollmentLease and
server registration plus an already-held main process handle. EnrollmentLease
binds once to that exact server object after checking its held PID/birth/current
token against the retained supervisor process. The endpoint host must be that
same native server instance. A second independently created server registration,
a reversed main/server pair, routing labels and copied enrollment JSON cannot
replace the association. Borrowed server/lease ownership remains with the caller.

The pending owner creates its own held main registration and independently pins
three fixed root slots: `main-registration.json`, `inventory.json` and
`aegis-main.exe`. Native identity, final path, non-reparse state and protected
descriptor checks apply to each slot. Main image size/hash are verified by the
existing streamed executable pin and its native process-image comparison.

Records are strict UTF-8 canonical JSON with fixed order and no extra fields.
The role record is bounded to 2048 bytes and contains schemaVersion 1,
installId/revision/epoch, role `controller-main`, protocol
`aegis-supervisor-caller` version 1, operatorSid/operatorAuthentication/
operatorSession, mainImageSize/mainImageSha256 and inventorySha256. The inventory
is bounded to 4096 bytes, repeats the exact installation tuple and contains one
through eight unique selections, each with a 32-hex id, 32-hex epoch and sole
operation `inspect-owned`. Installation revision is positive uint32. Main's
observed SID, authentication LUID and Windows session must equal the trusted role
record. The server may use a different principal; no main/server token equality
substitutes for this role check. Full retained token fences continue independently.

The main-only pipe frame is a single existing length-prefixed message, bounded
to 4096 body bytes, with protocol/version, literal role `controller-main`, literal
operation `inspect-owned`, requestId/sessionId/generation, selectionId,
inventoryRevision/selectionEpoch and sequence 1. All IDs are lowercase 32-hex.
The native endpoint verifies the exact peer PID, held birth/current token and
per-frame impersonation token. Reversion finishes before proof/lease/server/main
and selected inventory are checked again. The private pending owner publishes a
Context only after these checks. Legacy RegisterMain, ordinary admission Context
and transport labels cannot construct this operation owner from wire/user data.

Context.CheckCurrent and InspectOwned hold the original server gate and recheck
all retained evidence, endpoint, native peer, selection and revocation. Inspection
returns only the selected inventory id/revision/epoch and fixed observations. It
reports inventoryObserved true, ownershipQualified false and launchAllowed false;
it neither observes a VM nor mutates a filesystem/resource. A refusal or repeated
admission terminally closes owned endpoint, proof pins and main registration.
Issued contexts remain refused. External process/Job ownership is unchanged; the
fixture launcher independently stops both disposable Jobs and observes them empty.
Sticky cleanup uncertainty remains an explicit error and every disposal is attempted.

Before acquiring a supplied server gate, a short lease-only association check
refuses a known different bound server or revoked lease. It releases the lease
gate first; the association is checked again under the normal server/lease locks.
The held-unrelated-gate native control proves refusal without waiting for that
gate to be released. Lock order is original server.Gate before lease/endpoint gates. The main
registration shares that gate. The endpoint is private to this owner and no
inverse callbacks are introduced. Lease Dispose/CheckCore never acquire this
external server gate. Synchronous native calls and their observation budgets can
delay cancellation; check-to-later-effect and hostile privileged mutation races
remain unqualified. This slice performs only the fixed synchronous observation.

The behavioral baseline uses the preexisting observed-only API with a real
same-operator held main from `aegis-unlisted.exe`: old admission passes and the
independent counter becomes one. It motivates qualified role admission; the old
API did not promise that qualification. Corrected controls require zero effects
for an unlisted image, invalid role/operator/inventory/frame/selection and revoked
ownership. Positive descriptors are modeled under ENROLLMENT_LEASE_TEST; native
process/token/image/file/pipe/Job observations are real. A separate production
EnrollmentLease acquisition must refuse the actual ordinary root. Fixture routing
uses precreated disposable files plus directly duplicated held server handles;
this fixture channel establishes no protected locator delivery or provisioning.
Actual role/inventory attribute changes after publication are independently read
back and cause zero-effect refusal; restoring those attributes cannot revive the
issued Context. Owner disposal/frame refusal leaves valid borrowed lease/server
objects usable. These controls do not claim physical replacement against the pins.

The six earlier 65,536-byte executable assertions were fixture compiler/copy
budgets without an established security rationale. Their current explicit budget
is 256 KiB. Historical measurements remain valid at their tested bytes. Native
token/security/frame limits are unchanged. The maintained supervisor image is
measured independently against its unchanged 4 MiB enrollment/launcher guard;
the separate generic main executable pin retains its existing streamed 128 MiB
guard. No protected Electron install or x86 execution is qualified here.
