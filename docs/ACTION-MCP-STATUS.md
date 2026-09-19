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
