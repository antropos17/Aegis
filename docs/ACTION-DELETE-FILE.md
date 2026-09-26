# Selected file deletion (B4)

`--action-delete-file-confirm <policy.json> <request.json>` is an opt-in,
terminal-owned operation. AEGIS itself removes one existing regular file after
an exact policy match and a fresh `DELETE <challenge>` answer. It does not launch
an executable. This standalone command is separate from the schema 2/3 execution
policy.

## Selected-file MCP terminal route

An operator can expose the same deletion through a dedicated MCP tool by starting
a terminal broker with fixed policy, request and new endpoint paths:

```sh
node src/main/main.js --action-mcp-delete-review /absolute/policy.json /absolute/request.json /private/newendpoint.json
```

Configure the intended client to use the existing
[review relay](ACTION-MCP-REVIEW.md) with
`--action-mcp-connect /private/newendpoint.json`. The
[configuration generator](ACTION-MCP-CONFIG.md) can produce that relay entry
with `--action-mcp-config-json relay /private/newendpoint.json`; it does not
start the broker or install settings. The broker requires a live terminal and
accepts one bearer-authenticated relay connection. Its endpoint file belongs in
an operator-private directory.

This route publishes `aegis_delete_selected_file` with an empty object argument
schema and the read-only `aegis_route_status` tool. Client-supplied paths, extra
fields or malformed arguments are rejected before review. Initialization binds
the exact selected policy and request bytes; each accepted call uses that same
private binding and requires a fresh terminal challenge. An observed change or
read failure revokes the connection binding; restoring bytes afterward does not
revive it. An affirmative answer permits the existing deletion executor to
recheck the target and issue one regular-file unlink. A second call needs its own
review. The MCP result contains the redacted `action-delete-file` report;
`isError: false` requires
`operation.state: "deleted"`. Cancellation, transport closure and owner shutdown
abort pending review; a completed unlink cannot be undone.
The selection is checked on calls and after review; there is no continuous
filesystem watcher.

The connection-local `aegis_route_status` result uses `selected-file-only` for
this route and reports attempts and owner outcomes. The desktop `--observe`
endpoint is not available for deletion: its current single-action presentation
describes process execution. These counters do not prove blocking outside this
selected route.

The request and policy are bounded JSON files selected by the operator:

```json
{ "schemaVersion": 1, "operation": { "kind": "delete-file", "path": "C:\\work\\project\\old.txt" } }
```

```json
{
  "schemaVersion": 1,
  "defaultDecision": "deny",
  "rules": [
    { "operation": { "kind": "delete-file", "path": "C:\\work\\project\\old.txt" }, "decision": "allow" }
  ]
}
```

All fields are closed. The rule must name the identical path; no prefix, glob,
command string or directory recursion is accepted. `allow` still requires the
terminal challenge. `deny`, an absent rule, missing terminal, refusal, timeout,
input failure and cancellation before the unlink prevent the deletion. The
selected policy and request are captured as private byte bindings and checked
again after confirmation. The target must be an ordinary file with directory
parents that are not links or junctions. Its filesystem identity, size and
change timestamps are checked before and after confirmation. The policy and
request files cannot themselves be the target.

The command emits a fixed-metadata `action-delete-file` report without the file
path or contents. Exit 0 requires an observed successful unlink; exit 1 means
invalid command arguments; other outcomes exit 2. If unlink reports an error,
the report conservatively says `unknown` because the caller cannot infer the
state from that error alone. There is no retry and no recursive removal.

This control applies only to a request explicitly sent through the standalone
command or the selected-file MCP terminal route.
The target is an exact absolute path and may be outside a project if the
operator explicitly permits it. Other agent tools, ordinary shell commands and
allowed child processes can still delete files. The process uses the caller's
account. A same-account actor can change policy or filesystem paths; a swap
between the final path check and unlink is not excluded by Node's path-based
unlink. No protected launch, separate account, process-tree containment or
outside-route coverage is established. C1 is required before extending a
destructive-operation guarantee to arbitrary allowed children.

Focused tests cover real local file removal, policy denial, missing rule and
terminal, refused review, selected-file mutation, target changes, links and
junctions, invalid schema/path and cancellation. The MCP route tests also cover
argument rejection, request-ID replay, terminal timeout, and a separate process
deleting an outside-route sentinel. These fixtures do not establish control of
third-party agent routes or resistance to same-account races.
