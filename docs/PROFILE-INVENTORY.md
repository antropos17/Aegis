# Explicit profile inventory

```powershell
node src/main/main.js --inventory-profile-json user-home "C:/Users/example"
node src/main/main.js --inventory-profile-json codex-user "X:/copied-codex-profile"
node src/main/main.js --inventory-profile-json claude-managed "C:/Program Files/ClaudeCode"
node src/main/main.js --inventory-profile-json gemini-user "X:/copied-gemini-profile"
node src/main/main.js --inventory-profile-json gemini-project "X:/copied-project/.gemini"
node src/main/main.js --inventory-profile-json gemini-system-windows "X:/copied-ProgramData/gemini-cli"
```

The caller selects both a built-in layout and one directory. AEGIS does not infer
the current user, expand `~`/environment variables, select an active profile or
resolve paths from configuration. The directory may be an offline copy. Each
command shares the [bounded reader, privacy rules and exit codes](PROJECT-INVENTORY.md).
No client, MCP server, hook or script is executed.

## Layout coverage

Paths below are relative to the selected directory. Absent locations are normal.
Found files get their raw SHA-256, parse status/counts and declared provenance.

| Adapter | Select this directory | Recognized locations |
| --- | --- | --- |
| `user-home` | A user home or its offline copy | `.claude.json`; `.claude/settings.json`; `.cursor/mcp.json`; `.gemini/settings.json`; `.codex/config.toml`, `hooks.json`, `managed_config.toml`, direct `NAME.config.toml`; `.claude/CLAUDE.md`; `.codex/AGENTS.md`, `AGENTS.override.md`; `.agents/skills`, `.claude/skills`, `.codex/skills`, `.cursor/skills` |
| `codex-user` | The Codex state directory, normally `~/.codex`, or a custom `CODEX_HOME` | `config.toml`, `hooks.json`, `managed_config.toml`, direct `NAME.config.toml`, `AGENTS.md`, `AGENTS.override.md`, `skills/` |
| `claude-user` | Normally `~/.claude`, or the settings directory chosen with `CLAUDE_CONFIG_DIR` | `settings.json`, `CLAUDE.md`, `skills/`; the sibling `~/.claude.json` requires `user-home` |
| `cursor-user` | Normally `~/.cursor` | `mcp.json`, `skills/` |
| `vscode-user` | One VS Code user/profile directory containing `mcp.json` | `mcp.json` as JSONC; named profiles require their own explicit directory selection |
| `gemini-user` | One `.gemini` user directory or offline copy | `settings.json` with comments allowed, trailing commas rejected |
| `gemini-project` | One project's `.gemini` directory or offline copy | `settings.json` with comments allowed, trailing commas rejected; selecting the project root with `project` also recognizes `.gemini/settings.json` |
| `gemini-system-windows` | One Windows `C:/ProgramData/gemini-cli` directory or offline copy | `system-defaults.json` and `settings.json` as separate observations with comments allowed, trailing commas rejected |
| `claude-managed` | A Claude Code system configuration directory | `managed-mcp.json`, `managed-settings.json`, direct non-hidden `managed-settings.d/*.json` |
| `codex-managed` | A Codex system configuration directory | `config.toml`, `requirements.toml`, `managed_config.toml`; supported locations differ by OS, below |

`NAME.config.toml` accepts letters, numbers, `_` and `-` in `NAME`. These profiles
are counted separately; neither their presence nor their contents proves that a
running client selected them. Legacy inline `[profiles.NAME]` settings are hashed
but not interpreted. Codex `mcp_servers` and `hooks` are counted separately.

Claude's `.claude.json` is a shared configuration/state file that can also contain
account data. It is read within the same byte limits to count top-level MCP
declarations and aggregate `projects.*.mcpServers`. Project names/paths, credentials
and all other values are excluded from output. Dedicated `auth.json`, session and
history files are not read. `projectScopedEntries` is a declaration count across
the file, without deduplication or filesystem traversal to those projects.

Gemini settings expose the count of top-level `mcpServers` declarations and a
`geminiMcpDeclarations` summary for the selected file. It records whether
`mcp.allowed` and `mcp.excluded` appear and their list lengths; it also counts
server declarations with explicit `trust: true` or `false`, and servers and
entries with `includeTools` or `excludeTools`. Missing filters differ from
declared empty lists. A malformed counted field marks that file incomplete;
list lengths count declarations without deduplication.
Server names, tool names, commands, URLs, headers and environment values are
never returned. Counts do not validate server launch, filter matching or the
effective policy after configuration layers, extensions, environment variables
and launch arguments are combined. The Windows system adapter does not merge
defaults and overrides or inspect either override environment variable.

## OS and version matrix

