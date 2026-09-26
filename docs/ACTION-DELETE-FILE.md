# Selected file deletion (B4)

`--action-delete-file-confirm <policy.json> <request.json>` is an opt-in,
terminal-owned operation. AEGIS itself removes one existing regular file after
an exact policy match and a fresh `DELETE <challenge>` answer. It does not launch
an executable or forward a tool call. This route is separate from the schema 2/3
execution policy and existing MCP routes.

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

This control applies only to a request explicitly sent through this command.
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
junctions, invalid schema/path and cancellation. The terminal challenge has a
separate negative/positive test. These fixtures do not establish control of
third-party agent routes or resistance to same-account races.
