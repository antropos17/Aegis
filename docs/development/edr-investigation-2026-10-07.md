# One investigation workspace — 7 October 2026

The user reports that the Simple interface still scatters related tasks and explicitly requests applying patterns from popular EDR products. This supersedes the five-destination Simple composition; it preserves the underlying functionality and the Advanced registry.

## Source-backed direction

- [Microsoft Defender alert investigation](https://learn.microsoft.com/en-us/defender-endpoint/investigate-alerts) keeps entity context and response actions together in the investigation.
- [CrowdStrike Falcon Insight XDR](https://www.crowdstrike.com/en-us/platform/endpoint-security/falcon-insight-xdr/) illustrates process context and connected investigations. This is a vendor product reference, not proof of AEGIS detection or response capabilities.
- [Cortex XDR alert side panel](https://docs-cortex.paloaltonetworks.com/r/Cortex-XDR/Cortex-XDR-3.x-Documentation/Alert-side-panel) presents alert details in incident context. The AEGIS adaptation uses a local evidence pane without losing the feed.

Our design inference is a compact roster, contextual risk/response header, one live activity feed and a selected-evidence pane. Enterprise product menus, remote isolation and fabricated process causality are outside this change.

## Implementation and ownership

Root owns App/navigation, the workbench, evidence pane, localization, browser integration and publication. The roster worker owns InvestigationRoster and its behavioral tests. The header worker owns InvestigationHeader, the optional compact DetailControls presentation and its behavioral tests. Independent read-only navigation and agent-journey audits supplied concrete source findings.

Simple has three primary destinations: Investigate, Check files and Settings. Home, Agents and Activity are replaced by one investigation composition. Registered technical routes remain available in Advanced and through Commands; related Simple process/file/network commands reach the shared investigation feed.

The roster changes the existing App scope explicitly without navigating to another page. A product never silently selects a worker. The nearby native worker selector retains departed identities and distinguishes project/process context. The compact native product selector replaces the side roster below 981 pixels without discarding its desktop search draft. Only fresh, exactly stamped workers with matching generation witness value and source can receive the existing manual Pause/Suspend, Resume and Stop controls. Permission policies remain advisory.

Selecting evidence preserves its captured row and the feed's accepted actor context, filters and loaded rows. Explicit opening reveals the evidence; closing restores its opener after reflow or falls back to Activity when filtering removed it. The adjacent pane shows the full resource, observed action/source context and confirmed reversible false-alarm state. A distinct full-details action retains technical metadata. Changing records during a pending write cannot carry status to another resource. Unknown ownership cannot inherit a named-agent exception.

Advanced remains a separate saved preference. Settings drafts, scopes, route commands and mode-switch state are retained. Audit loss and write failures remain explicit. Ordinary sensor state is compact; diagnostics and exit stay accessible. Source events, scoring and response boundaries are unchanged.

## Verification and operational bounds

Use behavioral regressions for same-screen selection, retained feed state, captured evidence, exact response guards, failed/pending exception writes and complete Advanced access. Render the changed layouts in light/dark at 1200×800/100% and 900×600/150%, checking vertical proximity, keyboard/focus and empty/error/stale states. Run the repository gates, both builds and isolated-profile Electron smoke before the authorized PR/CI/merge cycle.

Worktree: X:/tmp/aegis-edr-agent-workbench-20261007, branch codex/edr-agent-workbench-20261007, base fc502005213711996817ac1f6e993601cb26cc76. The existing running app builds are preserved. Installed dependencies are reused through a junction only after lockfile hashes matched; never run npm ci or recursive removal through that junction. Unlink the junction itself before any later worktree cleanup.

Owned TEMP/cache/output is on X under the existing runner's eight-MiB log cap per run. Preserve receipts; disposable closed diagnostics have seven-day retention, without automatic deletion of user profiles or open files. C free is constrained by a measured expanding pagefile and unrelated active workloads. Keep checks serial with one worker and a bounded Node heap; measure before and after heavy runs. No global configuration, workflow, dependency, release-tag or unrelated-service changes are authorized by this interface task.

## Completed local verification

The final Windows coverage run passed 458 files and 7936 tests, with nine skipped and zero failures.

Formatter, lint, TypeScript/Svelte checks, both renderer builds, both mutation gates, derived counts, the full rendered matrix, isolated-profile Electron smoke and the production dependency audit passed.

Lint reports 55 warnings already present, with zero errors. The native check observed a reliable population, no renderer errors, retained settings after restart, key-free settings IPC and six exports. The production audit found zero vulnerabilities.

Two independent source reviews cleared the final navigation and captured-evidence changes by file hash. These do not establish a new backend enforcement verdict. Historical failed receipts are preserved: the initial Windows checkout lacked local sidecar binaries; legacy callbacks required their original two-argument contract; a missing translation and Home alias were restored. The 123-test focused recovery and final full coverage passed. Counts use tracked paths, so new/deleted components were explicitly staged before the accepted count check. Rendered verification uses the existing Chromium installation through a process-local PLAYWRIGHT_BROWSERS_PATH on X.

Publication follows the authorized feature-branch PR and five-context CI cycle. Read the actual GitHub state and local out/development/edr-investigation-result record for its outcome. No installer or release tag is implied by this source change.
