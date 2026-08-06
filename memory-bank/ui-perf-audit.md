# AEGIS UI / Performance Audit (read-only)

**Date:** 2026-06-03 · **Branch:** master (281bf31) · **Method:** ui-designer subagent (sonnet) + manual perf pass, cross-checked against data-flow. Trust-code-over-docs; all refs verified from source.

## Verdict

The **main process and IPC path are well-engineered** — batching, startup deferral, and heap/leak hygiene are already correct (see "Healthy — no action"). The real perf surface is the **always-visible canvas radar** (per-frame rebuild of static data) and **un-virtualized lists** that can reach 200–500 rows. Several subagent findings were **corrected/downgraded** after verifying the tab-mount model and Electron defaults (see "Corrections").

## Findings

| # | Problem | File:line | Impact | Complexity |
|---|---------|-----------|--------|------------|
| P1 | Radar rebuilds `new Map()` + full `$enrichedAgents` iteration **every frame (60fps)** to dedupe dots, though agents change only per scan (~10s) — 600 rebuilds per data change. Bounded to when Shield tab is foreground-visible. | `Radar.svelte:95-101` (called from rAF `:177`) | **high** | S–M |
| P2 | ActivityFeed `{#each}` key includes loop index `i`; newest-first list means indices shift every update → all ≤200 rows destroyed+recreated per event batch. Removing `i` risks dup keys (same agent+ms) → needs a stable event id from main. | `ActivityFeed.svelte:183` (cap at `:133`) | **med** | M |
| P3 | NetworkPanel renders `sorted` (full `cachedNetwork`, capped 500 in store) as flat rows with **no virtualization**; 500 > 200 threshold. | `NetworkPanel.svelte:49` · cap `ipc.ts:78` | **med** | M (virtualize) / S (tighter cap) |
| P4 | GroupedFeed expanded group renders up to 200 items (whole `unified` cap can land in one agent) × ~5 child nodes, **no per-group cap/virtualization** → ~1000 nodes on expand. | `GroupedFeed.svelte:81-89` | **med** | M |
| P5 | TimelineCanvas agent-link `<line>`s keyed by index `i` → full reconciliation when history is prepended. | `TimelineCanvas.svelte:60` | **low–med** | S |
| P6 | Radar `$effect` re-runs on every `$theme` change and restarts rAF; cleanup captures a stale `animId`, so a theme toggle can briefly run two concurrent loops. | `Radar.svelte:183-196` | **low–med** | S |
| P7 | `getStats()` is eagerly computed on **every** file event (`:296`) — building 2 `Set`s + `Array.from` — but the `stats-update` batcher is `latest`-mode (1000ms), so all but the last result are discarded. | `main.js:296` · `getStats():124-136` | **low–med** | S |
| P8 | Radar allocates two gradients (`createConicGradient`/`createLinearGradient`) per frame. Inherent to an angle-driven sweep; only fixable via offscreen pre-render. | `Radar.svelte:67,81` | **low** | L |
| P9 | Radar `getContext('2d')` re-called on every theme change, not just mount (idempotent but a needless DOM call). | `Radar.svelte:189` | **low** | S |
| P10 | Radar token re-resolve uses a fire-and-forget `requestAnimationFrame` with no cancel handle — fires even if the component unmounts in that frame gap. | `Radar.svelte:191-193` | **low** | S |
| P11 | ShieldTab `dataReady` latches true and never resets → skeleton won't reappear if `$agents` empties (reload/reset). | `ShieldTab.svelte:20-22` | **low** | S |
| P12 | Timeline scrubber: `scrollLeft` (`$derived`→`$effect`→assignment, `:184-187`) and `thumbOffset` (`$state`+`$effect`, `:207-217`) introduce a one-tick/one-frame lag where `$derived` would be synchronous. | `Timeline.svelte:184-217` | **low** | S–M |
| P13 | Radar reads `document.documentElement.dataset.theme` directly instead of the already-reactive `$theme` store value. | `Radar.svelte:27` | **low** | S |

## Corrections to the subagent (verified false/overstated)

| Claim | Reality | Source |
|-------|---------|--------|
| **RH-1** `$effect`+`if(!active)return` store-copy in ActivityFeed/GroupedFeed/NetworkPanel/Timeline is an anti-pattern → convert to `$derived` (high value, S). | **By-design, do NOT convert.** All 5 tabs stay mounted (`App.svelte:230` `{#each TAB_IDS}` + CSS `tab-active/inactive`); the `active` guard is what stops hidden feed tabs recomputing their 200-row chain on every IPC push. Plain `$derived` removes the gate → **regression**. | `App.svelte:230-253`, `ActivityFeed.svelte:21-29` |
| **NP-1** NetworkPanel list is "unbounded". | Capped at 500 in the store (`network.set(arr.slice(-500))`). Still > 200, so virtualization is valid — but not unbounded. | `ipc.ts:78` |
| **R-5** rAF "burns CPU at 60fps when minimized to tray". | `webPreferences` sets no `backgroundThrottling` → defaults `true`; Chromium throttles hidden-window rAF to ~1fps. Downgraded to low/defensive. | `main.js:167-174` |

## Healthy — no action

- **IPC main→renderer is already coalesced.** `scan-loop.js:188` emits a single `scan-batch` (agents+stats+resourceUsage+anomalyScores); `ipc.ts:61-68` applies all 4 store writes inside one `queueMicrotask` → one Svelte repaint, not four cascades. `file-access` (150ms append) and `stats-update` (1000ms latest) are batched via `ipc-batcher.js`.
- **Startup / first paint.** CLI fast-path before Electron import (`main.js:9`); heavy modules deferred via `loadDeferredModules()` after `ready-to-show` + `setImmediate` (`:398`); `show:false` + `backgroundColor:'#050507'` (no white flash); scans staggered 3s/8s/12s with a 60s warmup (`scan-loop.js:289`). Nothing heavy blocks first paint.
- **Heap / leaks.** Watchers closed on `quit` (`main.js:428`), batchers destroyed (`:425`), intervals cleared (`:409,427`); OOM-trim interval guards heap > 512 MB (`:333`); all hot maps bounded — `eventDedupMap` (`scan-loop.js:46-51`), `watcherDebounce` (`file-watcher.js:147-152`), `knownHandles` per-PID 500 + prune (`:278,331`), `activityLog` capped 10k (`:172`), events/network stores capped 500/500.

## Suggested order (if acted on later)

1. **P1** — derive deduped dot list reactively (recompute on `$enrichedAgents`, not per frame). Biggest real win.
2. **P2 / P5** — stable keys (needs a per-event id from main for P2).
3. **P3 / P4** — virtualize or cap the long lists.
4. **P6–P13** — low-effort polish; bundle opportunistically. **Do not touch RH-1.**
