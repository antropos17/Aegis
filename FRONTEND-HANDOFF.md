# Historical frontend handoff — 2026-09-10

This is a dated integration record. Use [current development context](docs/development/current-context.md)
to select the active checkout and evidence, and [the Observatory design](frontend/observatory/DESIGN.md)
for current interface rules. The observations below describe the September checkpoint.

Production renderer: frontend/observatory/entry.ts. npm start, build:renderer and Electron packaging consume dist/renderer. Preview uses an isolated fixture host with the same Svelte components; desktop builds exclude fixtures.

Machine-specific checkout, installation and profile paths are selected by the active task; this historical handoff does not select them.

The approved template is preserved in frontend/observatory/reference/. Twelve original stylesheets retain their source order, followed by the requested radar, motion, detail and comfort refinements. Historical Shield/Fancy UI documents and the old migration prompt are not current design instructions.

Monitoring groups products and exposes stamped processes for actions. Statistics uses resource collection provenance and source-specific delivery clocks for other telemetry, actual observation points, fixed time windows and explicit missing/partial coverage. Cached resource replies add no numeric point; mixed collections expose their age span. A backwards wall-clock change resets the timeline and rate baselines. Settings/provider editors save changed fields against current main-process state; same-field concurrent writes remain last-commit-wins. Renderer pause freezes the view while collection continues. Settings and detail dialogs have internal sections.

The all-section duplicate pass is recorded in docs/current-state/SECTION-DUPLICATES-2026-09-09.md. Resource grouping retains all original evidence, canonicalizes Windows display paths and exposes local socket endpoints. Statistics Processes separates Comparison and Table. Catalog and policy targets use durable unique keys; offline policies remain editable through single-key atomic saves. Analysis counts describe the captured request. See docs/current-state/AUDIT-2026-09-09.md for the preceding backend/frontend audit and its limits. See OBSERVATORY-INTEGRATION.md for historical integration evidence and the preload transfer matrix, frontend/observatory/DESIGN.md for visual rules, and memory-bank/architecture.md for the code map.

The risk clarity pass is recorded in docs/current-state/RISK-CLARITY-2026-09-10.md. Monitoring, radar and agent rows open the Risk explanation detail section. It exposes shared scoring contributions, captured process evidence, saved adjustments and exact highest-process navigation.

The usability pass removes duplicate workspace tabs and repeated Statistics charts. Statistics filters by agent and exact process, preserves departed selections, and opens directly from the Monitoring inspector or agent table. Scoped history starts when the selection changes; per-agent file rates remain unavailable. Radar/inspector geometry is stable across layer and agent changes. See docs/current-state/USABILITY-2026-09-10.md for verification and remaining scope.
