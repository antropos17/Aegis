# Private owned Claude hook writer

`src/main/claude-hook-writer.js` is an independently callable, private transaction
library over an explicitly supplied target capability. It consumes the existing
[pure planner](CLAUDE-HOOK-PLAN.md). It has no production caller, filesystem
implementation, profile discovery, IPC handler, UI, hook activation, command
execution or provider qualification. This is a prerequisite for later owned-file
installation work. It supplies no completion evidence for the pending W5 owner
prerequisite or the independent Cedar policy owner work.

The module preserves the existing action-policy hook route. Installation status
does not establish that Claude loaded a configuration, that a hook was observed,
or that an operation was blocked. Configuration changes or tampering do not prove
an operating-system mismatch.

## Trusted caller and IO capability

`createOwnedHookWriter({ configPath, io })` requires an explicit absolute path
label and all four IO operations below. There is no default IO implementation.
The constructor returns `INVALID_CAPABILITY` for a missing contract or operation.
`io.contract` must equal the exported `IO_CONTRACT` version string. This marker
identifies an interface; it does not attest that its implementation is qualified.

The trusted main-process caller selects and qualifies an owned target before
creating a session. The path label is bound into the planner manifest; the writer
never opens or resolves it. The capability must already bind operations to the
same verified file identity and handle. It must preserve appropriate file
metadata and access restrictions. A renderer path, a byte hash, or a self-declared
contract cannot establish those properties.

| Operation | Required contract |
| --- | --- |
| `readTarget()` | Return `{ identity, bytes }` for the currently bound target. `identity` is a stable, nonempty string of at most 256 code units. Bytes must be a Buffer no larger than 256 KiB. |
| `retainPrivate({ bytes, manifest })` | Retain an independent, restricted exact-byte backup and manifest, then return an opaque object reference. Partial retention on failure must also remain private and available to the storage owner. |
| `readPrivate(ref)` | Read the retained bytes and manifest by opaque reference. No path supplied by a renderer participates. |
| `compareAndWrite({ identity, beforeBytes, afterBytes })` | Revalidate identity and exact current bytes at the guarded mutation boundary. Return `stale` only if nothing was mutated; return `written` only after writing all supplied bytes to that same target. Any uncertain/partial outcome must throw or return another value. |

The provider must justify its comparison/write critical section, handle lifetime,
identity semantics, link/reparse handling, external-writer coordination, metadata
preservation and storage permissions separately for the deployment platform.
Reading bytes and then writing a path is insufficient. This library cannot prove
an atomic filesystem commit, a Windows reparse security boundary, or protection
from an uncooperative external writer between a provider's comparison and write.
Such an implementation remains unqualified. The injected fixture provider tests
the protocol only. A successful postwrite readback establishes exact bytes and
identity at that observation; another process can change the file later.

All callbacks and JavaScript objects belong to the trusted caller. The library
is not a sandbox for hostile proxies, mutated builtins, or malicious IO providers.
Provider exceptions are caught without reading their messages or accessors.

## Private review and application

`prepareInstall({ command, contract, timeoutSeconds })` reads explicit target
bytes, calls `planInstall`, and returns `REVIEW_REQUIRED` with a frozen private
`review` and an empty process-local `ticket`. The review includes the planner's
exact fragments, hashes and manifest. Nothing has been written. An existing
equal hook returns `CONFIGURED_UNOWNED`; the writer never adopts it or creates a
backup for it. A session with an owned installation refuses another installation.

After displaying the exact target and review and obtaining a later owner
confirmation, the trusted caller uses `apply(ticket, true)`. Only the most recent
ticket from that session is accepted. Failed confirmation does not consume it;
an accepted attempt consumes it before any IO. A boolean cannot prove a human
decision: the trusted caller owns that boundary. No UI or renderer should use
these methods directly. A future UI bridge requires a separately reviewed opaque,
expiring, owner-bound plan ID and privacy projection; that bridge is not present.

Every accepted mutation attempt follows this sequence:

1. Retain an exact copy of the approved before bytes and its ownership manifest.
2. Read the private storage back and verify the original byte hash and manifest
   hash against separate, process-private expected digests.
3. Read the target again and compare its identity and exact bytes to the approved
   snapshot immediately before invoking the guarded provider write.
