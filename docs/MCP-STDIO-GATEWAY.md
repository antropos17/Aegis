# Explicit stdio MCP gateway (B2.1; bounded Windows C1 launch)

An optional [known-secret policy](MCP-KNOWN-SECRETS.md) checks tool metadata, arguments and results for explicitly supplied values and a finite set of encodings. It is not general DLP.

Optional [manifest v2 persistent grants](MCP-DURABLE-GRANTS.md) add expiry and cross-run replay protection using an explicitly selected shared local store. Version 5 also binds the effective stdio launch descriptor to a store-backed tag across restarts. The version 1 examples below retain connection-local semantics.

`node src/main/main.js --mcp-gateway-stdio <policy.json> <request.json> <manifest.json>`
starts one operator-selected server after an MCP initialization request and an
exact local launch-policy `allow`. `ask` and `deny` never start the server. No
server discovery, provider configuration changes or credentials are automatic.
The command works in Node CLI mode before Electron loads.

The launch files use the [direct execution contract](ACTION-EXECUTION.md): schema 2
policy with `defaultDecision: "deny"` and exact `{action, decision: "allow"}` rules;
schema 1 request with `{action: {executable, cwd, args, env}}`. Executable and cwd
must be absolute; arguments and environment must match exactly. On Windows, Node
servers need an explicit `SYSTEMROOT` value in both action definitions. Shell
execution and inherited environment are disabled. File contents and executable
code are not attested: the selected command and its dependencies must be trusted
for launch under the current account.

## Optional terminal review for each call

The separate `--mcp-gateway-stdio-review` route requires an owner terminal and
an explicitly selected durable grant store, disclosure policy and known-secret
policy. The owner launches it with a new endpoint file in an operator-private
directory; a client uses the existing `--action-mcp-connect` relay to that file.
The owner terminal and MCP streams are separate:

```sh
node src/main/main.js --mcp-gateway-stdio-review /private/launch-policy.json /private/launch-request.json /private/manifest.json /private/new-endpoint.json /private/grant-store /private/disclosure.json /private/known-secrets.json
node src/main/main.js --action-mcp-connect /private/new-endpoint.json
```

The disclosure file is a strict JSON object with `schemaVersion: 1` and a `tools`
array of `{name, paths}` records. Each `paths` entry is an explicitly approved
JSON Pointer to a displayed leaf, including array indices and empty containers.
Every field in the current call and its earlier comparison must be covered;
sensitive-looking field names and unsupported or control-containing values are
refused. These checks do not classify every sensitive-looking value. The separate
[known-secret policy](MCP-KNOWN-SECRETS.md) rejects only selected known values
and finite encodings. It does not find every secret or provide general masking.
Review displays the actual selected values in the owner terminal: terminal
scrollback, recording and screen capture may retain them. Unknown secrets may
still be present. A TTY or an endpoint bearer demonstrates possession, not
authenticated human identity; the endpoint inherits the chosen directory's
permissions on Windows.

Each eligible call receives a fresh terminal challenge, including when its
arguments match a previously approved call. The comparison baseline is private
to the selected gateway session and is established only by an owner-approved
call that remains valid through final admission checks. No baseline exists for a
tool before its first such call. Cancellation or timeout during review, stale
authorization and missing disclosure evidence refuse dispatch. Cancellation or
timeout after dispatch cannot establish whether an upstream effect occurred.
The review does not resolve filesystem targets or establish argument provenance;
both remain unknown.
Ordinary preauthorized gateway modes remain separate and do not gain a prompt.

The review route reports fixed, redacted attempt outcomes to its private terminal.
An attempt ID is generated for one eligible call; it is not a stable operation ID.
“Upstream response accepted; effect unverified” means the gateway accepted a
checked response, not that the downstream client received it or an effect was
verified. “Dispatch attempted; outcome unknown” also covers cancellation or an
invalid or missing response after the gateway attempted the request. “Not
dispatched by this gateway” is reported only after cleanup and complete evidence
show an eligible attempt ended before the dispatch point. Early rejected requests
may have no attempt ID. Incomplete evidence or a terminal write failure can leave
outcomes unknown; an abrupt process or terminal loss can prevent final output.
The gateway does not retry automatically. A fresh approval does not prevent a
duplicate effect; idempotency and reconciliation are unsupported. Every reviewed
call prompt states this risk before the owner can approve, including after a
gateway restart when earlier outcomes may not be available in the terminal.

For example, a version 2 manifest may select two separate one-attempt grants for
the same exact call on this review route. Supply actual current validity times
and a reviewed tool definition; each ID must be unique in the selected store:

