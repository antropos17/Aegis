# Selected-action MCP terminal review (B1)

Before starting this route, the optional
[route checker](ACTION-ROUTE-CHECK.md) can inspect selected files and current
runtime/terminal prerequisites without opening a listener or requesting approval.
Its result does not establish a future broker connection or authorize execution.

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
processes exited zero and the endpoint was removed.

Installed Windows Claude Code 2.1.263 also passed all four broker/relay scenarios:
approved ask returned `operator-confirmed`, original policy `ask`, child exit zero
and a sentinel; declined ask required an observed negative answer and returned
`confirmation-denied` without launch; policy deny returned `policy-deny` without
a preview; disconnect after a drained preview cancelled the Claude process tree
with confirmed taskkill cleanup, no tool result and no sentinel. Every broker
closed and removed its endpoint without fallback owner cancellation. The run made
seven local model requests, rejected no proxy requests and removed owned scratch.
Provider tool results and captured Claude stdout passed exact private-canary scans,
including the descriptor bearer and selected private paths. The ignored receipt is
`.agent/b1-claude-review-provider-receipt.json`.

To reproduce on Windows, replace the executable and scratch paths with explicitly
selected local paths; scratch must already exist on a spacious drive:

```powershell
node scripts/verify-claude-action-mcp.mjs --review --claude 'C:/absolute/claude.exe' --bash 'C:/absolute/bash.exe' --scratch 'X:/existing/private-scratch'
```

Keep stdin and stderr attached to a real terminal. Enter the displayed `RUN`
challenge for the first scenario, then `no` for the second. Policy deny needs no
answer. The verifier accepts the negative answer only within 55 seconds of the
drained preview, so an answer after the production review's 60-second deadline
cannot turn a timeout into a successful refusal check. The production deadline
remains 60 seconds. The disconnect scenario automatically cancels Claude after the preview
has drained. Stdout contains readiness JSON lines followed by the final redacted
receipt. The private preview remains on stderr; do not save a combined terminal
transcript as a receipt.

The unchanged default fixture also passed its allow/deny/ask regression with six
local model requests; `.agent/b1-claude-review-direct-regression.json` records that
separate direct-stdio run.

The fixture uses a synthetic loopback API, dummy credential and disposable MCP
configuration. It does not verify a cloud model or enforce OS network isolation.
These automated interactions do not establish human presence. Executable-content
binding, continuous file watching,
process-tree isolation and activity outside this selected route remain unsupported.
