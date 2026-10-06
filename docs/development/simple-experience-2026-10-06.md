# Simple agent experience — 6 October 2026

## Request and window

The user authorized five independent UX audits followed by implementation over a three-hour window. Start: 14:50:47 UTC / 18:50:47 Asia/Baku. Stop new source work at 16:50:47 UTC; reserve the final hour for integration and verification. End: 17:50:47 UTC / 21:50:47 Asia/Baku. Finish early if acceptance is achieved. Preserve every existing capability.

Base: `b9ceebed0d4fe6285d193c0c880d6160e806e96b` (`origin/master`). Implementation checkout: `C:/Users/murtu/.codex/worktrees/gap-completion-1006/AEGIS`, branch `codex/simple-agent-experience-20261006`. The original dirty checkout and other worktrees are outside this task. The user is running the previously built desktop application; do not stop it to perform verification.

## Independent audit assignments

Five audits run in two waves because at most three subagents can run alongside the coordinator. Audit reports precede implementation assignments. Each reviewer owns an independent scope and reports concrete source evidence in English.

1. `simple_audit_navigation`: navigation duplication, beginner journey and Simple/Advanced mapping.
2. `simple_audit_agent_journey`: unified agent workspace, attribution, risk, suppression and exact-process control semantics.
3. `simple_audit_timeline`: active activity views, continuous scrolling, bounded retention, live arrivals, focus and motion.
4. `ux_settings_reports_statistics`: shared layouts and persisted mode preferences.
5. `ux_monitoring_agents`: independent accessibility, discoverability and control safety review.

All five independent source audits completed before the implementation assignments. The first three use read-only researcher roles. The last two reuse completed writable agents; a new-agent attempt reached the session thread limit, so no additional models or accounts were substituted.

## Source-backed decisions

At the baseline, fourteen top-level destinations were rendered. Agent detail repeated clickable summary cards and tabs, defaulted to Risk, and showed only four file and four connection observations before sending the reader elsewhere (`runtime/navigation.ts`, `components/AgentWorkspace.svelte`, `components/AgentEvidence.svelte`). Simple exposes Home, Agents, Activity, Check files and Settings. Stable internal route IDs, commands and contextual links remain available; Advanced reveals the full sidebar.

The interface preference is separately saved on this device using the existing renderer preference precedent. Its control is outside the host-dependent Settings fieldset and Save/Discard snapshot. Mode changes must preserve visited compositions, shared agent scope and drafts. A failed storage write must retain the previous mode.

`Events.svelte` and `ObservationTable.svelte` are the active file/network display; the older `Timeline.svelte` is unmounted. At the baseline, the shared table paged thirty groups. Files have a five-hundred-observation display cap; network is a replacement snapshot. The new scroll contract uses stable original identities, a held reading snapshot, bounded thirty-row increments and explicit Show latest. No network timestamps or connection lifetimes are invented.

Production provides exact-process Suspend/Resume/Stop, while saved permission block states and the watchlist are advisory. Simple calls the same guarded operations Pause process / Resume process. Product scope requires an explicit worker choice. The existing Agent & controls link must request `process-controls` so Advanced expands the promised actions.

False-positive patterns already persist through the validated Settings patch. They currently affect renderer scoring but not popup/banner presentation. Reversible exact path/agent controls will use existing IPC, confirmed writes and readback. Presentation suppression must happen after retained journal/audit capture, leaving original observations and Alerts history intact. Unattributed observations cannot inherit a name-based exception.

## Implementation ownership

- `ux_settings_reports_statistics`: App/navigation/commands, independent interface preference and Settings control, Simple Home and agent-list presentation, mode tests.
- `ux_monitoring_agents`: Events/shared observation table/history, live-feed helper, incremental-scroll tests and its existing browser fixture.
- `ux_rules_catalog_analysis`: selected-file exception control, matching helper, desktop/transient notification filtering and scoped tests.
- Coordinator: SimpleAgentView/AgentWorkspace, process captions and promised-controls link, legacy Advanced fixture adaptation, localization, design/context, aggregate rendered/native verification and authorized Git cycle.

The read-only researchers independently review the resulting frozen implementation. No worker owns another worker's files or the aggregate verification batch.

## Intended behavior

The default view should make one agent's activity, file observations, process risk and available controls easy to find. A separately saved Advanced preference in Settings reveals technical workspaces and details. Related information should share a useful composition and consistent search/filter/action positions. Keep technical tools, exports, evidence inspection, rules and existing direct navigation available.

The activity timeline should use bounded incremental scrolling rather than numbered pages. New arrivals must not move a reader away from older evidence or steal keyboard focus. Offer an explicit route to the latest activity and honor application and system reduced motion.

Use existing confirmed host actions and stamped process identities. A file observation does not prove a file was modified. Network snapshots do not prove connection start/end times. Review status, false-positive suppression, saved permissions and an alert watchlist are distinct from enforcement. Existing Suspend/Resume/Stop actions must keep their confirmations and unavailable/failure states; no process interventions against user processes are part of verification.

## Acceptance and verification

- Beginner navigation and an agent-centered first screen are understandable without knowing the sensor or policy architecture.
- Advanced is separately available in Settings, persists as documented, and preserves every route and feature.
- File activity, risk, suppression and exact-process controls are discoverable from one agent workspace with consistent control positions.
- Activity keeps its existing retained-source bounds, loads rows incrementally, remains stable while reading and supports exact inspection, keyboard use and reduced motion. Large network snapshots eventually mount their retained rows; no hard virtual-window claim is made.
- Meaningful behavioral tests cover new mode/navigation, incremental/live activity and relevant control failures. Do not add markup-mirroring tests or weaken existing assertions.
- Freeze changes before one coordinator-owned required verification batch: renderer and preview builds, format, lint, TypeScript, Svelte, coverage, witness and sequence gates, counts and production dependency audit; run frontend and disposable-profile Electron checks for changed states.
- Verify rendered states at 900×600/150% and 1200×800/100%, light/dark, focus and error states. Report actual coverage and limitations.
- Publish through the authorized normal commit/push/PR/five required CI/merge cycle only when checks pass. No release tag, force push, lockfile regeneration, workflow or `.codex/config.toml` edit.

Keep targeted iterations inexpensive. Reuse the bounded check runner at `X:/tmp/aegis-github-review-20261006/run-check.mjs`, existing caches and owned X-drive diagnostic output. Its logs are capped at 8 MiB per run. Preserve verification receipts. Measure storage before and after heavy checks; do not delete unrelated or active output. Do not invoke paid providers, install integrations or change model/account settings.

## UX review references

Checked the primary [WCAG focus-order guidance](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html),
[WCAG animation guidance](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)
and [Nielsen Norman Group system-status guidance](https://www.nngroup.com/articles/visibility-system-status/).
They inform the preserved keyboard destination, disableable motion and explicit
pending/read/failure states. These targeted checks are not a complete WCAG
conformance audit or a screen-reader certification.
