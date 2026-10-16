# Inactive runtime candidate core

The runtime candidate parser and retained reader describe a possible future workload. They issue no approval, enrollment, dispatch or launch authority. The installed owner still exposes only `inspect-owned`; `launchAllowed=false` remains unchanged. Production installation does not publish `runtime-candidate.json`, adopt it into the installation stage, or require it as a stage leaf. A missing candidate is unavailable.

## Retained association

`InstalledRuntimeCandidate.Acquire(owner, inspection)` selects only the fixed future leaf beneath `InstalledOwnerPolicy.Root`. It retains the original owner, its reference-equal policy and the original caller-bound inspection. It owns its candidate leaf handle and original bytes; disposing the candidate leaves the shared owner and inspection alive.

The candidate installation/revision/epoch/policy digest, operator SID and selection tuple must match that retained policy. `CheckCandidateBinding` checks the original installed owner by reference, actual caller binding, schema-4 VM/configuration tuple and original registered bytes. It fences a fresh inspection using the same retained native manager. Neither a copied tuple nor a separately parsed VM record supplies this association. Prepared inspections remain unavailable until the original caller has been bound.

Every reader check revalidates the owner/policy association, original candidate volume/file identity, descriptor, metadata and exact bytes, and then checks the association again. The two-second reader budget follows the existing fixed-record reader convention. Missing, malformed, replaced, unprotected or stale records refuse. A failed retained reader closes permanently; restoring bytes, metadata or an observed owner does not revive it. Candidate construction accepts no production root selector, provider factory or passing authority callback. Test injection factories compile only under `RUNTIME_CANDIDATE_TEST`.

## Closed data format

The record is canonical UTF-8 without BOM, whitespace, trailing bytes, duplicate/unknown fields or reordered fields. Its exact field order is:

`schemaVersion`, `installId`, `revision`, `epoch`, `policySha256`, `operatorSid`, `selectionId`, `selectionEpoch`, `vmId`, `configurationProfile`, `configurationSha256`, `osImageBytes`, `osImageSha256`, `bootstrapBytes`, `bootstrapSha256`, `packageBytes`, `packageSha256`, `entryPoint`, `arguments`, `maximumProcesses`, `jobMemoryBytes`, `processMemoryBytes`, `durationMs`, `status`.

Schema version is 1, configuration profile is `aegis-offline-fixed-v1`, and status is `candidate`. IDs/hashes use their existing lowercase canonical forms; numeric values are unsigned decimal without redundant leading zeroes. Strings permit literal valid UTF-8 and canonical quote/backslash escapes. Control characters and alternate Unicode/slash escapes refuse. The metadata exposes immutable scalar values and cloned argument arrays.

| Value | Bound |
| --- | --- |
| Whole record | 1–16384 bytes |
| OS image identifier | 1 MiB–64 GiB |
| Bootstrap and package identifiers | 1 byte–4 MiB each |
| Entry point | 1–240 ASCII characters, `/`-separated components of at most 64 characters |
| Arguments | At most 16; at most 512 UTF-8 bytes each and 4096 bytes total |
| Processes | 1–32 |
| Job/process memory | 1–512 MiB each; process limit cannot exceed Job limit |
| Duration | 100–120000 ms |

The entry point is package-relative data. Empty/dot/traversal components, absolute/drive/device paths, ADS, backslashes, reserved DOS device stems and trailing dots refuse. There are no host-command/path, provider URL, credential, approver or approval fields. Unknown fields refuse. Arguments have no command, credential or provider interpretation in this branch: no execution API consumes them.

## Integrity and approval boundary

OS, bootstrap and package sizes/digests identify supplied bytes. They do not establish trusted provenance, a safe workload or approval. The parser opens none of these artifacts. Resource bounds describe candidate data and grant no permission to run it. Fixture digests and entry points are harmless dummy candidates and must never be copied into an approved runtime selection.

The focused fixture exercises canonical parsing, malformed/overflow inputs, stale tuples, original-owner and caller association, fresh inspection, retained-file loss and permanent refusal. VM/configuration/storage and installation authority are modeled. Native process registrations and the candidate file sharing/identity controls are real where explicitly labeled; the positive file-control case models acceptance of protected descriptors. Production compilation excludes injected candidate factories. These checks do not qualify a real installed service, Hyper-V configuration, guest runtime, trusted image or production issuance.

Drafting dependency: reviewed frozen B02 source `7ecdc67b4abe066d630e081dc4e5f621d43b1a4e`. Publication requires dependency merge, then-current master integration and independent review of the integrated revision.

Runtime candidate parser/retained-reader core complete; approved issuance and runtime authority absent. Full B03 active-manifest completion still depends on approved OS/bootstrap/package provenance, fixed workload selection and reviewed issuance.
