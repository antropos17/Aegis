# Cedar execution policies

AEGIS supports an explicitly selected schema-4 Cedar policy for the existing
local direct-execution preparation route. Schema-1 Claude Bash policies and
schema-2/3 execution policies retain their current evaluator. Gemini, deletion,
MCP policies and gateway grants keep their separate contracts.

This is an opt-in W5 implementation slice with bounded selected-input sizes. Agent-instance principals, sensor
health, attribution strength and other routes are unavailable until their trusted
input provenance and route integration are implemented and qualified. A Cedar
permit does not establish identity, executable-content binding, provider support,
OS enforcement or approval.

## Runtime and schema

The runtime dependency is the official `@cedar-policy/cedar-wasm`, pinned to
`4.13.0`, loaded lazily through its synchronous CommonJS
`@cedar-policy/cedar-wasm/nodejs` export. Initialization verifies that version.
The runtime makes authorization decisions locally and performs no network request.
See the [official package](https://www.npmjs.com/package/@cedar-policy/cedar-wasm)
and [Node loading documentation](https://github.com/cedar-policy/cedar/blob/v4.13.0/cedar-wasm/README.md).

The required envelope is:

```json
{
  "schemaVersion": 4,
  "cedarSchema": "aegis-execution-v1",
  "policies": {
    "review_exec": "@reviewRequired(\"true\") permit(principal, action == AEGIS::Action::\"exec\", resource);"
  }
}
```

`cedarSchema` selects the immutable AEGIS schema in `cedar-schema.js`; supplying a
replacement schema is invalid. Policy IDs start with an ASCII letter and contain
at most 64 ASCII letters, digits, underscores or hyphens. There are at most 33
policies, allowing 32 translated rules plus their explicit default. Unknown
envelope fields, unsupported annotations, malformed Cedar, invalid schemas and
validation warnings are rejected before evaluation.

The only action is `AEGIS::Action::"exec"`. The principal is the fixed
`AEGIS::UnboundAgent::"unbound"` sentinel. It carries no instance identity or
attributes. The resource is `AEGIS::Execution::"selected"`, with these private
attributes from the validated selected request:

| Attribute | Encoding |
| --- | --- |
| `executable` | Literal executable path string |
| `cwd` | Literal working-directory string |
| `args` | JSON string of the ordered argument array |
| `env` | JSON string of the environment object, with sorted keys |

These encodings preserve argument order and exact environment keys and values.
Cedar sets would lose argument order. Paths are never normalized for matching.
The context is an empty closed record. Additional request fields, including
principal, health and route assertions, fail existing request validation. Policies
that depend on absent dimensions or undeclared actions fail Cedar validation.

## Decisions and private review

Cedar's matching `forbid` policies determine deny even when permits also match.
An unannotated matching permit means allow. `@decision("ask")` on a permit means
ask; `@reviewRequired("true")` means ask with reason `review-required`. If several
permits match, any ask or required review remains effective. Review takes priority
in the reason. Annotations cannot turn a forbid into ask or allow. Empty policy
sets and unmatched native policies deny.

Successful evaluations return fixed decision/reason codes plus sorted deciding
`policyIds`. Raw Cedar diagnostics, input strings, resource attributes, source,
engine exception messages and file paths are excluded from this metadata. Policy
IDs are author-chosen explanation metadata; choose non-sensitive identifiers.
Callers must keep any private `launch` descriptor out of logs, reports and IPC.

`prepareExecution` preserves request-first validation, selected-file checks and
pinned binding behavior. A launch descriptor is returned for allow, or for ask
only when its existing trusted caller supplies `review: true` as a boolean. The
returned decision stays ask. This option does not replace the separate single-use
approval and confirmation flow; a Cedar permit never creates an approval.
Environment defaults and the `NODE_V8_COVERAGE` suppression remain unchanged.

Caught initialization and cache failures return `cedar-unavailable`; evaluation failures,
partial diagnostics, unexpected result IDs or invalid responses return
`cedar-evaluation-failed`. These caught failures deny without launch, even in review mode. Invalid
policy structure returns `policy-invalid`. Existing malformed-file, missing-file,
invalid-request and changed-binding reasons retain their previous meanings.

## Explicit schema-2/3 translation

`translateSchema2Policy(policy)` and `translateSchema3Policy(policy)` return
`{ ok: true, policy }` for their respective execution-policy version, or
`{ ok: false, reason: "policy-invalid" }`. Each entrypoint rejects the other
version. Both snapshot input through the existing bounded JSON parser and use
the unchanged validator for whole-policy validation and exact duplicate
rejection. Schema 2 forbids a `reviewRequired` field and emits no review
annotations. Schema 3 retains its nonempty unique review references to explicit
allow actions. The functions do not migrate or rewrite selected files. Schema 1
and other policy families remain unsupported translation inputs.

For rule `i`, the generated condition is its exact predicate and the negation of
every earlier rule's predicate. Deny becomes forbid; allow becomes permit; ask
uses the ask annotation. Listed schema-3 review actions use the review annotation.
The explicit default excludes every rule's predicate, with the policy's deny/ask
behavior. Thus translated defaults have their own deciding `default` ID and do
not depend on Cedar's implicit deny. Existing exact predicates are disjoint in
valid policies; equivalent duplicates are invalid.

Compilation snapshots its input. Evaluation reuses one fixed policy/schema slot
in the official WASM cache, replacing it when evaluators alternate. It does not
allocate a permanent native cache entry per request or policy. Selected files
still obey the existing 64 KiB JSON, depth and node limits. In-memory generated
policies have an 8 MiB compilation ceiling because earlier-rule exclusions expand
translation output; this does not increase the selected-file limit. A large
translation may therefore be usable in memory but exceed the selected JSON file
limit. No file migration is automatic.

A schema-2 preparation fixture records this representability boundary: an
original policy below 64 KiB can produce an expanded Cedar envelope above that
limit. In-memory evaluation and original-file preparation can allow the request,
while selecting the oversized translated file returns `input-unavailable`
without launch. Preparation equivalence is qualified to envelopes that fit the
existing selected-file limit.

## Availability limits and isolation boundary

The current API parses, validates, compiles and evaluates WASM synchronously in
the caller's process. Input-byte limits and the fixed cache-slot count do not
provide enforceable CPU-time or total-memory limits. A selected policy may keep
the event loop busy; the executor's Promise.race timer cannot preempt synchronous
WASM. Its monotonic-time recheck can refuse a late result only after control
returns. Process-level out-of-memory or native termination can prevent any denial
receipt. This slice has no availability qualification for hostile policies and
remains limited to explicitly selected local preparation.

The existing watch-worker-client.js/thread.js isolate watcher work with
worker_threads. They establish a lifecycle pattern, but a thread shares its host
process. Node's resourceLimits affect the JavaScript engine, exclude external
data such as ArrayBuffers, and do not prevent global process out-of-memory.
Neither resourceLimits nor --max-old-space-size is a total WASM or process-memory
limit. See the [Node 24 worker limits](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html#new-workerfilename-options).

A disposable evaluator process is the candidate remedy: one bounded policy/action
message, one metadata reply, and parent-owned timeout, cancellation and confirmed
process exit. The parent must reject late, malformed or excess replies and must
not fall back to synchronous evaluation after child failure. A verified native
process-memory limit is separate work; a V8 heap flag cannot supply it. The child
would receive private bounded values rather than file paths, configuration
bindings, approval objects or launch authority. The parent retains those opaque
capabilities, rechecks selected-file bindings and owns any subsequent execution.
Explicit environment and transport redaction must prevent inherited credentials
and private action contents from reaching child diagnostics.

No evaluator subprocess adapter exists here. The current action CLI dispatches
from main.js before GUI Electron initialization. Electron's utilityProcess.fork
is a main-process API available after app readiness, so it cannot directly serve
that shared early-CLI/plain-Node boundary. See the [Electron utility-process API](https://www.electronjs.org/docs/latest/api/utility-process#utilityprocessforkmodulepath-args-options).
A packaged implementation needs an explicit runtime adapter, packaged child/WASM
entrypoint, bounded private-message protocol, verified termination on each
supported platform, cleanup/late-reply tests and measured resource limits.
Guessing a process.execPath or ELECTRON_RUN_AS_NODE launch path would leave those
requirements unverified. This revision documents the gap without adding that
launch path or claiming a hard time/memory bound.

## Verification scope

`tests/main/cedar-*.test.js` exercise native forbid/permit/ask/review behavior,
redacted runtime failures, authority-field rejection, literal execution matching,
validation, private launch eligibility and selected-file binding checks. The
schema-3 property test compares 10,000 generated inputs with the current execution
evaluator using fixed seed `0x5eedc3` (`6221251`), reporting the seed and category
counts. An instrumented call count records 7,300 actual WASM authorization calls;
the other 2,500 requests fail the shared descriptor validator before WASM, and
200 invalid policies fail translation validation. It covers
executable, cwd, ordered arguments, exact environment values/key sets, defaults,
review classification, request failures and duplicate/invalid policy cases.
Translator tests also cover the execution-policy maximum (32 entries) and the maximum argument/environment counts.

The schema-2 property test separately compares 10,000 generated requests using
seed `0x52ceda` (`5426906`). Each generated request passes the selected-input JSON
parser and descriptor validator, and all 10,000 reach the instrumented official
WASM authorization call. Each generated translation also fits the selected-file
limit. Matching unusual literals and single-field near misses cover exact paths,
ordered arguments, environment keys/values, both explicit
defaults and rule orders. Invalid policies and requests are separate cases.

This generated domain is the selected-JSON-valid request domain. A hand-built
JavaScript descriptor containing a lone surrogate can pass the pure legacy
descriptor validator, while the selected-file JSON parser refuses that value.
Preparation regressions characterize the existing `input-unavailable` result for
both original schema 2 and translated schema 4. The translator also refuses
policy JSON containing those values. No validator or runtime behavior outside
the selected-file domain is changed by this translation entrypoint.

Selected schema-2 and translated schema-4 fixtures compare fixed metadata and
the complete private launch descriptor for allow/ask/deny, both defaults and
strict boolean review. They also cover environment suppression, request-first
validation, changed/missing pinned inputs, malformed files and redacted Cedar
initialization/evaluation failure without launch. Original schema-2 preparation
continues to work when Cedar initialization is unavailable.

Runtime-input tests reject excess policy counts, oversized source and overlong IDs
before loading WASM. The execution/approval tests keep production preparation and
mediation active while replacing OS spawn with an in-memory child. They cover
allow, ask, required review, forbid precedence, strict boolean review, copied and
replayed approval rejection, and evaluation-error denial/recovery on pinned files.
The public execution report retains its existing fixed reason mapping; private
preparation exposes the redacted Cedar failure code.

The existing characterization suites remain a regression gate for the separate
policy families. Native schema-4 execution preparation and translated schema-2/3
behavior are covered here; equivalence of Cedar adapters for Claude, Gemini,
deletion and MCP, trusted instance/health inputs, packaged Electron WASM loading,
and live provider/OS enforcement remain outside this slice. This implementation
does not complete overall W5 or qualify W6 guard mode.
