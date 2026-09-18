# Agent handoff evidence: source review and implementation contract

Status: offline import and [opt-in live transport](LIVE-LIFECYCLE.md) implemented;
a Windows provider fixture with local model responses is verified. Independent
action binding and general execution control remain open.
Source review: 2026-09-16 against AEGIS baseline `b744da5`. A5 remains partial.
External sources were inspected; live hooks, SDK integrations and their
effectiveness were not tested. No handoff sequence rule or enforcement adapter is
implemented by this slice.

## Decision

Introduce reported agent activity through a separate, versioned adapter boundary
before using it in behavioral chains. Start with Claude Code subagent lifecycle
events. They can expose logical activity inside one OS process, which the existing
process ancestry rules cannot resolve. Keep the reporting source and OS evidence
distinct throughout ingestion, audit, display and export.

A handoff record must never create an OS parent edge, move a file event to another
actor, increase a sequence score by itself, or establish transferred content.
SEQ001–SEQ003 retain their current contracts. The implemented first slice is the
bounded offline importer described below; live collection requires the B1 adapter
boundary and separate identity and delivery verification.

## Sources checked and useful parts

| Source | Observed contract | What AEGIS can take / limitation |
| --- | --- | --- |
| [Claude Code hooks](https://code.claude.com/docs/en/hooks#subagentstart) | `SubagentStart` includes `session_id`, `agent_id`, `agent_type`; it also fires on resume and in-process teammate messages. It cannot block creation. | Start with lifecycle reports scoped to a session. A repeated start is not necessarily another agent. These fields do not establish an OS process identity. |
| [Claude Code stop events](https://code.claude.com/docs/en/hooks#subagentstop) | `SubagentStop` includes a transcript path and final response text. | Retain only the lifecycle and scoped identifiers. Discard response text and paths without opening the referenced files. A stop does not establish delivery of a report. |
| [OpenAI Agents SDK span data](https://openai.github.io/openai-agents-python/ref/tracing/span_data/#agents.tracing.span_data.HandoffSpanData) | `HandoffSpanData` contains `from_agent` and `to_agent`; both may be absent. | Preserve declared direction in a future SDK adapter. Names alone cannot identify unique logical agents or OS processes. |
| [OpenAI Agents SDK tracing](https://openai.github.io/openai-agents-python/tracing/) | Tracing includes handoffs; model and function spans can include sensitive inputs and outputs. | A future local processor should project a narrow metadata allowlist before retention. Do not import or forward entire traces. |
| [A2A specification](https://a2a-protocol.org/latest/specification/) | `contextId` groups tasks/messages; `taskId` continues a task and `referenceTaskIds` references related tasks. | Scope identifiers to the reporting endpoint. Shared context and related-task references do not prove local OS ownership or content transfer. Remote peers need their own evidence boundary. |
| [OpenTelemetry GenAI conventions](https://github.com/open-telemetry/semantic-conventions-genai) | The [previous agent-spans documentation](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/) redirects readers to this repository. | Recheck the maintained definitions when implementing an exporter. This review does not freeze an OTel field mapping or claim conformance. |

The limitations in the last column are AEGIS design conclusions. Provider
documentation supplies event semantics, not evidence that an installed adapter
works, covers every action or resists a hostile process with the same user rights.
Record the exact tested agent/adapter versions and OS before enabling a live source.

## Existing AEGIS evidence

| Source in this repository | Current behavior | Consequence |
| --- | --- | --- |
| [Claude token adapter](../src/main/token-adapters/claude-code.js), `_readOneProc` | Resolves a local session registry using a process-start tolerance; extracts usage from main and subagent transcripts; stamps both with the main PID. | Keep this as token accounting. Its registry is agent-controlled, and its timestamp tolerance does not authenticate a handoff. |
| [Subagent usage reader](../src/main/token-adapters/claude-code-subagents.js), `readSubagentUsage` | Returns PID-less usage deltas; excludes sidecar metadata files. | A directory, filename or usage record cannot become a second observed process or a delegation edge. |
| [Token collector](../src/main/token-cost-collector.js), `collectTokenCosts` | Maps the source PID to the current process instance for accounting. | Logical subagent activity cannot inherit independent file/network ownership from that mapping. |
| [Process lineage](../src/main/process-lineage.js) and [related sequences](../src/main/sequence-related.js) | Use fresh process observations and bounded monitored ancestry. | Preserve their identity, outage, age and attribution requirements; see [sequence evidence](SEQUENCE-EVIDENCE.md). |

At the review baseline, the runtime had no `SubagentStart`/`SubagentStop` intake or
handoff-span adapter. The offline importer now accepts these two lifecycle event
kinds from an explicit file. No user transcripts or credentials were read during
the source review or implementation tests.

## Trust and identity contract

Represent these claims separately; satisfying one must not silently satisfy another:

| Claim | Evidence needed | Honest absence |
| --- | --- | --- |
| A provider reported activity | Accepted record with adapter/schema version and source scope | Unsupported, rejected or not observed |
| A sender delivered the record to AEGIS | A receiver-owned receipt and a verified transport/session association | Imported or unauthenticated source |
| A report belongs to a monitored process | Independently established binding to the full fresh process instance | Unbound; never join by PID, name, cwd or timestamp proximity alone |
| Logical agent A handed work to B | An explicit directional provider event with scoped endpoint IDs and documented semantics | Lifecycle only, ambiguous direction or missing endpoint |
| Data moved between agents or to a network destination | Separate observations at the relevant mediation point with their own coverage limits | Transfer unobserved |

Even an authenticated sender can supply false or incomplete reports. Transport
authentication identifies the sender; it does not make that sender a trusted
observer. A caller-provided PID, `instanceId`, confidence or `verified` flag must
never establish an OS binding. Two matching reports from agent-controlled sources
are not independent corroboration. Receipt time is not execution time.

Scope logical identities by adapter, source and session before comparing agent IDs.
One process may host many logical agents, and a resumed session may outlive an OS
instance. Preserve repeated starts as separate observations; do not deduplicate
solely on `agent_id`. Missing stops, lost input, collector restarts and out-of-order
records leave lifecycle coverage incomplete. Never infer successful completion,
parentage, task delivery or fresh ownership from a timeout.

## First implementation slice: explicit offline import

CLI: `node src/main/main.js --handoff-import-json claude-code <events.jsonl>`.
It reads an explicitly selected regular file and emits a metadata report to stdout
before Electron starts. It installs no hooks, starts no agent, follows no transcript
references and does not feed the sequence scorer. The importer makes no outbound
service requests. The caller controls whether to save its stdout.

Exit code 0 means the selected input was processed completely; 2 means incomplete
processing; 1 means invalid arguments, an unsupported adapter or unavailable input.
None is a safety verdict. An empty file can be processed completely while activity
coverage remains unknown. Input order is preserved without asserting execution
order, duration, complete start/stop pairs or successful task delivery.

The normalized report uses `schemaVersion: 2` (the B1 envelope integration), an adapter identifier and an
import-local source identifier. Each event contains a fixed event kind
(`subagent-start` or `subagent-stop`), input record ordinal and opaque report-local
session/agent references. Source session/agent strings are bounded inputs used only
for in-memory equality; they are never echoed, hashed into an export identifier,
logged or retained after import. Allocate opaque references scoped to the import;
they deliberately cannot be joined across imports. Agent names/types remain
excluded in this first slice because they can contain arbitrary user text.

Events now use the [B1 receiver envelope](AGENT-EVENT-CONTRACT.md), with
receiver-owned source/event IDs, observation phase and no applicable policy
decision. The report includes a final receiver summary with delivery/loss metadata.

The report fixes `provenance: imported-unverified`, `processBinding: unbound`,
`transferEvidence: unobserved` and `activityCoverage: unknown`. It includes numeric accepted/rejected/unsupported
counts, bounded fixed-code diagnostics, limit usage and an explicit completeness
field. Completeness describes processing of the selected file only; it cannot
describe coverage of the agent's activity. Do not accept producer-supplied versions
of these receiver-owned fields. Do not emit per-record wall-clock timestamps when
the source supplies none; an import timestamp labels import time only.

Implemented engineering limits; these are not measured tuning recommendations:

| Resource | Bound | On exhaustion or invalid input |
| --- | --- | --- |
| Selected file | 8 MiB, regular file; reject leaf links/junctions recognized by Node | Fixed error; no alternate path or recursive discovery |
| JSONL record | 64 KiB of bytes before parsing | Mark incomplete; skip within the total byte budget, retaining no raw bytes |
| Records / accepted events | 10,000 / 2,000 per import | Stop at the bound; mark incomplete |
| Session/agent input identifiers | Nonempty strings, at most 256 UTF-8 bytes each, no control characters | Reject record without echoing the value |
| Distinct identity entries | 2,000 combined scoped sessions and agents | Stop import before an event would exceed the bound; mark incomplete |
| Diagnostics | 32 fixed-code entries plus aggregate counters | Count further errors without retaining input or exception messages |

Read bounded chunks and compare file identity/size before and after import; visible
mutation makes the result incomplete. Do not claim these checks detect every
concurrent rewrite. Explicitly document the supported OS behavior and path-race
limits. Reuse established safe-file helpers only after checking their actual
guarantees. Unrecognized events count as unsupported. Missing required fields,
malformed JSON, an unterminated final record and read failures remain visible.
Discard unknown fields, nested payloads, tool arguments, prompts, outputs, env
values and transcript paths before constructing results. Error diagnostics never
include a `JSON.parse` message, file body or arbitrary exception text.

`usage.bytes` counts bytes read in 16 KiB blocks, including read-ahead within the
last block. `usage.records` counts newline-terminated records examined, including
the record that triggers the event or identity cap. Accepted, rejected and
unsupported counts exclude unprocessed records and unterminated tails. A rejected
record or unsupported kind makes processing incomplete. Diagnostics retain at most
32 entries; their total count remains available when entries are omitted. A
line's byte bound excludes LF and includes an optional CR. Invalid UTF-8 and lone
surrogates in identifiers are rejected; valid multibyte identifiers use byte limits.

The selected parent directory is canonicalized once. Leaf symlinks, Node-recognized
junctions, nonregular files, UNC/device namespace paths and alternate-stream leaf
names are rejected. This is best-effort Node filesystem checking: it does not
establish that a mount/drive is physically local, cover every Windows reparse tag,
or prevent all same-size rewrites/path races by a hostile same-user process.
Size, device/inode and modification/change times are checked against the open
handle and pathname before and after reads. Detected changes retain any accepted
metadata with `complete: false`; they never upgrade its unverified provenance.

| Surface | Support in this slice |
| --- | --- |
| Node 24 CLI, Windows regular files | Experimental; synthetic file, race and junction tests |
| Node 24 CLI, Linux regular files | Experimental; same synthetic suite in CI, including leaf symlinks |
| macOS, unusual filesystem/reparse providers | Not verified in this slice |
| Claude producer versions | Unknown; only the documented two event shapes are accepted, without asserting a tested installed version |
| Live hooks, SDK traces, A2A, UI and prevention | Not connected |

## Verification required for that slice

| Scenario | Required observable result |
| --- | --- |
| Start/stop records and repeated starts | Ordered lifecycle observations; no inferred handoff, extra process or success verdict |
| Same agent ID in different sessions or imports | Distinct scoped references; no cross-session/import join |
| Forged PID, birth time, `instanceId`, severity or verification fields | Report remains unbound, imported and without a score |
| Canary secrets in every unused field, malformed lines and parser errors | No canary or raw identifier in stdout, stderr, diagnostics or saved report |
| Boundary bytes, multibyte identifiers, large lines and excessive records/identities | Bounded work and memory; explicit incomplete/rejected result |
| Truncation, replacement, link/reparse input, missing file and read failure | Fixed diagnostics, no referenced-file reads, no false complete result |
| Unsupported event, missing stop or unknown producer version | Explicit limits; no claim of full lifecycle or prevention coverage |
| Import while monitoring is running | Existing process identities, sequence state, risk score and audit ownership are unaffected |

Synthetic behavioral, filesystem and CLI fixtures live in
`tests/main/handoff-{import,reader,cli}.test.js`. They exercise the real Node entry,
verify the import module graph stays isolated from monitoring/audit/scoring, and
check privacy and limit failures. A successful import test does not verify a live
provider. Verification and platform results are recorded in the implementation PR.

## Following slices and completion boundary

1. Completed: the offline importer above, its experimental support matrix and
   bounded metadata output. Review its output contract before UI integration.
2. The [first B1 receiver slice](AGENT-EVENT-CONTRACT.md) now supplies the offline
   envelope, registration, ordinal replay checks, loss reporting and lifetime bounds.
   The [live transport](LIVE-LIFECYCLE.md) now checks bearer possession and bounds
   intake; independent OS binding remains open. Provider-driven lifecycle hooks were
   verified on Windows Claude 2.1.263 with a local synthetic API; other versions
   and platforms remain unverified. Credential and same-user attacker boundaries must be
   explicit; a shared loopback secret alone does not establish process ownership.
3. Add Audit display with separate labels for reported activity, source delivery,
   OS binding and transfer evidence. Only propose a new correlation rule after a
   concrete adapter supplies the required independently observed relationships.

For live collection, expiry/reset of a source binding or fresh-process observation
must invalidate dependent pending relations. Dropped events or collector outages
must remain visible through the report, audit and UI. Do not attach old reports to
a recycled PID or revived process path. Privacy review must cover diagnostics,
exports, crash paths and disk retention as well as the nominal event payload.

A5 is not complete after the importer or lifecycle collector. Explicit directional
handoffs, unmonitored helpers, broader causal evidence and measured noise/misses
remain open. B1 also still requires policy decisions, execution-point support and
the planned ACS comparison; this document defines only its evidence prerequisite.
Blocking claims require a connected, separately tested pre-execution control point.
