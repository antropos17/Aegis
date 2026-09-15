# Local static review (A4.1 and the language subsets of A4.2)

AEGIS can inspect a selected agent directory or package for literal command and
configuration patterns. It returns review findings with the original file hash,
relative path, fixed explanation and, for script/code-block matches, a line number.
It reads local bytes without running commands, starting MCP servers, installing
packages, resolving DNS, uploading content or modifying files.

The built-in engine includes bounded [JavaScript](JAVASCRIPT-STATIC-ANALYSIS.md)
and [Python](PYTHON-STATIC-ANALYSIS.md) command analysis, including bounded
[selected-source literal, wrapper and primitive return flow](STATIC-COMMAND-FLOW.md).
General dataflow, semantic prompt-injection detection and a vulnerability database
remain outside this scope.
The separate [external report importer](STATIC-REPORT-IMPORT.md) accepts explicit
Cisco JSON/SARIF results alongside this local review. It does not add those
analysis engines to AEGIS, connect findings to the dashboard or block an action.

## Commands and scope

From an AEGIS checkout with Node.js 24:

```powershell
node src/main/main.js --static-scan-json package "X:/reviews/downloaded-skill"
node src/main/main.js --static-scan-json project "X:/work/example"
node src/main/main.js --static-scan-json codex-user "X:/reviews/copied-codex-profile"
```

The caller selects both the adapter and an existing directory. There is no
automatic home discovery or environment-variable expansion.

| Adapter | Read scope |
| --- | --- |
| `package` | The selected tree, including files beside `SKILL.md`, within the shared entry/depth/byte limits; `.git` names are excluded case-insensitively |
| `project` | Declared project agent configurations, instructions, skill trees and the root `package.json` |
| Any [profile adapter](PROFILE-INVENTORY.md) | Its declared configurations, named fragments, instructions and skill trees |

Links below the selected root are skipped. The selected root is canonicalized
and its identity checked across the scan. All reads remain best effort; this is
not an atomic filesystem snapshot or a sandbox against races.

Configuration commands may reference files outside this read scope. These files
are **not followed**. Recognized interpreter references produce a coverage issue;
use a separately selected package directory to inspect the bundle itself. Unknown
executables and their behavior are not resolved. Finding a declaration does not
prove which configuration takes precedence or that the component runs.

## Supported inspection

Known agent JSON/JSONC/TOML settings use the existing strict parser. Inspection
covers MCP `command`/`args`, URLs, hook command objects, Claude project-local MCP
entries, named profiles and the `ANTHROPIC_BASE_URL` environment override. Other
provider endpoint mechanisms are outside this slice. MCP argument strings retain
their argv boundaries: an `echo` argument containing a pipeline is not a pipeline.
Only an explicit supported shell wrapper is inspected as command text.

Every encountered `package.json` contributes npm script and dependency selector
checks. Installation lifecycle declarations are informational findings. Ordinary
semver ranges do not trigger a mutable-remote-source finding. Supported Git
selectors ending in a full commit identifier avoid that particular finding;
the identifier is not verified and does not authenticate the publisher. Lockfiles
are parsed and fingerprinted without resolving or auditing a dependency graph.

JavaScript inspection covers `.js`, `.cjs` and `.mjs` files. It resolves a bounded
subset of Node `child_process` calls through imports, aliases and constant strings,
reusing STA001–STA006. Inline argv stays separate from shell text unless a supported
shell is explicitly selected. Dynamic inputs, mutations and unresolved call targets
produce coverage issues. Control flow and whether a call executes are not evaluated.

Python inspection covers `.py` files through an in-process syntax parser. It reviews
literal `subprocess` and `os.system`/`os.popen` calls, including aliases and selected
single-assignment strings. Python module identity and execution order are not resolved.
Sequences preserve argv boundaries; `shell=True` with a sequence remains a coverage
gap because its behavior depends on the platform. No Python interpreter is required.

Shell inspection covers a bounded literal subset in `.sh`, `.bash`, `.zsh`, `.ps1`
and recognized shell shebang files. Markdown/text instructions contribute only
fenced blocks labeled `sh`, `bash`, `shell`, `zsh`, `console`, `powershell`, `pwsh`
or `ps1`. Free prose is not semantically analyzed. A command example inside such
a block can require review even when the surrounding prose advises against it.

The parser distinguishes quoted literals, process arguments and potential shell
expansion. It never substitutes a variable or decodes an executable payload.
Common command forms are covered, without full shell grammar, alias resolution
or all command options. Substitutions, grouping, unfamiliar wrappers and several
dynamic forms produce fixed coverage issues. At an unresolved multiline quote,
here-document or PowerShell block-comment opener, script inspection stops and
reports incompleteness; subsequent text is not treated as independent commands.

Unlabeled/unsupported code blocks, unsupported source languages, binary data,
invalid encodings, unsupported policy semantics and read/parser failures remain
visible in `issues`. Their file hashes remain in `files` when reading succeeded.

