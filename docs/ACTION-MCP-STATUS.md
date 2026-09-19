# MCP connection status (B1)

Every selected-action and catalog MCP connection exposes the fixed read-only
tool `aegis_route_status` alongside its action tools. It accepts empty arguments
and returns bounded observations from that connection's MCP owner. It performs
no file reads, binding checks, execution, confirmation or network connection.

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": { "name": "aegis_route_status", "arguments": {} }
}
```

The result is a JSON text content block. Negotiated protocols 2025-06-18 and
2025-11-25 also receive the same value as `structuredContent`; 2025-03-26 receives
text only. The tool advertises read-only and idempotent annotations, with
destructive and open-world hints false. Initialization and its acknowledgement
are required before querying status.

## Observations

The report has `schemaVersion: 1`, `mode: action-route-status` and
`scope: current-mcp-connection`.

| Field | Meaning |
| --- | --- |
| `selection` | `single-action` or `catalog` |
| `selectedActionCount` | Number of selected action tools captured during initialization; excludes the status tool |
| `activity` | `idle`, `owner-pending`, or `cancellation-requested` |
| `messagesObserved` | Received messages counted by the session, including this status query, rejected messages and notifications |
| `actionAttempts` | Calls admitted after tool validation, busy and execution-budget checks; includes later catalog-selection rejection |
| `selectionRejected` | Admitted catalog calls whose private entry could not be selected |
| `ownerInvocations` | Calls actually forwarded to the configured execution owner |
| `ownerSettled` | Owner calls that returned or threw; includes denied, ask and cancelled calls |
| `ownerFailures` | Owner calls that threw; this does not prove execution never started |
| `cancellationRequests` | First matching cancellation notification for each active typed request ID; duplicate or wrong-ID notifications do not increment it |
| `limits` | Shared limits: 128 messages and 16 action attempts |

An owner can remain pending while preparing, awaiting terminal confirmation,
executing or cleaning up. A cancellation request leaves it pending until the
owner actually settles. Neither cancellation nor settlement alone proves child
termination or successful execution. Consult the individual execution report
for that evidence. Status does not retain or reinterpret those reports.

An idle connection with zero invocations has no execution evidence. Denied and
ask calls still count as owner invocations; these counters do not count launches,
successful tasks, prevented harm or global agent activity.

## Limits and privacy

Status consumes the existing message budget and request-ID replay set, but no
action attempt. It remains queryable while an owner is pending and after all 16
action attempts are used. It cannot reopen a closed connection, restore a revoked
binding, replenish a budget or authorize an action. The normal transport expiry,
frame and output limits still apply. Excessive polling can close the connection
through the existing message limit.

Reports contain no client-provided identity, request ID, tool arguments, selected
paths, file contents, environment, bearer token, private capability or raw error.
Counters are in-memory and bounded by the existing connection budgets. Reconnect
starts a fresh scope; no history, persistence, wall-clock timestamp or cross-agent
correlation is introduced.

Every result explicitly keeps `authorization: none`,
`blockingVerification: not-performed`, `providerIdentity: unverified`,
`outsideRouteCoverage: unknown`, `control: direct-child-only` and
`descendantControl: unsupported`. The execution owner callback does not establish
which provider is connected or authenticate human presence. Status does not read
files again and makes no fresh configuration-validity claim. Use the separate
[preflight commands](ACTION-ROUTE-CHECK.md) for selected configuration checks.

This supplies connection observations for B1. The Observatory coverage interface,
independent provider identity and outside-route enforcement remain separate work.

## Verification scope

Native stdio tests query status before and after real single-action/catalog calls,
during a running child and after cancellation cleanup. Core tests check replay,
shared message limits, exhausted action quotas, selection failure, owner exceptions
and text-only negotiation. Broker tests query status during review and after
confirmed or refused calls. Privacy fixtures check status results for private canaries.

Installed Windows Claude Code 2.1.263 passed the existing single-action and
catalog execution fixtures after tool discovery gained status (six and seven
synthetic loopback API requests respectively). These provider regressions did
not invoke the status tool itself. Their owned scratch was removed; receipts are
`.agent/b1-session-status-single-provider-regression.json` and
`.agent/b1-session-status-catalog-provider-regression.json`.

### Installed-provider status sequence

The opt-in verifier can explicitly ask installed Windows Claude to query status,
call one selected action, then query status again in the same connection:

```powershell
node scripts/verify-claude-action-mcp.mjs --status --claude <absolute-claude.exe> --bash <absolute-bash.exe> --scratch <existing-directory>
node scripts/verify-claude-action-mcp.mjs --catalog-status --claude <absolute-claude.exe> --bash <absolute-bash.exe> --scratch <existing-directory>
```

Each mode runs allow, deny and ask in separate provider processes with generated
disposable MCP settings and synthetic loopback model replies. Catalog mode selects
the second of two actions and independently checks that the first stays unused.
The verifier correlates actual tool results and observes fixture side effects
after every result. It requires zero initial owner counters, one settled owner
invocation afterward (including deny and ask), and no additional action attempt
for either status query. Only allow may append one byte to its selected sentinel.

Status counters alone cannot establish that outcome: the action report and
intermediate sentinel observations must agree. Missing, malformed, mismatched or
changed tool results fail verification. Private canaries are checked across tool
result history and final provider output; receipts contain fixed metadata and
bounded counters. All files and processes belong to disposable fixture setup.
The script leaves saved user settings unchanged and reports cleanup explicitly.

These modes exercise idle status before and after a completed direct-stdio call.
They do not verify installed-provider polling during a pending owner, terminal
review, cancellation, a cloud model, provider identity or outside-route protection.

Installed Windows Claude Code 2.1.263 passed both modes: three scenarios and
12 synthetic API requests per mode. Observed message counters advanced from four
to six, while action attempts, owner invocations and settlements advanced from
zero to one for allow, deny and ask. Only allow appended its one sentinel byte;
the unused catalog action had no side effect. Both final runs removed owned
scratch. Receipts are `.agent/b1-provider-status-single.json` and
`.agent/b1-provider-status-catalog.json`.

An initial selected-action run passed its scenarios but failed cleanup because
an empty fixture working directory remained. That failed receipt is preserved
separately; the empty directory was later removed after path validation. The
verifier now retries the same conservative cleanup for up to three seconds and
still fails if removal is incomplete. This is no guarantee about Windows handle
release or descendant termination.
