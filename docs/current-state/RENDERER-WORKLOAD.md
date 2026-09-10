# Renderer workload — 10 September 2026

Profiling identified repeated instance-risk enrichment across components, deep Svelte proxy enumeration of delivered snapshots, and repeated Intl.DateTimeFormat construction for chart labels. The change shares assessments within a snapshot, uses raw reactive references for immutable telemetry/history, and reuses the two clock formats. Settings and other editable drafts retain deep reactivity.

A new host delivery still updates consumers. Assessment source-reference replacement invalidates the cache even when a wrapper is reused. PID reuse and captured-vs-current risk remain distinct. A held snapshot retains its assessment; a new delivery recomputes age decay. The weak-key cache does not keep old snapshots alive. Clock formatters refresh every minute and after backwards clock changes.

## Identical-input comparison

Baseline renderer: packaged PR #421, commit `51ac7fb382526b49e18b3a137defd976780755bd`. Candidate: this change. Both run in the same installed Playwright Chromium, headless, 1440×1000, en-US/UTC, dark theme, full motion. The harness injects a synthetic desktop bridge with 49 process instances, four agent products, 500 file observations and 49 sockets. Five warmup deliveries precede 120 measured ordered deliveries. Timestamps, input values and navigation are identical. This is a renderer workload, not live sensor accuracy or whole-application CPU.

| Measurement | Before | After |
| --- | ---: | ---: |
| Renderer task time, 120 deliveries | 10,328 ms | 1,062 ms |
| JavaScript execution time | 9,291 ms | 768 ms |
| Live JS heap after first workspace round and GC | 7.86 MiB | 4.89 MiB |
| Live JS heap after fourth round and GC | 7.91 MiB | 4.94 MiB |
| Attached DOM elements after navigation | 1,746 | 1,746 |
| Page errors | 0 | 0 |

Task time fell about 90%; retained JS heap in this fixture fell about 38%. TaskDuration and ScriptDuration are CDP cumulative execution counters, not user click latency. Heap numbers follow explicit GC in the disposable browser, not forced collection in production. These figures do not claim the installed application's total RAM fell by the same amount, prove absence of a long-session leak, or identify the earlier GPU allocation growth.

Visible summary values match exactly, including four products / 49 processes, risk 12, 500 retained observations / 50 sensitive, 49 unverified endpoints, and unavailable tokens with 0/49 coverage. The radar and layout screenshots were inspected; motion remains enabled. Four repeated tours cover Agents, Events, Network, Statistics and Monitoring.

Earlier live Electron profiles with 20 temporary loopback processes also identified enrichment, proxy traps and date formatting as hot paths. Their view states diverged, so their large timing difference is not used for the numeric before/after claim above.

## Reproduction

Build the desktop renderer with `npm run build:renderer`. To compare two versions, preserve their respective `dist/renderer` directories and run these sequentially from the current checkout:

```sh
node frontend/observatory/tests/renderer-workload.mjs <baseline-renderer-directory> before
node frontend/observatory/tests/renderer-workload.mjs dist/renderer after
```

The harness serves only the selected directory on an ephemeral loopback port, injects its fixture in a disposable browser and writes numeric JSON plus screenshots under ignored `dist/renderer-workload/`. It does not alter settings, start monitored processes, read user transcripts, or call a model provider. The fixture is confined to test tooling and is not imported by the desktop renderer.

Regression coverage includes held/new assessments, evidence replacement within a reused wrapper, PID reuse, bounded formatter creation and default-zone refresh. Existing App, scope, graph and departed-history regressions cover delivery updates and retention. Required repository and isolated Electron checks accompany the change.
