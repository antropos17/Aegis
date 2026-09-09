# Approved Observatory template

The files in ui/ preserve the user's reviewed Observatory dialogs-14 markup and interactions from the frontend preparation. They are a read-only visual reference, excluded from the application bundles. They contain simulated data paths and must not be executed with the Electron bridge.

The twelve template stylesheets are used directly from ../styles/ in their original order (../styles.ts). reference/DESIGN.md records the original design brief. The source checkout is X:/tmp/aegis-observatory-frontend-prep/frontend/observatory/.

Port markup into Svelte with live bindings and safe escaping. Do not approximate a view from a prose description or canonize an accidental implementation difference. Functional checks and geometric assertions supplement side-by-side rendered review; neither establishes approval by itself.

Permitted live-data adaptations must be documented in ../DESIGN.md. Review the radar, selected inspector, every workspace, forms, detail windows, navigation, empty/error states, and both themes at desktop and minimum window sizes.
