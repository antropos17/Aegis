# AEGIS Development Guide

Practical reference for contributors. Covers stack versions, patterns, gotchas,
and IPC architecture specific to this codebase.

---

## Stack

Exact dependency ranges live in [package.json](../package.json); [package-lock.json](../package-lock.json) records the installed versions. Use the Node.js version pinned in `.nvmrc` and `npm ci` to reproduce the dependency tree.

The application uses Electron, Svelte 5 and Vite. Vitest provides the test runner; Prettier and ESLint cover formatting and linting.

Runtime dependencies are `ajv`, `chokidar`, `electron-updater`, `js-yaml` and `semver`. Electron is a devDependency that supplies the desktop shell. Justify new dependencies in the PR.

---

## Svelte 5 Runes — Patterns

Svelte 5 replaced implicit reactivity with explicit **runes**. All new components
use runes; writable stores (in `src/renderer/lib/stores/`) still coexist fine.

### Core rune roles

```js
let count = $state(0);              // local reactive state — deeply proxied for objects/arrays
let doubled = $derived(count * 2);  // computed, memoized — recalculates only when deps change
$effect(() => {                     // side effects — runs AFTER DOM update, not synchronously
  document.title = `Count: ${count}`;
  return () => { /* cleanup on re-run or unmount */ };
});
let { value = $bindable(0) } = $props(); // two-way bindable prop
```

### $effect cleanup is mandatory for timers and listeners

```js
// GOOD
$effect(() => {
  const handler = (e) => doSomething(e);
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
});

// BAD — leaks listener on every re-render
$effect(() => {
  window.addEventListener('keydown', (e) => doSomething(e));
});
```

### Stores vs runes — when to use each

- **Runes** (`$state`, `$derived`): local component state, component-tree state passed via props
- **Stores** (`writable`, `derived` from `svelte/store`): cross-component global state (IPC data,
  theme). Stores are NOT deprecated — they coexist with runes and work in non-component `.js` files.
- In `.svelte` components, subscribe to stores with the `$` prefix: `$agents`, `$theme`.

---

## Svelte 5 Runes — Gotchas

### 1. Destructuring breaks reactivity

```js
// BAD: loses tracking after destructure
let { count } = $state({ count: 0 });
count++; // does NOT trigger updates

// GOOD: keep the reactive reference
let state = $state({ count: 0 });
state.count++;
```

### 2. `$effect` runs AFTER DOM update, not synchronously

Svelte 4's `$: { }` reactive blocks ran synchronously. `$effect` does not — it defers
until after the DOM settles. Use `$derived` for synchronous computed values.

### 3. Cannot export reassigned `$state` from `.svelte.js`

```js
// In a .svelte.js module:
export let count = $state(0);
// count = 5; // compiler error — reassignment of exported $state

// WORKAROUND: wrap in object or use a function
export const store = $state({ count: 0 });
store.count = 5; // OK — property mutation, not reassignment
```

### 4. Method binding loses `this` in event handlers

```js
// BAD: this === DOM element inside handler
<button onclick={myObject.increment}>

// GOOD: wrap in arrow fn
<button onclick={() => myObject.increment()}>
```

### 5. `{#key}` fully unmounts children — use sparingly

```svelte
{#key activeTab}
  <TabContent /> <!-- completely destroyed and recreated on every activeTab change -->
{/key}
```
This is intentional for tab transitions but has a render cost. Avoid nesting `{#key}` blocks.

---

## Electron Security

### Non-negotiable settings

```js
new BrowserWindow({
  webPreferences: {
    contextIsolation: true,  // keep renderer and preload worlds separate
    sandbox: true,           // sandbox the renderer
    nodeIntegration: false,  // never enable — would expose Node to renderer
    preload: path.join(__dirname, 'preload.js'),
  },
});
```

### contextBridge rules

