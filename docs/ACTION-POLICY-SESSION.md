# Experimental decision and after-report linkage (B1)

`src/main/action-policy-session.js` adds a bounded in-process session around the
[Bash policy evaluator](ACTION-POLICY-HOOK.md). It correlates one local decision
with one provider-reported after event. Its implemented consumer is the opt-in
installed-provider verification fixture. The existing one-shot CLI hook remains
before-only; no production listener, desktop configuration, UI or execution
mediator is installed by this slice. B1 remains partial.

## API and meaning

Trusted adapter code creates `createActionPolicySession({ policyPath })` and calls
`before(Buffer)` for a bounded Claude `PreToolUse` Bash request. Admission reserves
the session/tool-use identity pair before asynchronous evaluation. The existing
evaluator reads the selected policy anew. The promise returns a fixed decision,
reason and session-scoped `actionRef`; rejected admission has no action reference.
The adapter remains responsible for delivering a timely decision to the provider.

`after(Buffer)` accepts `PostToolUse` or `PostToolUseFailure`. It requires the same
session ID, tool-use ID, Bash surface, exact cwd and every own tool-input field.
Object key order is irrelevant; additional keys, array order and types matter.
Matching consumes the pending entry once. Outcomes are `reported-completed` and
`reported-failed`, respectively; command output and exception text are discarded.
The [provider reference](https://code.claude.com/docs/en/hooks#posttoolusefailure)
defines the event fields. A report is not independent evidence of execution.

| Decision linked to an after report | Interpretation |
| --- | --- |
| allow | Reported action matches input evaluated as allowed; delivery and execution are unverified |
| ask | Reported action matches input requiring provider approval; no approval was observed by AEGIS |
| deny | Provider reports the denied input afterward; this is not permission or proof of successful prevention |

`snapshot()` and idempotent `close()` return detached metadata: a fresh source
UUID, opaque action references, decisions, states, optional outcomes and counters.
No caller-supplied verification claim changes `processBinding: unbound`,
`activityCoverage: unknown` or `control: provider-hook-fail-open`. References are
correlation labels and must never be accepted as approval tokens.

## Ordering and failure behavior

Repeated before IDs invalidate an unresolved earlier entry and return deny.
An after arriving while evaluation is unresolved invalidates that entry, so a
late allow cannot escape. A well-formed after with changed cwd or arguments also
consumes the entry as invalidated. Terminal or expired identities remain
tombstones until session close, preventing re-reservation in the same scope.
Malformed or unsupported after input closes the session because its target
identity cannot be safely determined. Unknown valid IDs are rejected.

The decision deadline is 1.5 seconds, and the after-report window is 30 seconds
from initial admission. Expiry, close, invalidation, evaluation failure and
exhausted capacity cannot turn pending evaluation into allow. Monotonic checks
at admission and evaluator completion supplement timers. They cannot interrupt
an event-loop stall or cancel an already delivered decision. Closing a session
does not stop a provider command that is already running.

`lossDetected` is sticky evidence of rejected intake or unresolved correlation,
not a measurement of all provider activity. Expiry/close without an after for a
known deny is expected and does not alone mark loss. Missing after for allow or
ask leaves uncertainty. Neither zero loss nor an empty session proves coverage.

## Bounds and privacy

Each session permits 128 action reservations, 512 intake attempts, 1 MiB total
input bytes and four outstanding evaluations. Malformed input consumes attempt
and byte budgets too. Caps are lifetime budgets; completion does not replenish
them. Exceeding a cap closes the scope and revokes unresolved evaluations.
An evaluator that times out still occupies its concurrency slot until it settles.
Individual records also retain the evaluator's 64 KiB/depth/node limits.

The adapter copies input before awaiting evaluation, so a caller cannot mutate
the reserved request into a different evaluated action. Private tool-input
objects are released on terminal state, expiry or close; owned raw buffers are
zeroed at those boundaries and when evaluation settles. Identity tombstones
retain bounded raw ID pairs until close, when keys become public references.
Already parsed local variables inside a hung evaluator can survive until that
evaluation settles; the four-evaluation limit bounds this exposure. JavaScript
heap erasure, crash-dump protection and hostile in-process code are outside scope.

No raw arguments, cwd, IDs, response text, policy contents or unkeyed hashes are
exported or persisted. There is no disk ledger, background service or process
discovery. Trusted callers must close sessions; timers are unreferenced and do
not keep Node alive. Restart creates a fresh scope and cannot recover history.

## Verification and remaining work

Unit tests exercise actual policy reads, exact comparison, separate sessions,
single consumption, mismatch/replay, deadlines, close races, caller mutation,
capacity, privacy and metadata isolation. The opt-in
`scripts/verify-claude-hooks.mjs` additionally uses a test-only authenticated,
finite loopback relay to connect actual Claude hooks to the session API. It uses
disposable settings and synthetic local model responses, with fixed redacted
receipts. This relay is not a supported production transport.

On Windows Claude Code 2.1.263, the linked-allow fixture created its disposable
sentinel and matched the actual after hook to the before action reference. The
linked-deny fixture created no sentinel and received no after hook. Both closed
without detected loss. The complete fixture made sixteen local synthetic API
requests and removed its owned scratch. PostToolUseFailure and ask correlation
are covered by synthetic unit tests, not an installed-provider approval exercise.
There is no OS firewall isolation or real cloud model verification.

Remaining B1 work includes a production mediation point that owns execution,
failure behavior that cannot silently permit an action, approval bound to exact
action/policy revision/expiry, and independent OS identity. This correlation
window is not an expiring execution permit. Policy changes after a before
decision do not revoke execution; another hook may change input, and providers
may omit, alter or forge reports. The session cannot enforce against those paths.
