# Observatory

The production desktop interface and simulated browser preview use App.svelte and the same components and tokens.

- `npm start`: build dist/renderer and launch Electron.
- `npm run dev`: simulated preview at http://127.0.0.1:8770.
- `npm run frontend:build:preview`: static preview in dist/frontend-preview.
- `npm run frontend:test`: browser checks against both built artifacts.
- `npm run frontend:test:electron`: real desktop smoke in an isolated profile.

runtime/host.ts connects existing preload capabilities and retains source uncertainty. components/ contains the workspaces and dialogs. styles/ and DESIGN.md define appearance; demo/ is production-excluded. public/assets contains original artwork; SOURCE.json describes the preparation provenance, not current source hashes.

See ../../OBSERVATORY-INTEGRATION.md for the migration matrix, verification and limitations.