```js
// preload.js — SAFE: explicit named methods only
contextBridge.exposeInMainWorld('aegis', {
  getStats: () => ipcRenderer.invoke('get-stats'),
});

// UNSAFE: never expose raw ipcRenderer — would allow arbitrary IPC
// contextBridge.exposeInMainWorld('electron', { ipcRenderer });
```

### `invoke` over `send` for data-returning calls

```js
// GOOD: await a response, catches errors
const data = await ipcRenderer.invoke('get-stats');

// AEGIS exposes no fire-and-forget send method in its preload bridge.
```

### Validate IPC args in main process

Never trust renderer input. Validate/sanitize all args in the main process handler before
performing file I/O, spawning processes, or writing to disk.

---

## Observatory data flow

OS sensors → main process → preload.js → runtime/host.ts → App.svelte and workspace components. The host adapter owns seven telemetry subscriptions, freshness, revision-guarded initial reads and teardown. Settings, Rules and App own the remaining update, rules and theme subscriptions. All 44 invoke and 10 push methods are mapped in [the integration record](../OBSERVATORY-INTEGRATION.md).

The scan batch carries anomalyScoresByInstance. Risk enrichment remains a shared pure computation. Instance identity is never inferred from name or PID. Process commands carry both pid and instanceId and are revalidated in main. Project permission keys persist by agent/cwd/parent context and are deliberately separate from process lifetime IDs.

## Renderer builds

vite.frontend.config.ts defines __FRONTEND_PREVIEW__. The desktop entry fails visibly without a bridge; it never falls back to demo data. Preview imports demo/host.ts and mounts the same App.svelte without calling window.aegis. base './' supports Electron file URLs.

```bash
npm run dev                    # Simulated preview, port 8770
npm run frontend:build:preview # Static preview -> dist/frontend-preview
npm run build:renderer         # Production -> dist/renderer
npm start                      # Build production renderer and launch Electron
npm run frontend:test          # Built-artifact browser checks
npm run frontend:test:electron # Disposable-profile Electron smoke
```

For a local installer, run these commands in order:

```bash
npm run build:renderer
npm run build
```

`build`/`dist` package the existing renderer output; they do not rebuild it. On Windows the packaging hook compiles the process-snapshot sidecar. Close a source-run AEGIS instance before packaging if it is holding that sidecar executable. Release CI runs the renderer build explicitly before packaging.

---

## Testing

Vitest (not Jest). Tests live in `tests/` at the repository root — split into three Vitest
projects (`main`, `renderer`, `components`) by `vitest.config.js`.

```bash
npm test               # run all tests once
npm run test:watch     # watch mode
npm run test:coverage  # coverage report (v8 provider)
```

Use `vi.fn()` to mock IPC calls. Existing tests mock `window.aegis` as a module-level
vi.fn stub — follow that pattern for new tests.

---

## CSS Tokens

All colors and spacing come from M3 design tokens in
`frontend/observatory/styles/theme.css`. Never hardcode hex values.

```css
/* GOOD */
color: var(--md-sys-color-primary);
padding: var(--aegis-space-6);

/* BAD */
color: #7a8a9e;
padding: 12px;
```

Key token namespaces:
- `--md-sys-color-*` — M3 color roles (surface, primary, error, etc.)
- `--md-sys-typescale-*` — typography (body-medium, label-large, etc.)
- `--md-sys-shape-corner-*` — border radii
- `--aegis-space-*` — spacing scale (4px base unit, scale 1-12)
- `--aegis-size-*` — structural sizes (header height, footer height)
- `--aegis-color-*` — semantic aliases (header-bg, brand, etc.)

---

## Conventions

- **300-line soft limit** per file — a target for NEW files, not an invariant; 27 existing `src/` files already exceed it. Not enforced by the linter
- **JSDoc on all exported functions**: `@param`, `@returns`, `@since`
- **Commit prefixes**: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `test:`; see [BRANCHING.md](../BRANCHING.md)
- **IPC channel names**: `kebab-case`
- **CSS class names**: `component-element` (BEM-lite, no nesting depth > 2)
- **Branch from `master`**, not main
