# AEGIS overnight UX development plan

## Scope and schedule

The user authorized a ten-hour development window, eight hours of section-agent work, and conservative credit use. Start: 2026-10-06 07:55:49 UTC. Section improvements end at 15:55:49 UTC (19:55:49 Asia/Baku). Integration ends at 17:55:49 UTC (21:55:49 Asia/Baku). Finish early when the acceptance criteria are met. The hourly chat continuation is `aegis-ten-hour-development`; local execution requires the computer and Codex app to remain running.

Use English for the plan, handoff, new canonical interface copy and publication. Preserve the optional Portuguese locale and every existing feature. Work in the attached `gap-completion-1006/AEGIS` checkout on `codex/overnight-ux-20261006`, starting from `a42ff3bd445d157368243502b3dc0b4f1236013e`. Preserve the original dirty checkout and other projects.

## Five section assignments

The session permits three workers alongside the coordinator. Run five assignments in two waves, reusing agents when follow-up is necessary; do not create extra user-owned chats.

| Assignment | Owned section | Intended result |
| --- | --- | --- |
| `ux_monitoring_agents` | Monitoring and agent workspace | Show resource availability, retained activity and worker context together, with direct access to existing detail panels. |
| `ux_investigation` | Events, agent evidence and protection details | Keep sensitive retained observations reachable in the current agent context and make recorded reasons understandable. |
| `ux_security_actions` | Local security and action coverage | Keep collection limitations visible alongside findings; retain access to complete scope and coverage. |
| Wave 2: rules, catalog and analysis | Rules, Agent catalog, AI analysis | Clarify saved configuration, next actions and result context without implying enforcement or invoking paid analysis. |
| Wave 2: settings, reports and statistics | Settings, Reports, Statistics | Improve hierarchy and contextual next actions while preserving drafts, exports, sensor caveats and resource uncertainty. |

The coordinator owns shared navigation, translation keys, design notes, integration and verification. Workers own disjoint component files and uniquely named tests; they do not commit, switch branches or run aggregate checks. All work follows the approved Observatory design.

After the first integrated PR, reuse the workers for a brief second pass over
remaining section flows: Monitoring and Statistics; Rules and Agent catalog;
Settings and report exports; Action control; and task guide navigation. Inspect
the current screen and its callers, record concrete friction, and implement only
evidence-backed bounded improvements. A section with no actionable finding keeps
its existing behavior. Do not run a new full verification batch for an unchanged
revision. Track this pass in the handoff; the final two-hour cutoff still applies.

## Acceptance criteria

- Useful overview context reduces avoidable tab changes while all original detail panels, commands, filters and operations remain accessible.
- Important outcomes and limitations have clear headings, text hierarchy and accessible controls. Unknown, partial, stale and unsupported states remain explicit. Primary results must remain inside the visible content area above fixed chrome at supported scale.
- Agent and process actions retain stamped identity. No automatic file-content read, provider request or destructive action is introduced.
- Existing mounted drafts, filters, selection and keyboard focus survive contextual navigation. Controls work with keyboard input and do not rely only on color.
- Check the affected production workspace at 900×600 and 1200×800, 100–150% scaling, both themes, and relevant empty/error states. Record actual coverage and limitations; do not claim unperformed native or screen-reader checks.
- Run focused behavioral tests during implementation. For a frozen integrated revision, run the required build, format/lint, TypeScript/Svelte, coverage/gates/counts and production dependency audit, plus preview build and frontend tests required by the frontend instructions.
- Publish a cohesive PR through the authorized normal Git cycle. Merge only after the five required CI contexts pass for the current head. Refresh the source context and English handoff with exact revisions and receipts.

## Cost and storage controls

Use compact prompts and source-backed changes. Avoid repeated research, speculative features, paid provider calls, idle agent loops and duplicate heavy check batches. Preserve configured models, billing, credentials and permissions. Review usage at phase boundaries; no exact spend cap is claimed.

The coordinator owns heavy verification and uses the bounded `X:/tmp/aegis-github-review-20261006/run-check.mjs` runner. Check free disk space and owned diagnostic growth before and after heavy work. Store disposable process temporary output and caches on X. Never clear unrelated caches or stop the user's application.

## Publication boundaries and stopping

Normal branch, selective commit, push, PR, CI wait and merge are authorized. This task does not authorize a new release tag, force push, lockfile regeneration, workflow change or `.codex/config.toml` change. Preserve unrelated work.

During the final two hours, start no new section redesign. Finish integration, verification, source context and the report. At the deadline, stop new edits, finish only already-started bounded verification, record the result and pause the matching automation. If accepted work finishes early, pause it without manufacturing more work.