Existing layout references were checked on **2026-09-15**; Gemini settings
locations and fields were checked on **2026-09-26** against the upstream
[configuration reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md)
and [MCP server reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md).
The upstream [settings loader](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/config/settings.ts)
strips comments before `JSON.parse`, so the `json-comments` inventory format
accepts comments and rejects trailing commas.
These are documented paths and
fixture-tested formats, not certification of every client release. Local tests
run on Windows; the PR's CI runs on Linux. No native macOS client validation is
claimed. All adapters operate on the caller's selected directory without OS APIs.

| Client / layout | Windows | macOS | Linux / WSL | Version evidence |
| --- | --- | --- | --- | --- |
| Codex user | `%USERPROFILE%/.codex` | `~/.codex` | `~/.codex` | [Current configuration layers](https://developers.openai.com/codex/config-basic/); [named files from 0.134.0](https://learn.chatgpt.com/docs/config-file/config-advanced#profiles); `CODEX_HOME` must be supplied explicitly to AEGIS |
| Codex managed | `%ProgramData%/OpenAI/Codex/requirements.toml`; legacy `managed_config.toml` belongs to the user state directory | `/etc/codex/{config,requirements,managed_config}.toml` | Same Unix locations | [Managed configuration](https://learn.chatgpt.com/docs/enterprise/managed-configuration); no installed version observed |
| Claude Code user | `%USERPROFILE%/.claude`, plus `%USERPROFILE%/.claude.json` | `~/.claude`, plus `~/.claude.json` | Same home locations | [Settings locations](https://code.claude.com/docs/en/settings), [MCP scopes](https://code.claude.com/docs/en/mcp); no installed version observed |
| Claude Code managed | `C:/Program Files/ClaudeCode` | `/Library/Application Support/ClaudeCode` | `/etc/claude-code` | [Managed settings/drop-ins](https://code.claude.com/docs/en/managed-settings), [managed MCP](https://code.claude.com/docs/en/managed-mcp); no installed version observed |
| Cursor user | `%USERPROFILE%/.cursor` | `~/.cursor` | `~/.cursor` | [MCP configuration locations](https://prod.cursor.com/help/customization/mcp); no installed version observed |
| VS Code user | `%APPDATA%/Code/User` | `~/Library/Application Support/Code/User` | `~/.config/Code/User` | [MCP configuration](https://code.visualstudio.com/docs/agent-customization/mcp-servers), [profile directories](https://code.visualstudio.com/docs/configure/profiles); named profiles use `profiles/<ID>` |
| Gemini CLI user | `%USERPROFILE%/.gemini` | `~/.gemini` | `~/.gemini` | [Settings locations](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md); no installed version observed |
| Gemini CLI project | Project root `.gemini` | Same project-relative layout | Same project-relative layout | [Project settings](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md); current process working directory is not inferred |
| Gemini CLI Windows system | `C:/ProgramData/gemini-cli` | Separate documented `/Library/Application Support/GeminiCli` layout is outside this adapter | Separate documented `/etc/gemini-cli` layout is outside this adapter | [System defaults and override](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md); environment path overrides are not resolved |

The report's adapter version describes AEGIS's layout implementation. Component
`provenance.agentVersion` stays `null`. A component inside an observed skill
package can carry `packageIdentity: "contained-in-local-package"` and a
`packageRef`; other components retain `not-resolved`. [Package evidence](PACKAGE-EVIDENCE.md)
records declared versions, npm lockfile agreement and local Git manifest bytes.
Profile inventory reads package metadata only inside the listed skills roots;
it does not read a home-level package manifest. File location and hashes cannot
establish which agent is installed, who published a package, whether an `npx`
request is pinned, or whether a policy is effective.

## Coverage boundaries

The report lists its exact scope, including config patterns. `complete: true`
means those declared locations were processed without issues. It does not mean
that all agent state on the machine was discovered. Custom paths require an
appropriate explicit directory selection; AEGIS does not inspect the caller's
environment to discover overrides.

Effective configuration precedence, trust/enablement, references outside selected roots,
plugin caches/marketplaces, linked shared skills, client rules, remote settings,
registry/MDM policy, other VS Code profiles, Insiders defaults, containers and WSL
machines are not automatically discovered or merged. Selecting a copied managed
directory does not make its policy trusted. Empty JSON settings files are reported
as invalid JSON, even where a client treats an empty managed file as an empty object.

## Schema 3 component example

```json
{
  "path": "config.toml",
  "kind": "agent-config",
  "provenance": {
    "agent": "codex",
    "scope": "user",
    "basis": "selected-layout",
    "agentVersion": null,
    "packageIdentity": "not-resolved"
  },
  "format": "toml",
  "parseStatus": "parsed",
  "declaredEntries": 1,
  "declaredSections": { "mcp_servers": 1, "hooks": 0 }
}
```

The real component also includes `size` and `sha256`. No configuration value is
included. Unknown adapter IDs fail before filesystem access. CLI misuse returns
`expected-profile-and-directory`; an unknown adapter returns `unsupported-profile`.
