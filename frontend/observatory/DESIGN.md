# Observatory design contract

Use this entry point for implementation. The preserved
[reference](reference/README.md) defines the approved baseline. The complete
dated decisions remain verbatim in [DESIGN-HISTORY.md](DESIGN-HISTORY.md); read
the relevant amendment before changing that behavior. Existing implementation
alone does not establish visual approval.

An explicit new user brief governs its requested change. Otherwise apply the
baseline together with the applicable dated amendments; a later amendment
supersedes an earlier value for the same property. This index does not retire
unlisted requirements in the history.

## Current layout and interaction

- Advanced is the default for fresh or unreadable preferences; preserve saved
  Simple mode and its **Simple interface** setting. Simple remains an opt-in
  workflow, with its own recorded navigation and responsive behavior.
- Keep related evidence and context visible in bordered workspace columns.
  Agent activity, resources and worker context stay together. Preserve drafts,
  keyboard focus, selection and scroll across telemetry updates and navigation.
- Use the October 7 compact density: 28 px controls, 12 px panel insets, 8 px
  heading padding, 30 px sidebar rows and 44 px radar markers. The 12 px inset
  supersedes the earlier 16 px brief. Keep font sizes and allow multiline content
  to grow; do not reserve empty roster height.
- Use 110 ms control feedback and 150 ms entrance motion where the recorded
  motion contract applies. Restore reading state and keyboard focus immediately.
  Pause radar sweep for paused/stale/hidden states and reduced motion.
- Preserve local identity artwork and the imported stylesheet order in
  `styles.ts`. Use existing semantic theme properties and scoped component CSS.
  Keep product labels and evidence limits aligned with returned host data.

These are the cross-cutting decisions most likely to conflict with older briefs.
Use the topic links below for full detail and exceptions.

## Read by changed behavior

| Area | Applicable recorded decisions |
| --- | --- |
| Layout, density, default mode | [Current layout](DESIGN-HISTORY.md#current-layout-brief--2026-10-07), [compact density](DESIGN-HISTORY.md#compact-density--2026-10-07), [one workspace](DESIGN-HISTORY.md#one-investigation-workspace--7-october-2026) |
| Motion, icons and agent identity | [Motion and identity](DESIGN-HISTORY.md#motion-and-identity-refinement--2026-10-07), [circular markers](DESIGN-HISTORY.md#circular-agent-markers-2026-09-11-follow-up) |
| Simple mode and keyboard behavior | [Simple foundation](DESIGN-HISTORY.md#simple-agent-experience-foundation-2026-10-06), [keyboard and catalog recovery](DESIGN-HISTORY.md#keyboard-and-catalog-recovery-2026-10-06) |
| Agent workspace, monitoring and sizing | [Agent workspace](DESIGN-HISTORY.md#agent-centred-workspace--10-september-2026), [monitoring and sizing](DESIGN-HISTORY.md#monitoring-and-sizing-correction), [stationary interaction](DESIGN-HISTORY.md#stationary-interaction-correction) |
| Charts, tokens and freshness | [Live charts](DESIGN-HISTORY.md#live-chart-refinement--5-october-2026), [token retention](DESIGN-HISTORY.md#token-history-retention--5-october-2026), [observation status](DESIGN-HISTORY.md#observation-status--1-october-2026) |
| Audit, rules and returned results | [Audit reads](DESIGN-HISTORY.md#audit-history-and-delivery-reads--30-september-2026), [rules readback](DESIGN-HISTORY.md#rules-persistence-and-readback--30-september-2026), [action/results](DESIGN-HISTORY.md#action-and-returned-result-workflow--30-september-2026) |
| Attribution and recorded files | [Editor ancestry](DESIGN-HISTORY.md#observed-editor-ancestry--2026-10-11), [shared files](DESIGN-HISTORY.md#shared-recorded-files--2026-10-11) |
| WSL, containers and Podman | [WSL inventory](DESIGN-HISTORY.md#passive-wsl-inventory--2026-10-11), [container candidates](DESIGN-HISTORY.md#container-metadata-candidates--2026-10-11), [Podman observations](DESIGN-HISTORY.md#podman-configuration-observations-2026-10-11) |
| File review, permissions and actions | [Session-only review](DESIGN-HISTORY.md#session-only-file-review--26-september-2026), [rules and permissions](DESIGN-HISTORY.md#rules-permissions-and-sensor-clarity--27-september-2026), [deletion setup](DESIGN-HISTORY.md#selected-file-deletion-setup--26-september-2026) |
| Process cadence and event retention | [Scan cadence](DESIGN-HISTORY.md#process-scan-cadence--27-september-2026), [event retention](DESIGN-HISTORY.md#monitoring-event-retention--27-september-2026) |

For other affected behavior, search the dated history by component or visible
label. Preserve the baseline and all applicable decisions outside the task.

## Verification

Follow [Observatory instructions](AGENTS.md) and the
[verification workflow](../../docs/development/workflow.md#selecting-verification).
Compare affected rendered states with the applicable reference at matching
viewport, theme and scale. Cover focus, selection, empty/error/stale states and
reduced motion when relevant. A simulated preview or successful build does not
verify the real preload bridge, native sensors or action controls.
