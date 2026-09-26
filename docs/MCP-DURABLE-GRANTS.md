# Persistent one-attempt MCP grants

An optional [known-secret policy](MCP-KNOWN-SECRETS.md) checks tool metadata, arguments and results for explicitly supplied values and a finite set of encodings. It is not general DLP.

Manifest version 2 extends the explicit stdio and loopback HTTP gateway profiles.
An operator selects an existing absolute grant-store directory as the final CLI
argument. All processes using those permissions must use the same store.
Version 1 remains connection-local and accepts no store argument.

Manifest version 3 adds an exact configured HTTP(S) route binding to the same
persistent one-attempt grants. It is supported by the HTTP/HTTPS gateway; stdio
continues to use version 2. A version 3 manifest adds one top-level `route` object
while retaining the version 2 `tools` and `grants` shapes and store argument.
For a loopback endpoint, set `schemaVersion` to 3 and add this root field:

```json
{"route":{"transport":"http","url":"http://127.0.0.1:4567/mcp"}}
```

For pinned HTTPS, `route` has exactly `transport: "https"`, the exact selected
`url`, `connectAddress` and lowercase `certificateSha256` from the endpoint
descriptor. HTTP has exactly `transport: "http"` and `url`. A mismatch with the
validated selected endpoint rejects initialization before starting a tool or
consuming a grant. The route object contains no bearer token or CA text.
The connection still pins all endpoint descriptor bytes, including the token and
CA, and rechecks them before dispatch. Changing the selected route requires a
new manifest and a new grant ID; a consumed ID cannot be reused through another
route in the same store. Version 2 stays available with its earlier unbound-route
contract, so operators who need this binding must select version 3 explicitly.
The configured URL and certificate pin do not independently prove the server's
identity or what it does with arguments. A different bearer token at the same
URL can select another account or tenant on a later run; v3 does not bind that
credential. Loopback HTTP can also have a different listener on the same URL
after restart. Stdio route binding, protected issuance, task identity and general
recipient semantics remain open.

```text
node src/main/main.js --mcp-gateway-http endpoint.json manifest-v2.json <absolute-store-directory>
node src/main/main.js --mcp-gateway-stdio policy.json request.json manifest-v2.json <absolute-store-directory>
```

The root remains a closed object with schemaVersion, tools and grants. Version 2
uses schemaVersion: 2 and each grant has exactly these fields:

```json
{
  "id": "unique_grant_identifier_32_chars_min",
  "taskId": "operator_task_identifier_32_chars_min",
  "notBefore": 1790000000000,
  "expiresAt": 1790000060000,
  "tool": "record",
  "arguments": { "recipient": "chosen" }
}
```

This example's timestamps are illustrative; choose the actual validity window.
IDs contain 32–64 ASCII letters, digits, underscores or hyphens. Timestamps are
nonnegative safe integer Unix milliseconds, with a positive window of at most
24 hours. Grant IDs and exact tool/argument combinations must be unique within
the manifest. Task ID is operator-supplied metadata, not an independently
verified task or caller identity. Recipient restrictions remain exact argument
matching and depend on what the tool actually does.

The gateway consumes permission persistently before catalog/route rechecks and
before sending tools/call. Store errors, expiration, malformed output, catalog
changes, cancellation and process death never refund that permission. The clock
is checked at consumption and immediately before dispatch. Expiry does not stop
an already dispatched operation, and this profile does not provide a trusted
clock or protection against clock changes by the account owner.

Consumption uses the hash of the grant ID, independent of task ID or arguments:
changing other fields cannot revive that ID in the same store. Concurrent
processes may fail closed on contention; they never retry automatically.
Store records contain no tool arguments or bearer credentials.

The store has a hard 1024-entry ceiling including its transient lock (at most
1023 retained entries), and is not automatically pruned. Existing
receipts, including incomplete ones, remain consumed. An interrupted exclusive
store lock blocks future consumption; the gateway does not guess that a lock is
stale or remove it. Operator recovery must revoke old manifests and permissions
before adopting a new store. Deleting receipts, selecting a different directory,
restoring an old backup or falling back to v1 removes the cross-run guarantee.
Keep this authorization state separately from disposable diagnostic logs.

This is a local filesystem boundary. It does not protect against malicious
same-account modification, prove server identity, provide OS containment or
ensure persistence across power loss on every filesystem. The server may have
completed an operation when the reply is lost; denial on the next attempt does
not imply rollback. HTTP cleanup acknowledgement still does not prove remote
execution has stopped. General secret/DLP protection and protected permission
issuance remain open.

Verification uses owned fixtures: two native Node CLI processes contend for one
permission, a gateway dies during an upstream call, and restarts cannot repeat
its effect. Stdio restarts, expiry after a fresh catalog, cancellation and
malformed responses exercise the same store. These tests do not establish
third-party server/provider compatibility.
