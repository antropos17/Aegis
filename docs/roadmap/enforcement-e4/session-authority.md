# Session capability and operation ledger

This reusable owner-side broker executes a fixed callback only after recording a
bound one-use attempt. It consumes existing policy outcomes and adds no policy
rules. The fixed qualification harness runs dummy effects in a fresh disposable
directory. Production Protected Session v1 remains unchanged and unavailable;
every broker receipt retains `launchAllowed=false`.

## Trusted creation and byte binding

`src/main/session-authority.js` exports `createSessionAuthority(context, options)`.
Only a trusted owner may call the factory and its issuer, after independently
admitting its session context. Syntax validation establishes no OS identity,
protected inventory, VM ownership or guest authentication. No IPC exposes either
factory or issuer, and caller-supplied JSON cannot reconstruct a capability.

The owner context contains `sessionId`, `epoch` and `policyRevision`. The fixed
operation allowlist is copied at construction. `issue(request, policyOutcome,
{approved})` binds `operationId`, operation, exact request/snapshot SHA-256 digests,
expiry and a fresh private nonce. An existing `allow` can mint; an existing `ask`
also needs explicit trusted approval. A `deny` never mints, even with approval.
Changing policy revision or epoch requires revoking the old authority and creating
a new one. Old capability objects fail after restart or with another authority.

`createSessionOperationBroker({authority, ledger, dispatchers})` accepts only fixed
trusted callbacks. `dispatch(capability, {operationId, operation, request,
snapshot}, {signal})` copies bounded Buffer bytes before any asynchronous work,
hashes those copies, and reserves the exact capability before awaiting persistence.
Substitution invalidates it; another concurrent reservation cannot dispatch it.
Issuance, byte sizes and lifetimes have fixed bounds. Raw contents are never put
in public receipts or ledger records.

## Irreversible attempt and outcome

`src/main/operation-ledger.js` exports async `createOperationLedger(storePath)` for
an existing canonical owner-selected directory. It checks ordinary filesystem
identities/ancestors, refuses links, unknown entries and oversized records, and
serializes writes with an exclusive lock. Each globally unique owner operation ID
has a create-new hashed `.spent` record. Complete write, file sync, readback and
lock release must succeed before dispatch. An owner must retain an operation ID
across reconnection/recovery; choosing a new ID is a new explicit operation, never
automatic retry. Session, epoch or nonce changes do not renew a spent operation ID.

Persistence failure dispatches nothing and does not restore the capability.
Partial records and crash-left locks remain unavailable evidence; they are not
automatically cleared. The broker rechecks revocation/cancellation/expiry after
spending. A refusal then records `not-dispatched`. A crash after spending but
before recording a result is `outcome-unknown` on inspection.

The fixed callback receives owned request/snapshot Buffers and the capability's
AbortSignal. Owner revocation, capability cancellation, external invocation abort
and its actual expiry timer abort that signal. The broker races the callback
against the signal, so an abort-ignoring callback cannot keep it waiting past the
capability deadline. The signal is also closed when the attempt finishes. Buffers
are cleared on broker return; a cancelled callback must not keep using them.
Abort after dispatch cannot reverse effects or establish process termination.

Only a trusted callback's `status: completed` can record completion. Thrown errors,
missing responses and abort before the terminal decision return `outcome-unknown`
and never retry. `settle(binding, state, {signal})` writes, syncs, closes and reads
back a create-new `.pending` candidate. A pre-decision abort prepares a separate
`.pending-unknown` candidate; failure leaves spent intent unknown. Inspection never
treats either pending candidate as completion. Only rename publication to `.outcome`
confers a terminal state. Terminal records use schema 2; older terminal records
fail closed, while the consumed-record schema remains 1.

The terminal decision is linearized at the last signal check immediately before
invoking publication, with no intervening await. Abort after that point is too late
to change a successfully published completion. Failed publication returns unknown;
cleanup failures after successful publication preserve the committed state and
disable further writes through that ledger handle. `settle` returns the published
`{state, published: true}` decision and never overwrites it. Records contain only
schema, binding hash and fixed state. Revocation still aborts the callback signal
after this cutoff, and finishing closes it, regardless of the reported state.

## Executable qualification and exclusions

Run `node scripts/qualification/qualify-session-authority.mjs <mode>` with exactly
one fixed mode: `allow`, `ask`, `deny`, `lost-response` or `revoked`. The harness
uses the existing `evaluateActionPolicy()` against its own fixed policy and
request, then invokes the actual broker. Its callback writes one fixed dummy byte;
an independent file/counter oracle checks effects and replay refusal. The Bash
command field is a policy label and is never executed. No arbitrary source,
command, endpoint, credential or output selector is accepted.

These ordinary-account receipts do not resist hostile same-principal rewriting,
rollback or preexisting memory-mapped writers. File sync is observed through the
supported API, without a power-loss durability claim for directory publication.
There is no VM, protected host/guest identity, network enforcement, real provider
credential, original-host export or release qualification. Full gates remain
UNREVIEWED. Native launch must still require independently qualified ownership
and containment; the capability issuer cannot manufacture them.
