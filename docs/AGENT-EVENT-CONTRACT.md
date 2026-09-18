# Agent event and policy boundary (B1)

Status: first bounded runtime slice implemented, consumed by
`--handoff-import-json claude-code <events.jsonl>`. B1 remains partial.
Live collection, transport authentication and execution control are not implemented.

## Receiver ownership and versioning

`src/main/agent-event-receiver.js` owns registration and normalization. Its only
supported registration is `claude-code-offline`, selected by the importer after
validating CLI arguments. An opaque object handle authorizes in-process intake;
copies, another receiver's handle and closed handles are rejected. It is not an
authentication credential and is never serialized into provider input. The public
source UUID identifies one receiver-allocated registration epoch, not a principal.
All in-process code is inside this trust boundary; this is not a sandbox against
malicious code already running inside AEGIS.

The import report is now schema **2**. Its events are envelope schema **1** and
the source summary (`receiver`) is schema **1**. Existing kind, record, sessionRef
and agentRef fields remain; consumers must recognize the new report version.
There is no wire-envelope decoder or negotiation yet. The adapter parses bounded
provider JSON; a provider's `schemaVersion` is an ignored field. Future envelope
decoders must explicitly reject unsupported versions before admission.

Each event carries a receiver-owned eventId (`sourceId:record`), sourceId,
adapter/adapterVersion, phase, kind, input ordinal and opaque scoped logical IDs.
The current fixed claims are:

| Field | Implemented value and meaning |
| --- | --- |
| phase | `observation`; start/stop reports cannot serve as pre-execution requests |
| provenance / sourceAuthentication | `imported-unverified` / `none` |
| processBinding | `unbound`; no provider field can establish OS identity |
| transferEvidence / activityCoverage | `unobserved` / `unknown` |
| control / decision | `not-supported` / `not-applicable`; admission is never permission |

Receiver snapshots label receipts `receiver-intake-only`, transport `offline-file`
and sequence scope `selected-input-records`. They report accepted/rejected counts,
lastSequence, missingSequences, replayed, lossDetected and open/closed state.
`rejected` includes unsupported and cap-triggering intake attempts, whereas the
legacy report counters separate unsupported input and exclude unprocessed
cap-triggering records. They intentionally count different scopes.

No receipt or execution wall time is invented. A source's session/agent strings
are used only for bounded in-memory equality and cleared on close, including
failure paths. Identical strings in separate source epochs produce separate IDs.
Neither registration nor matching logical IDs binds a process. A future binding
requires fresh independent full OS identity, invalidation on outage/expiry and
separate verification of transport identity. A same-user sender can lie even on an
authenticated transport. Existing sequence rules and audit ownership are unchanged.

## Delivery, loss and resource limits

The offline reader supplies monotonically increasing line ordinals. The receiver
consumes an ordinal before payload validation: malformed input cannot be replaced
by a later retry at the same ordinal. Any ordinal at or below the high-water mark
is rejected as replayed-or-out-of-order; no reorder buffer exists. Higher ordinals
with gaps are accepted with missingSequences and sticky lossDetected. Repeated
provider starts at new ordinals remain separate observations of the same logical
agent. This is input-order replay handling, not cryptographic wire replay protection.

Parser failures, unsupported events, bounds and reader-detected truncation/races
mark loss. Empty input and contiguous input can have no detected loss while activity
coverage remains unknown. A missing tail cannot be discovered from a high-water
mark alone. A missing stop never proves successful completion. Closing a source
revokes intake and retains a bounded metadata tombstone; it does not assert that
the provider has stopped. Restarting creates a fresh scope and cannot link history.

Per receiver lifetime: 32 registrations, 10,000 intake attempts, 2,000 accepted
events and 2,000 combined session/agent identities across all sources. Closing a
source does not replenish budgets. Input ordinals are integers 1–10,000. Each
record is at most 64 KiB and each identifier at most 256 UTF-8 bytes. All limits
are fixed, including on rejected input; no raw error text is returned. The receiver
retains no event list; the importing consumer retains at most 2,000 immutable
metadata envelopes. The reader still enforces 8 MiB total input, bounded chunks and
32 report diagnostics. No queue, background task or disk retention is introduced.

