# Local package evidence

Both [inventory commands](PROJECT-INVENTORY.md) emit schema 3. They associate
inventoried files with their nearest observed `package.json`, compare declared
name/version with a local npm lockfile, and compare manifest bytes with local Git
objects. No package manager, Git command, hook, filter, client or script runs.
There is no network lookup, installation or automatic trust decision.

## What each result establishes

| Evidence | Meaning | Remaining unknown |
| --- | --- | --- |
| `declaration: self-declared` | A parsed manifest declares a name and exact SemVer version | Whether an agent installed or loaded the package |
| `lockfile.status: consistent-local-metadata` | An observed npm lock entry has the same name and full version | Downloaded artifact integrity, registry identity, publisher |
| `git.status: matches-local-commit` | Manifest bytes match a regular blob reached from local HEAD and trees; object IDs are checked | Signature, publisher, remote repository, other package files |
| `git.status: differs-from-local-commit` | The observed manifest differs from that local blob | Whether the change is intended or malicious |
| `publisher: not-verified`, `installation: not-established` | No such verification was performed | Local agreement never changes these to trusted |

Two attacker-controlled local files can agree. Local Git objects can also be
replaced together with the manifest. Consumers must not translate agreement into
a safety verdict. `assessment` remains `not-performed`.

## Scope and linkage

Project inventory probes root `package.json`, `npm-shrinkwrap.json` and
`package-lock.json`. Both commands recognize these names in files already read
inside declared skills roots. No additional `node_modules` traversal, package
cache discovery, command parsing or config-reference resolution is added.
Nested `node_modules` are only encountered inside that existing bounded walk.

Every processed manifest produces a `packages` record with its relative
`manifest` path, raw `sha256`, declaration, identity summary, lockfile and Git
evidence. Contained components receive `provenance.packageRef` pointing to their
nearest observed manifest and `packageIdentity: contained-in-local-package`.
This does not identify the package as an AI agent. An unreadable or budget-excluded
nearer manifest prevents fallback to a processed ancestor.

Project lockfile/Git lookup stays inside the selected project. Profile lookup
stays inside the relevant skills root; it never climbs into a home/profile-level
repository. Metadata outside these bounds is unknown. Symlinks, junctions and
special files remain excluded.

## Version and npm lockfiles

Raw names and versions stay internal for exact comparison. Output contains
`nameSha256` and a version summary with numeric `core` (for example `1.2.3`),
`prerelease` and `buildMetadata` booleans, and `sha256` of the full version.
Prerelease/build identifiers can contain private values and are not returned.
Missing/invalid identities remain `identity-incomplete` or `invalid`. Versions
are never inferred from commands or copied into `provenance.agentVersion`.

Only npm lockfile versions 2 and 3 are compared. The nearest observed lockfile
wins; in the same directory `npm-shrinkwrap.json` takes precedence over
`package-lock.json`, including when malformed or unreadable. Comparison uses the
manifest's relative location in the lockfile's `packages` map. Root name/version
fields are checked when present. A missing entry name can be inferred from an
exact `node_modules` path segment; explicit alias names take precedence. Entries
with `link` are `link-not-followed`.

`source` includes only a fixed reference kind and `integrityDeclared` boolean.
URLs, credentials, integrity strings, scripts, environment values and descriptions
are excluded. An npm SRI value describes an artifact; this implementation does
not download or verify the artifact or an installed tree.

## Git coverage and bounds

The reader probes containing `.git/HEAD` paths within the boundary. It supports
detached HEAD and a single `refs/heads/…` or `refs/tags/…` reference, including a
matching entry in `packed-refs`. Only required loose commit/tree/blob objects are
read. SHA-1 or SHA-256 IDs are checked against decompressed bytes. The actual
manifest blob is additionally compared using SHA-256, including in SHA-1 repos.
Scope is always `manifest-only`: a script fingerprint can change while that proof
still matches. Signatures and publisher identity are not verified.

Packfiles, reftables, symbolic-ref chains, `.git` indirection files used by
worktrees/submodules, external object stores, alternates, replacements and Git
configuration are not resolved. Missing loose objects are `object-unavailable`;
unreadable/linked/indirect metadata yields an unavailable status and an issue.
No visible repository gives `not-observed`, which is not an error. Unicode and
other refs outside the supported ASCII syntax yield `invalid-head`.

Physical reads share the inventory's entry/file/total-byte limits. A separate
`limits.gitInflatedBytes` bounds total decompression (8 MiB by default), including
failed attempts; one expansion cannot exceed `fileBytes + 64`.
`usage.gitInflatedBytes` records the charged amount. At most 64 manifests receive
package evidence. Missing objects, malformed formats, contradictory lock entries
and exhausted limits make `complete` false and yield exit code 2. A manifest that
simply differs from a valid local commit is an observed difference; it alone does
not change the exit code. Consumers must inspect evidence statuses.

The snapshot is best effort, without atomic capture, signing or persistence.
Hashes and paths are metadata, not anonymization; filenames can contain private
values. [Snapshot commands](INVENTORY-SNAPSHOTS.md) can separately persist these
fingerprints, record explicit review and detect later changes; they do not add
publisher authentication.

## Verified references

Checked 2026-09-15:

- [npm v11 lockfile format and precedence](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json/).
- [Git loose object format](https://git-scm.com/docs/gitformat-loose.html).
- [Git object and tree structure](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects).

Tests cover objects written by Git, SHA-1/SHA-256 fixtures, version disagreement,
lockfile precedence, secret canaries, missing/substituted objects, linked/indirect
Git directories and shared decompression limits.
