# Private Claude hook configuration plans

`src/main/claude-hook-plan.js` is an IO-free planning library. Its inputs are
explicit configuration bytes, a selected absolute path label, and an existing
owner-selected command. It neither discovers profiles nor reads or writes files,
executes commands, installs hooks, changes permissions, activates a provider, or
adds a setting. No production caller or IPC surface is connected in this slice.

The supported contract identifier, `aegis-action-policy-hook-v1`, describes the
entry in [ACTION-POLICY-HOOK.md](ACTION-POLICY-HOOK.md):

```json
{"matcher":"Bash","hooks":[{"type":"command","command":"<owner-selected command>","timeout":5}]}
```

The entry is appended to `hooks.PreToolUse`. Missing target containers are
created. The planner supplies only these supported fields and adds no managed
marker to provider configuration. The selected command is retained literally as
a JSON string. The library does not generate or qualify shell quoting, command
safety, executable or policy paths, provider versions, provider acceptance,
timeout behavior, or enforcement. A timeout is an integer from 2 through 60
seconds, exceeding the existing adapter's internal 1.5-second deadline; that
arithmetic establishes no provider failure guarantee.

## Explicit inputs and private results

`planInstall({ configPath, configBytes, command, contract, timeoutSeconds })`
requires an ordinary Buffer and own data properties on a plain options object.
`configPath` is an opaque syntactically absolute label, checked without filesystem
access or normalization. It does not establish the existence, identity, ownership,
permissions, link status, or active use of a file. The exact label is hashed for
subsequent manifest binding. Callers must select and verify the actual target.

A successful result contains `beforeSha256`, `afterSha256`, ordered `edits`, and
`changedFragments`. Each edit has zero-based half-open UTF-8 `startByte` and
`endByte` offsets and a literal `replacementUtf8` string. Apply edits in descending
offset order to a private copy of the exact input bytes. The planner returns no
complete before/after configuration. The caller retains the original bytes for
backup; unrelated values are never reserialized. Existing whitespace, numeric
spelling, escapes, LF/CRLF and non-ASCII bytes survive unchanged. Inserting compact
JSON can produce mixed formatting; formatting an entire profile is outside scope.

Changed fragments contain the selected file label, exact removed/inserted token
fragments, byte offsets, and `before`/`after` start/end line and column positions.
Line and column numbers are one-based; columns count UTF-16 code units, matching
JavaScript string positions. CRLF counts as one line break; lone CR and LF each
count as a line break. End positions are exclusive. `contextOmitted: true` means
these are **changed fragments**, not full-line diffs. Adjacent unchanged values,
even values on an affected line, are intentionally absent. Byte offsets count
UTF-8 bytes, so they differ from columns for non-ASCII characters.

An insertion returns `status: "planned"`, current `presence: "Unknown"`, and
`plannedPresence: "Configured"`. These describe a possible configuration change;
the library has applied nothing. A pre-existing structurally equal entry returns
`status: "configured"`, `presence: "Configured"`, no edits, and no ownership
manifest. It does not adopt an equal hook, including on a repeated planning call.
A selected command already present with different fields is refused as a
conflict, including when another equal entry exists before or after it. All
selected-command occurrences are checked before the equal-only idempotent result.
Configured presence establishes neither Observed nor Blocking verified.

New insertions also return a private serialized `manifest` and its
`manifestSha256`. The manifest binds the path label, before/installed hashes,
entry hash, exact command, timeout, insertion shape/offset, and entry index. It
contains only the owned insertion artifacts. It contains no unrelated settings.
Neither the manifest nor a matching hash authenticates ownership or protects
against a malicious caller. A future writer must keep the approved manifest and
its digest in trusted private storage associated with the verified backup and
owner confirmation. A caller-supplied replacement manifest and digest are not
ownership evidence.

## Removal and rollback

`planRemoval({ configPath, configBytes, manifest, manifestSha256 })` receives
explicit current bytes and the previously recorded private manifest and digest.
It refuses a changed manifest digest or different path label.

When the current bytes match the manifest's installed hash exactly, the planner
removes only the recorded insertion, verifies that this reconstructs the exact
before hash, and returns `mode: "exact-rollback"`. This reconstructs every original
byte without returning or displaying unrelated configuration. A future writer
may restore a complete verified backup only while the current file still equals
the recorded installed version.