```json
{
  "schemaVersion": 2,
  "tools": [{
    "name": "record",
    "inputSchema": {"type":"object","properties":{"recipient":{"type":"string","maxLength":32}},"required":["recipient"],"additionalProperties":false},
    "outputSchema": {"type":"object","properties":{"accepted":{"type":"boolean"}},"required":["accepted"],"additionalProperties":false}
  }],
  "grants": [
    {"id":"11111111111111111111111111111111","taskId":"tttttttttttttttttttttttttttttttt","notBefore":1000,"expiresAt":2000,"tool":"record","arguments":{"recipient":"chosen"}},
    {"id":"22222222222222222222222222222222","taskId":"tttttttttttttttttttttttttttttttt","notBefore":1000,"expiresAt":2000,"tool":"record","arguments":{"recipient":"chosen"}}
  ]
}
```

With `{"schemaVersion":1,"tools":[{"name":"record","paths":["/recipient"]}]}`
as the disclosure file, the first eligible call shows no baseline. The second
still requires a new terminal approval even if its argument is unchanged. An
attempt reserves its distinct grant within that session before asynchronous work.
Once its durable receipt has been confirmed, denial or cancellation does not
restore it. Cancellation before receipt confirmation can leave durable status
unknown and may leave the ID reusable in a new session; do not infer a durable
consumption from the closed session alone. The ordinary gateway continues to
reject duplicate tool-and-argument entries.

Within one session, the next unused matching grant can be selected. On a later
session, the first matching entry can already be spent in the durable store;
the gateway fails closed instead of skipping a store failure. Before a restart,
the owner must explicitly review a new manifest omitting the previously spent
matching grant IDs. This does not restore or renew any spent grant.

The private accepted manifest has this shape (replace the sample tool with the
complete reviewed definition actually returned by the chosen server):

```json
{
  "schemaVersion": 1,
  "tools": [{
    "name": "record",
    "description": "Record approved operation",
    "inputSchema": {
      "type": "object",
      "properties": {"recipient": {"type": "string", "maxLength": 32}},
      "required": ["recipient"],
      "additionalProperties": false
    },
    "outputSchema": {
      "type": "object",
      "properties": {"accepted": {"type": "boolean"}},
      "required": ["accepted"],
      "additionalProperties": false
    }
  }],
  "grants": [{"tool": "record", "arguments": {"recipient": "chosen"}}]
}
```

Each distinct grant permits one attempt per connection, including failed or
cancelled attempts. With manifest v1, restarting explicitly with the same files creates new grants;
v1 has no durable replay ledger. Manifest v2 uses the selected persistent store. A client cannot supply another manifest or
launch command. Arguments must satisfy the input schema and equal one unused
grant, including every recipient or scope field present. This does not interpret
recipient semantics, resolve aliases or enforce the server's network/filesystem
permissions. Protect these files from untrusted writers; changing them is not an
approval mechanism.

The gateway pins manifest and launch-policy/request bytes at initialization and
rereads them before each call. It asks the upstream for a fresh complete catalog,
compares all tool fields and array order, then rereads configuration again before
forwarding. Observed differences, read failure, unsolicited upstream messages
(including `notifications/tools/list_changed`), malformed output or server death
close the connection. Restoring files does not revive it. There is no continuous
filesystem monitor or atomic guarantee against changes between checks, and a
server can lie about a stable catalog.

## Supported protocol and schemas

