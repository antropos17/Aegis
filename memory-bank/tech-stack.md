# AEGIS Tech Stack

Source check: 11 September 2026, `17a3c0d` (PR #438). Exact dependency ranges
live in `package.json`; `package-lock.json` records resolved versions.

## Runtime and build

Electron supplies the desktop shell. Main-process modules in `src/main/` use
CommonJS JavaScript with JSDoc. `checkJs` is off; annotations alone do not mean
JavaScript function bodies pass a TypeScript check.

The active Svelte renderer is `frontend/observatory/`, configured by
`vite.frontend.config.ts`. Desktop and simulated preview share `App.svelte`;
`entry.ts` selects the host at build time. Retained computations, stores and
regression fixtures under `src/renderer/lib/` are not the active visual shell.
New renderer files use TypeScript and ES modules.

Svelte provides compiled components, reactive runes and scoped component CSS.
Shared styles are also used. Validation is performed by the package scripts;
an installed MCP integration does not imply automatic code validation.

## Dependencies and checks

Runtime dependencies are `ajv`, `chokidar`, `electron-updater`, `js-yaml` and
`semver`. Electron, Svelte, Vite, TypeScript, Vitest, ESLint and Prettier are
build/development dependencies. Use the pinned Node version and `npm ci`.

`npm run typecheck` checks main, retained renderer code and Observatory configs.
`npm run typecheck:svelte` checks both configured Svelte projects. The current
full CI gate is listed in `AGENTS.md` and `.github/workflows/ci.yml`.
`npm run build:renderer` builds production assets; `npm run build` packages
those assets. `npm run dev` starts a simulated preview.

## Styles and fonts

`frontend/observatory/styles.ts` owns stylesheet order. Base layout and semantic
theme properties are in `styles/workbench.css`. `--sans` uses Segoe UI Variable
Text, Segoe UI and system fallbacks; `--mono` uses Consolas, Courier New and
monospace. See `frontend/observatory/DESIGN.md` for the approved design and
subsequent user-requested adaptations.