If current bytes differ, a fresh `mode: "targeted-removal"` preview removes only
the unique exact owned entry and one necessary comma. It preserves concurrent
unrelated values and other entries. Created empty containers remain in place.
The owned entry must retain its recorded array index and exact generated bytes;
reformatted, changed, moved, absent, duplicate, or otherwise ambiguous entries
are refused. Another occurrence of the selected command is ambiguous. Concurrent
insertion or reordering ahead of the entry can therefore require manual review.
Removal reports Unknown presence because no provider state has been inspected.

## Required future writer boundary

The library enforces absence of its own IO; it does not implement a writer or
perform the following gates. Before any profile mutation a separately reviewed
writer must satisfy all of them:

1. Display the exact selected file label, changed fragments and hashes; obtain
   a later owner confirmation bound to this exact plan and target. Producing a
   plan or selecting a command supplies no profile-write authorization.
2. Retain a private exact-byte backup, verify its before hash by readback, and
   record the manifest/digest and restoration procedure. Preserve appropriate
   file metadata and access restrictions; do not log the backup bytes.
3. Revalidate the target identity and exact current bytes immediately before
   writing. If the file changed, produce and confirm a fresh plan. Handle links,
   races, metadata, permissions, atomic replacement and crash recovery in that
   writer's own reviewed contract; a byte hash alone does not solve those races.
4. Apply only the approved edits and verify the exact after hash by readback.
   On failure, stop and use the verified backup under the same revalidation
   constraints. Concurrent unrelated edits require a new targeted removal plan;
   never overwrite them with an old whole-file backup.

The returned `requirements` list names owner confirmation, verified private backup,
current-byte revalidation and written readback. It is an obligation for a future
writer, not evidence that those operations occurred.

## Privacy and bounds

Treat **the entire result**, manifest, selected path, command and hashes as private.
Unknown configuration values can hold credentials. Do not persist these plans in
audit records, IPC, exports, diagnostics, telemetry or ordinary reports. A
separately reviewed privacy projection is required before any such persistence
or exposure. Even a changed fragment can disclose a secret embedded in an
owner-selected command. This module never prints or logs inputs or results.

The source scanner accepts strict UTF-8 JSON with an object root. It rejects BOM,
comments, trailing commas, malformed syntax and duplicate decoded property names
at every depth. It preserves unknown values, including names such as `__proto__`,
without materializing configuration objects or assigning their properties. It
validates target containers, not every provider setting against a provider schema.
Inputs and generated output are limited to 256 KiB, nesting to 32, value nodes to
20,000, command bytes to 4,096, manifest bytes to 16,384 and serialized changed
fragments to 32 KiB. Paths are limited to 4,096 UTF-16 code units. No arbitrary
exception, path diagnostic, source excerpt, or provider response is returned on
failure. Failures have only `ok: false` and one fixed reason code:

`INVALID_BYTES`, `CONFIG_TOO_LARGE`, `INVALID_ENCODING`, `INVALID_JSON`,
`DUPLICATE_KEY`, `CONFIG_COMPLEXITY`, `INVALID_OPTIONS`, `INVALID_SELECTION`,
`UNSUPPORTED_CONTRACT`, `UNSUPPORTED_STRUCTURE`, `PREVIEW_TOO_LARGE`,
`INVALID_MANIFEST`, `MANIFEST_MISMATCH`, `OWNED_ENTRY_CHANGED`,
`AMBIGUOUS_OWNERSHIP`, or `SELECTED_COMMAND_CONFLICT`.

Own accessors are rejected without invoking them; byte copying uses intrinsic
typed-array operations. Exception-message accessors are not invoked. This is an
in-process library in a trusted JavaScript realm, not a sandbox for hostile
JavaScript proxies, mutated intrinsics or concurrently changing shared memory.
It executes no callbacks supplied by the caller. Provider qualification, actual
profile read/write/backup handling, hook activation, Electron integration and
denial enforcement are outside these local planning tests. The pending W5 owner
prerequisite remains pending; this planner supplies no completion evidence for it.
