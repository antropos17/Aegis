# AEGIS Architecture

## Main Process (src/main/) — 75 CommonJS modules (56 top-level + 17 platform/ + 2 token-adapters/)

Optional development ETW: main → platform/etw-file-runtime → etw-file-supervisor
→ normal `sidecar/etw-file` broker → authenticated elevated file collector.
Only the `etw-file` health leaf reaches app stats. Diagnostic observations stay
in bounded main memory and never become FileEvents. Packaged enablement is gated;
see [backend record](../docs/roadmap/etw-file-backend.md).

Core modules:
- main.js — orchestrator, module wiring, lifecycle
- scan-loop.js — periodic scan intervals, staggered startup, event dedup
- ipc-batcher.js — batches high-frequency IPC events (append/latest modes)
- ipc-handlers.js — all IPC handlers (invoke + listeners)
- preload.js — IPC bridge (window.aegis via contextBridge, 44 invoke + 10 events = 54 channels)
- process-scanner.js — bundled and validated custom signatures over platform process snapshots
- process-utils.js — parent chain resolution + editor annotation
- file-watcher.js — watcher health, main-thread attribution + handle scanning
- watch-worker-client.js / watch-worker-thread.js — dedicated chokidar worker per evidence watch group; close invalidates delivery before termination
- watch-event-queue.js — bounded, acknowledged worker delivery; counted drop-newest overflow reaches sensor health
- network-monitor.js — TCP scanning + DNS + domain classification
- rule-loader.js — YAML rule loading + categoryIndex (Map<category, rules[]>) exposed via getRulesByCategory(); built and tested, but no production caller consumes it yet (C-16)
- config-manager.js — validated atomic settings persistence, changed-field patch merging, encrypted key retention and permissions
- baselines.js — session tracking + rolling averages
- anomaly-detector.js — multi-dimensional anomaly scoring (network/fs/process/baseline)
- llm-runtime-detector.js — local LLM runtime detection (Ollama, LM Studio)
- scoring-utils.js — risk scoring utilities
- logger.js — structured logging
- cli.js — CLI interface (--scan-json, --version, --help)
- ai-analysis.js — Anthropic API threat analysis
- audit-logger.js — persistent JSONL audit trail (the canon; hash-chained per daily file)
- audit-index.js — `node:sqlite` projection of the audit JSONL, fed at flush time strictly after the line is on disk, capability-gated (`state: 'unavailable'` without the engine); never the source of truth, no hash columns (docs/roadmap/audit-index.md)
- audit-index-query.js — bounded timestamp-ordered history queries with bound type filters; audit-logger falls back to JSONL when the index is unavailable or fails
- audit-index-rebuild.js — rebuild/reconcile of the index from the daily files after `cleanOldLogs` on every init, resumed from `indexed_bytes`, ~2000-line transactions between `setImmediate` yields
- exports.js — JSON/CSV/HTML report export
- tray-icon.js — system tray with procedural icon

## Renderer (frontend/observatory/) — Svelte 5 + Vite 7
56 Svelte components, 16 stores, 22 utils. Component count refers to frontend/observatory/components; retained store/utility counts refer to src/renderer/lib.

App.svelte owns workspace tabs, history and the host connection. Monitoring groups products and exposes stamped instances for process actions; Events and ActivityChart show retained evidence; Details and EntityLinks connect observations; Rules, Catalog, Analysis, Reports, Statistics and Settings expose host actions. SensorStatus renders effective sensor IDs; Notifications tracks anomaly crossings.

runtime/host.ts owns seven telemetry subscriptions, revision-guarded seed results/errors, outage retention, source-specific receipt clocks and freshness updated after confirmed settings saves. runtime/resource-observations.ts merges sequence-ordered per-instance readings and suppresses cached numeric history points; statistics-history.ts preserves collection ranges and resets timelines on backwards wall-clock changes. Shared enrich-agents.ts preserves risk scoring and instance joins. Legacy stores and utility regression fixtures remain under src/renderer/lib, outside the packaged source list; the old UI, fonts and styles are removed.

styles.ts loads twelve approved template stylesheets in their original order, followed by radar-clarity, feedback, desktop, coherence, detail-layout and comfort refinements. reference/SOURCE.json records the template source hashes and stylesheet order. Preview uses demo/host.ts and the same components, with no real preload calls. Production excludes these fixtures.

## Shared (src/shared/)
- constants.js — ignore patterns, editor lists, AGENT_CONFIG_PATHS
- rules/*.yaml (repo root, NOT src/shared) — 73 active detection rules across 8 categories, the real source of truth
- src/main/rule-loader.js exports: getAllRules(), getRulesByCategory(category), getRuleById(id), reloadRules(), and loadRules aliased as _loadRules (test seam — not a public API)
- agent-database.json — 110 agents / 262 name signatures

## Key Patterns
- Main process: CommonJS (require/module.exports) with init() dependency injection
- Renderer: Svelte 5 runes ($state, $derived, $effect), ES modules via Vite
- IPC channels: kebab-case (scan-processes, file-access, network-update)
- CSS: preserve the approved template cascade in frontend/observatory/styles.ts; desktop integration uses styles/desktop.css and the template's existing variables
- Build: Vite compiles Svelte → dist/renderer/, Electron loads dist/renderer/index.html
