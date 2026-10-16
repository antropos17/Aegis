# Protected operation record and settlement core

The operation record/settlement core is complete; protected store provisioning,
active mutation authority and durable crash qualification are pending. This is a
bounded prerequisite of B04. The complete protected-persistence stream remains
open.

`ProtectedOperationRecord.cs` provides immutable metadata and an exact canonical
codec. `ProtectedOperationState.cs` validates and observes a finite record prefix.
Production exposes `Parse`, `Encode`, `Replay`, `Inspect`, and immutable values.
There is no production writer, store factory, admission token, effect callback,
dispatch decision, journal-reader factory or restart adoption. These files have
no connection to ordinary caller admission or VM management operations.

The existing JS operation ledger remains unchanged. Its ordinary-account
persistence and power-loss/rollback limits still apply. Native inspection
authorization continues to permit only `inspect-owned`; this prerequisite does
not change `launchAllowed=false` or approve a runtime candidate.

## Exact data contract

All records are schemaVersion 1. The binding prefix contains these fields in
this exact order:

| Field | Canonical value |
| --- | --- |
| `schemaVersion` | Integer 1 |
| `installId` | 32 lowercase hexadecimal characters |
| `revision` | Positive uint, invariant decimal, no leading zeroes |
| `epoch` | 32 lowercase hexadecimal characters; installation epoch |
| `policySha256` | 64 lowercase hexadecimal characters |
| `selectionId`, `selectionEpoch` | 32 lowercase hexadecimal characters each |
| `vmId` | Nonempty lowercase GUID in D format |
| `vmIdentitySha256` | 64 lowercase hexadecimal characters |
| `configurationProfile` | Existing B02 `VmConfigurationProfile.Name`: `aegis-offline-fixed-v1` |
| `configurationSha256` | 64 lowercase hexadecimal characters |
| `sessionId`, `sessionEpoch` | 32 lowercase hexadecimal characters each |

The session epoch identifies an original registration generation. It is distinct
from the installation epoch and selection epoch. These scalar metadata values
do not establish live original-owner association or configuration authority.

An operation adds `operationId` (nonempty GUID in N format) and `requestedState`
(integer 2 or 3). These finite descriptors reuse the existing immutable
`VmOperationRecord` intent value: original operation/VM/state, unresolved true,
with no JobPath or ReturnCode. The descriptors grant no permission to request a
state transition. Provider result classification remains in `OwnedVmLifecycle`.

The canonical intent is the closed compact JSON object consisting of this
binding/operationId/requestedState prefix, ending with `}` and without a newline.
Its digest is:

```text
operationSha256 = SHA256(UTF8("aegis-protected-operation-intent-v1\n") || canonicalIntent)
```

The operation frame continues with `operationSha256`, `sequence`,
`previousSha256`, and `phase`, then `}` and exactly one LF byte. Parse recomputes
the operation digest and requires exact re-encoding equality.

A revocation frame is a closed alternative: the binding prefix followed by
`sequence`, `previousSha256`, `phase`=`revoked-admission`, then `}` and LF. It has
no operation ID, descriptor or operation digest.

The chain starts with sequence 1 and a 64-zero previous hash. Every later frame
increments sequence by exactly one and names the SHA-256 of the entire previous
frame, including its LF. Exact UTF-8, fixed ordering and closed scalar grammars
reject BOM, CRLF, invalid encoding, duplicate/unknown/missing/reordered fields,
alternate escapes, extra whitespace and trailing bytes. Retained bytes are
copied; Encode returns a copy.

The bound is 2048 bytes per frame, 256 distinct operation IDs without eviction,
four records per operation, and one reserved revocation frame. The maximum is
1025 frames or 2,099,200 bytes. A full ordinary history still has its reserved
revocation state. Existing terminal outcomes and unresolved intents are retained.

## One monotonic reducer

Replay and the fixture driver use the same private transition validator.

| Prior phase | Legal next phase | Meaning |
| --- | --- | --- |
| Absent | `recorded-intent` | Retain the exact descriptor |
| `recorded-intent` | `durably-consumed` | Store acknowledgment is required by the fixture driver |
| `durably-consumed` | `dispatched-unknown` | Acknowledge this uncertainty marker before any fixture effect |
| `dispatched-unknown` | `settled-success` or `settled-failure` | Require the exact matching synthetic effect acknowledgment |

