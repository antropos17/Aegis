# Local static review (A4.1 and the language subsets of A4.2)

AEGIS can inspect a selected agent directory or package for literal command and
configuration patterns. It returns review findings with the original file hash,
relative path, fixed explanation and, for script/code-block matches, a line number.
It reads local bytes without running commands, starting MCP servers, installing
packages, resolving DNS, uploading content or modifying files.

The built-in engine includes bounded [JavaScript](JAVASCRIPT-STATIC-ANALYSIS.md)
and [Python](PYTHON-STATIC-ANALYSIS.md) command analysis, including bounded
[selected-source literal, wrapper and primitive return flow](STATIC-COMMAND-FLOW.md).
Bounded [instruction-pattern review](INSTRUCTION-REVIEW.md) inspects selected
English directives and explicitly supplied offline MCP tool descriptions.
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
node src/main/main.js --static-scan-json project "X:/work/example" --tools-file "X:/reviews/tools.json"
```

The caller selects both the adapter and an existing directory. There is no
automatic home discovery or environment-variable expansion.
The optional `--tools-file` reads one bounded offline export into a separate
`mcpCatalog` report section. It does not start the server or select additional
content through references in the artifact.

| Adapter | Read scope |
| --- | --- |
| `package` | The selected tree, including files beside `SKILL.md`, within the shared entry/depth/byte limits; `.git` names are excluded case-insensitively |
| `project` | Declared project agent configurations, instructions, skill trees and the root `package.json` |
| Any [profile adapter](PROFILE-INVENTORY.md) | Its declared configurations, named fragments, instructions and skill trees |

For Gemini CLI, these declared instructions include root `GEMINI.md` under
`project`, `.gemini/GEMINI.md` under `user-home`, and `GEMINI.md` under
`gemini-user`. The selected `gemini-project` root is a `.gemini` settings
directory; its sibling project-root instruction file requires a `project`
selection. The scanner reports observed file hashes, bounded instruction
findings and `instruction-semantics-not-analyzed` for nonempty text. It does not
resolve effective context, recursively discover context files, follow `@`
imports, inspect extension context or infer configured `context.fileName` values.

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
covers MCP `command`/`args`, `url` and `httpUrl` declarations, hook command objects, Claude project-local MCP
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
and recognized shell shebang files. Within Markdown/text, command review uses
fenced blocks labeled `sh`, `bash`, `shell`, `zsh`, `console`, `powershell`, `pwsh`
or `ps1`. Prose receives the separate bounded directive checks below; general
semantics remain unknown. A command example inside a supported block can require
review even when the surrounding prose advises against it.

The parser distinguishes quoted literals, process arguments and potential shell
expansion. It never substitutes a variable or decodes an executable payload.
Common command forms are covered, without full shell grammar, alias resolution
or all command options. Bounded [ordered redirection review](SHELL-REDIRECTIONS.md)
associates stdin/stdout across literal pipelines and avoids carrying a payload
through an overridden stream. It can recognize a sensitive input path without
opening that path. Every redirection retains a runtime-dialect coverage issue.
Substitutions, grouping, unfamiliar wrappers and several dynamic forms produce
fixed coverage issues. At an unresolved multiline quote,
here-document or PowerShell block-comment opener, script inspection stops and
reports incompleteness; subsequent text is not treated as independent commands.

Unlabeled/unsupported code blocks, unsupported source languages, binary data,
invalid encodings, unsupported policy semantics and read/parser failures remain
visible in `issues`. Their file hashes remain in `files` when reading succeeded.

## Built-in checks

Instruction prose also receives four fixed directive checks. Every nonempty
inspected text retains `instruction-semantics-not-analyzed`; finding-free prose
can therefore be incomplete and require review. The supported grammar,
source-line conventions and catalog bounds are documented in
[Instruction-pattern review](INSTRUCTION-REVIEW.md).

Rule-set ID: `aegis-static-patterns`, version `12`. Each report includes fixed rule
metadata. Severity prioritizes review; every finding has `confidence: heuristic`.

| ID | Severity | Review trigger |
| --- | --- | --- |
| STA001 | high | Literal HTTP download piped into a supported interpreter, optionally through a recognized pass-through stage |
| STA002 | high | Curl upload of a recognized sensitive file, potential secret-variable expansion, or a supported sensitive-source pipeline |
| STA003 | high | Recursive deletion of a recognized root/home target |
| STA004 | medium | Recognized encoded PowerShell invocation |
| STA005 | medium | Claude invocation requesting permission bypass |
| STA006 | medium | Supported `npx`, `bunx`/`bun x` or `uvx`/`uv tool run` package selector lacks an exact version; recognized `npx` offline/no-install and `bunx` no-install forms are excluded |
| STA007 | medium | Non-loopback MCP URL uses HTTP |
| STA008 | medium | MCP URL contains user information or a recognized credential query field |
| STA009 | medium | Nonempty `ANTHROPIC_BASE_URL` override |
| STA010 | info | npm installation/preparation lifecycle script is declared |
| STA011 | medium | Recognized remote dependency selector lacks a supported full Git commit suffix |
| STA012 | medium | Instruction directive asks to override prior/system instructions |
| STA013 | high | Instruction directive associates sensitive material with a transfer destination |
| STA014 | medium | Instruction directive asks to bypass approval or consent |
| STA015 | medium | Instruction directive asks to conceal an action from the user |
| STA016 | medium | Selected Claude settings declare a broad Bash or PowerShell execution allow without a matching ask/deny in the same file |
| STA017 | medium | Leading YAML in a Claude-scoped skill declares broad Bash or PowerShell execution preapproval |
| STA018 | medium | Selected Claude user or managed settings declare `permissions.defaultMode: "bypassPermissions"` without a same-file `disableBypassPermissionsMode: "disable"` |
| STA019 | medium | Selected Claude project or local settings declare `sandbox.network.strictAllowlist: true`, which Claude Code ignores at those scopes |
| STA020 | medium | Selected Claude settings declare a whole-server MCP allow without a complete same-file ask/deny rule |
| STA021 | medium | Selected Claude user or managed settings declare raw Anthropic API request and response body logging |

STA002 includes common `.env` variants, `.npmrc`, selected SSH private-key names,
AWS credentials and kubeconfig paths. Template/example `.env` names are excluded.
This is a small path/name heuristic, not secret detection. Arbitrary filenames,
application-specific secrets, hidden transformations and cross-file flows can be
missed. A hostname, exact package version or absence of a match is not an allowlist
decision. Legitimacy, reachability and successful execution are not established.

For STA006, `bunx --package`/`-p` and `uvx --from` identify the package when its
executable has a different name. The executable and its following arguments are
not treated as additional package selectors. The uv subset recognizes a direct
`tool@version`, `tool@latest`, and simple `--from`/`--with` package requirements,
including `name==version`, extras and version ranges. Unsupported package sources,
selectors and pre-executable options produce coverage issues. An exact direct
version does not establish fixed transitive dependencies, executable bytes or
publisher authenticity. uv's special `python`/`python@version` interpreter launch
is outside package-selector review and produces a coverage issue.

STA016 checks `.claude/settings.json` and `.claude/settings.local.json` at the
selected project or package root, selected Claude user `settings.json` (or
`.claude/settings.json` under `user-home`), and
selected Claude managed `managed-settings.json` plus visible direct
`managed-settings.d/*.json` files. STA017 checks only leading `allowed-tools`
YAML in `.claude/skills/<name>/SKILL.md`, nested Claude skill directories in a
selected package, and `skills/<name>/SKILL.md` in a selected Claude user profile.
Other agents' skill metadata is not interpreted as Claude permission syntax.
The matcher recognizes only a finite set of broad execution grants. A matching
ask or deny in the same settings file suppresses STA016, but cross-file
precedence, the active permission mode and the invoking-turn behavior of skills
are not established. Malformed selected declarations report fixed coverage
issues. Findings contain a path and file hash, not grant text; settings findings
have no source line because the structural parser does not retain one.

STA018 checks only selected Claude user and managed settings. Claude Code's
[permission documentation](https://code.claude.com/docs/en/permissions) describes
`bypassPermissions` as a mode that skips permission prompts, and the same-file
`permissions.disableBypassPermissionsMode: "disable"` suppresses this declaration
signal. For selected project and local settings, AEGIS instead emits the fixed
`claude-bypass-mode-version-unknown` coverage issue: the
[settings documentation](https://code.claude.com/docs/en/settings) says these
files' bypass default is ignored from Claude Code v2.1.257, while older versions
may accept it. The scan does not know the installed version or whether a file is
loaded. Other settings and launch options can change the active mode; a finding
or issue does not establish the mode of a running session. The report contains
the selected file's relative path and hash, never the settings value or contents.

STA019 checks only exact boolean `true` at `sandbox.network.strictAllowlist` in
`.claude/settings.json` and `.claude/settings.local.json` at the selected project
or package root. Claude Code's
[sandbox documentation](https://code.claude.com/docs/en/sandboxing) says this
setting in those project or local files has no effect.
The setting is supported in user, managed or CLI `--settings` configuration
starting with Claude Code v2.1.219, and applies to sandboxed commands only.
Native Windows does not support Claude Code's sandbox; WSL2 is supported. A
finding identifies an ignored declaration, without establishing the installed
version, whether sandboxing is enabled, or effective network access. It does
not imply unrestricted egress: other settings and ordinary host approvals may
still constrain a command. Only the selected relative path, file hash and fixed
wording are reported.

STA020 checks the same selected project, user and managed Claude settings paths
as STA016. It recognizes whole-server `permissions.allow` forms
`mcp__server` and `mcp__server__*`, following Claude Code's
[MCP permission syntax](https://code.claude.com/docs/en/permissions#mcp) and
[tool-name wildcard rules](https://code.claude.com/docs/en/permissions#tool-name-wildcards).
The recognized server segment uses the letters, numbers, hyphens and
underscores listed by [Claude Code's MCP server naming](https://code.claude.com/docs/en/mcp).
The matcher accepts a leading hyphen or underscore. An allow ending in `__*`
whose candidate server name contains another `__` could name a whole server
or a tool wildcard. It produces the fixed
`claude-mcp-server-name-ambiguous` coverage issue without an STA020 finding.
An exact allow with an interior `__` is treated as a specific tool and does
not make the scan incomplete. This leaves bare whole-server names containing
`__` outside the STA020 signal.
Tool-specific forms such as `mcp__server__get_issue` or
`mcp__server__get_*` do not trigger it; unanchored allow globs such as
`mcp__*` are skipped by Claude Code and do not trigger it. A same-file ask or
deny of `mcp__server`, `mcp__server__*`, `mcp__*` or `*` suppresses the
finding for that server. Tool-specific restrictions leave other server tools
potentially preapproved. If another same-file restriction glob might cover
the whole server but this analyzer cannot prove its effect, the finding stays
and the fixed `claude-mcp-restriction-unresolved` coverage issue appears.
Cross-file rules, connector policies, hooks, active permission mode, runtime
server inventory and whether the settings file is loaded remain unresolved.
STA020 is a static review signal, not runtime interception or permission
enforcement. The report omits server names and raw rules; it contains the
selected relative path, file hash and fixed wording.

STA021 checks only the top-level `env.OTEL_LOG_RAW_API_BODIES` entry in selected
Claude user `settings.json` (or `.claude/settings.json` under `user-home`) and
managed `managed-settings.json` or visible direct `managed-settings.d/*.json`
files. It recognizes exact string `1` for inline logging and `file:<dir>` with
a nonblank directory for file logging. Claude Code's
[monitoring documentation](https://code.claude.com/docs/en/monitoring-usage#common-configuration-variables)
and [environment variable reference](https://code.claude.com/docs/en/env-vars)
say these modes can include conversation history and that project/local settings
do not enable the flag. Nested MCP server environments are outside this signal.
Findings use fixed inline/file contexts and omit the value and directory path.
The scan does not establish the active process environment, logging state,
collector configuration, exported records or written files.

## Result contract and limits

The report has `schemaVersion: 1`, `mode: static-analysis`,
`assessment: static-patterns` and always `safety: not-determined`.

- Exit `0`: `status: no-findings`, with no reported gaps in the declared subset.
- Exit `2`: findings or incomplete inspection; `reviewRequired: true`.
- Exit `1`: malformed invocation, unknown adapter, unavailable root or invalid/unavailable selected catalog; fixed error
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
Directory output is capped at 256 findings and 1,024 issues. The optional MCP
catalog has a separate 1 MiB input limit, 256-tool limit and 256-finding/1,024-issue
output limits. Summary totals include both sections. Per-text instruction bounds
are listed in [Instruction-pattern review](INSTRUCTION-REVIEW.md). Reaching a
limit produces an incomplete report. Truncated tree subsets can depend on
filesystem enumeration order.

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

## Additional references checked on 2026-09-26

- [Claude sandboxing](https://code.claude.com/docs/en/sandboxing): `strictAllowlist` scope, version requirement and supported platforms.
- [Bun `bunx`](https://bun.com/docs/pm/bunx): `bun x` alias, package/executable separation, `--package`/`-p`, exact version examples and `--no-install`.
- [uv tool guide](https://docs.astral.sh/uv/guides/tools/) and [CLI reference](https://docs.astral.sh/uv/reference/cli/#uv-tool-run): `uvx`/`uv tool run`, `--from`, exact and range selectors, extras, alternate sources and the special Python interpreter form.
