# Selected-action MCP stdio adapter (B1)

`--action-mcp-stdio <policy.json> <request.json>` connects an MCP client to
[AEGIS-owned direct execution](ACTION-EXECUTION.md). The operator selects one
policy and one request file when launching the server. The action tool is
`aegis_execute_selected`, with empty arguments. The separate read-only
[`aegis_route_status`](ACTION-MCP-STATUS.md) reports bounded observations from the
current connection without invoking the execution owner. The client cannot choose files,
executable, command arguments or environment. Initialization pins the raw bytes of
both selected JSON files for that connection. Each invocation still requires an
exact allow decision from those unchanged files. Ask and deny return tool errors
without launch.

The separate [operator-selected catalog](ACTION-MCP-CATALOG.md) publishes up to
eight fixed actions while sharing this protocol's replay, concurrency and call
budgets. This page describes the original single-action entry.

This provides one explicit agent route. Native Bash, other MCP servers and other
agent actions remain outside it. It is not an MCP gateway, sandbox or automatic
installation. Allowed executables retain their account privileges; descendants
remain uncontrolled. No user configuration is modified by this implementation.

## Explicit setup

The [configuration generator](ACTION-MCP-CONFIG.md) can produce this JSON using
the current Node executable and checkout: `--action-mcp-config-json selected
<policy.json> <request.json>`. It prints selected path metadata, reads no input
files and changes no settings. Load its output explicitly in the intended client.

Prepare the exact request and schema 2 policy described in ACTION-EXECUTION.md.
Keep them outside an agent-writable project where possible. In an explicitly
chosen MCP client configuration, use actual absolute paths:

```json
{
  "mcpServers": {
    "aegis": {
      "type": "stdio",
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": [
        "C:\\AEGIS\\src\\main\\main.js",
        "--action-mcp-stdio",
        "C:\\private\\policy.json",
        "C:\\private\\request.json"
      ]
    }
  }
}
```

On other platforms select the local Node executable and local paths. Nothing
copies or installs this configuration automatically. The tool description is
fixed and does not disclose the private action. The operator must review the
action separately; tool discovery is not an approval preview. Policies and
requests are reread on each call and compared against their initialization bytes.
An observed mismatch or read failure revokes the connection's binding. Restoring
the files does not restore permission in that connection; reconnect explicitly to
capture a new revision. Reconnection observes the files again and does not record
human approval.

The private binding is an opaque in-process capability backed by per-binding
keyed digests. Neither it nor its digest material is sent to the client or added
to execution reports. Byte comparison uses the same bounded buffers subsequently
parsed for policy evaluation; it is not a separate check followed by a fresh read.
Whitespace and key-order edits also change the pinned bytes. Successful capture
establishes readable bounded JSON, not schema validity or an allow decision.

There is no continuous watcher. A change restored before a checked read is not
observed. A same-user process can modify or bypass AEGIS and can change executable
bytes, libraries, scripts or working-directory contents. Those contents are not
bound by the selected-file revision check.

## Protocol and lifecycle

