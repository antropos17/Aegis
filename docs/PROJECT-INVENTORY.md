# Static project inventory

Run with Node.js 24 from the AEGIS source checkout:

```powershell
node src/main/main.js --inventory-json "X:/path/to/project"
```

The command prints a JSON snapshot and exits before loading Electron or starting
monitoring. It reads only recognized locations below the explicit project root.
It does not start MCP servers, run hooks/scripts, install packages, make network
requests or store a baseline. Discovery does not prove installation, activation,
trust or safety. `assessment: "not-performed"` is always present.

## Scope

| Locations | Inventory |
| --- | --- |
| `.mcp.json`, `.cursor/mcp.json` | SHA-256 of raw bytes, strict JSON shape and number of keys in `mcpServers` |
| `.claude/settings.json`, `.claude/settings.local.json`, `.codex/hooks.json` | SHA-256, strict JSON shape and number of event groups in `hooks` |
| `.vscode/mcp.json`, `.codex/config.toml` | Fingerprint only; JSONC/TOML interpretation is explicitly unsupported in this version |
| Root `AGENTS.md`, `CLAUDE.md`, `.cursorrules` | Fingerprint only |
| `.agents/skills`, `.claude/skills`, `.codex/skills`, `.cursor/skills` | Bounded recursive fingerprints of manifests and other regular files, including scripts |

`declaredEntries` counts declarations/event groups; it is not a count of valid,
enabled, installed or running tools. Empty/missing sections are zero. Recognized
JSON sections must be objects; individual entries are not schema-validated yet.

The report lists its scope and limits. It does not follow configuration references,
scan unrelated project files, resolve remote dependencies, inspect user/system
profiles or discover all agents. A project's linked skills need a separately
selected root or a future profile adapter.

## Output and privacy

`schemaVersion: 1` includes components (`path`, `kind`, `size`, `sha256`), optional
parse status/count, issues, scope and usage. Components are sorted by relative
path. Hashing the original bytes makes changes in bundled scripts visible even
when their `SKILL.md` stays the same. It does not attest authorship or harmlessness.

Configuration values, commands, environment variables, server names, URLs and
file contents are not included in the output. Error messages from the OS and JSON
parser are replaced by fixed reason codes. Relative paths and hashes are still
metadata: a secret placed in a filename can appear in `path`. Review reports
before sharing. Nothing is automatically uploaded.

Exit status:

- `0`: the declared inventory scope was processed without recorded issues.
- `2`: partial inventory, including unreadable/changed/linked files, malformed
  JSON, unsupported formats or exhausted limits. Usable components remain in JSON.
- `1`: missing/invalid command arguments or unavailable project root. A fixed
  JSON error is returned without revealing OS exception details.

`complete` refers only to the declared scan scope, never machine-wide discovery
or a security assessment. An empty successful snapshot means no recognized files
were found in that scope; it does not mean the project has no AI components.

## Bounds and filesystem limitations

Default limits: 1,024 visited entries (including probed missing paths), 1 MiB per
file, 8 MiB total bytes read and six directory levels below each skills root.
One extra byte is reserved while reading to detect growth. A file limit skips
that file; total-byte/entry exhaustion stops further traversal. Depth exhaustion
skips that subtree. Every such skip makes the snapshot incomplete.

The explicit root is canonicalized. Symbolic links and Windows junctions below
it are skipped, including linked ancestors of selected files. Special files are
not inventoried. Reads check file identity/size/mtime before and after access,
but this remains a best-effort snapshot. It does not provide atomic filesystem
capture or a security boundary against an attacker racing directory changes.

Persistent trust comparison, static threat analysis, profile adapters and UI
are tracked separately in [the protection plan](roadmap/ai-agent-protection.md).
