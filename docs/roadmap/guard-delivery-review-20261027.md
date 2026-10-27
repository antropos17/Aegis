# Guard delivery and CI review — 27 October 2026

This review answers the owner's request to accelerate AEGIS toward a usable
HOL Guard competitor. It changes the execution order in
[the completion plan](completion-plan.md#7-execution-order). That plan remains
the execution queue; this document records the evidence and implementation
contract behind the change. It does not establish new product acceptance.

## Reviewed evidence

AEGIS source and process baseline: `352280a480456bdce59145e64965bd2a9b8aca0b`,
verified against the remote master on 27 October. HOL source comparison:
`5f53c249846e79144b09450ce6dcdfeaac1c0cb7`; its latest stable release observed
was `v3.57.0`. The review read production entrypoints, packaging, workflows,
branch protection, check results and existing qualification records. It ran no
new builds, native/provider sessions, mutation campaigns or competitor binaries.
Live effectiveness claims below are dated first-party records, not independent
head-to-head measurements.

The observed AEGIS branch protection requires `build`, `lint`, `svelte-check`,
`test` and `audit`, with strict updating and admin enforcement. These controls
stay in force. Proposed workflow changes require the authorization specified
in [AGENTS.md](../../AGENTS.md#permissions-and-boundaries); this documentation
change does not modify workflows, release tags or repository settings.

## Findings that determine the next work

| Priority | Evidence and consequence | Required correction |
| --- | --- | --- |
| P1 | The previous section 7 puts Windows read admission and W4 before a usable Guard route. `action-policy-hook.js` evaluates a request without an ETW input. A missing native-read acceptance record therefore need not block packaging or qualifying that hook's own supported surface. | Put the Windows Claude Guard journey first for new work. Keep W11 ownership and acceptance separate; require native-read evidence for every claim that actually depends on it. |
| P1 | `scripts/electron-builder-before-build.js` builds renderer, process and ETW helpers, but never prepares hook-review assets. `package.json` only copies `build/hook-review`. The separate `scripts/build-hook-review-assets.cjs` requires SDK 10.0.302/runtime 10.0.10 and embeds an absolute runtime root; release builds select SDK 10.0.403/runtime 10.0.14. The clean release path cannot be assumed to supply the independently prepared Guard setup assets. | Connect reproducible Guard asset preparation to ordinary packaging, select and validate a supported portable runtime strategy, and test the resulting installed artifact on a clean Windows user environment. Missing assets must be an explicit build/feature failure. Do not repair this by dropping integrity checks or using an arbitrary executable from PATH. |
| P1 | `src/main/action-policy.js:evaluateActionPolicy` compares exact `cwd` and the entire `tool_input` object. `validActionPolicy` only accepts Bash. A changed description or input shape can change the decision even when the intended command is equivalent. The two predeclared marker commands prove the tested boundary, not practical ordinary-work coverage. | Deliver a bounded everyday policy with reviewed safe/risky pairs, an explicit shell grammar and unknown behavior. Preserve the existing exact policy profile. Do not silently reinterpret old rules or treat an unsupported command as safe. |
| P1 | `ClaudeHookProfile.svelte` selects an existing policy file, reviews installation/removal and opens the profile folder. An explicit `--settings` launch is required. The existing hook emits a fixed provider decision, without a connected user-facing rule/result history in that setup journey. | Finish policy selection, supported launch guidance, actual hook activity, decision explanation and result visibility in the existing Observatory workspace. Provider `ask` and AEGIS-owned approval remain distinct. |
| P1 | All five required CI jobs run on Ubuntu. `windows-fixtures.yml` is outside the required contexts and its runner lists five caller/import/GUI fixture suites; it does not run the installed Guard journey. `frontend:test:electron` and `scripts/qualification/claude-hook-app.cjs` are not invoked by the required workflow. | Add a relevant-change Windows package/Guard check whose failure reaches an existing required context. Keep offline hook/installer replay distinct from a real installed-agent run. A passing Linux suite cannot certify Windows pipe IO, native dialogs or portable setup. |
| P1 | `release-build.yml` builds, signs, verifies the signature and uploads. It does not consume a lifecycle-qualified Guard artifact. `release-qualification.yml` is pinned to an older alpha; `windows-candidate-021.yml` names two frozen candidates. Those are useful historical receipts but do not automatically validate later release bytes. | Build one candidate, run its required package/lifecycle checks, retain its digest, and publish those same bytes after release authorization. If packaging or signing changes executable bytes, validate the final bytes. Keep old receipts as evidence and replace repeated one-off workflow edits with a validated reusable candidate contract when that release work is authorized. |
| P2 | `vitest.config.js` emits coverage for a selected file list and sets no thresholds. The hook entrypoint/policy are included, but the new `claude-hook-app*` and native setup modules are absent. Unit tests may still run for them; coverage reporting does not currently describe that whole path. | Include the shipped Guard modules and make required behavioral cases explicit. Use coverage to find omissions; do not invent a repository-wide percentage target or inflate test counts. |
| P2 | Derived-count validation runs after coverage. Runs `40454527416` and `40432600712` failed at that late stage; the latter reports `size.over300 declared 48, derived 49`. | Move cheap metadata/count validation before coverage. Preserve the check. Prefer pointers to derived output over additional maintained count declarations. |
| P2 | Release workflow runs a renderer build and then the packaging hook builds the renderer again. The hook is the shared packaging authority. | Remove the redundant outer build only after verifying the same production mode and package output; retain the packaging hook's build. This is a small optimization, not the main delivery blocker. |
| P2 | The former queue still asks for the first real allow/deny demonstration despite the source and packaged-Claude records in `docs/CLAUDE-HOOK-APP.md` and #1115. | Reuse those receipts for unchanged inputs and name what remains: portable installation, real owner consent, everyday policy, failure/bypass scope and current candidate qualification. |

Source anchors: [packaging hook](../../scripts/electron-builder-before-build.js),
[asset builder](../../scripts/build-hook-review-assets.cjs),
[profile admission](../../src/main/claude-hook-app-profile.js),
[policy](../../src/main/action-policy.js),
[hook transport](../../src/main/action-policy-hook.js),
[Guard panel](../../frontend/observatory/components/ClaudeHookProfile.svelte),
[CI](../../.github/workflows/ci.yml),
[Windows suite contract](../../tools/development/verification-contract.mjs),
[release build](../../.github/workflows/release-build.yml),
[coverage configuration](../../vitest.config.js).

## What the CI timings actually show

The existing Markdown-only selector is a useful optimization: it keeps the five
contexts, checks the diff and derived facts, and explicitly reports that runtime
verification was not repeated. Unknown paths and both sides of renames require
runtime checks. Preserve that behavior and its regression cases.

In [runtime PR run 40462050861](https://github.com/antropos17/Aegis/actions/runs/40462050861),
the workflow elapsed about 4 minutes 32 seconds. Coverage took 249 seconds;
`npm ci` in that job took six seconds; the other required jobs completed in
18–33 seconds. This sample does not identify dependency installation as the
dominant cost. It also does not justify copying HOL's 128-way sharding.

A snapshot of the most recent 100 CI runs contained 68 successes, six failures,
two cancellations and 24 `action_required` results. These are overlapping PR and
push runs with changing inputs, not 100 independent reliability trials.
`action_required` is not a failed test. The observed failures included counts,
coverage/test execution and Svelte checking; the review does not relabel all of
them as flaky. Preserve the first assertion and changed input before retrying.

Strict base freshness can require another full run after a merge. Reduce avoidable
churn by finishing a coherent user-visible change per PR and serializing final
integration. Preserve strict protection and the required current-head results.
Do not split every helper, status report or count update into its own delivery
milestone. Do not repeat successful full CI locally or wait for unrelated
post-merge checks before doing independent work.

## CI/CD changes to implement with the Guard journey

1. **Required product evidence.** Keep the five required context names. A required
   aggregate such as `test` can depend on the existing Linux tests and the
   relevant Windows Guard/fixture lane. The planner must run for every PR; a
   required context cannot disappear through a workflow-level path filter.
   Unknown inputs select the stronger scope. Failed, cancelled, missing or
   invalid required receipts fail the aggregate. An intentionally unselected
   lane needs an explicit scope reason. Preserve all existing applicable checks.
2. **One candidate and actual boundaries.** Build the Windows candidate once in
   an unprivileged, secret-free PR lane. Verify required Guard assets, installed
   startup, real inherited input/output through the packaged executable,
   allow/deny/malformed/held-open cases and owned profile setup/removal using
   disposable data. Retain real-dialog and real-provider cases as separately
   identified acceptance until their environment and authorization exist.
   Reuse the same candidate for downstream checks; never give untrusted PR code
   publication credentials. Scope includes packaging scripts, native projects,
   policy/hook/IPC/UI consumers, dependency locks and the verification code.
3. **Earlier useful failures.** Run count/scope/manifest validation before the
   long suite. Include the new Guard modules in coverage. Keep expected decisions
   independent of implementation and test observable effects. Split test work
   only if measured queue/runtime data shows a material improvement without
   dropping cases or losing merged coverage. Record timing in existing receipts.
4. **Release the qualified artifact.** Keep signing and publication privileged
   and separate from PR execution. Require source, lock, runtime, artifact and
   qualification identity agreement. A signature verifies origin/integrity;
   it does not replace installed behavior checks. Account for bundled Electron
   and native runtime advisories: the current production-only npm audit excludes
   Electron as declared in `devDependencies`. This is a scope gap to assess, not
   a claim that the current artifact contains a particular vulnerability.

Use bounded job timeouts derived from measured work, explicit artifact retention
and disposable output roots. Preserve qualification receipts and application
data. These are implementation proposals; the present review changes no CI
settings and dispatches no qualification runs.

## HOL comparison: usable practices and evidence limits

At the reviewed HOL commit, GitHub reported 267 check runs. The set included
128 `coverage` shards, 24 `native-gates` shards, compatibility/platform checks,
Rust checks and release operations. Some were pending or skipped at inspection;
this is not 267 independent successful security guarantees. Its
[CI configuration](https://github.com/hashgraph-online/hol-guard/blob/5f53c249846e79144b09450ce6dcdfeaac1c0cb7/.github/workflows/ci.yml)
and [real-process pre-tool lane](https://github.com/hashgraph-online/hol-guard/blob/5f53c249846e79144b09450ce6dcdfeaac1c0cb7/.github/workflows/rust-pretool-adversarial.yml)
are concrete implementation evidence.

HOL also has first-party live evidence, beyond its modeled public benchmark.
Its [findings record](https://github.com/hashgraph-online/hol-guard/blob/5f53c249846e79144b09450ce6dcdfeaac1c0cb7/ci/gauntlet/FINDINGS.md)
describes a 14-scenario OMP run on `0ef1e41e5ac2b0a78f80851c14e43b787d8af38a`:
29 ordinary successful calls and seven blocked synthetic attempts, filesystem
and loopback oracles, and no ordinary approvals. The linked
[evidence run 37153308133](https://github.com/hashgraph-online/hol-guard/actions/runs/37153308133)
was observed successful. This establishes a dated first-party record, not current
cross-agent or Windows qualification. The same findings preserve an uncovered
prompt-attachment leak and later incomplete runs instead of counting them as passes.

The reviewed [harness-smoke workflow](https://github.com/hashgraph-online/hol-guard/blob/5f53c249846e79144b09450ce6dcdfeaac1c0cb7/.github/workflows/harness-smoke.yml)
is manual and comments that its matching self-hosted runners are not registered.
The [installed-acceptance lane](https://github.com/hashgraph-online/hol-guard/blob/5f53c249846e79144b09450ce6dcdfeaac1c0cb7/.github/workflows/gauntlet-installed-acceptance.yml)
is also manual and explicitly outside required CI. Their existence alone does
not establish that those routes run for every change. The
[public benchmark](https://hol.org/guard/research/ai-coding-agent-runtime-security-benchmark)
distinguishes its scenario catalog from a scored live run, and its older fixture
archive from real attacks. The [non-coverage contract](https://hol.org/guard/security/non-coverage)
documents agent/event-specific blind spots.

The practice to adopt is a complete installed route, ordinary-task controls,
independent effect oracles and retained failures. Keep the comparison tied to
named versions and surfaces. Neither stars nor workflow totals determine safety.

## Product target and existing AEGIS advantages

Initial competitive target: a Windows developer can install AEGIS, choose a
supported Claude setup and policy, launch that route, complete ordinary work,
review a risky request, and inspect what was decided and observed. The boundary
must state unsupported actions and failed protection. This target is narrower
than HOL's whole advertised agent/platform catalog and is not full parity.

| Dimension | AEGIS baseline | Completion condition |
| --- | --- | --- |
| Installation | Separate profile and native transaction implementation; machine-bound asset preparation | Clean installed package supplies supported assets; setup, cancellation, restart and removal work through the real app |
| Everyday protection | Exact schema-1 Bash input matching; dated genuine source/package allow/deny cases | Small reviewed rule set permits its benign controls and stops its declared dangerous cases without manually authoring each complete request |
| Decisions and approvals | Provider decisions; separate existing MCP grant contracts | User sees scope, rule/reason and actual or unknown outcome; changes/replay cannot inherit authority |
| Agent breadth | Claude hook plus separately bounded adapters/routes | Claude first, then a named Codex surface, then Gemini; reuse policy semantics while qualifying each host's hook failures and approval behavior |
| Extension/package trust | Selected local inventory, static review and snapshot comparison | First-use/changed artifact review connected to a chosen launch/install boundary; runtime package blocking only when an actual pre-install route is exercised |
| Evidence | Existing native/provider receipts; W8 method and workload components | Declared benign and forbidden corpus, independent effects, misses/false blocks/task completion/latency with separate denominators and unavailable cases |
| System observation | Instance-aware processes, file observations, TCP endpoints, sensor health and Observatory | Connect supported policy events to the correct instance and observed effects; native-read assertions wait for W11 evidence |

AEGIS already has useful assets: instance-oriented desktop investigation,
process/file/network observations with availability states, explicit selected
MCP routes with one-attempt grants, and scoped Windows containment work. These
are opportunities for differentiation, not proof of uniqueness or superiority
over HOL. Local/offline execution is shared by both products. Agent recognition
counts are not counts of protected integrations. Complete OS capture, general
DLP, prompt-injection immunity and a ready general-purpose sandbox are not
current advantages.

The strongest potential difference is independently observing a side effect and
linking it to a particular guarded agent instance. That claim requires qualified
system evidence and must remain unknown when the relevant sensor or association
is unavailable. Do not make all Guard progress wait for that stronger claim.

## Acceptance and execution discipline

Use the existing W6/W9/W10 consumers and W8 method. Each selected profile names
its caller/version, OS, action grammar, policy defaults and expected outcomes
before execution. Include ordinary project inspection/edit/test work, selected
secret reads, destructive Git/file operations and controlled loopback egress
where the supported surface exposes them. Use fake secrets and owned disposable
targets. A package script or arbitrary executable is not safe solely because
its top-level command is familiar.

Record denied-no-effect and allowed-effect separately. A model refusing to try,
missing hook, unavailable evaluator or unexercised case is not a successful
protection. Count ordinary approvals/warnings, false blocks, misses, task
completion and latency. Keep the first failed run and its exact stage. The
initial declared finite must-pass cases must all meet their independent expected
outcomes before calling that profile accepted; broader rates need a suitable
sample and repetitions under the existing measurement method.

Runtime unknowns must not silently allow execution on a route promising
enforcement. Do not equate a failing hook process with a host-enforced denial:
qualify missing/unstartable/timed-out hooks and malformed output on the actual
agent. If the host continues, report the limit and keep the route unqualified
for that condition. A static parser's coverage gap is not permission.

Complete one selected integration before adding another helper, adapter or
architecture report. Defer Cedar migration, new OS sensors, general provenance
infrastructure and broad isolation expansion unless a demonstrated dependency
of that integration requires them. Existing security invariants and applicable
independent review remain required; implementation convenience does not weaken
them. Resume bounded implementation from section 7 on the next task; another
general comparison or plan rewrite requires new evidence or an explicit request.