The adapter implements the bounded tools-only subset of MCP's
[stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports),
[lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)
and [tool contract](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
It supports versions 2025-11-25, 2025-06-18 and 2025-03-26; unsupported requested
versions negotiate to 2025-11-25 for the client to accept or disconnect.
Initialization waits for a bounded 1.5-second configuration capture before replying.
An early initialized notification is ignored while capture is pending. Capture
failure returns a fixed configuration error and prevents retry in that connection.
Initialization and a subsequent initialized notification are required before tool access.
Ping, tools/list, tools/call and matching cancellation notifications are supported.
Resources, prompts, sampling, tasks, pagination and HTTP are not implemented.

Messages are UTF-8 JSON-RPC objects separated by newline. Batches are rejected.
IDs are nonnegative safe integers or 1–64 ASCII letters, digits, underscores,
dots, colons and hyphens. IDs are echoed for protocol correlation and may be
visible to the client; do not embed secrets in them. Request IDs are consumed
before validation or execution, including busy and failed requests. Reuse within
the same connection cannot run an action again. New IDs can repeat an allowed
action: this is not a single-use approval system. Restart starts a fresh scope.

Only one execution may be in flight; concurrent calls are rejected without
queuing. Notifications lacking request IDs cannot execute tools. A matching
typed cancellation ID aborts the active operation; unknown IDs do nothing.
Cancelled results are suppressed. Client disconnect, invalid framing, transport
errors, bounds and session expiry revoke admission and the private binding, and
abort pending initialization or active work. A late capture is revoked without
an initialization response.
The server awaits bounded direct-child cleanup before exiting.

Cancellation during preparation prevents a later allow from launching. After
launch it requests termination of the direct child and cannot undo side effects.
The execution report distinguishes confirmed from unconfirmed termination, and
never implies that descendants stopped. Native synchronous work/event-loop stalls
remain outside JavaScript timer guarantees.

## Bounds and disclosure

Each connection lasts at most fifteen minutes and permits 128 input frames,
1 MiB total input, 16 KiB per frame, four unfinished response operations and
sixteen execution attempts. It retains bounded ID tombstones and no replay cache
of action results. At most 64 KiB of output may await write completion; output
drain has a one-second deadline. These are finite lifetime budgets, not activity
coverage or rate guarantees. Closed connections require explicit client restart.

Only JSON-RPC messages go to stdout. Tool results contain the existing redacted
execution report as JSON text and, for newer negotiated versions, structured
content. Raw child output, action arguments, environment values, paths and native
exception strings are not added. Native stderr/stdout are still discarded by the
execution owner. Unexpected execution errors explicitly leave execution status
unknown; they do not assert that nothing ran. The protocol uses `isError` for
policy denial/ask and failed or incomplete execution, separately from protocol errors.

MCP tools are annotated as potentially destructive, non-idempotent and open-world.
The stdio child trusts its launching client; there is no network listener or new
authentication protocol. This does not prevent a local process from bypassing
the route or modifying same-user files. File/heap/crash-dump limits from the
direct-execution and policy contracts continue to apply.

## Verification

Unit and native CLI tests cover negotiation, lifecycle, argument rejection,
typed replay/cancellation, busy calls, bounds, EOF during preparation/execution,
late allow suppression and direct-child cancellation. The opt-in
`scripts/verify-claude-action-mcp.mjs --help` describes the installed-provider
fixture with explicitly selected Windows Claude/Bash executables and scratch.
It disables built-in tools and uses a local model-response stub, disposable MCP
configuration and dummy credentials. It requires actual MCP tool results for
allow, deny and ask; absence of a sentinel alone cannot establish a policy block.
Windows Claude Code 2.1.263 passed this fixture: all three actual tool results
contained the expected AEGIS decision; allow created the disposable sentinel,
deny and ask did not launch. Six local model requests were made and owned scratch
was removed. No OS firewall isolation or real cloud model verification is claimed.
The installed-provider fixture also passed with revision binding enabled.
The added unit and native stdio revision tests cover changed selected bytes, restored files after an observed mismatch,
capture failures, close during initialization and private-capability handling;
provider/CI receipts belong to the implementation PR.

The separate [terminal confirmation CLI](ACTION-CONFIRMATION.md) now binds local
review to the selected action, policy revision and an expiring one-attempt grant.
The direct `--action-mcp-stdio` route keeps ask unstarted and exposes no approval
capability to the client. The separate [terminal review broker and relay](ACTION-MCP-REVIEW.md)
connect this selected tool to fresh operator confirmation for each allow/ask call.
Its installed-Claude `--review` fixture has separately passed approved ask,
explicit refusal, policy deny and disconnect during review; see that contract for
the reproducible command and evidence limits.
Broader deliberate agent routing and coverage display remain B1 work.
MCP gateway inspection and process-tree isolation remain separate roadmap work.

The opt-in verifier also supports `--status` for an installed-provider sequence
of status, one action and status in the same connection. See
[status verification](ACTION-MCP-STATUS.md#installed-provider-status-sequence)
for commands, expected counter transitions and evidence limits.
