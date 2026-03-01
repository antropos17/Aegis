# AEGIS Development Guide

Practical reference for contributors. Covers stack versions, patterns, gotchas,
and IPC architecture specific to this codebase.

---

## Stack Versions (current as of v0.3.0-alpha)

| Dep | Version | Role |
|-----|---------|------|
| Svelte | 5.51+ | UI framework (runes mode) |
| Vite | 7.3+ | Dev server + bundler for renderer |
| Electron | 33 | Desktop shell + OS APIs |
| Vitest | 4.0+ | Unit testing (Node env, jsdom available) |
| chokidar | 3.6 | File system watcher (main process only) |
| prettier | 3.8 | Code formatter — run before committing |

**Runtime deps only:** `electron` + `chokidar`. No other runtime deps without discussion.

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
export const store = { count: $state(0) };
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
    contextIsolation: true,  // enforced since Electron 12, never disable
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

// ONLY for fire-and-forget (no response needed)
ipcRenderer.send('other-panel-expanded', true);
```

### Validate IPC args in main process

Never trust renderer input. Validate/sanitize all args in the main process handler before
performing file I/O, spawning processes, or writing to disk.

---

## IPC Data Flow (AEGIS Architecture)

```
OS (chokidar + netstat) --> main process
    --> preload.js (contextBridge) --> window.aegis
        --> ipc.js stores (agents, events, stats, network, anomalies, resourceUsage)
            --> risk.js (enrichedAgents derived store)
                --> components
```

### Stream channels (pushed from main)

| Channel | Store | Payload |
|---------|-------|---------|
| `scan-results` | `agents` | `Agent[]` |
| `file-access` | `events` | `FileEvent[]` |
| `stats-update` | `stats` | `StatsObject` |
| `network-update` | `network` | `NetworkConnection[]` |
| `anomaly-scores` | `anomalies` | `{ [agentName]: score }` |
| `resource-usage` | `resourceUsage` | `{ memMB, heapMB, cpuUser, cpuSystem }` |

### Invoke channels (renderer requests main)

Common ones: `get-stats`, `get-resource-usage`, `get-agent-database`, `get-settings`,
`save-settings`, `get-all-permissions`, `save-agent-permissions`, `analyze-session`,
`kill-process`, `get-audit-stats`. Full list in `src/main/preload.js`.

### Browser / demo mode guard

`window.aegis` is `undefined` in plain browser builds. Always guard:

```js
if (window.aegis) {
  const data = await window.aegis.getStats();
}
```

`ipc.js` exports `isDemoMode` boolean — components can use it to hide Electron-only UI.

---

## Vite Multi-Mode Build

### Mode-aware config pattern

```js
// vite.config.js
export default defineConfig(({ mode }) => {
  const isDemo = mode === 'demo';
  return {
    define: {
      // Replaced at build time — tree-shakeable, zero runtime cost
      'import.meta.env.VITE_DEMO_MODE': JSON.stringify(isDemo ? 'true' : 'false'),
    },
    build: {
      outDir: isDemo ? '../../dist/demo' : '../../dist/renderer',
    },
  };
});
```

### `VITE_*` env vars

- Only variables prefixed `VITE_` are exposed to the renderer via `import.meta.env`
- Not available in `preload.js` or `main.js` (CommonJS, not processed by Vite)
- `import.meta.env.VITE_DEMO_MODE` → string `'true'` or `'false'` (check with `=== 'true'`)

### `base: './'` is required for Electron

Electron loads renderer via `file://` URLs. Absolute paths (`/assets/...`) break. Always
use `base: './'` so asset paths are relative.

---

## Build Commands

```bash
npm run dev            # Vite dev server on :5174 (renderer hot-reload only)
npm run build:renderer # Production renderer build -> dist/renderer/
npm run build:demo     # Static demo build -> dist/demo/ (no Electron required)
npm run build          # Full Electron app -> dist/ (platform installer)
npm start              # build:renderer + launch.js (opens Electron with built renderer)
```

---

## Testing

Vitest (not Jest). Tests live in `src/tests/`.

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
`src/renderer/lib/styles/tokens.css`. Never hardcode hex values.

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

- **200-line soft limit** per file — split by feature, not enforced by linter
- **JSDoc on all exported functions**: `@param`, `@returns`, `@since`
- **Commit prefixes**: `feat:`, `fix:`, `docs:`, `refactor:`, `security:`
- **IPC channel names**: `kebab-case`
- **CSS class names**: `component-element` (BEM-lite, no nesting depth > 2)
- **Branch from `master`**, not main
