# Delivery process review — 2026-10-26

The owner requested faster completion, no mutation campaigns and no meaningless
repeated verification. The review covered the current completion plan, project
skills and agent instructions, active development handoffs, the private progress
tracker, current PRs and recent GitHub Actions runs.

## Findings and changes

| Finding | Evidence | Process change |
| --- | --- | --- |
| Delivery repeatedly ends at preparation inside an unfinished substep. | W4 has bounded readers but live session integration remains open; W6 has owner review operations but the installation UI remains open; W8 has offline adapters but real workload measurements remain open. Recent deliveries include #1074, #1076, #1077, #1079 and #1081–#1083. | Section 7 of the completion plan names closure milestones and requires the next task to identify its final consumer and acceptance observation. |
| Mutation work is requested by multiple instruction layers. | CI runs witness/sequence mutation gates; the plan, audit/testing skills and three implementation-agent definitions request deliberate source breakage. | Remove the automatic CI steps and those requirements. Behavioral regressions and independently specified expected results remain required where relevant. |
| Full test execution dominates ordinary CI. | In CI run 40238291100, coverage took 4m04s; the two ordinary mutation steps took 4s and 5s. | Use focused local checks, one final hosted verification and a Markdown-only CI path. Removing the two small mutation steps alone would not solve the delay. |
| Native qualification has a separate repeated gate and expensive guest preparation. | Run 40238768892 completed its native control/mutation gate in 4m09s before its guest stage. The native branch downloads an 8,225,329,152-byte pinned ISO and prepares a fresh Windows guest. | The native task owns controls-only migration and its consumers. Diagnose the first failed stage before a new run. Reusable image work is deferred until integrity, reset and isolation requirements can be preserved. |
| Several development handoffs wait again for post-merge master tests before starting independent work. | Required PR checks already passed; strict branch protection requires a current branch before merge. | Confirm the merge, observe master CI and continue independent work. A master failure still blocks dependent integration and release. |
| Strict serialization repeats full CI for components of one unfinished feature, and the plan adds a routine owner-confirmation checkpoint after review. | The parallel W4/W6/W8 wave updated each remaining branch after its predecessor merged; section 5.4 also required owner confirmation for reviewed critical-contract PRs despite advance Git-cycle authorization. | Group components of one coherent milestone into a reviewed integration PR. Preserve independent review for critical contracts and proceed under existing merge authorization after it and required CI pass. |
| A small number of broad milestones hides incremental implementation. | At review time the private visual roadmap had 12 completed substeps out of 44, with 10 partial; each partial substep contributes zero to the displayed completion percentage. | Preserve the denominator and acceptance rules. Record delivered prerequisites under existing substeps, with the exact remaining closure condition. |

GitHub branch protection was inspected: strict checks remain enabled for build,
lint, svelte-check, test and audit. Their names and repository settings are
unchanged. This change does not qualify a native sensor, provider or release.

## Verification selection

Markdown-only changes in the explicit allowlist get whitespace, skill-catalog
and derived-count checks. Only the count job installs locked dependencies, with
lifecycle scripts disabled. Other jobs omit application installation and runtime
verification, and report that scope explicitly. Code, dependencies, workflows,
tests, agent configuration and unknown inputs get full checks. Rename sources
are included, and unavailable range metadata selects full verification.

Classifier tests cover mixed changes, code moved into documentation, unknown
paths, invalid range metadata and actual Git commit ranges. Project-skill
synchronization validates the catalog without changing client permissions.
Historical receipts and legacy mutation scripts are retained; they are no
longer an automatic execution requirement.

## Next delivery decisions

Consume the existing authorized native run once and retain its first failing
stage or successful acceptance evidence. In parallel, complete one supported
live-session explanation path or one provider's owner-visible installation and
rollback flow. Additional synthetic measurement helpers wait for an identified
missing input to the first real workload measurement. Linux/macOS expansion and
Protected Session retain their original long-term acceptance requirements.

The ordinary all-users installer result from #1052 remains valid within its
recorded Windows x64/100-percent-display scope. It does not establish completion
of native read admission, recovery or every T10 platform. Preparation percentage,
delivered components and accepted product behavior must remain separate.

## Follow-up: shared rules and verification quality

A second read of current development and UI-review handoffs confirmed that live
session binding and the provider installation flow remain disconnected. The
native-admission PR #1057 is still a draft at head `6d3f0947` in this observation.
The modernization assessment proposed an optional pilot, including intentional
breakage, but did not execute it. That suggestion does not override the owner's
no-mutation instruction or authorize a new tool/agent campaign.

The preserved primary checkout still had old tracked instructions after #1084
and #1085 merged. Updated installed skills could also be overwritten from that
older catalog. The context entry point now distinguishes source and policy
revisions, prohibits instruction downgrades and describes how to read current
policy without changing the preserved source. Active chats need a notification;
file edits alone do not establish that an existing session reloaded instructions.

The plan also prescribed a root model, restricted it to coordination and offered
an external-CLI fallback. Revision 5 preserves the selected model, allows direct
implementation without delegation, and reuses existing baseline rows. The common
delivery loop replaces repeated discovery with a named consumer, acceptance
observation and focused checks. No new automation, monitoring service or review
layer is required by this correction.

### External ideas and limits

The owner requested Reddit research. These discussions are anecdotal suggestions,
not measured evidence about AEGIS or proof of a universal prompting technique:

- [Repeated workflow drift](https://www.reddit.com/r/codex/comments/1wbkgw5/how_do_you_stop_codex_from_overengineering_losing/)
  describes testing unrelated components, replacing working pipelines and
  confusing manual intervention with automation. We adopt concrete acceptance
  observations and regressions from actual failures. We do not adopt new blanket
  write restrictions or mandatory ledger commits for every edit.
- [Overengineering and conflicting instructions](https://www.reddit.com/r/codex/comments/1ve9nxe/why_does_codex_constantly_overengineer_code_and/)
  suggests clearer constraints and smaller scope. We apply this by consolidating
  policy and finishing one coherent user-visible path. Claims that more files,
  a different model or weaker quality requirements always solve the problem are
  not supported by this review.

The engineering basis is Ham Vocke's
[Practical Test Pyramid](https://www.martinfowler.com/articles/practical-test-pyramid.html#AvoidTestDuplication):
put logic checks at a fast boundary and retain higher-level tests for the unique
integration behavior they establish. This supports focused local checks; it does
not justify removing native admission, security invariants or required PR checks.
[GitHub's concurrency documentation](https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency)
supports canceling obsolete work; the existing PR concurrency change already
implements that idea. No further workflow edit is needed for this follow-up.

### Observed effect and remaining bottleneck

Documentation-only run [40241856902](https://github.com/antropos17/Aegis/actions/runs/40241856902)
completed successfully from 22:47:55Z to 22:48:15Z on 2026-10-25 (20 seconds),
with explicit structural scope. Full runtime CI for #1084 remained successful;
its coverage step took 3m55s. These are separate observed workloads, not a claim
that all development became a fixed percentage faster. The remaining product
bottleneck is completing and qualifying connected behavior. Additional process
work is warranted only by a concrete recurring failure or measured delay.
