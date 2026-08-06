# DEFERRED — `utilityProcess` engine migration (Phase 5)

> **Status: DEFERRED to Phase 5. Motivation = ISOLATION / SELF-PROTECTION, NOT a freeze remedy.**
>
> **Windows + macOS measured fully-async on 2026-06-04** (read-only measure-gate, file:line —
> see `progress.md` "Phase 2 measure-gate" and `AEGIS-MASTER-PLAN.md` §4 Tier 0). Every
> collector on the shipping desktop targets is `execFile`+Promise with zero event-loop blocks;
> a `utilityProcess` offloads CPU-bound work and does **not** speed up async I/O, and **no
> CPU-bound tick exists** to offload. Per Electron docs a separate process is a last-resort.
> **Therefore this migration is NOT needed as a cure for UI freezes.**
>
> **The architecture below is valid and stays as-is — only the MOTIVATION changes** from
> "fix freezes" to **process isolation / self-protection**: the monitoring engine surviving a
> renderer crash, and a hardened process boundary around the code that watches
> `.ssh` / `.aws` / `.env` (master-plan §5 "Self-protection", §8 "ступенька к sidecar").
>
> **Re-open trigger:** only a *measured* CPU-bound Windows scan tick (via the
> `feat/scan-timing-instrumentation` PR — Tier 0 #1) would re-motivate this as a perf change.
> Absent that, pursue it for isolation when Phase 5 (native sidecar) begins.

---

## Context (why this plan exists)

AEGIS runs its entire monitoring engine on the Electron **main** process: `tasklist`,
`handle.exe`/PowerShell file-handle scans, `Get-NetTCPConnection`, parent-chain enrichment,
chokidar, regex classification over ~73 rules, and baseline/anomaly math. Moving that engine
into a `utilityProcess` (which streams batched messages over a `MessagePort`) isolates it from
the main thread and the window. It cannot land as one PR (breaks "one PR ≤300 lines, green by
itself"), so it is sliced into 5 in-process, 0-behavior-change prep PRs followed by one
behavior-changing fork PR.

## Boundary map (validated against the code)

- **Only `baselines.js`** among engine-candidate modules imports Electron (`app.getPath` for
  `baselines.json`). `grep require('electron')` → 8 files total; the rest of the engine
  (process-scanner, file-watcher, network-monitor, anomaly-detector, scan-loop, process-utils,
  session-tracker, ide/wsl/llm detectors, scoring-utils, rule-loader, logger) is pure Node and
  portable once `baselines` is de-Electron'd.
- **Keystone (recon missed it):** `scan-loop`'s `doProcessScan`/`doFileScan` call main-only
  Electron APIs **inline every tick** — `tray.updateTrayIcon()`, `tray.notifySensitive()`
  (`Tray`/`Notification`), `sendToRenderer()` + the two batchers (`webContents.send`), and
  `audit.log()`. These must be lifted into **injected sinks** before the engine can move.
- **Central decision — `activityLog` stays MAIN-owned** (overturns the recon's PR-B "engine
  owns the log" hypothesis): every full-log reader (`exports`, `ai-analysis`, `export-zip`,
  the OOM-trim loop) is main-side; every frequent reader needs only two integers
  (`log.length`, sensitive-count) folded into the scan-batch snapshot; nothing inside the
  engine reads the raw log (`baselines.recordFileAccess` consumes aggregates). The engine
  emits the **pre-dedup** event stream and **`dedupFileEvent` runs main-side** (today the log
  holds pre-dedup events; dedup gates only the renderer/audit/notify paths — keeping that
  faithful requires dedup in main).
- **PR-D ("12 sync IPC → async") DISSOLVES:** with the log + agent mirrors + last-tick anomaly
  scores cached in main, `get-stats`/`export-*`/`analyze-*`/`get-resource-usage` read main
  caches — ~zero need a round-trip. What remains is a few **main→engine control messages**
  (settings-apply, pause/resume, rules-reload, finalize-on-quit).

## PR slicing (merge order)

PRs A–E are **in-process, 0-behavior-change**; **PR-F** is the single fork that flips the
switch. The renderer (`preload.js` surface + `scan-batch` shape
`{agents, stats, resourceUsage, anomalyScores}`) is **untouched in every PR**.

| PR | Goal | Key files | Behavior change | Size |
|----|------|-----------|-----------------|------|
| **A** | De-Electron `baselines` — `init({userDataPath})` injection (generalize `_setBaselinesPathForTest`); whole engine set becomes Electron-free | `baselines.js`, `main.js`, `baselines.test.js` | none | ~50 |
| **B** | `activityLog` → MAIN-owned; dedup moves main-side. `file-watcher` stops touching the log, calls injected `onRawFileEvent`; new `engine-host.js` (main) owns append/counters/OOM-trim/`dedupFileEvent`+`eventDedupMap`; `getStats`/`exports`/`export-zip`/`ai-analysis`/`tray` read the host's log | `file-watcher.js`, `scan-loop.js`, `main.js`, new `engine-host.js`, `ipc-handlers.js` | none | ~220–260 (indivisible: log-ownership + dedup are one seam) |
| **C** | Lift `scan-loop` side-effects into injected sinks (`emitScanBatch`/`emitFileEvents`/`emitNetwork`/`emitDeviations`/`emitScanStatus`/`emitSessions`); host wires sinks → tray + `audit.log` + batchers + renderer; scan-batch carries the full stat snapshot (`peakAgents`/`uniqueAgents`/`monitoringStarted`/`permissionDeniedScans`/`resourceUsage`); `getStats` reads main's cache | `scan-loop.js`, `engine-host.js`, `main.js`, `scan-loop.test.js` | none | ~240–280 |
| **D** | Main→engine control channel (`engineControl.applySettings(subset)` restarts intervals + rebuilds watchers + **recompiles custom RegExp engine-side from `customSensitivePatterns`**, `setPaused`, `reloadRules`); `config.applyCallback` + tray pause toggle route through it; `rules:reload` made bidirectional | `config-manager` callsite, `scan-loop.js`, `file-watcher.js`, `engine-host.js`, `ipc-handlers.js` | none | ~120–160 |
| **E** | Formalize the bridge as an in-process `postMessage`-shaped protocol (`{type, payload}`) via an `EventEmitter` pair standing in for the future `MessagePort`; validate every payload is structured-clone-safe (no functions/class instances) | new `engine/protocol.js`, `engine-host.js`, new `engine/engine-entry.js`, `engine-protocol.test.js` | none | ~150–200 |
| **F** | **The fork.** `utilityProcess.fork(engineEntry)` in `initDeferredSubsystems`; `MessageChannelMain` host↔engine; crash/respawn w/ backoff; async before-quit; `getResourceUsage` reports the engine process; `get-agent-database` reads JSON directly (not `scanner.agentDb`) | `main.js`, `engine-entry.js`, electron-builder bundling, `ipc-handlers.js` | **YES (the switch)** | ~350–450, indivisible & justified |

## Resolved open questions (carry forward)

- **`getResourceUsage`** → the **engine** process's `memoryUsage`/`cpuUsage` (posted in
  scan-batch); the footer's semantic becomes "engine cost." Optional 2nd main-side field.
- **Batchers** → engine emits raw, **MAIN batches** (forced: `fileAccessBatcher`/
  `statsUpdateBatcher` call `webContents.send`; `statsUpdateBatcher` pushes main-side
  `getStats()`).
- **`ai-analysis`** → stays **MAIN** (needs the decrypted key via `safeStorage`, main-only;
  all other inputs are main caches/mirrors + last-tick scores; the straddle dissolves).
- **config apply** → send the settings subset; **recompile custom RegExp engine-side** (do
  NOT rely on `RegExp` structured-clone).

## Correctness landmines (each blocks if missed)

- **Async before-quit:** today's `before-quit` is synchronous. Must `e.preventDefault()` →
  message engine to `finalizeSession` (save `baselines.json`) + flush → await ack/timeout →
  kill child → `audit.shutdown` (main) → `app.quit()`. Failure mode = baselines lost on quit.
- **`rules:reload` is bidirectional:** the `rules:reload` IPC (main) must propagate INTO the
  engine (else `classifySensitive` uses stale rules); the engine's chokidar rules-watcher must
  propagate BACK to main → `sendToRenderer('rules:reloaded')`.
- **Crash / respawn:** on child `exit`, respawn with backoff (cap N), re-init with current
  settings + pause-state; on exhaustion push `monitoring-degraded` to renderer + tray red.
  Note current-session `sessionData` / `deviationWarningsSent` / `knownHandles` are lost
  (`baselines.json` reloads from disk) — acceptable, documented.

## Verification

- **PR-A…E:** `npm test` (each moved/added regression test green + falsifiable),
  `npm run build:renderer`, `npm run lint`, `npx tsc --noEmit` — full CI gate
  `[audit, build, lint, svelte-check, test]` green, **no behavior change** (renderer + IPC
  identical).
- **PR-F (can't fork a `utilityProcess` in Vitest):** PR-E in-process protocol tests
  (contract) + the **Playwright `_electron` harness** (memory:
  `playwright-electron-renderer-verify`) as the real-boundary smoke test — app boots,
  renderer still receives `scan-batch`, a scan no longer blocks the window; quit saves
  `baselines.json`; a killed engine respawns and resumes streaming.

## Forward note

`activityLog`-in-main optimizes for minimal churn now and is the *opposite* of the eventual
sidecar boundary (where the engine becomes source-of-truth). That is the right trade for this
migration; revisit log ownership when the Phase 5 native sidecar makes the engine canonical.
