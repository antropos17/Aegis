# Known-secret checks for MCP tool traffic

An optional --secret-policy <path> suffix enables a bounded deny check in the
explicit stdio, HTTP and HTTPS gateways. Existing configurations without that
suffix retain their previous behavior. The operator supplies known protected
values in a separate local JSON file; the gateway does not discover or read
credentials from environment variables, agent configs, .env, .ssh or cloud files.

```json
{"schemaVersion":1,"values":["SYNTHETIC_PROTECTED_VALUE_12345"]}
```

The example is a disposable synthetic value. The real file contains plaintext
protected values and must be stored with the operator's normal credential
protections; do not commit it. The file has exactly schemaVersion and values,
with 1–32 distinct strings, each 8–256 UTF-8 bytes and at most 4096 bytes in total.
Controls and unpaired Unicode surrogates are unsupported. File/JSON reads retain
the existing bounded regular-file, strict UTF-8 and JSON limits.

```text
node src/main/main.js --mcp-gateway-http endpoint.json manifest.json --secret-policy protected.json
node src/main/main.js --mcp-gateway-stdio launch-policy.json request.json manifest-v2.json <absolute-grant-store> --secret-policy protected.json
```

The suffix must be last and occur once. A supplied policy that cannot be read or
validated causes refusal; it never silently disables the check. The path is
captured once and the file bytes are SHA256-pinned for that gateway lifetime.
Read failures or observed changes close admission. Checks occur before dispatch,
before returning a tool result, and before serving the cached tool catalog.
These are checkpoints, not continuous file monitoring or an atomic filesystem
transaction; changes made and reverted between checkpoints can go unobserved.

The guarded payloads are accepted tool metadata before it can reach the client,
complete tools/call parameters before upstream dispatch, and validated tool
results before they reach the client. Both string values and object property
names are inspected after JSON decoding. Matching uses substrings of the literal
protected value and a fixed set of representations: UTF-8 Base64/Base64url with
and without padding, full UTF-8 hex in upper/lowercase, encodeURIComponent output,
and fully percent-encoded UTF-8 with upper/lowercase hex digits. JSON-escaped
forms of these representations are also checked. It does not run
operator-provided regexes or an LLM. Traversal is bounded to 2048 nodes, depth 8
and 64 KiB of text; unsupported values or exceeded limits fail closed.

A match yields a fixed error and closes admission, without returning the matched
value, its location or the policy contents. The existing CLI may close with code 2
before writing the error frame. A refused call attempt can remain consumed by
the persistent grant store; the filter never refunds or automatically retries
it. Rejecting an upstream result does not undo effects already performed by the
server. No automatic redaction silently changes the authorized operation.

This is a known-value filter on selected tool traffic. It does not discover
unknown secrets, prove that clean text is harmless or provide complete DLP.
Numeric transformations, split/reordered values, altered alignment in larger encoded payloads, partial,
mixed-case percent escapes and arbitrary/nested encodings may evade this finite
representation set. Credentials used to launch a stdio server (arguments/env),
HTTP authorization/URL/headers, MCP session headers and client-owned request-ID
echoes are outside this payload contract. Those configuration channels have
their existing explicit trust boundaries. The filter cannot erase data the
client already supplied, prevent a server's independent actions, inspect other
network routes or protect against same-account runtime/file tampering.

Policy values are necessarily held in process memory. Closing drops references
and clears owned buffers where possible; JavaScript strings cannot be reliably
zeroized. This feature makes no guarantee about process dumps or ambient runtime
diagnostics for launch configuration. Keep unrelated secret files and production
credentials out of test fixtures and reports.
