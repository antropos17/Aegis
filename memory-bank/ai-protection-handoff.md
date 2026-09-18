# AI-agent protection: continuation context

Updated 2026-09-18 at the user's request to continue in a new chat.
Offline-import baseline: `cb23c581a51228e09aab29e4f5db13b276cfb7b2`, merged
[PR #488](https://github.com/antropos17/Aegis/pull/488). The B1 receiver slice below
was added afterward; fetch and check its publication status before continuing.

## Objective and next action

Continue [the AI-agent protection roadmap](../docs/roadmap/ai-agent-protection.md).
The product goal is protection from unsafe AI-agent actions, with explicit limits
on observation, attribution and prevention. The current stage is **partial B1**:
exact operator approval binding and the selected MCP review route now exist;
an executable route checker now reports selected configuration and prerequisites,
including a whole-catalog check through `--action-catalog-check-json`.
The [MCP action catalog](../docs/ACTION-MCP-CATALOG.md) additionally exposes up to
eight operator-selected actions through direct stdio or the terminal-review broker.
Installed Windows Claude 2.1.263 now exercises two catalog actions through both
routes with local synthetic model replies; see the catalog evidence below.
Broader deliberate agent routing and observed coverage display remain. A fixed
selected-action MCP tool now connects to the execution owner (docs/ACTION-MCP.md).
The explicit direct-execution
CLI now owns a selected child launch; see docs/ACTION-EXECUTION.md.
The bounded action-policy-session API now connects local decisions to after reports
in the opt-in provider fixture; see docs/ACTION-POLICY-SESSION.md. It does not own
execution and is not a production transport.
The [exact-input Bash policy hook](../docs/ACTION-POLICY-HOOK.md) now supplies
experimental before-only allow/ask/deny. Actual Windows Claude 2.1.263 exercised
AEGIS allow/deny and lifecycle delivery against an isolated loopback model stub.
No user hook configuration or provider credentials were used. Interactive ask,
other provider-hook failure modes and independent OS binding remain. The missing-hook
bypass was demonstrated in the provider fixture.

B1's offline consumer now uses receiver-owned registration, envelope schema 1,
ordinal replay rejection, sticky loss and shared lifetime budgets. Import reports
are schema 2. The contract also defines planned before/after and allow/ask/deny
semantics and a pinned initial ACS schema assessment. The before-only hook is
experimental; it cannot guarantee protection when the provider fails to run it.
Live transport authenticates bearer possession only. B1 remains partial.
A5 remains partial after offline import; independent handoffs and broad causal
inference remain uncovered. Do not restart the completed work below.

## B1 selected-action MCP route

--action-mcp-stdio <policy> <request> exposes one argument-free tool,
aegis_execute_selected. Only selected files reach the execution owner. The protocol
core and transport bound initialization, message IDs, concurrency, frames and
output. Disconnect/cancellation abort preparation or interrupt the direct child;
cleanup is awaited. Other agent tools/descendants remain outside this route.

The opt-in scripts/verify-claude-action-mcp.mjs uses real installed Claude with
synthetic local model responses and disposable MCP settings. Inspect ignored
.agent/b1-mcp-provider-receipt.json and .agent/b1-mcp-receipt.json for actual run,
CI and publication evidence. No permanent user configuration was modified.
Current continuation: approval is now bound to exact action/policy/expiry through
the terminal owner, also available per call via the separate review broker below.
Broader deliberate routing and coverage display remain open.

The current [route checker](../docs/ACTION-ROUTE-CHECK.md),
`--action-route-check-json <route> <policy> <request>`, supports `direct`,
`terminal`, `mcp-stdio` and `mcp-review`. It reads actual bounded files and reports
fixed policy/runtime/current-terminal metadata with explicit coverage gaps, without
launching, prompting or listening. Exit zero means a valid completed check,
including policy deny; no approval or revision binding is retained. Future route
connection, provider identity and blocking remain unverified by this check.
The local focused suites passed 20 native CLI, 27 core and nine runtime checks;
inspect current publication receipts before claiming CI or merge status.

## B1 MCP review broker: current provider evidence

Catalog continuation: `--action-mcp-catalog-stdio <manifest>` and
`--action-mcp-catalog-review <manifest> <new-endpoint>` share the existing global
MCP limits and relay. Initialization snapshots the manifest and atomically captures
per-entry revision bindings; manifest edits apply only on a new connection. Each
reviewed allow/ask invocation needs fresh terminal confirmation. The four-route
single-action preflight checker keeps its original contract. The separate
`--action-catalog-check-json <mcp-stdio|mcp-review> <catalog>` now checks all entries
under one 1,500 ms deadline. It captures the real catalog, evaluates each action
against its revision binding, and revokes temporary capabilities before returning.
Each public tool has its own fixed configuration/decision result; a valid deny
can exit zero because this grants no authority. Review checks observe only the
current process's terminal. Cancellation or observed revocation discards partial
results. See [the contract](../docs/ACTION-ROUTE-CHECK.md#whole-catalog-check).
The native Windows TTY receipt `.agent/b1-catalog-check-native-receipt.json`
records mixed allow/ask/deny on both routes with no action sentinel or prompt,
available terminal for review, and removed owned scratch. Inspect
`.agent/b1-catalog-check-receipt.json` for publication and CI evidence.

Catalog provider evidence: `scripts/verify-claude-action-mcp.mjs --catalog` passed
two allowed actions in sequence, second-action deny and second-action ask (seven
local API requests). `--catalog-review` passed first-action confirmation, explicit
second-action refusal and third-call disconnect in one connection (three requests).
Actual result IDs, sanitized reports and intermediate sentinel sizes establish the
sequence. The pending third call has no result or effect. Forced relay termination
returned broker status 2 after cleanup; provider-tree termination, endpoint removal
and broker closure without fallback owner abort were confirmed. Both runs removed
owned scratch and passed canary checks. Inspect ignored receipts
`.agent/b1-catalog-provider-direct-receipt.json` and
`.agent/b1-catalog-provider-review-receipt.json` for these observations, and
`.agent/b1-catalog-provider-receipt.json` for publication evidence. These are
installed-CLI checks with dummy credentials and synthetic loopback responses;
cloud models, human identity and OS isolation remain unverified.
The following evidence concerns the original single-action route.

`--action-mcp-review <policy> <request> <new-endpoint>` keeps exact per-call
confirmation on an operator terminal; `--action-mcp-connect <endpoint>` is the
agent's relay. The MCP connection pins selected revisions once and lends that
binding to each fresh review. Deny remains final. The private descriptor bearer
permits one connection and requires a trusted private directory; TTY/PTY control
does not authenticate a human. See [the broker contract](../docs/ACTION-MCP-REVIEW.md).

The inspected `.agent/b1-claude-review-provider-receipt.json` records installed
Windows Claude Code 2.1.263 passing all four cases: confirmed ask, explicit typed
negative answer, hard policy deny without preview, and disconnect after a drained
review preview. The last case confirmed taskkill cleanup of the provider tree,
with no result or sentinel. All brokers closed and endpoints were removed without
fallback owner abort; owned scratch was removed. Seven loopback synthetic API
requests were observed. Full tool-result and Claude stdout canary checks passed.
The fixture uses dummy credentials and disposable MCP configuration, with no
permanent settings change, cloud-model verification or OS isolation claim.

Reproduce using `scripts/verify-claude-action-mcp.mjs --review` with the explicit
Claude/Bash/scratch arguments documented in the broker contract. Keep stdin and
stderr on a terminal; answer the first challenge and then type `no`. Preserve only
the redacted stdout receipt if needed, not a combined private-preview transcript.
This local provider evidence does not establish CI or merge status; inspect the
current branch and publication receipts before making those claims.

## B1 explicit direct-execution slice

The following slice notes retain their original next-step context. Execution
ownership and approval binding have since advanced as described above.

`execution-policy.js` validates distinct schema 2 exact launch policies and
schema 1 requests. `action-execution.js` starts its direct child only after allow;
`action-execution-cli.js` exposes --action-exec-json before Electron initialization.
Ask never launches. Preparation timeout/failed policy do not fall through.
Fixed empty environment defaults suppress native inheritance; explicit Windows
SYSTEMROOT/WINDIR may be needed. Parent debug/permission runtime is unsupported.
Output is counted/discarded, runtime and cleanup are bounded, direct-child
termination evidence is distinct from descendants (unsupported).

Publication receipt: .agent/b1-execution-receipt.json; inspect before claiming
merge/test results. No installed hook or user configuration was changed.
Next: explicit agent routing into execution ownership and approval/action binding.

## B1 decision/after-report session

`action-policy-session.js` owns atomic reservations, exact input comparison,
single after consumption, replay tombstones, lifetime caps and bounded decision
and correlation deadlines. It never runs a command. The one-shot hook is unchanged;
the current consumer is the test-only relay used by the provider fixture.
Deny-no-after is expected, ask is still delegated, and reported completion cannot
prove execution or permission. No production listener or user configuration changed.

Validation/publication receipts are `.agent/b1-linkage-provider-receipt.json` and
`.agent/b1-linkage-receipt.json`; inspect them before claiming provider/CI/merge status.
Next: execution-owning production mediation and approval/action/policy binding.

## B1 before-only policy slice and provider verification

`action-policy.js` reads one bounded selected policy file and compares the full
Bash tool_input and exact cwd. No shell analysis, command execution or content
hashes are emitted. `action-policy-hook.js` implements stdin/total-deadline bounds,
fixed provider JSON and deny on controlled failures; CLI flag is
`--action-policy-hook <policy.json>`. Policies are reread per invocation, so there
is no session ledger, replay-protected approval token or after-action correlation.

Parallel security review found no confirmed blocker; a candidate late stdin error
was fixed and tested before publication. Core and adapter focused tests passed.
The opt-in script `scripts/verify-claude-hooks.mjs` reproduces the installed-provider
fixture with explicitly selected Windows executable/bash/scratch paths. It runs
real hooks with local synthetic model responses; no OS firewall isolation is
claimed. AEGIS allow created a sentinel, deny prevented it; the live collector
accepted two lifecycle events. Interactive ask was not exercised.

Ignored `.agent/b1-provider-receipt.json` retains local fixture evidence and
`.agent/b1-policy-receipt.json` records final CI/publication. Consult those and the
implementation PR before claiming merge. User authorized parallel agents in this
continuation; otherwise retain the ordinary no-unsolicited-delegation preference.

## B1 live transport slice

`handoff-live.js` binds only 127.0.0.1 for a finite CLI-selected window;
`handoff-send.js` reads bounded stdin and projects three lifecycle fields before
sending. `handoff-live-cli.js` handles both flags before Electron imports:
`--handoff-listen-json claude-code <port> <seconds>` and `--handoff-send`.
Credentials use AEGIS_HANDOFF_TOKEN (fresh 32-byte hex bearer per run), with
AEGIS_HANDOFF_PORT for the sender. Nothing installs or launches automatically.

The live source is separate from offline imports: provenance source-reported,
authentication bearer-possession, OS binding unbound, decision not-applicable.
Delivery UUIDs reject same-run repeats; new IDs and restarts do not prove continuity.
Read docs/LIVE-LIFECYCLE.md before use. Final verification/publication receipts
are in the implementation PR and `.agent/b1-live-receipt.json`.

## B1 receiver slice

`src/main/agent-event-receiver.js` projects the same two Claude lifecycle events
and is consumed by `handoff-import.js`. A source handle is an in-process capability,
not a transport credential. Serialized/cross-receiver/closed handles fail admission.
Input sequence numbers come from the reader; replay/late records are rejected,
gaps and invalid payloads retain loss, and source closure clears raw logical IDs.
No input PID, verification flag or policy decision can override receiver evidence.

Per receiver lifetime: 32 source registrations, 10,000 attempts, 2,000 events and
2,000 combined identities; existing byte/identifier bounds remain. Closing sources
does not replenish budgets. Events carry `phase: observation`,
`decision: not-applicable` and `control: not-supported`. The final receiver summary
labels intake-only receipts and unknown activity coverage. The importer remains
isolated from monitoring, scoring, audit and Electron initialization.

Tests: `tests/main/agent-event-receiver.test.js` plus importer/reader/CLI regression
suites. Local focused run passed 68 tests on Windows; typecheck and focused ESLint
passed. Final CI and merge receipts belong to the implementation PR and ignored
`.agent/b1-receiver-receipt.json`; check them before claiming publication.

## Completed foundation

- A1–A3: scoped local component inventory, profile/package evidence, snapshots and
  comparison, with explicit provenance/coverage limits.
- A4 is partial: static command/configuration, bounded JavaScript/Python and
  selected-source flow review, shell redirections, instruction patterns and offline
  Cisco results. General semantics and broader flows remain open. The active
  Observatory Local security workspace exposes the implemented workflows.
- A5: SEQ001 calibration; SEQ002 direct monitored parent/child relations (PR #484);
  SEQ003 monitored ancestor paths of two to four hops (PR #485). See
  [SEQUENCE-EVIDENCE.md](../docs/SEQUENCE-EVIDENCE.md). Fresh full identities,
  outage invalidation, real event owners and severity ceilings remain required.
- PR #486 puts sequence limitations and actual events before detailed process IDs
  in Audit. Native expandable details preserve full evidence. Browser checks cover
  both themes, viewports and text scales. It is already merged.
- PR #487 reviewed sources and defined handoff evidence boundaries. Claude token
  accounting attributes subagent usage to the main process; it cannot establish a
  distinct OS process, delegation edge or file/network ownership.
- PR #488 implements the offline lifecycle importer described below.

## Offline importer: shipped contract and source map

```sh
node src/main/main.js --handoff-import-json claude-code <events.jsonl>
```

`src/main/main.js` routes the flag before Electron imports; `src/main/cli.js`
validates arguments and emits JSON. `src/main/agent-event-receiver.js`, consumed by `handoff-import.js`, projects only
`SubagentStart`/`SubagentStop` into event kinds, input ordinals and opaque references
scoped to the import. `src/main/handoff-reader.js` reads the selected regular file
in 16 KiB blocks and checks file identity before/after reading.

Bounds: 8 MiB file, 64 KiB line, 10,000 records, 2,000 events, 2,000 combined
session/agent identities, 256 UTF-8 bytes per input identifier, 32 diagnostic entries
plus totals. Raw IDs, agent names, response text, prompts, tool arguments, paths,
secrets and arbitrary exception text are excluded from output. Referenced files
are never opened. There is no monitoring, audit or scoring initialization.

Reports retain `provenance: imported-unverified`, `processBinding: unbound`,
`transferEvidence: unobserved`, `activityCoverage: unknown`. `complete` concerns
selected-input processing only. Exit 0 means processed input; 2 means incomplete;
1 means invalid arguments/adapter or unavailable input. None means safe.
Producer version is unknown. Windows and Linux synthetic checks passed; macOS
and live provider integrations were not tested. Filesystem checks are best-effort:
the selected parent is canonicalized; not every reparse type, same-size rewrite,
path race or mounted remote filesystem is covered. The contract documents this.

Tests: `tests/main/handoff-import.test.js`, `handoff-reader.test.js` and
`handoff-cli.test.js`, plus existing CLI regressions. They cover privacy canaries,
forged evidence, scoped identities, repeated starts, UTF-8, limits, file races,
Windows junction/Linux symlink rejection, actual Node entry and module isolation.

## Verification and publication receipts

PR #488 head: `d152b3cb8dfa07f72b65633d367454ef9dded243`.
Merge: `cb23c581a51228e09aab29e4f5db13b276cfb7b2`.
Tested and merged tree: `325ca16b1a752a628032875bd4cacd52486dcb4b`.
[CI run 35360260388](https://github.com/antropos17/Aegis/actions/runs/35360260388)
passed all five contexts on its first attempt: build, lint, svelte-check, test,
audit. Full coverage: **4,728 passed, five skipped**. Both mutation gates and
derived counts passed. Local focused suite: **50 passed**, Node 24.11.1 on Windows.
Local format, lint, types, Svelte check, renderer build and counts passed.
Existing lint warnings and the renderer chunk-size warning remain.

Ignored receipts live in the active worktree's `.agent/handoff-import-receipt.json`
and `.agent/handoff-ci-test.log`; earlier `.agent/handoff-contract-receipt.json`
records PR #487. That earlier documentation PR needed one CI test-job retry after
an existing UI test timed out; do not attribute that retry to PR #488.

No release, installed-application update or live handoff verification occurred.
Source merged to master does not imply that the installed desktop has been updated.

## Workspace and safety context

Continue in `X:/tmp/aegis-ai-protection-plan`. Check status, fetch origin/master,
and use a fresh `codex/` branch from the current base after this handoff is merged.
The original `X:/Future/ESCAPE/AEGIS` checkout is intentionally dirty at
`64478536ed8e0faa86e7a60eb543d0683b2a2e9e`; preserve its UI work. Do not switch,
pull, reset, stash, clean or overwrite that checkout. Do not delete worktrees or
their junctioned node_modules. Existing dependencies work.

Project skills are under `X:/Future/ESCAPE/AEGIS/.agents/skills`; ignored skills
are not present in the temporary checkout. Use aegis-context/electron-main/testing
for backend work; design-system/svelte-patterns when touching the active renderer,
which is `frontend/observatory/`. Preserve English source/docs and existing pt-BR
localization. Respond briefly in Russian. Do not spawn agents unless asked.

The ordinary Git cycle is authorized: branch, commit, push, PR, wait for all five
required contexts, merge with `--merge --delete-branch`. From outside Git, e.g.
`X:/tmp`, use `gh pr merge <number> --repo antropos17/Aegis --merge --delete-branch
--match-head-commit <verified-head>` so gh does not switch the dirty root checkout.
Verify the merged tree against the tested tree. Release tags, force pushes,
lockfile regeneration and protected workflow/config edits require separate scope.

Use process-local TEMP/TMP `X:/tmp/aegis-inventory-test-temp` and npm cache
`X:/tmp/aegis-ai-protection-plan/.agent/npm-cache`. Check free space before/after
heavy work. At the B1 local checks C: had about 3.36 GB free, X: about 51.72 GB.
External `C:/Users/murtu/AppData/Local/Temp/DiagOutputDir/RdClientAutoTrace`
was about 8.17 GB (unchanged across the B1 local checks); persistent rotation was not installed by this
task, and other changes in C: free space have not been fully attributed.
Do not claim this is fixed, clear global Temp, alter services or delete user data.
Local full coverage was left to CI while this disk issue remained unresolved.

Task logs use fixed `.agent/handoff-*.log` / `.agent/b1-*.log` names, manual retention of 14 days and
64 MiB combined; there is no automatic enforcement. Preserve verification receipts
and application profiles/audit/databases. No owned test/build process was left
running at the end of the implementation task. Historical PIDs/session IDs are
not valid handles for later process control.
