# Observatory integration

Observatory is now the production entry at frontend/observatory/entry.ts. npm start, build:renderer and packaging consume dist/renderer. Preview uses an isolated fixture host with the same Svelte components. No pending integration screen or window.Obs compatibility shell remains.

The old src/renderer shell, component styles and fonts are removed. Existing business computations, stores used by regression tests, and pure utility tests remain under src/renderer/lib. Do not restore the old visual system when using those helpers.

See [OBSERVATORY-INTEGRATION.md](OBSERVATORY-INTEGRATION.md) for the complete preload matrix and verification state, and [frontend/observatory/DESIGN.md](frontend/observatory/DESIGN.md) for visual rules.