The replay validator rejects duplicate records, invalid transitions, changed
bindings/digests, sequence gaps or reordered chains. Repeated identical live
fixture requests return the existing observation without another record or
effect. A changed descriptor under an existing ID refuses. Terminal outcomes
cannot be overwritten.

Consumed and dispatched phases are explicitly unknown until settlement.
Revocation before dispatch preserves that consumed intent; it does not invent a
provider-failure settlement. A later observed Off state, fresh lease/session label
or restored bytes cannot clear an unresolved mutation. An unresolved consumed or
dispatched operation prevents consumption of another operation for the bound VM.

Revocation has both committed control metadata and an independent live fixture
admission latch. The latch is set before attempting the control write and stays
set if that write fails. New intent/consumption/dispatch refuses after revoke;
matching settlement for an already dispatched effect remains possible. Revoke
does not imply cancellation, rollback or provider closure. Its repeated request
is idempotent.

Replay labels every accepted record chain `PrefixOnly`. This includes an empty
chain and any shorter valid prefix. Internal checksums cannot establish that a
suffix was not removed. Malformed/incomplete frames refuse with a bounded error;
no accepted or refused observation can become active authority.

## Fixture-only storage and effects

The partial driver, storage interfaces, acknowledgment types and effect methods
live under `tests/fixtures/protected-operation-record/` and the
`PROTECTED_OPERATION_TEST` compile guard. They are absent from production builds.

The fixture driver admits only a fresh empty simulated store. A replayed state
has no store and cannot dispatch. Commit binds the original store and exact
attempt, expected sequence/head and complete bytes; acknowledgment must confirm
full byte count, flush, publication and exact readback. Both consumption and the
pre-dispatch unknown marker require this acknowledgment. Failed or uncertain
acknowledgment latches the live fixture state unavailable. The driver retains
all committed frame bytes, so an observed regression/replacement cannot be
repaired by restoring older bytes.

One gate serializes control/dispatch ordering and rejects reentry. The synthetic
effect runs once only after its unknown marker is acknowledged; the callback is
a synchronous bounded fixture action. Successful callback return creates an
acknowledgment tied to that exact live fixture owner and operation. Copies or
acknowledgments from another attempt cannot settle it. Callback exceptions leave
unknown intent, and dispatch never retries the effect.

The simulated store can report short writes, failed flush/publication, wrong
readback/attempt/store, torn records and crash points before/after persistence.
These are tests of the core's response to a storage contract. They do not measure
actual filesystem durability or authenticate a protected writer.

## Verification and remaining dependencies

The focused Windows test compiles the actual codec/reducer twice, with and
without the test define. Production reflection verifies that fixture store,
acknowledgment and dispatch APIs are absent. Behavioral cases cover canonical
bytes and tuple/digest checks, malformed chains, replay prefixes, duplicate
consume, unknown intent, failed acknowledgments, simulated crash points,
revoked/restored stores, reentry, deterministic concurrent revoke/dispatch
ordering, and full history with reserved revocation. The fixtures count zero
effects before acknowledged consumption/dispatch fencing and at most one
afterward per operation. Capacity coverage exercises all 256 operations.

The initial focused run passed 119/119 tests without skips on Windows x64. It
does not qualify a protected persistent backend, real process/power-loss
recovery, hostile rollback resistance or actual VM management effects. Native
fixture artifacts use a bounded checkout-local data-drive scratch directory
and are removed after closed-handle validation; test reports are kept separately.

The next backend step needs a reviewed original-owner/configuration association,
distinct protected mutation admission, fixed provisioned journal location and
permissions, exclusive compare-and-advance writes, real flush/publication
semantics, and an independently protected monotonic head/recovery policy. A
hash chain or DACL by itself does not supply rollback protection. An actual
effect whose terminal record is absent must remain unknown after restart.

`InstalledOwnerFiles.WriteNew` remains fixed one-use publication. No receipt
allowlist, installer tree/schema, dispatcher or retained VM association was
broadened for this core. B03's narrow candidate-binding seam has separate
ownership and grants no B04 mutation authority.
