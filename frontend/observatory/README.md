# Observatory

The production desktop interface and simulated browser preview use App.svelte and the same components and tokens.

- `npm start`: build dist/renderer and launch Electron.
- `npm run dev`: simulated preview at http://127.0.0.1:8770.
- `npm run frontend:build:preview`: static preview in dist/frontend-preview.
- `npm run frontend:test`: browser checks against both built artifacts.
- `npm run frontend:test:electron`: real desktop smoke in an isolated profile.

runtime/host.ts connects existing preload capabilities and retains source uncertainty. components/ contains the workspaces and dialogs. reference/ui/ preserves the approved template markup, and styles.ts imports its complete stylesheets in order. DESIGN.md records the permitted live-data adaptations. demo/ and reference/ are production-excluded. public/assets contains original artwork. SOURCE.json records the preparation provenance; reference/SOURCE.json verifies the captured template files and stylesheet order (normalized LF).

For side-by-side review, run node frontend/observatory/tests/capture-template.mjs with the prepared template and the shared preview running. OBSERVATORY_REFERENCE_URL and OBSERVATORY_PREVIEW_URL override their local addresses. Screenshots go to dist/template-qa; the script also checks resource routes, native dialog dismissal/focus and appearance preview/discard. The hash and geometry checks prevent specific regressions but do not replace visual review.

See ../../OBSERVATORY-INTEGRATION.md for the migration matrix, verification and limitations.
