# Operator-selected MCP action catalog (B1)

An opt-in catalog publishes up to eight exact operator-selected actions on one
MCP connection. The client chooses a published tool with empty arguments; it
cannot supply executable paths, argv, environment or policy files.

The separate read-only [`aegis_route_status`](ACTION-MCP-STATUS.md) tool reports
owner lifecycle counters and pending/cancellation state for this connection.
It does not count toward the eight selected actions or consume action attempts.
It shares the normal message and replay limits and grants no authority.

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

To generate the client's explicit JSON configuration, use
`--action-mcp-config-json catalog <catalog.json>` or, for a separately started
review broker, `--action-mcp-config-json relay <endpoint.json>`.
The [generator](ACTION-MCP-CONFIG.md) exports selected paths without reading
contents, starting servers or editing client settings.

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
[catalog checker](ACTION-ROUTE-CHECK.md#whole-catalog-check),
`--action-catalog-check-json <mcp-stdio|mcp-review> <catalog.json>`, checks the whole
manifest and every selected policy/request pair without executing or connecting.
It reports each public tool's policy decision and current-process prerequisites;
its temporary revision bindings are revoked before return. The original
`--action-route-check-json` keeps its four single-action routes. A completed check
grants no permission and does not replace catalog admission on a real connection.

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
The installed-provider verifier has two catalog modes. Pass absolute paths to
the installed Windows Claude executable, Git Bash and an existing spacious scratch
directory:

```sh
node scripts/verify-claude-action-mcp.mjs --catalog --claude <claude.exe> --bash <bash.exe> --scratch <directory>
node scripts/verify-claude-action-mcp.mjs --catalog-review --claude <claude.exe> --bash <bash.exe> --scratch <directory>
```

Direct mode requests two different allowed actions in one connection, then checks
deny and ask on the second action in separate connections. It verifies actual
correlated tool reports and records sentinel sizes before requesting the next
action. Review mode keeps one connection for three calls: confirm the first
terminal challenge, type `no` for the second, and let the fixture disconnect
Claude automatically after the third preview. The third call must have no result
or side effect; provider-tree cleanup and broker/endpoint cleanup are required.
Keep stdin and stderr on a terminal and preserve only redacted stdout receipts,
not the private preview transcript.

Installed Windows Claude Code 2.1.263 passed all three direct catalog scenarios
using seven synthetic API requests. Both allowed actions ran once in the expected
order; deny and ask left both sentinels absent. The redacted local receipt is
`.agent/b1-catalog-provider-direct-receipt.json`; its owned scratch was removed.
The same CLI version passed the review sequence using three API requests: first
confirmed once, second explicitly declined, third pending at disconnect with no
result or side effect. The receipt
`.agent/b1-catalog-provider-review-receipt.json` records confirmed provider-tree
cleanup, broker closure without fallback owner abort, removed endpoint and removed
scratch. Forced relay termination produced broker status 2 (abnormal transport
closure); the verifier accepts 0 or 2 only alongside those cancellation and cleanup
proofs. A transport regression verifies that status 2 waits for pending cleanup.

Both modes use disposable configuration, dummy credentials and synthetic local
model responses. They check private canaries in complete tool results and provider
stdout. Historical provider wrappers may change; the fixture compares sanitized
report semantics while preserving strict current-call IDs and scanning all raw
results for canaries. These checks do not authenticate a human, verify a cloud
model or provide OS firewall isolation. Native agent tools, arbitrary MCP servers,
descendant isolation and general observed activity coverage remain outside scope.
