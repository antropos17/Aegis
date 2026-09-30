# Provider adapter replay and evidence

Run `node scripts/qualification/qualify-provider-adapters.mjs all` for both generated
provider corpora, or select `claude` or `codex`. This executes fixed harmless local
receivers and the actual existing `createActionPolicySession`/policy evaluator.
No message command is executed. No saved provider settings, transcripts or
authentication files are discovered or read. There is no production launcher or
IPC integration; every report retains `developerOnly=true` and `launchAllowed=false`.

`createClaudeAdapter(owner)` and `createCodexAdapter(owner)` are private trusted-owner
factories. Each owner supplies an explicit policy path, admitted session id and cwd.
The separately versioned finite profiles are `claude-hook-subset-v1` and
`codex-hook-subset-v1`. Claude admits the six selected common PreToolUse fields and
a completion with `tool_response`. Codex additionally requires `turn_id` and `model`
and binds both across completion. Unknown fields, another provider's profile,
changed owner identity/input, duplicate or late completions fail closed locally.
The finite profiles do not claim support for every native provider hook schema.

The adapters preserve the existing evaluator's allow/ask/deny outcomes. Claude ask
remains pending. Codex ask stays `decision=ask`, `reason=approval-unsupported` in
metadata and produces a deny wire response. This is an adapter refusal, not evidence
that a native client enforced an approval request. The current official Codex
contract documents unsupported PreToolUse ask and hook failures that can continue
the tool; PermissionRequest covers requests already requiring approval. These
limitations require installed-behavior evidence before any stronger claim.
[Official hook contract](https://learn.chatgpt.com/docs/hooks).

The existing session owns decision deadlines, finite observation state and reported
completion linkage. The adapters add a 64-action, 128-event, 256-KiB lifetime budget
and a 16-KiB per-event limit. Close and invalid completion stop later admission;
there is no refund or automatic replay. Policy outcomes add no second policy engine.
Action references are observations and do not authorize execution.

The shared 14-scenario corpus covers read/edit/test, deny, pending approval,
missing/invalid/timed-out delivery, identity/input substitution, duplicate/late
completion, lost response and falsely reported completion. Baseline and adapter
paths each execute the same generated corpus. The direct baseline uses fixed
fixture scheduling; the adapter path consumes actual policy decisions. Receivers
read a known source byte and write exact effect bytes. A separate disk oracle checks
presence and content, including a deliberately linked provider completion with no
receiver effect. Provider-reported completion and independent effects are separate
fields. The delivery-timeout scenario injects a ten-millisecond local hook-delivery
fault; it does not measure native hook launch or evaluator timeout. Focused tests
also exercise the real session evaluator deadline using its existing trusted seam.

Reports retain all empirical monotonic samples, nearest-rank p50/p95, exact scenario
and task denominators, false refusals, approval requests, missing/late events and
false completion claims. CPU is `process.cpuUsage` over the measured path; memory
is the maximum of observed process RSS/heap samples. Neither measures system-wide
attribution or a continuous peak. These are local fixture adapter replay measurements,
with no Protected Session, provider, boundary or competitor performance claim.

Recovery actually injects a failed exchange after the receiver writes a byte. The
same owner then refuses another admission; a fresh owner admits a later fixed
attempt. Both recovery admissions remain in the denominator (one successful
admission out of two). The failed exchange and independently observed effect remain
visible separately; unsuccessful recovery is never removed from the samples.

Evidence binds provider/profile version and client/helper/adapter/policy/corpus
digests. The default client is explicitly the generated fixture caller. Source
receipts record both raw and LF-normalized SHA-256; generated policies are reread
after execution to detect changes. Freshness requires current source bindings to match
a bounded initial source observation made before CJS factory loading.
Changed source in a later run and already-cached CJS dependencies without that loading
observation remain stale. Corpus and metrics ESM helpers retain their own initial-evaluation hashes,
so a preloaded helper cannot be attributed to different bytes presented to a later issuer.
Before/after loading and replay checks detect ordinary file changes; this local observation
does not attest an adversarial loader or host,
nor an undetected change-and-restore during module loading. Freshness also requires
current owner-observed dependency bindings and a maximum fifteen-minute age; missing dependencies, same-version
binary changes, changed hashes, future timestamps or unknown schema invalidate the
affected assessment. Current bindings are trusted owner observations, never a
candidate report's self-authentication.

`qualifyProviderReplay` is the only issuer of process-private branded observation
proofs and takes only a fixed provider selector. `assessProviderEvidence` accepts a
report, current owner binding and that private proof. A report's success field,
matching digest, serialized proof or imported receipt cannot create trusted fixture
qualification. Persisted reports remain untrusted reports after restart. Configured,
adapter-tested, host-tested and boundary-tested stages each carry result, scope,
source and freshness; the last two remain `not-run`. Intact receipt history and full
event coverage are also explicitly unqualified.

An optional explicit diagnostic operation is
`node scripts/qualification/qualify-provider-adapters.mjs codex --probe <native.exe> <wrapper.ps1> <launcher.mjs>`.
It hashes only the selected regular local files and runs that native binary with
the fixed `--version` argument. One directly spawned process, a two-second deadline,
one-second kill wait and four-KiB combined output limit apply. Native files are
limited to 256 MiB; each wrapper/launcher to one MiB, with before/after identity and
hash rechecks. Diagnostics contain numeric version/platform/Node metadata and
hashes, never selected paths or raw process errors. This operation requires trusted
explicit executable selection; it neither installs anything nor proves host hook
behavior, nested protection or credential isolation. Default replay does not spawn
installed clients. Historical Claude receipts remain untouched.
