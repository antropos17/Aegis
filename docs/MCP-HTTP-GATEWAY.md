# Explicit loopback HTTP gateway (B2.2)

An optional [known-secret policy](MCP-KNOWN-SECRETS.md) checks tool metadata, arguments and results for explicitly supplied values and a finite set of encodings. It is not general DLP.

The same command also accepts the opt-in [pinned HTTPS descriptor v2](MCP-HTTPS-GATEWAY.md). This document describes the loopback HTTP descriptor v1.

Optional [manifest v2 persistent grants](MCP-DURABLE-GRANTS.md) add expiry and cross-run replay protection using an explicitly selected shared local store. The version 1 examples below retain connection-local semantics.
Manifest v3 can additionally bind those grants to this exact loopback URL; see the same grant contract.
Manifest v4 can also bind the selected bearer bytes through a private grant-store key.

`node src/main/main.js --mcp-gateway-http <endpoint.json> <manifest.json>` connects
the existing stdio-facing gateway to an already running, explicitly selected
local MCP HTTP server. The tool manifest, exact one-attempt grants, input/output
schema subset and fresh catalog checks are shared with the
[stdio gateway](MCP-STDIO-GATEWAY.md). This command opens no inbound HTTP listener
and does not install provider configuration or start an upstream process.

The private endpoint descriptor is:

```json
{
  "schemaVersion": 1,
  "url": "http://127.0.0.1:43210/mcp",
  "bearerToken": "REPLACE_WITH_THE_SERVERS_PRIVATE_TOKEN"
}
```

Use the token configured on the chosen server; the gateway does not provision or
rotate it. Keep the descriptor private and outside exports. The token must contain
32–256 ASCII letters, digits, underscores or hyphens. The descriptor must contain
exactly these three fields. It is bounded to 64 KiB, parsed privately and pinned
by its bytes for the connection. Observed changes or read failure revoke the route;
restoring the file does not revive it. As with the tool manifest, there is no
continuous filesystem monitor or atomic guarantee between checks.

Only the literal `http://127.0.0.1:<port>/<path>` form is admitted: port 1024–65535,
path up to 256 characters using nonempty slash-separated ASCII letters, digits,
underscores and hyphens. Hostnames, IPv6, alternate numeric hosts, userinfo,
queries, fragments, percent escapes, dot segments and trailing slashes are
unsupported. Each request uses its own agent and a literal loopback socket; no
DNS lookup, environment proxy, global agent or pooled connection is used.
Redirects, authentication challenges and cookies never trigger another request
destination, credential forwarding or automatic login.

This constrains the address contacted. It does **not** independently identify the
process listening there, secure its configuration, constrain its own network
egress or prove that it enforces authentication. A local process can replace an
unprotected listener. The operator must trust the selected server and protect
its token/configuration. Plain HTTP is confined to loopback in this profile;
the pinned HTTPS profile adds configured TLS identity; OAuth remains separate work.

## Finite HTTP profile

The implementation follows the request/session structure of
[MCP 2025-11-25 Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
within an explicitly restricted profile. RPCs and notifications use POST to the
exact endpoint, with Bearer authorization, its origin, an Accept header for JSON
and SSE, and the fixed MCP protocol version. The upstream must assign a visible
ASCII session ID of 1–128 characters during initialization. All later requests
carry that same ID; missing initialization IDs, duplicate headers and observed
ID replacement close admission. Stateless servers are unsupported.

Both JSON and **finite** SSE RPC replies are supported. SSE may contain comments,
an empty priming event, bounded event IDs/retry metadata, and one correlated JSON
result with an optional `message` event type. Multiline data and CRLF are accepted.
Incomplete events, extra replies, reverse requests, tool-change notifications,
unsupported fields or data-event types, malformed UTF-8 and mismatched IDs close the
route. Notifications require an empty HTTP 202 acknowledgement. RPC replies
require HTTP 200 and JSON or SSE with optional UTF-8 charset; content encodings
and alternate media types are unsupported. Tool output is still checked against
the accepted output schema and exact JSON text representation before delivery.

There is no persistent GET stream, resumption, automatic reconnect, retry,
legacy HTTP+SSE fallback or grant renewal. In particular, an expired session
(HTTP 404) closes this gateway connection instead of silently acquiring fresh
one-use grants. An operator must start a new connection explicitly. A server that
keeps an SSE reply open past the deadline is unsupported by this finite profile.
This is not a claim of general MCP HTTP client compatibility.

## Cancellation, bounds and evidence

Cancelling the active downstream request closes admission, aborts its HTTP request
and attempts a cancellation notification using the **upstream** request ID. It
then attempts DELETE for the captured session at the original endpoint. Wrong
typed IDs do not cancel the request. Initialization is not sent a cancellation
notification; losing initialization can leave an unknown server session.

HTTP disconnection, a cancellation acknowledgement and a session DELETE response
do not prove that an already executing operation stopped or that effects were
undone. There is no process handle or server-process termination on this route.
No failed operation is retried. Failed/unsupported cleanup remains unconfirmed.

Responses are bounded to 16 KiB body and 8 KiB per header block, with at most four
informational responses and no protocol upgrade. There is a 1 MiB
total response body accounting. SSE is limited to 128 split lines and one result.
Requests are bounded to 16 KiB bodies. Each exchange has a three-second deadline;
cleanup allows 400 ms each for cancellation and DELETE. The existing 30-second
CLI lifetime and downstream framing limits also apply. Empty 200/204/404 DELETE
responses acknowledge cleanup; rejection, oversized output, timeout or failed
cancellation acknowledgement make cleanup unsuccessful. Clean EOF returns 0 only
after acknowledged session cleanup (or when no peer was opened); this is not a
tool-success or remote-termination result. Lost routes return 2. Failure may close
stdio without a final error frame.

Node's cached `NODE_DEBUG=http` or `NODE_DEBUG=net` diagnostics are rejected before
contacting the endpoint because HTTP diagnostics can print authorization headers.
This is not protection against an instrumented or compromised host runtime.
Credentials, raw headers and server errors are not added to logs or UI exports.

Real loopback-server and Node CLI tests cover JSON/SSE success, exact grants,
replay, changed catalog/descriptor/session, redirects, protocol failures,
cancellation ID translation, deadlines, cleanup refusal, environment proxy
isolation and sensitive runtime diagnostics. Fixtures own their servers and
temporary directories; cleanup closes sockets and removes those directories.
No installed provider or third-party HTTP server compatibility is established
by these fixtures. B2 remains partial: OAuth and third-party HTTPS interoperability, broader recipients
and scopes, protected permission issuance, protected launch and Observatory integration remain.
