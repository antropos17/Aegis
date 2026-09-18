# Operator-selected MCP action catalog (B1)

An opt-in catalog publishes up to eight exact operator-selected actions on one
MCP connection. The client chooses a published tool with empty arguments; it
cannot supply executable paths, argv, environment or policy files.

```json
{
  "schemaVersion": 1,
  "actions": [
    {
      "id": "tests",
      "policyPath": "/absolute/tests-policy.json",
      "requestPath": "/absolute/tests-request.json"
    }
  ]
}
```

The manifest accepts only these fields and one to eight entries. IDs are unique,
match `[a-z][a-z0-9_-]{0,31}` and are deliberately public: the example publishes
`aegis_action_tests`. There are no arbitrary descriptions. Each tool has a fixed
description, empty input schema and destructive/non-idempotent annotations.
Selected paths must be fully qualified local paths, with no UNC, NUL or Windows
alternate-stream colon. The bounded JSON reader limits the manifest to 64 KiB.
Paths, action contents and private binding capabilities are excluded from tool
metadata and result reports.

## Starting a route

```sh
node src/main/main.js --action-mcp-catalog-stdio /absolute/catalog.json
```

Direct catalog stdio uses the existing execution owner: allow can launch, ask and
deny do not launch. To require local terminal review for each allow/ask invocation:

```sh
node src/main/main.js --action-mcp-catalog-review /absolute/catalog.json /private/newendpoint.json
```

The agent connects using the unchanged relay:

```sh
node src/main/main.js --action-mcp-connect /private/newendpoint.json
```

The review route retains the [broker's endpoint and terminal requirements](ACTION-MCP-REVIEW.md),
including a trusted private descriptor directory, one authenticated connection,
finite lifetime and fresh one-attempt approval for each eligible call. Policy
deny cannot be overridden. Agent-controlled terminals do not authenticate human
presence. The private effective-action preview stays on the operator terminal.

## Connection and cancellation boundaries

Initialization snapshots the manifest and captures a separate private revision
binding for each selected policy/request pair. One 1,500 ms deadline covers
manifest reading and all captures, with at most eight capture operations. Any
failure rejects the complete initialization and revokes completed bindings;
late capture results are revoked too. Closing the connection cancels pending work
and revokes all bindings.

Manifest edits apply only to a new connection. There is no manifest watcher or
continuous revision check. Each invocation checks all captured bindings' liveness
before selecting an action. If any member is observed revoked, the entire catalog
rejects subsequent selection. The other entries' files are not proactively reread:
changes are discovered when the existing evaluator reads the selected entry.
Restoring changed files cannot revive an observed revoked binding.

The published tool list stays fixed after revocation. There is one shared active
execution/review slot, a global 16-execution limit, a global 128-message limit and
one request-ID replay set across all tools. Selecting another tool does not reset
these limits. Existing transport byte, frame, output and lifetime bounds remain.
Cancellation targets the current request; disconnect waits for bounded review or
direct-child cleanup. Already completed effects cannot be undone.

The original single-tool routes remain compatible. The
[route checker](ACTION-ROUTE-CHECK.md) still accepts only its four single-action
routes; it is not a whole-catalog validation command. Catalog initialization is
the implemented catalog admission check.

## Verification and remaining scope

Focused catalog tests cover exact schema/path rules, private metadata, immutable
selection, all-or-nothing capture, one deadline, late completion cleanup and shared
revocation. Integration checks exercise the existing core, stdio and review broker.
A native Windows terminal run exercised the actual catalog broker and relay:
the first ask action was confirmed and executed once, the second was explicitly
declined, and a third review was cancelled by client disconnect after its preview.
The second sentinel stayed absent; broker/relay exited zero, the endpoint and
owned scratch were removed. The ignored receipt is
`.agent/b1-catalog-pty-receipt.json`. Automated terminal control is not human
authentication.
No installed-Claude catalog verification is claimed here. This adds deliberate
selection among bounded actions; native agent tools, arbitrary MCP servers,
descendant isolation and general observed activity coverage remain outside scope.
