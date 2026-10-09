# Enrollment ancestor metadata: native regression and retained role

This follow-up is based on `428f96ee02df86575cf91a6f805073c685587820`.
It corrects the inactive enrollment observer's comparison of incidental activity
on a retained ancestor directory. Full E1/A1, protected provisioning, broker
admission and launch authority remain unqualified.

## Contract and correction

The [inspection contract](enrollment-inspection.md) permits sibling creation on
ancestors while requiring protected replacement and descriptor rights. Creating
an unrelated sibling can change the ancestor's native `LastWriteTime` and
`ChangeTime` without changing the held branch's identity or security descriptor.
The original metadata comparison treated this activity as invalidation.

The trusted inspection and lease now pass an explicit ancestor role into the
held-object recheck. Only an ancestor that is also a native directory excludes
write/change timestamps from equality. The protected enrollment root and files
retain their original comparison. Creation time, full volume/file identity,
final path, attributes, reparse/type state and exact descriptor comparison remain
required. The pre-existing last-access exclusion remains unchanged.

The role is selected by the trusted observed ancestor chain, including at the
final inspection recheck and retained lease use. `Protected(bool)` remains a
descriptor query without policy mutation. No wire input selects this role.
Record bytes, image digest, process generation, primary-token context, thread
token absence, Job membership/accounting and permanent revocation remain the
existing [lease contract](retained-enrollment-lease-evidence-20261009.md).

## Preserved native baseline

The bounded same-principal experiment first passed a clean native snapshot and
lease. Creating a real sibling under the retained parent changed directory
write/change timestamps. Independent native queries observed unchanged full
file identity, descriptor digest, creation time and attributes. The baseline
snapshot and lease refused; removing the sibling did not revive the lease.

A paired control created a child inside the protected enrollment root. The
baseline also refused that root metadata change. The correction keeps this
strict boundary rather than applying an ancestor policy to every directory.

Original sources, compiler commands, real observations and executable hashes
are retained in `X:/tmp/aegis-enrollment-ancestor-20261009-evidence/baseline-native.json`
and `root-paired-native.json`. Protected-descriptor acceptance in the lease
adapter is explicitly modeled; independently compared native descriptor bytes
are actual observations. No host ACL or protected installation was provisioned.

This demonstrates an ancestor-timestamp refusal mechanism. It does not recover
the erased exception or prove the exact cause of the previous five failures in
the four-worker Windows coverage run. Those original failed receipts remain
preserved under `X:/tmp/aegis-github-review-20261006`.

## Verification boundary

The meaningful test-first baseline failed the retained-sibling and capture-sibling
expectations while its other eight controls passed. A preceding fixture JSON
formatting error was corrected first and remains a separate failed receipt.
It is not counted as the behavioral failure signal.

The corrected focused enrollment suites passed 70 tests without skips. The new
suite checks ordinary sibling creation/deletion during inspection and retained
use, strict enrollment-root child activity, native creation/attribute/time
controls, and refusal of an ancestor role on a nondirectory. Each mutation
control distinguishes an independently observed applied change from a refused
native mutation; a blocked mutation is not evidence that a changed object was
accepted and then rejected.

Direct native observations applied sibling/root child creation and ancestor,
root and leaf Hidden-attribute changes. The attribute controls caused native
snapshot and lease refusal. Creation-time and root/leaf write-time setters were
refused by the actual retained pins; those three cases are pinning controls,
with unchanged independent observations and a still-valid lease. They do not
establish rejection after an applied creation/write-time change. The compiled
diagnostic and per-case observations are preserved in `corrected-native.json`.

Behavioral, native, build and integration receipts are retained in the task's
external evidence packet. Independent GPT-6.1 Sol review covers the frozen source
and evidence, with later source changes requiring a new review.

Ordinary same-principal controls do not qualify a protected supervisor, native
ACL replacement by a hostile principal, complete VM isolation, durable recovery
or launch. The production prepare path remains unavailable. No account, service,
VM, host permission, workflow or lockfile change belongs to this correction.