## Built-in checks

Rule-set ID: `aegis-static-patterns`, version `5`. Each report includes fixed rule
metadata. Severity prioritizes review; every finding has `confidence: heuristic`.

| ID | Severity | Review trigger |
| --- | --- | --- |
| STA001 | high | Literal HTTP download piped into a supported interpreter, optionally through a recognized pass-through stage |
| STA002 | high | Curl upload of a recognized sensitive file, potential secret-variable expansion, or a supported sensitive-source pipeline |
| STA003 | high | Recursive deletion of a recognized root/home target |
| STA004 | medium | Recognized encoded PowerShell invocation |
| STA005 | medium | Claude invocation requesting permission bypass |
| STA006 | medium | Supported npx selector lacks an exact semver version; recognized offline/no-install launch options are excluded |
| STA007 | medium | Non-loopback MCP URL uses HTTP |
| STA008 | medium | MCP URL contains user information or a recognized credential query field |
| STA009 | medium | Nonempty `ANTHROPIC_BASE_URL` override |
| STA010 | info | npm installation/preparation lifecycle script is declared |
| STA011 | medium | Recognized remote dependency selector lacks a supported full Git commit suffix |

STA002 includes common `.env` variants, `.npmrc`, selected SSH private-key names,
AWS credentials and kubeconfig paths. Template/example `.env` names are excluded.
This is a small path/name heuristic, not secret detection. Arbitrary filenames,
application-specific secrets, hidden transformations and cross-file flows can be
missed. A hostname, exact package version or absence of a match is not an allowlist
decision. Legitimacy, reachability and successful execution are not established.

## Result contract and limits

The report has `schemaVersion: 1`, `mode: static-analysis`,
`assessment: static-patterns` and always `safety: not-determined`.

- Exit `0`: `status: no-findings`, with no reported gaps in the declared subset.
- Exit `2`: findings or incomplete inspection; `reviewRequired: true`.
- Exit `1`: malformed invocation, unknown adapter or unavailable root; fixed error
  code, `safety: not-determined` and `reviewRequired: true`.

`status: findings` can coexist with `complete: false`. Always inspect `complete`,
`issues`, `scope` and each file's analysis mode. Even a complete no-findings report
does not grant execution permission or mean that a package is safe. The [A3 snapshot
acceptance workflow](INVENTORY-SNAPSHOTS.md) remains a separate explicit decision;
static review never accepts or rewrites a baseline.

Read limits are 1,024 entries, 1 MiB per file, 8 MiB total and depth 6. Parser depth
is capped at 64. Each file permits 256 command inspections; each command permits
16,384 characters and 256 tokens. Configuration traversal permits 2,048 items;
scripts permit 8,192 physical lines. Explicit shell-wrapper recursion is bounded.
JavaScript adds per-file character, token, AST-node, nesting and value-work budgets,
all exposed in `limits` and detailed in its [contract](JAVASCRIPT-STATIC-ANALYSIS.md).
Python adds bounded parsing advances, syntax-tree nodes/depth and static value
work; its [contract](PYTHON-STATIC-ANALYSIS.md) lists the corresponding limits.
Selected-source flow adds shared source, resolution and work limits plus bounded
module/call depth. Its [contract](STATIC-COMMAND-FLOW.md) describes hash-bound evidence.
Output is capped at 256 findings and 1,024 issues. Reaching a limit produces an
incomplete report. Truncated subsets can depend on filesystem enumeration order.

No source snippets, command values, MCP names, URLs, dependency names, environment
values or parser/OS exception messages appear in findings. Relative paths, file
sizes, line numbers and SHA-256 fingerprints are retained. Filenames and hashes
can still reveal private information; review a report before sharing it. Nothing
is persisted or sent remotely by the scan command.

## References checked on 2026-09-15

- [Claude hooks](https://code.claude.com/docs/en/hooks) and [CLI options](https://code.claude.com/docs/en/cli-reference): command structure and permission-bypass flag semantics.
- [npm lifecycle scripts](https://docs.npmjs.com/cli/v11/using-npm/scripts/) and [npx](https://docs.npmjs.com/cli/v11/commands/npx/): installation hooks, package selectors and option/argument boundaries.
- [curl manual](https://curl.se/docs/manpage.html): data/file/stdin options, including the literal `--data-raw` behavior.
- [Check Point disclosure](https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/): project hooks/MCP and provider-endpoint abuse. The reported pre-consent vulnerabilities were fixed; a finding here does not claim the installed client remains vulnerable.
- [Cisco Skill Scanner](https://github.com/cisco-ai-defense/skill-scanner) and [Cisco MCP Scanner](https://github.com/cisco-ai-defense/mcp-scanner): deeper analysis and offline inputs inform A4.2. No Cisco code, scanner installation or API call is included in A4.1; third-party detection effectiveness was not reproduced.
