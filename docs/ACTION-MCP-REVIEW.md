# Selected-action MCP terminal review (B1)

This opt-in route connects an MCP client to one operator-selected action while
keeping each execution review on the operator's terminal. Start the broker with
live terminal input and error output, using a new endpoint file in a trusted,
private directory:

```sh
node src/main/main.js --action-mcp-review /absolute/policy.json /absolute/request.json /private/newendpoint.json
```

Configure the intended MCP client to launch the relay:

```sh
node src/main/main.js --action-mcp-connect /private/newendpoint.json
```

No permanent agent settings are changed automatically. The broker prints only
the fixed readiness record `{"mode":"action-mcp-review","ready":true}` to stdout
after publication. The relay's stdout carries MCP protocol messages only.

## Review and revision binding

The client receives the existing `aegis_execute_selected` tool with empty
arguments. It cannot select another action or supply an approval. Each `allow`
or `ask` call requires a fresh [terminal confirmation](ACTION-CONFIRMATION.md);
`deny` remains final. The complete, ASCII-escaped effective action is shown only
on the operator terminal, subject to the existing 16 KiB preview limit, 60-second
review deadline, 128-byte response limit and random challenge. It is never sent
to the MCP client or included in the redacted execution report.

MCP initialization captures the selected policy/request revisions. Each review
borrows that same private binding, without recapturing configuration or revoking
it after an ordinary completed call. Observed changes or read failures revoke
the connection's scope; restoring bytes does not revive it. Closing the session
revokes the binding and cancels pending review or direct-child execution through
bounded cleanup. A confirmed grant expires after five seconds and permits one
launch attempt, including a failed spawn. Reports preserve the original policy
decision and identify successful approval as `operator-confirmed`.

The standalone JSON CLI and direct MCP stdio route retain their behavior: `ask`
does not launch there. This broker is an explicit additional route, not general
interception of native agent commands or other MCP tools.

## Endpoint and transport boundary

The broker listens on a random port at `127.0.0.1` and accepts one authenticated
connection. Its descriptor has exactly three fields: `schemaVersion: 1`, `port`
and a 256-bit random bearer `token` encoded as 64 lowercase hexadecimal digits.
Publication uses exclusive `wx` creation with mode `0600`; it never overwrites an
existing descriptor. The parent directory must already be trusted and private.
Windows inherits directory ACLs: mode `0600` alone does not ensure privacy.

Anyone who reads the bearer can win the single connection or cause denial of
service. Anyone who can replace the descriptor can redirect the relay to a fake
broker. This is not authenticated human identity: agents can automate a TTY/PTY.
The preview may expose secrets in local scrollback or terminal recording.

The broker limits its lifetime to 15 minutes, connection attempts to eight,
pending authentications to four, authentication time to three seconds and each
authentication buffer to 16,449 bytes. The existing bounded
[MCP protocol contract](ACTION-MCP.md) still applies. The relay limits each
direction to 1 MiB, queued output to 64 KiB, connection setup to three seconds,
output drain to one second and lifetime to 15 minutes.

Cleanup removes a descriptor only when its owned identity, metadata and expected
content remain verifiable. Partial publication failures use the same conservative
ownership checks; changed or unverifiable files are retained. A trusted parent
directory is necessary because checking a path and unlinking it cannot be atomic
against a hostile directory writer. Private buffers are cleared on cleanup;
filesystem, terminal and crash-record persistence are not thereby erased.

## Verification scope

A native Windows PTY fixture has exercised a real MCP relay, an affirmative ask
execution with exit code zero, and disconnect during a second review with cleanup.
A second run confirmed an ask call, then rejected a subsequent call with a typed
negative response: the report was `confirmation-denied` with no launch, both
processes exited zero and the endpoint was removed. This fixture uses a native
MCP driver; the new broker route has not been verified through the installed
Claude provider CLI. These automated interactions do not establish human
presence. Executable-content binding, continuous file watching,
process-tree isolation and activity outside this selected route remain unsupported.
