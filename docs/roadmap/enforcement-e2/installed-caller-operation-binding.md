# Installed caller operation binding

The installed `inspect-owned` path consumes one authenticated main operation and
publishes one read-only result fence. The completion is usable only through the
original retained objects; its fields and result are insufficient to reconstruct
authority. This path leaves `ownershipQualified=false` and `launchAllowed=false`.
Lifecycle dispatch, preparation authority, agent release and production activation
remain unavailable. A1-A4 remain `UNREVIEWED`.

The installed path also requires the two protected records described by
[fixed inspection registration](installed-fixed-operation-registration.md).
They bind the exact policy, operator, inventory, fixture and executable images
before endpoint publication. Missing records refuse the new installed reader.

## Operation and installed selection

`CallerMainOperation.Accept` retains the exact published `Context` and original
`CallerAdmission.Context`. Context checks require both object identities to match
the operation that accepted the live pipe peer. A second context constructed from
the same operation cannot replace the published context.

Installed checks also require the same `InstalledOwnerRegistration` retained by
the operation. After rechecking that registration, they compare the original
admission's selection ID, selection epoch and inventory revision with the retained
policy's `SelectionId`, `SelectionEpoch` and `Revision`. Membership in a generic
role inventory alone does not satisfy these installed checks.

`InstalledOwnerFiles.PublishMain` already pins the installed inventory
byte-for-byte to `InstalledOwnerFiles.Inventory(policy)` before publishing main
registration evidence. The new local comparisons make this contract explicit at
issuance and during retention. They do not demonstrate a currently exploitable
selection gap in the existing installed publication path.

## Single issuance and permanent failure

`InspectInstalledOwned` validates the original installed binding and supervisor
deadline, issues one native inspection authorization, consumes it through the
fixed-operation dispatcher, and records the one completion it issues. The
authorization retains the original context, admission/request, main generation,
registration generation, installed owner and deadline. The dispatcher allows only
`inspect-owned`; direct installed calls to `InspectOwned` are refused.
Completion checks require that exact issued completion, the published context and
the original native admission. Directly constructing another completion with the
same references cannot substitute for issuance. A second inspection or completion
issuance is refused.

The context records the `InstalledOwnerDeadline` from its first installed attempt;
completion validation requires that same deadline object. Each recheck tests
that deadline before and after the retained native, installation and selection
checks. The initial dispatch still enforces the original two-second admission age;
the terminal completion uses `CheckRetained` to keep checking the original pipe
peer, token and held process identity under the supervisor deadline. It also
rechecks the consumed authorization and original protected records. No renewal
method or second dispatch is exposed.

Failures during initial installed issuance, completion validation or installed
owner validation close the operation. This includes deadline expiry, a foreign
owner, selection mismatch, lost peer or revoked retained evidence. Restoring the
inputs or supplying a fresh deadline cannot revive that operation. Its borrowed
server and installed registration keep their existing ownership and disposal
rules; closing the operation releases the resources it owns.

## Native fixture evidence boundary

The main-admission harness compiles all production C# files in `sidecar/session`
and `sidecar/owner` with an explicit `MainAdmissionFixture` entry point and the
required framework references. It retains its fixture transport and descriptor
model while exercising native process, token, Job and pipe admission. Its strict
root case continues to exercise production descriptor rejection. The fixture's
exact temporary root is validated and removed after the suite; capped command
logs and verification receipts remain outside that disposable root.

The installed completion fixture adds test-only factories under
`CALLER_MAIN_OPERATION_TEST` for modeled installed authority and policy. Those
factories compile out of production. They allow the actual operation and
completion implementation to be exercised through native admission while
controlling installed-policy and authority failures. They do not establish SCM
installation, SYSTEM supervision, protected installation ACLs, an actual Hyper-V
registration, or a hosted VM result. Test assertions and passing run receipts
must identify those modeled inputs explicitly.

An installed or hosted qualification still requires an exact-source passing
receipt for the full protected installation path and its registered VM. Existing
storage, network, lifecycle, crash and acceptance requirements remain open; local
native fixture evidence supplies no E1/E2/E3 or A1-A4 acceptance.