This is a deliberately limited subset of MCP
[2025-11-25 tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
over [stdio](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).
Clients initialize with that exact version, then send `notifications/initialized`.
Only `ping`, unpaginated `tools/list`, `tools/call` and cancellation are supported.
There is one active operation. Reused request IDs are rejected; cancelling its
exact typed ID closes the route and kills the held direct server child. Other IDs
do not cancel it. EOF, SIGINT, SIGTERM and deadlines also close admission.

Tools must declare object input and output schemas. Supported schema keywords:

| Type | Required shape / optional constraints |
| --- | --- |
| object | `properties`, `required`, `additionalProperties: false`; at most 32 properties |
| array | `items`, `maxItems` from 0 through 64 |
| string | `maxLength` from 0 through 4096 Unicode code points |
| number / integer | optional finite `minimum`, `maximum`; integers must be safe integers |
| boolean / null | exact JSON type |
| all | optional description up to 1024 characters and 1–32 primitive `enum` values |

Unknown keywords, references, regex, unions, defaults, coercion and open objects
are rejected. Schema depth is at most four with 128 visited schema nodes. The
bounded JSON parser also limits complete upstream envelopes and manifest files
to depth eight and 2048 values, so deeply nested schemas can hit that limit first.
Tool names and property names use bounded ASCII identifiers; prototype-related
names are excluded. Tool annotations, metadata, pagination and task extensions
are unsupported and fail closed instead of being silently dropped.

Successful upstream results must have `structuredContent` matching the accepted
output schema and exactly one text content block equal to
`JSON.stringify(structuredContent)`. Optional `isError` may only be false. Extra
text, resources, metadata or tool errors close the route without passing their
payload. Output validation happens **after** the server executes: it cannot undo
an effect. Schema-valid text can still contain malicious instructions or secrets;
this feature provides neither semantic prompt-injection protection nor DLP.

## Bounds, evidence and remaining work

Manifest/policy/request files are each limited to 64 KiB. The manifest accepts at
most eight tools and 16 unique grants. Downstream transport admits at most 128
frames and 1 MiB total input, with 16 KiB frames and a 64 KiB output queue; at most
64 distinct request IDs are admitted. Upstream output is limited to 16 KiB per
frame and 1 MiB total; stderr is discarded and capped at 32 KiB. Reads/RPCs have
three-second deadlines (launch binding capture is stricter at 1.5 seconds).
The ordinary gateway CLI connection lasts at most 30 seconds. The separate owner
review relay lasts at most 15 minutes, with a 60-second terminal challenge and
the same three-second bounds for non-review gateway operations. Direct-child
cleanup waits at most one second; Windows protected cleanup waits at most two seconds;
unconfirmed cleanup returns exit 2. Clean EOF after confirmed cleanup returns 0.
Transport loss may close without a final JSON-RPC error response.

On Windows, this **explicit stdio route only** requires the bundled
`aegis-mcpjob.exe`, built by `npm run build:sidecar` and included from
`build/sidecar` in the Windows installer. If the helper is missing or protected
launch fails, the route closes without starting the selected server. The helper
receives the exact selected executable, arguments, cwd and environment over its
private stdin.

The helper starts with only `SystemRoot` in its own environment, so inherited
.NET profiler settings and parent process secrets do not reach it. The selected
server receives its separate, policy-authorized environment from the private
launch frame. AEGIS checks that `SystemRoot` is an absolute path; this does not
attest the OS installation directory.

The helper creates a private
[Windows Job Object](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
with `KILL_ON_JOB_CLOSE`, assigns that Job atomically during suspended process
creation with `PROC_THREAD_ATTRIBUTE_JOB_LIST`, and resumes the process only
after creation succeeds. Its
ready signal precedes any relayed server stdout; the gateway strips and checks
that signal. The selected process's stderr is counted and discarded. Helper
status and failure paths do not print launch fields or server stderr.

On ordinary EOF, cancellation, upstream failure and RPC timeout, the helper
terminates its Job and queries active process accounting before it acknowledges
cleanup. The gateway reports confirmed cleanup only after that acknowledgment
and a zero helper exit. Unexpected helper death or a failed cleanup check is
unconfirmed even though closing the last Job handle requests termination.
Native Windows tests exercise a direct child and detached grandchild, exact
argv/cwd/env, missing helper, launch failure, helper crash, timeout and stderr
redaction, including helper death immediately after process creation. On Linux,
the existing direct-child launch remains in use.

Tests in `tests/main/mcp-gateway*.test.js` use real disposable Node upstream
processes and the real Node CLI. They verify exact grants and replay rejection,
schema rejection before launch, catalog/configuration mutation before effects,
invalid results after effects, malformed/reverse traffic, cancellation, deadline
and death. Existing action stdio framing uses the same extracted transport and
retains its regression tests. Fixture processes have a 12-second fallback lifetime
and test cleanup removes their owned directories. No production provider or
third-party server compatibility is claimed by these fixtures.

The server runs with the current user's OS rights and can act independently at
startup or outside forwarded calls. The Windows Job covers ordinary child
processes created through `CreateProcess`; it does not cover work started by
another process or service, including `Win32_Process.Create`. Existing parent
Job restrictions or incompatible nested Jobs can reject creation, which closes
the route. A helper killed after process creation closes its last Job handle;
Windows then terminates the selected process and ordinary descendants. The
gateway still records this as unconfirmed cleanup because it cannot receive the
helper's acknowledgment. The Job does not isolate files, registry, network or credentials.
The separate [finite loopback HTTP profile](MCP-HTTP-GATEWAY.md) has no protected
launch from this change. OAuth and third-party HTTPS interoperability,
protected permission issuance, independent identity, general recipients/scopes,
secret control and Observatory gateway coverage remain open. B2 remains partial;
this bounded Windows path does not close the remaining C1 work or C2–C3. Do not
expose the raw manifest, arguments or results in audit exports.
