# Explicit pinned HTTPS MCP profile

An optional [known-secret policy](MCP-KNOWN-SECRETS.md) checks tool metadata, arguments and results for explicitly supplied values and a finite set of encodings. It is not general DLP.

The existing --mcp-gateway-http command accepts an endpoint descriptor v2 for
HTTPS. It shares the finite JSON/SSE transport, accepted catalog, exact tool and
argument checks, cancellation/session cleanup and optional persistent grants.
Endpoint descriptor version and grant manifest version are independent.

```json
{
  "schemaVersion": 2,
  "url": "https://mcp.example.com/mcp",
  "connectAddress": "192.0.2.10",
  "bearerToken": "OPERATOR_SELECTED_TOKEN_32_CHARACTERS_MIN",
  "caCertificate": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n",
  "certificateSha256": "<64 lowercase hexadecimal characters: SHA256 of leaf DER>"
}
```

The certificate placeholders and documentation address above are not usable
credentials. The operator obtains the intended server identity, CA certificate,
leaf fingerprint, address and token through a trusted channel. The whole bounded
descriptor is pinned by bytes and reread before calls, like the HTTP v1 profile.
It must contain exactly those six fields.

URL names are lowercase ASCII DNS names with at least two labels; IDNs, IP names,
userinfo, query strings, fragments, escaped paths and trailing slashes are not
supported. Paths use the same simple segment grammar as v1. Port defaults to 443
or is an explicit integer 1–65535 without leading zeros. connectAddress is a
literal IPv4 address, including explicitly chosen loopback/private addresses;
this is an operator-selected destination and does not discover or authorize a
network range. The gateway does no DNS resolution, proxy discovery or redirects.

Each exchange creates a dedicated TLS connection to that address. It supplies
the URL hostname as SNI and HTTP Host, requires TLS 1.2 or newer, and offers
HTTP/1.1 through ALPN. The explicit single CA PEM (at most 8192 bytes) replaces ambient trust
for this connection. Standard certificate-chain, validity and hostname checks
must succeed, followed by the exact SHA256 leaf-certificate check, before an HTTP
request or its bearer can be sent. No global TLS settings are changed;
NODE_TLS_REJECT_UNAUTHORIZED=0 cannot disable this connection's verification.
See the [Node TLS identity contract](https://nodejs.org/api/tls.html#tlscheckserveridentityhostname-cert)
and [HTTPS pinning example](https://nodejs.org/api/https.html).

There is no connection/session reuse, automatic certificate rotation, address
fallback, retry, OAuth discovery, challenge-following or downgrade to HTTP. A
changed certificate closes admission even when it has the same trusted CA and
hostname. An operator must deliberately review and update the descriptor after
server changes. Cached Node HTTP/net/HTTPS/TLS diagnostics and runtime
--tls-keylog/--trace-tls options are rejected before connecting. Experimental
Node configuration-file flags are also refused because they can enable those
diagnostics outside the visible command-line flags. This CLI assumes
a trusted Node bootstrap; arbitrary injected preload code or same-account runtime
mutation is outside the boundary.

Cancellation and DELETE always return to the captured endpoint and still perform
TLS checks. A failed handshake during cleanup means cleanup is unconfirmed; an
HTTP acknowledgement does not prove remote execution stopped. Existing transport
limits and deadlines remain, so high-latency or streaming servers outside this
finite profile can fail closed.

Owned TLS fixtures verify the positive route and negative certificate cases.
Their checked-in keys are public disposable test keys, never deployment keys.
This evidence does not establish interoperability with an installed provider or
third-party hosted MCP service. TLS authenticates the configured certificate;
it does not prove a tool's honesty, constrain its operating-system effects or
provide general secret/DLP controls. OAuth, protected permission issuance and
process isolation remain separate work.
