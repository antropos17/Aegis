# Static project and profile inventory

Run with Node.js 24 from the AEGIS source checkout:

```powershell
node src/main/main.js --inventory-json "X:/path/to/project"
```

The command prints a JSON snapshot and exits before loading Electron or starting
monitoring. It reads only recognized locations below the explicit project root.
It does not start MCP servers, run hooks/scripts, install packages, make network
requests or store a baseline. Discovery does not prove installation, activation,
trust or safety. `assessment: "not-performed"` is always present.

Separate [snapshot commands](INVENTORY-SNAPSHOTS.md) add explicit persistence,
exact-digest acceptance and fresh comparison. The inventory commands above remain
read-only. Snapshot acceptance does not establish package safety.

User and managed directories have a separate explicit command:

```powershell
node src/main/main.js --inventory-profile-json codex-user "C:/Users/example/.codex"
```

See [profile layouts, OS paths and source references](PROFILE-INVENTORY.md).
The project command never expands its scope to the user's home directory.

## Scope

| Locations | Inventory |
| --- | --- |
| `.mcp.json`, `.cursor/mcp.json` | SHA-256 of raw bytes, strict JSON shape and number of keys in `mcpServers` |
| `.claude/settings.json`, `.claude/settings.local.json`, `.codex/hooks.json` | SHA-256, strict JSON shape and number of event groups in `hooks` |
| `.vscode/mcp.json` | SHA-256, JSONC parsing (comments/trailing commas), number of keys in `servers` |
| `.codex/config.toml` | SHA-256, TOML parsing, separate counts for `mcp_servers` and `hooks` |
| Root `AGENTS.md`, `AGENTS.override.md`, `CLAUDE.md`, `.cursorrules` | Fingerprint only |
| Root `package.json`, `npm-shrinkwrap.json`, `package-lock.json` | Fingerprint and local package evidence |
| `.agents/skills`, `.claude/skills`, `.codex/skills`, `.cursor/skills` | Bounded recursive fingerprints, including scripts and package metadata; `.git` entries excluded case-insensitively |
| Enclosing `.git` directories inside the selected scope | Only HEAD, required refs and loose objects for package-manifest evidence; no Git command or config execution |

`declaredEntries` counts declarations/event groups; it is not a count of valid,
enabled, installed or running tools. Empty/missing sections are zero. Recognized
sections must be objects; individual entries are not schema-validated yet.
`declaredSections` names every counted section. `declaredEntries` remains the
first section's count (MCP for Codex TOML); it is never a sum of servers and hooks.

The report lists its scope and limits. It does not follow configuration references,
scan unrelated project files, resolve remote dependencies or discover all agents.
User/system profiles require the separate command. A project's linked skills need a separately
selected root or a future profile adapter.

## Output and privacy

`schemaVersion: 3` includes components (`path`, `kind`, `size`, `sha256`), optional
parse status/counts, issues, scope and usage, adapter ID/version/reference date,
and component provenance (agent, declared scope, `basis: "selected-layout"`).
It adds `packages` and a component `packageRef` when a containing local manifest
was processed. `packageIdentity: "contained-in-local-package"` describes that
containment; otherwise it remains `not-resolved`. `agentVersion` remains `null`.
See [package evidence](PACKAGE-EVIDENCE.md) for the distinction between a declared
version, agreement with a lockfile and Git content evidence. No field attests a publisher.
Components are sorted by relative
path. Hashing the original bytes makes changes in bundled scripts visible even
when their `SKILL.md` stays the same. It does not attest authorship or harmlessness.

Configuration values, commands, environment variables, server names, URLs and
file contents are not included in the output. Error messages from the OS and JSON
parsers are replaced by fixed reason codes. Relative paths and hashes are still
metadata: a secret placed in a filename can appear in `path`. Review reports
before sharing. Nothing is automatically uploaded.

Exit status:

- `0`: the declared inventory scope was processed without recorded issues.
- `2`: partial inventory, including unreadable/changed/linked files, malformed
  configurations, unsupported formats or exhausted limits. Usable components remain in JSON.
- `1`: missing/invalid command arguments or unavailable project root. A fixed
  JSON error is returned without revealing OS exception details.

`complete` refers only to the declared scan scope, never machine-wide discovery
or a security assessment. An empty successful snapshot means no recognized files
were found in that scope; it does not mean the project has no AI components.

## Bounds and filesystem limitations

Default limits: 1,024 visited entries (including probed missing paths), 1 MiB per
file, 8 MiB total bytes read and six directory levels below each skills root.
Pattern enumeration also charges ignored names against the entry budget; only
matching direct children are opened. `limits.parseDepth` is 64 for configuration
nesting, independent of the filesystem depth limit.
Package evidence is capped at 64 manifests. Git objects share the filesystem
budgets and have a separate 8 MiB decompression budget; one expanded object is
capped at the file-byte limit plus 64 header bytes. Rejected expansion attempts
also consume that budget. The report exposes both limits and consumed bytes.
One extra byte is reserved while reading to detect growth. A file limit skips
that file; total-byte/entry exhaustion stops further traversal. Depth exhaustion
skips that subtree. Every such skip makes the snapshot incomplete.

The explicit root is canonicalized. Symbolic links and Windows junctions below
it are skipped, including linked ancestors of selected files. Special files are
not inventoried. Reads check file identity/size/mtime before and after access,
but this remains a best-effort snapshot. It does not provide atomic filesystem
capture or a security boundary against an attacker racing directory changes.

## Parsing contract

JSON/JSONC use the visitor from Microsoft's `jsonc-parser` 3.3.1 (MIT) with
depth checking, null-prototype objects and duplicate-key rejection. JSON is
strict; JSONC permits comments and trailing commas but rejects any syntax error
instead of using a recovered partial parse. Duplicate JSON keys are treated as
ambiguous even when a client might accept the last value.

TOML uses `smol-toml` 1.8.0 (BSD-3-Clause), including quoted/dotted keys, tables,
inline tables, multiline strings and arrays. The parser bounds nested values;
an iterative check also bounds objects created by dotted keys/table headers.
Large integers stay internal as BigInt; only ordinary numeric counts leave the
parser. This is structural inventory, not full validation of the client's schema,
TOML-version compatibility or date semantics. The upstream parser documents date
validation limitations. Strict UTF-8 decoding rejects invalid bytes for all three
formats. UTF-8 BOMs are accepted.

Failures use `invalid-json`, `invalid-jsonc`, `invalid-toml`, `invalid-encoding`,
`invalid-shape`, `duplicate-key`, or `parse-depth-limit`. A TOML parser nesting
failure is reported as `invalid-toml`; no upstream exception text is exposed.

Parser references: [Microsoft API](https://github.com/microsoft/node-jsonc-parser),
[smol-toml behavior and limitations](https://github.com/squirrelchat/smol-toml).
Exact dependency versions and registry integrity digests are pinned in the lockfile.

[Persistent snapshot comparison](INVENTORY-SNAPSHOTS.md) is available through
separate explicit CLI commands. Static threat analysis, publisher authentication,
live MCP collection/enforcement and UI remain in [the protection plan](roadmap/ai-agent-protection.md).
