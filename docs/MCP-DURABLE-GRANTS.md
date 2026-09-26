# Persistent one-attempt MCP grants

An optional [known-secret policy](MCP-KNOWN-SECRETS.md) checks tool metadata, arguments and results for explicitly supplied values and a finite set of encodings. It is not general DLP.

Manifest version 2 extends the explicit stdio and loopback HTTP gateway profiles.
An operator selects an existing absolute grant-store directory as the final CLI
argument. All processes using those permissions must use the same store.
Version 1 remains connection-local and accepts no store argument.

Manifest version 3 adds an exact configured HTTP(S) route binding to the same
persistent one-attempt grants. It is supported by the HTTP/HTTPS gateway; stdio
uses version 2 or the version 5 profile below. A version 3 manifest adds one
top-level `route` object
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

Manifest version 4 also binds the selected HTTP(S) bearer bytes across gateway
restarts. Prepare the tag with an explicit operator command, using the same
endpoint descriptor and grant store that the gateway will use:

```text
node src/main/main.js --mcp-gateway-credential-tag endpoint.json <absolute-store-directory>
```

The command validates the endpoint and creates a 32-byte `.credential-key`
in the selected store if absent. It does not connect to the server or call a tool.
It returns one JSON `credentialTag` (64 lowercase hexadecimal characters). Set
`schemaVersion` to 4 in a version 3 manifest and add that returned value as the
top-level `credentialTag`; keep the same `route`, `tools`, `grants` and store path.
The tag is an HMAC over the validated public route and bearer bytes under the
store key. Do not put the bearer or the store key in the manifest. Use a
high-entropy bearer and restrict access to the store to the gateway operator.
On Windows, the requested `0o600` creation mode does not establish a private
ACL; this CLI does not verify the directory or key ACL. Anyone who obtains both
the key and manifest tag can test guesses of a weak bearer offline.

The gateway only reads the existing key. Missing, malformed or changed key
material, a different token, or a different route rejects initialization before
the upstream connection and before grant consumption. The key is checked again
before each durable grant is consumed. A second preparation for
the same route and token returns the same tag. Changing either requires a fresh
tag and a new grant ID; old consumed IDs remain consumed in the same store.
The key counts toward the 1024-entry store ceiling and is authorization state:
do not prune it with diagnostic logs. A crash during creation may retain an
incomplete key or lock; the gateway fails closed instead of repairing either.

The tag does not independently attest the server or prove which account the
server associates with the bearer. A service can change that association without
changing the token. The store key must remain with its permission records;
copying or replacing the store changes the trust boundary. Same-account tampering,
protected grant issuance, general recipient semantics and
outside-route enforcement remain open. Versions 1–3 retain their previous
contracts, including version 3's lack of credential binding.

Manifest version 5 binds an explicit stdio grant to the effective direct launch
descriptor across gateway restarts. Prepare the tag with the same policy, request
and grant store that the gateway will use:

```text
node src/main/main.js --mcp-gateway-stdio-route-tag policy.json request.json <absolute-store-directory>
```

The command requires a current exact policy `allow`, creates the same private
32-byte `.credential-key` used by version 4 if absent, and returns one JSON
`stdioRouteTag` (64 lowercase hexadecimal characters). It does not start the
server or call a tool. Set `schemaVersion` to 5, add that top-level tag, and keep
the version 2 `tools` and `grants` shapes. Version 5 is accepted only by the
stdio gateway; it has no `route` or `credentialTag` field. Use the existing
`--mcp-gateway-stdio` command with the policy, request, version 5 manifest and
same store path.

The tag is a domain-separated HMAC under the store key over the effective
`executable`, `cwd`, ordered `args` and completed `env` passed to `spawn`. Paths
are lexically resolved, environment names are sorted, and the platform is part
of the tagged descriptor. This includes Windows defaults and the explicit
`NODE_V8_COVERAGE` setting added by direct execution. No command, argument or
environment value is printed in the tag command's report. The gateway checks
the existing key and tag before opening upstream. Before each durable grant
consumption, it rereads the selected policy and request and checks the tag
again. Missing, malformed or changed key material, changed launch fields, or
changed source bytes during a connection close the route. A denied attempt does
not create a receipt when this pre-consumption check fails.

The tag binds launch strings, not executable bytes, resolved symlink targets,
files in the working directory, dependencies, child processes or actions outside
this gateway. A changed policy or request on a later run can use the same tag
if it authorizes the same effective launch. Changing the launch requires a new
tag and a new grant ID; consumed IDs remain spent in the same store. Restrict
access to the key and configuration, and apply the Windows ACL caveat above.
Possession of both key and tag permits offline guessing of weak launch values.
Versions 1–4 keep their previous contracts. Protected grant issuance, verified
task identity, same-account tampering and outside-route enforcement remain open.

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
before sending tools/call. Version 5 additionally rechecks source configuration,
the key and the effective stdio route before consumption. Store errors,
expiration, malformed output, catalog
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