4. Supply copies of the approved before/after bytes to `compareAndWrite`.
5. Read the target again and require the same identity and exact after bytes.

The writer retains returned backup references and expected digests in its private
session. Neither a caller-submitted replacement manifest nor a new matching digest
can replace the recorded ownership. There is no API to import ownership records.
Private storage must retain its artifacts independently of the session. The
writer permits at most eight backup attempts per instance, counting callbacks
that throw after partial retention. A ninth attempt returns `RETENTION_LIMIT`
before invoking storage. There is at most one pending review; IO operations are
serialized and reentrant/concurrent calls receive `BUSY`.

## Removal, failure and retention

`prepareRemoval()` verifies the retained original backup and manifest, reads the
same target identity and calls the unchanged `planRemoval` with current bytes.
The caller must review and confirm this new plan before `apply` can write it.
An unchanged installed file produces `mode: "exact-rollback"` and reconstructs
every original byte. Concurrent unrelated changes produce a fresh
`mode: "targeted-removal"` plan that preserves those changes and removes only the
unique exact owned entry under the planner's strict ownership rules. Altered,
moved, duplicated, missing, reformatted or ambiguous owned entries are refused.
The writer never unconditionally restores an old whole-file backup.

Removal verifies original retained ownership again when its ticket is applied,
then retains and verifies a separate backup of the current removal-before bytes.
It repeats target revalidation, guarded write and exact postwrite readback. This
preserves both the original installation backup and the later removal backup.

A prewrite storage failure, stale target, substituted identity, refused ownership
or missing approval stops without a target mutation by the writer. The contract
requires `stale` from the provider to have that same no-mutation meaning. A throw,
unexpected write outcome, partial write, substituted postwrite identity, mismatched
readback or failed postwrite read locks the session in retained unknown state.
It makes no further mutations, including rollback. Private backups remain for
separate owner review. `prepareInstall`, `prepareRemoval` and `apply` then return
`RETAINED_UNKNOWN`. No public reset, automatic recovery or ownership adoption is
provided. A failure during removal follows the same rule.

The only ordinary status shape is `{ ok, code, presence }`. Codes are fixed:

`IDLE`, `INVALID_CAPABILITY`, `BUSY`, `REVIEW_REQUIRED`, `INVALID_APPROVAL`,
`PLAN_REFUSED`, `CONFIGURED_UNOWNED`, `OWNED_INSTALL_EXISTS`, `NO_OWNED_INSTALL`,
`OWNED_ENTRY_REFUSED`, `TARGET_READ_FAILED`, `TARGET_IDENTITY_CHANGED`,
`TARGET_CHANGED`, `BACKUP_FAILED`, `BACKUP_TAMPERED`, `RETENTION_LIMIT`,
`WRITE_UNCERTAIN`, `READBACK_FAILED`, `RETAINED_UNKNOWN`, `INSTALLED`, `REMOVED`.

Only a successful verified installation or equal pre-existing configuration
reports `presence: "Configured"`. Other outcomes report `Unknown`.
`status()` copies the last sanitized status. It does not re-read the target and
can become stale after an external change. It never reports Observed or Blocking
verified. Calling `status()` alone does not advance retained unknown state.

## Privacy and evidence limits

The complete prepare result, review, manifest, ticket association, selected path,
command, configuration bytes, backup references and hashes are private. Commands
and configuration can contain credentials. Keep them out of IPC, diagnostics,
audit logs, exports, telemetry and ordinary reports. `apply` failures and
`status()` contain only fixed status fields. This module performs no logging.

Expected hashes are separated from mutable private-storage records in the live
session. They are not durable authentication or protection from a malicious
capability owner. There is no tested crash recovery, durable journal, secure
erase, private-storage cleanup, real profile installation, native atomic commit,
hook/provider invocation or denial-enforcement claim. Storage owners must define
retention and recovery before integration; this writer never deletes backups.

Local tests use only injected owned fixture IO and synthetic secret canaries.
They exercise exact-byte backup/readback, stale and substituted targets, guarded
commit refusal, partial/failed writes, original and narrow removal, retained-record
tampering, privacy, tickets, serialization and bounded backup attempts. These
results do not qualify any real filesystem provider or installation.
