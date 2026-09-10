# Current AEGIS context — 2026-09-09

Production renderer: frontend/observatory/entry.ts. npm start, build:renderer and Electron packaging consume dist/renderer. Preview uses an isolated fixture host with the same Svelte components; desktop builds exclude fixtures.

The active integration checkout is X:/tmp/aegis-observatory-integration. Preserve the separate dirty original checkout at X:/Future/ESCAPE/AEGIS. The installed Windows executable is X:/Future/ESCAPE/AEGIS-Desktop/AEGIS - AI Monitoring & Threat Detection.exe; its existing user profile is under %APPDATA%/aegis. Build and test temporary files belong on X.

The approved template is preserved in frontend/observatory/reference/. Twelve original stylesheets retain their source order, followed by the requested radar, motion, detail and comfort refinements. Historical Shield/Fancy UI documents and the old migration prompt are not current design instructions.

Monitoring groups products and exposes stamped processes for actions. Statistics uses resource collection provenance and source-specific delivery clocks for other telemetry, actual observation points, fixed time windows and explicit missing/partial coverage. Cached resource replies add no numeric point; mixed collections expose their age span. A backwards wall-clock change resets the timeline and rate baselines. Settings/provider editors save changed fields against current main-process state; same-field concurrent writes remain last-commit-wins. Renderer pause freezes the view while collection continues. Settings and detail dialogs have internal sections.

See docs/current-state/AUDIT-2026-09-09.md for the current backend/frontend audit, its verification and remaining limits. See OBSERVATORY-INTEGRATION.md for historical integration evidence and the preload transfer matrix, frontend/observatory/DESIGN.md for visual rules, and memory-bank/architecture.md for the code map.
