# Inventory snapshots and explicit acceptance

AEGIS can save a content snapshot, record explicit acceptance of an exact reviewed
digest, and compare a fresh capture with that accepted snapshot. A file, package
record or supplied MCP descriptor change requires another review. Saving and
comparing never update an existing baseline.

This is a CLI workflow. It does not intercept tool calls or block processes.
`assessment: "not-performed"` remains present, including in accepted snapshot files.
Acceptance records a local review decision about bytes; it does not establish
publisher identity or absence of malicious behavior.

## Commands

Run from the AEGIS checkout with Node.js 24. The project and snapshot directories
must already exist. Choose snapshot storage **outside** the inspected directory:

```powershell
node src/main/main.js --inventory-snapshot-json project "X:/work/example" "X:/aegis-review/example-01.json"
node src/main/main.js --inventory-accept-json "X:/aegis-review/example-01.json" "<reviewed digest>" "X:/work/example" "X:/aegis-review/example-01-accepted.json"
node src/main/main.js --inventory-diff-json "X:/aegis-review/example-01-accepted.json" project "X:/work/example"
```

The capture command returns its digest and `state: observed`. Inspect the files
and the [inventory/package evidence](PROJECT-INVENTORY.md) before accepting; the
snapshot contains hashes, not a readable source-code review. Pass that exact
64-character digest to the acceptance command. Acceptance rereads the directory
and refuses stale, incomplete or mismatched content. Its output is a **new**
`state: accepted` snapshot with its own digest. The original remains unchanged.

`project` can be replaced by any [profile adapter](PROFILE-INVENTORY.md), such as
`codex-user`. The acceptance command obtains the adapter from the saved snapshot,
while the caller still supplies the directory. No user-home discovery is added.

After an update, save another observed snapshot, review it and explicitly accept
its digest into another new file. Commands refuse existing output paths. They
never rotate, delete or automatically replace previous accepted snapshots.

## Comparison results

| `status` | `reviewRequired` | Meaning |
| --- | --- | --- |
| `accepted-content-unchanged` | `false` | Fresh complete content matches a previously accepted snapshot with the same subject and coverage contract |
| `review-required` | `true` | Content changed, or the reference has never been accepted; an unchanged observed snapshot still requires review |
| `incomplete` | `true` | Either snapshot has missing/unreadable/unsupported data or an incomplete supplied tool catalog |
| `incompatible` | `true` | Root, adapter, coverage/version/limits or explicit tool source differs; no cross-scope content comparison is returned |

`changes` has separate component, package and tool groups. Complete comparisons
report `added`, `removed` and `changed`; changes list content/metadata reasons.
When coverage is incomplete, absent entries are `unobserved`, and first-seen
entries are `newlyObserved`. They are not presented as confirmed deletions or
additions. File metadata includes size, kind, structural counts and provenance,
so a content edit can change both fingerprints. Tool names appear only as opaque
IDs, and `catalogBytesChanged` also detects changes to the raw export.

Exit codes depend on the command:

- Capture: `0` saved complete observed content; `2` saved partial observed content.
  Both return `reviewRequired: true`.
- Accept: `0` recorded exact reviewed content after a fresh match; `1` refused.
- Diff: `0` only for `accepted-content-unchanged`; `2` for review, incomplete or
  incompatible results; `1` for invalid input, unreadable artifacts or other errors.

All errors return a fixed code and `reviewRequired: true`. An exit code of zero
from **capture** is not a trust decision. Even a successful **diff** is not a
malware verdict or a grant to execute a tool. `issueCount` on capture and the two
issue counts on diff expose incomplete coverage; use the original inventory
command for detailed filesystem/parser/package issue reasons.

## Explicit offline MCP catalogs

Append `--tools-file "X:/exports/tools-list.json"` to each capture, acceptance
and comparison command to include one already exported `tools/list` result.
The file may be a bare result (`{"tools": [...]}`) or a successful JSON-RPC 2.0
response (`{"jsonrpc":"2.0","id":1,"result":{"tools":[...]}}`).

AEGIS checks a bounded structural subset: unique nonempty names, at most 256
tools, object input/output schemas with `type: object`, and string descriptions
when present. Legacy results without `resultType` and newer results with
`resultType: complete` are accepted. Other result types, ambiguous envelopes and
duplicate names are rejected. Any `nextCursor`, including an empty string,
means the export is incomplete and cannot be accepted.

The full descriptor is fingerprinted: description, input/output schema,
annotations, icons and extension fields. Their values are not stored or printed.
Remote `$ref` references and icon URLs are never fetched; schemas and annotations
are not evaluated as safety claims. Omission or substitution of the source file
changes the comparison contract. Raw export bytes are also fingerprinted, so
formatting, ordering, request IDs and numeric spelling changes can require review
even if descriptor fingerprints are otherwise equal.

The source binding identifies an explicitly selected export path. It does not
authenticate a server, authorization context or freshness. A stale export stays
stale; AEGIS does not connect, initialize MCP, follow pagination, combine servers
or listen for `list_changed`. Live collection/enforcement belongs to B2.

Format references checked on 2026-09-15:
[MCP 2025-11-25 tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools),
[MCP 2026-07-28 tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools).

## Storage, bounds and trust boundary

Snapshot format 1 has a fixed allowlist of fields. It stores the observed/accepted
state, root/scope/source bindings, completeness and issue counts, component paths
and hashes, package-evidence hashes and tool hashes. The digest covers the format,
state and body with deterministic object-key ordering. Relative entries are sorted;
duplicate paths, absolute/traversal paths, unknown fields, versions and malformed
digests are rejected before comparison or output. Inventory schema 3 JSON is not
itself a snapshot file and cannot be imported as an accepted snapshot.

The root binding hashes the canonical selected path. Moving the project or using
a different adapter/coverage contract requires another review. Catalog bindings
also hash their canonical selected path. These hashes are not anonymization.
Relative filenames can reveal private information; review artifacts before sharing.
No artifact is uploaded automatically.

Each snapshot and supplied catalog is capped at 1 MiB, independently of the
underlying [inventory read/decompression limits](PROJECT-INVENTORY.md). JSON uses
strict UTF-8, duplicate-key rejection and the existing depth cap. Snapshot arrays
are capped at 1,024 file fingerprints, 64 package fingerprints and 256 tool
fingerprints. Snapshot files must be outside the subject for capture, acceptance
and comparison. File reads reject
linked files; explicitly selected parent directories are canonicalized, including
junctions. Output creation is exclusive, requests POSIX mode 0600 and syncs before
success; Windows permissions depend on the selected directory's ACL. No global
permissions or configuration are changed. Output handles must be regular files;
filenames that select NTFS alternate streams are rejected before opening.

A failed write attempts to remove only its own closed partial file after checking
identity; a replaced path is preserved. Publication is not an atomic rename:
concurrent readers can encounter partial JSON and must treat that as unavailable.
There is no automatic snapshot history or background growth; each retained file
comes from a caller-selected save/accept command and remains under caller control.

The digest is **unkeyed**, not a signature or proof of who accepted the snapshot.
An attacker able to rewrite the store can forge a new consistent accepted file.
Keeping storage outside a project does not itself supply OS access isolation.
Use storage protected from the monitored agent; protection of the trust store and
AEGIS itself belongs to C2. This implementation provides no rollback protection.

All reads remain best effort, not an atomic filesystem capture. Root identity is
checked across capture; files can still change afterward. Comparison must be run
again to observe those changes. Existing inventory gaps, including unsupported
packed/indirect Git evidence, keep a snapshot incomplete and prevent acceptance.
An empty complete snapshot covers only the declared locations, not the machine.
