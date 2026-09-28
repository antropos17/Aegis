# Protected Session: inactive wire protocol v1

E-stage: first, partial E1 change. Backend direction: separate C# helper, accepted
at Astra A0 for `535c0e845787b27fbb6d70e2fd273ae4f545f525`.
This contract has no production caller and never permits an agent to launch.
The helper is unelevated and creates no identity, service, desktop, Job, ACL or
firewall resource. Current short-action/AppContainer and MCP owners keep their
separate contracts.

## Message and framing

One request per helper process: a four-byte unsigned little-endian byte length,
followed by UTF-8 JSON, then stdin EOF. Length must be 1–2048 inclusive. The
native helper rejects extra bytes/frames, invalid UTF-8, truncated input and
noncanonical JSON. It has a 2000 ms total input deadline, including EOF.
Malformed input or arguments exit 2 without output or exception text.

The private v1 grammar requires the exact following key order, no whitespace,
no extra or duplicate keys, and no escaping in the identifiers. This removes
JSON-parser disagreements between JS and the native helper. Version/shape
changes require a new reviewed contract; tolerant unknown-field handling is
not supported.

```json
{"protocol":"aegis-protected-session","version":1,"operation":"prepare","requestId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","sessionId":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}
```

`operation` is `probe` or `prepare`. `requestId` and `sessionId` are exactly 32
lowercase hex characters. The trusted owner will create fresh identifiers when
integrated; v1 uses them only for reply correlation. Neither identifier is a
capability, session authorization or authenticated identity. PID, SID, command,
path, policy, credential and approval fields are rejected.

The helper's only valid reply, framed identically, is:

```json
{"protocol":"aegis-protected-session","version":1,"operation":"prepare","requestId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","sessionId":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","state":"unavailable","reason":"containment-unavailable","launchAllowed":false}
```

The reply uses the original operation and identifiers. `probe` exits 0 after
reporting unavailable; `prepare` exits 3 after refusing. Exit 0 is successful
protocol inspection, not permission or isolation. There is no success/prepared/
running response in v1. No request can provision resources or launch a process.

The JS decoder requires exactly one complete frame matching the trusted
outstanding request and the fixed unavailable reply. It rejects a different
operation/session/request ID, changed version, unknown/duplicate keys, claimed
readiness or `launchAllowed: true`. It returns frozen refusal metadata. A
missing or failed helper cannot supply launch authority; integration must not
introduce an ordinary launch fallback.

## Ownership boundary still to implement

Schema validation and correlation do not authenticate a process. v1 does not
yet establish OS caller token, trusted helper provenance, session ownership,
replay protection, durable state, broker endpoint identity or authorization.
It must not be exposed as an elevated service or approval endpoint. A future
transport must independently establish those properties before a message can
have an effect. The renderer must not gain a generic privileged command API.

The separate entrypoint is intentionally inert. Turning `prepare` into a real
state transition, adding an active response, connecting a production launcher,
adding persistent resources, or introducing another operation changes the
trust boundary and needs scoped Astra review before merge. A1 still requires
the actual E1–E3 native effect/crash tests; this protocol step cannot pass A1.

Before broader agent integration, choose and review the concrete token/SID/ACL
profile. In an explicitly authorized disposable Windows host, qualify both
Everyone-readable outside-canary denial and successful in-scope runtime work.
Network persistence, host brokers, endpoint impostors, cleanup-unknown, and
the existing teardown EPERM remain later qualification requirements. Pro
subscription broker compatibility and real credentials remain gated at A2.

## Build and behavioral verification

`npm run build:sidecar` compiles `sidecar/session/{Program,Protocol}.cs` into
`build/sidecar/aegis-session.exe` with the existing inbox .NET Framework C#
compiler. The executable is included by the existing sidecar resource rule;
its presence is not integrity verification or runtime qualification.

`tests/main/protected-session-protocol.test.js` verifies the JS refusal contract
on all platforms. `tests/main/protected-session-windows.test.js` compiles the
actual C# sources into an owned disposable directory and exercises the binary:
cross-language probe/refusal, hostile frames, input deadline and no dispatch.
The no-dispatch fixture first creates its sentinel with an unrestricted reader/
writer control, removes it, then verifies hostile launch fields produce no
sentinel and no echoed output. Windows tests are explicitly skipped elsewhere.

These tests use ordinary test-process rights and no new OS containment. No
privileged provisioning, real provider secret or protected online task is
tested. Exact executed results and later scoped review live with the E1 packet.
