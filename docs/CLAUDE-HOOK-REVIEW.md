# Private owner review for Claude hook changes

The main-process `createOwnedHookReview` capability prepares owner-bound,
expiring approval for the existing owned hook writer. It constructs and retains
one real writer for one explicit target/IO pair. The application now consumes it
through the [separate profile flow](CLAUDE-HOOK-APP.md), with fixed main-owned
paths, owned-frame IPC admission and a native Cancel-default confirmation.
Live provider/version qualification and persistent recovery remain open under W6.

## Construction and private authority

`createOwnedHookReview({ owner, configPath, io, lifetimeMs, now? })` accepts an
explicit process-local owner object, an explicit target and an already qualified
owned IO capability. `lifetimeMs` is a required integer from 1 through 300000.
The default clock is `performance.now()`; an injected clock is a trusted test or
embedding dependency. There is no default filesystem or profile discovery.

The constructor captures the IO operations and their original receiver. Provider
`close` and `status` methods can remain under the embedding's control. Only the
same owner object reference authorizes owner operations. A copied object, numeric
process/webContents ID, serialized value or possession of a plan ID does not
establish ownership. This local object capability does not authenticate a human,
application sender, provider or executable.

The module creates the existing `createOwnedHookWriter` internally. It accepts no
external writer, ticket, backup reference, caller manifest or recovery import.
Cancellation and expiry keep this same writer, its retained installation ownership,
backup-attempt bound and sticky uncertain state.

## Review and confirmation

| Method                             | Private behavior                                                                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prepareInstall(owner, selection)` | Snapshots own primitive `command`, `contract` and `timeoutSeconds` fields before asynchronous target IO. Replaces prior pending authority and asks the real writer for its exact review. |
| `prepareRemoval(owner)`            | Uses the same writer's retained ownership. Removal receives a fresh ID and requires a separate confirmation.                                                                             |
| `confirm(owner, planId, true)`     | Requires the exact owner, current live ID and literal confirmation. Consumes that ID before invoking the original writer ticket once.                                                    |
| `cancel(owner)`                    | Revokes the owner's current unaccepted review/preparation. During accepted application it reports that application is in progress.                                                       |
| `release(owner)`                   | Permanently closes this owner's future admission and revokes pending authority. Outstanding writer work remains occupied until settlement.                                               |
| `status()`                         | Returns a fixed cached transaction projection and checks logical expiry; it performs no target IO and supplies no live configuration or blocking proof.                                  |

A successful private preparation returns
`{ ok, code, presence, planId, expiresAtMs, review }`. The opaque random ID carries
no target information. `expiresAtMs` uses this process's monotonic clock; it is
not a wall-clock timestamp. The exact review is the real writer's already deeply
frozen, bounded review. The underlying writer ticket is retained only inside the
capability and never returned.

The trusted owner must present the exact selected target and changed fragments,
then obtain a later decision for this specific review. Supplying `true` is a
trusted caller assertion and cannot prove that this human interaction occurred.
A production UI bridge must separately bind its caller, origin/lifecycle,
private presentation and confirmation to this capability.

## Time, cancellation and asynchronous work

The deadline starts before asynchronous preparation. The module rechecks liveness
and time after preparation and before confirmation. Deadline equality is expired.
Invalid, nonfinite, negative or regressing clock observations fail closed. There
are no background expiry timers; expiry is checked at the relevant API calls.
Expiry or release revokes broker authority when observed. The unchanged writer
may retain its pending transaction bytes, manifest and ticket until a later writer
preparation or collection of the whole capability; release prevents later
preparation through this capability. Revocation supplies no erasure or cleanup
promise.

At most one writer operation is outstanding and one plan is pending. The busy
slot is reserved before callbacks, injected clock calls or awaits. Cancellation and release invalidate a deferred preparation's generation; expiry
rejects its late result. Neither action replenishes the occupied slot. A late
result cannot publish a usable review.
Foreign-owner requests preserve the legitimate owner's pending plan. Accepted
confirmation, replacement and cancellation invalidate previous IDs; replay
requires no new writer work.

Expiry and cancellation restrict **admission to application**. Once the capability
invokes `writer.apply(ticket, true)`, that writer has no cancellation input and
can commit later, including after expiry or owner release. The original promise
returns the actual `INSTALLED`, `REMOVED`, prewrite failure or uncertain outcome.
It must not substitute a false cancelled/expired outcome for completed mutation.
There is no automatic retry, rollback or deletion of private backups.

The embedding must keep the qualified IO provider alive until outstanding work
settles, then manage its own close/cleanup. A review lifetime does not extend the
provider's separate request, session or cleanup limits. An otherwise live ID can
still fail writer identity, byte, storage or readback validation.

## Privacy and acceptance boundary

Ordinary outcomes and `status()` contain exactly `{ ok, code, presence }`, with
fixed broker/writer codes and `Unknown`/`Configured` presence. They exclude owner,
ID, expiry, review, configuration, target identity, backup references and exception
diagnostics. Configured presence remains a cached configuration observation.

The whole private prepare result is secret-bearing. The existing review includes
the target path, selected command, fragments, hashes and manifest. Keep these
artifacts and the ID/expiry out of ordinary IPC, logs, audit, telemetry, exports
and public receipts. No raw before/after configuration Buffer is exposed by this
module. Freezing or expiry cannot retract copies already received by a trusted
owner or establish secure erasure.

Callbacks, the local JavaScript realm and the embedding are trusted. Descriptor
checks are input hygiene, not a sandbox for malicious proxies, mutated builtins,
providers or preinstrumented code. The unchanged writer/IO still own private
backup verification, identity and exact-byte revalidation, guarded write/readback,
targeted removal and retained uncertainty. See [writer contract](CLAUDE-HOOK-WRITER.md)
and [Windows IO boundary](CLAUDE-HOOK-WINDOWS-IO.md).

Local controls and canonical tests must distinguish the real writer with injected
owned IO from native helper, live profile, UI and application execution. This
capability supplies no native qualification, supported-version matrix, observed
agent behavior, denial enforcement, `Blocking verified` status or full W6 acceptance.
