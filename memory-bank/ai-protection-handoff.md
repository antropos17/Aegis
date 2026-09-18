# AI-agent protection: continuation context

Updated 2026-09-18 at the user's request to continue in a new chat.
Implementation baseline: `cb23c581a51228e09aab29e4f5db13b276cfb7b2`, merged
[PR #488](https://github.com/antropos17/Aegis/pull/488). Fetch and check the tree
before continuing; this document's publication may be a later documentation commit.

## Objective and next action

Continue [the AI-agent protection roadmap](../docs/roadmap/ai-agent-protection.md).
The product goal is protection from unsafe AI-agent actions, with explicit limits
on observation, attribution and prevention. The next stage is **B1 in that roadmap**:
the shared event/policy and adapter boundary, followed by opt-in live lifecycle
collection. Older ETW or sensor-health tasks also use B1; they are separate queues
and are not the current assignment.

Read [HANDOFF-EVIDENCE.md](../docs/HANDOFF-EVIDENCE.md), the roadmap's B1 criteria
and current source before designing the next slice. Define receiver-owned source
registration, a versioned event envelope, delivery/replay/loss handling and bounds.
Keep source authentication, logical identities and fresh OS process binding
separate. Then implement a bounded, testable slice connected to an actual consumer;
do not add an unused framework or claim that lifecycle telemetry blocks actions.
The full B1 scope still includes before/after actions, allow/ask/deny semantics,
supported execution points and the planned ACS alignment assessment.

No B1 runtime implementation was started in the preceding chat. Live hooks, source
installation, UI integration of lifecycle imports, and execution control are open.
A5 remains partial after offline import; independent handoffs and broad causal
inference remain uncovered. Do not restart the completed work below.

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
validates arguments and emits JSON. `src/main/handoff-import.js` projects only
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
There are 56 existing lint warnings and a renderer chunk-size warning.

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
heavy work. C: had about 5.6 GB free at PR #488 completion, X: about 51.8 GB.
External `C:/Users/murtu/AppData/Local/Temp/DiagOutputDir/RdClientAutoTrace`
was about 8.0 GB and still growing; persistent rotation was not installed by this
task, and other changes in C: free space have not been fully attributed.
Do not claim this is fixed, clear global Temp, alter services or delete user data.
Local full coverage was left to CI while this disk issue remained unresolved.

Task logs use fixed `.agent/handoff-*.log` names, manual retention of 14 days and
64 MiB combined; there is no automatic enforcement. Preserve verification receipts
and application profiles/audit/databases. No owned test/build process was left
running at the end of the implementation task. Historical PIDs/session IDs are
not valid handles for later process control.