Before a live transport is added it must enforce framing/byte/rate/connection and
queue limits before parsing, source expiry and revocation, authentication and
sequence epochs, explicit restart/drop notices and bounded receipt retention.
An in-memory handle or public source UUID alone must not authorize a network sender.

## Policy contract for subsequent execution adapters

These semantics are design requirements, not implemented policy evaluation:

| Phase / decision | Required behavior at a supported execution point |
| --- | --- |
| `before` | Bind a unique action reference to source epoch, surface, exact operation/arguments/recipient, task and policy revision before side effects |
| `allow` | Permit only the bound action within its expiry and use limit; an intake acknowledgment is insufficient |
| `ask` | Keep the action pending; show the exact bound action; approval cannot authorize changed arguments or a different recipient |
| `deny` | Prevent that action at the declared mediation point and record whether prevention was actually verified |
| `after` | Link to the action and decision; record observed outcome separately; a reported success cannot retroactively authorize execution |

Timeout, unavailable evaluator, invalid/expired decision, lost source binding or
exhausted pending queue must not become `allow`. There is no implicit success or
permission on absent replies. A declared fail-open surface cannot be labeled
blocking-verified. Action payloads needed for policy evaluation require a separate
privacy boundary; this metadata importer must not begin retaining prompts,
arguments, output, credentials or file contents to accommodate that future work.

## Execution-point support

| Surface | Current support |
| --- | --- |
| Explicit Claude lifecycle JSONL | Experimental offline observation; Node 24 synthetic Windows/Linux tests; producer version unknown |
| Live Claude hooks, SDK and A2A sources | Not connected; no installed source or live version verified |
| MCP stdio/HTTP, before/after tool actions | Not connected; no action gate or policy decision |
| Direct shell, filesystem, network and descendants | No blocking through this boundary |
| Audit/UI, scoring and OS binding | No consumer added here; CLI report is the implemented consumer |
| macOS and unusual filesystem providers | Not verified in this slice; reader caveats remain in the handoff contract |

## Initial ACS alignment assessment

Reviewed 2026-09-18 at upstream revision
[`dc265475139a922824f0c817e2ecc2a2ce31c06c`](https://github.com/GenAI-Security-Project/agent-control-standard/tree/dc265475139a922824f0c817e2ecc2a2ce31c06c).
This is a schema comparison; no ACS implementation or conformance test was run.

| ACS v0.1.0 source | AEGIS decision / gap |
| --- | --- |
| [Request envelope](https://github.com/GenAI-Security-Project/agent-control-standard/blob/dc265475139a922824f0c817e2ecc2a2ce31c06c/specification/v0.1.0/request-envelope.json) uses JSON-RPC methods, request IDs, timestamps, metadata and payloads, with nonce/signature fields | AEGIS has local source/event scopes only. It cannot claim wire compatibility, authentication or replay conformance. Do not synthesize a provider timestamp. |
| [Response envelope](https://github.com/GenAI-Security-Project/agent-control-standard/blob/dc265475139a922824f0c817e2ecc2a2ce31c06c/specification/v0.1.0/response-envelope.json) includes allow/deny/modify/ask/defer and policy references | Planned AEGIS allow/ask/deny is a subset. No runtime response mapping exists; unsupported modify/defer must never silently become allow. |
| [Ask details](https://github.com/GenAI-Security-Project/agent-control-standard/blob/dc265475139a922824f0c817e2ecc2a2ce31c06c/specification/v0.1.0/ask-details.json) includes approver, timeout and timeout disposition | AEGIS requires timeout without permission. A future adapter must reject incompatible behavior and verify approval/action binding. |

Next: a separately bounded, opt-in live lifecycle collector with pinned adapter and
producer tests. Completing B1 additionally requires executable before/after policy
handling at an actual mediation point, failure/bypass tests and an updated ACS
assessment of that implementation. Telemetry tests alone cannot close those items.
