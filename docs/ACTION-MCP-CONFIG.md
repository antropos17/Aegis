# Generate an MCP client configuration (B1)

`--action-mcp-config-json` produces an explicit client configuration for the
existing selected-action, catalog or terminal-relay route. Run it from a source
checkout using Node.js. The result is installable configuration containing the
selected filesystem paths; it is not a redacted verification report.

```powershell
node src/main/main.js --action-mcp-config-json selected "X:/private/policy.json" "X:/private/request.json"
node src/main/main.js --action-mcp-config-json catalog "X:/private/catalog.json"
node src/main/main.js --action-mcp-config-json relay "X:/private/newendpoint.json"
node src/main/main.js --action-mcp-config-json selected "X:/private/policy.json" "X:/private/request.json" --observe "X:/private/new-observation.json"
node src/main/main.js --action-mcp-config-json catalog "X:/private/catalog.json" --observe "X:/private/new-observation.json"
```

| Mode | Selected inputs | Configured server entry |
| --- | --- | --- |
| `selected` | Exact policy and action request paths | `--action-mcp-stdio` |
| `catalog` | Catalog manifest path | `--action-mcp-catalog-stdio` |
| `relay` | Operator broker endpoint descriptor path | `--action-mcp-connect` |

Stdout is one JSON object with a fixed `mcpServers.aegis` entry. It contains
`type: stdio`, the current Node executable as `command`, and a literal `args`
array beginning with this checkout's absolute `src/main/main.js` path. Selected
paths follow the fixed route flag. No shell command is composed, so spaces and
Unicode remain literal arguments. No arbitrary server names, environment values,
provider keys, bearer tokens or action contents are copied.

For `selected` and `catalog`, the optional trailing `--observe <new-endpoint>`
adds the read-only [live-observation endpoint](ACTION-LIVE-OBSERVATION.md) to the
owner's argument array. Use a new file in a private local directory controlled
by the operator. Generation does not create or read this file; the owner creates
it when the client launches the server and refuses to overwrite an existing file.
Open Action control and explicitly select that descriptor while the owner runs.
The option has the same local-path and byte limits as the selected input paths.

`relay --observe` is rejected: the relay does not own observation. For terminal
review, append `--observe <new-endpoint>` to the separately launched selected or
catalog review broker; generate the relay configuration as before. Repeated,
misplaced, missing or unknown options produce the same fixed argument error.

## Use the generated file explicitly

For example, in PowerShell 7 save a catalog configuration to a chosen new file:

```powershell
node src/main/main.js --action-mcp-config-json catalog "X:/private/catalog.json" > aegis-mcp.json
```

Choose the output location deliberately: shell redirection can overwrite an
existing file, and this configuration exposes selected path metadata to its
reader. Load the file explicitly in a client that accepts the `mcpServers` JSON
shape. The generator itself writes no files and edits no user or managed client
settings. Client-specific installation and policy remain separate.

For `relay`, first start the [operator broker](ACTION-MCP-REVIEW.md) in a live
terminal, or start [catalog review](ACTION-MCP-CATALOG.md). Generate/load the relay
configuration with the same descriptor path. The descriptor may not yet exist
when generating configuration. The generator never reads its token, starts the
broker or embeds the terminal-review command in an agent's stdio process.

## Validation and limits

Each path must be a fully qualified local path, at most 4,096 UTF-8 bytes. Control
characters, UNC paths and Windows drive-relative/root-relative paths or alternate
data-stream colons are rejected. Paths are preserved literally: generation does
not resolve symlinks, normalize traversal segments, verify existence or read
selected files. A moved checkout or Node installation requires regeneration.

The command requires ordinary Node. An Electron runtime is rejected rather than
using its application executable as the client's Node command. The executable
and source paths are selected from the running process and module, not searched
through `PATH`; their future contents and availability are not verified.

Exit 0 means configuration JSON was produced. Invalid mode, arity or selected
path returns exit 1 with `expected-action-mcp-config-arguments`. Unavailable
runtime or unexpected failure returns exit 2 with `action-mcp-config-unavailable`.
Errors contain fixed text without reflecting selected paths or exception details.

Generation performs no preflight, action launch, listener, network connection,
approval or client installation. Use the separate
[route/catalog checks](ACTION-ROUTE-CHECK.md) to inspect current configuration.
The real connection captures its own revisions and evaluates its own policy.
Generating or loading a configuration does not establish provider identity,
human presence, OS isolation or protection of other agent tools.

## Verification

Native tests generate configurations with spaces and Unicode, then launch the
selected-action/catalog server from that exact JSON and query MCP status without
executing an action. Relay export is checked with a private-token fixture and a
missing endpoint. Probes verify that generation does not read selected files,
write settings, spawn a process or open a listener.
Configurations with observation enabled are also launched verbatim in native
Node fixtures: the real read-only observer receives an initialized snapshot,
action counters remain zero, owner closure produces sticky coverage loss, and
the owned descriptor is removed. Generation neither exposes its bearer nor
changes existing client settings. This new optional configuration path has not
yet been exercised with an installed provider.

The existing installed-provider verifier now uses this configuration builder for
selected, catalog and catalog-review relay modes. Installed Windows Claude Code
2.1.263 passed all three using synthetic loopback model replies and disposable
configuration: six selected-action requests, seven catalog requests and three
review-relay requests. The fixture adds only its explicit isolated test environment
to the generated entry; production output contains no environment block. The
review sequence confirmed the first action, refused the second and disconnected
before the third could launch. Owned scratch was removed in every run.
Receipts are `.agent/b1-mcp-config-{single,catalog,relay}-receipt.json`.
This establishes the tested CLI/configuration route, not every client's schema,
cloud-model behavior or OS isolation.
