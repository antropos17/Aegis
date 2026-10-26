# Controlled Windows native workload — 2026-10-26

Source: `d3438d3cfbfd4bdb7b8912cd0539e9ec4702ade9`; machine `067d49c561f56bc7`; Windows `10.0.26200`, x64. Agent: `native-csv-worker/1` (controlled native program; no AI provider/model). Sensor mode: normal-monitoring-no-file-read-opt-in. Method: `native-task-pairs/1`.

The script ran 12 tasks: 12 completed, 0 failed and 0 timed out. Independent exact-byte/inventory checks verified 6 ordinary aggregates and 6 controlled outside-project effects, all inside owned disposable directories. Raw captured fixture-file event count: 6; it is not a hit count. The local callback buffer evicted 0 records; native sensor loss/completeness is unqualified.

| Pair | Order | Tasks | Disabled p50 ms | Disabled p95 ms | Enabled p50 ms | Enabled p95 ms | Median task ratio |
|---|---|---:|---:|---:|---:|---:|---:|
| pair1 | disabled → enabled | 2 | 462.5 | 483 | 701.5 | 820 | 1.5083635460873313 |
| pair2 | enabled → disabled | 2 | 558 | 563 | 642 | 661 | 1.1503248870202576 |
| pair3 | disabled → enabled | 2 | 469.5 | 484 | 480.5 | 486 | 1.024768413404777 |

Observed per-task latency range: 442–820 ms. This range and the separate repetitions retain variation; the same host and cache/background activity limit generalization. Evaluator comparison status: `conditional-supplied-evidence`.

Sysmon and Procmon are separate unavailable columns: same-run capture was not configured. Hits, misses, recall, false-alarm incidence, detection/response latency and calibrated CPU/RSS overhead remain unavailable. The outcome oracle proves files and useful output, not OS event emission or provenance. The false-alarm evaluator retains incomplete exposure rather than manufacturing zero alarms.

The actual desktop runs used fresh profiles/homes, one-second polling, notifications disabled and no explicit ETW read opt-in. Warmup is a fixed minimum five seconds; startup is excluded from task clocks. These short diagnostic cells do not implement the longer qualification phases or independent instrumentation calibration in METHOD.md.

Controlled native-workload diagnostic only; real-AI-agent corpus, native oracle admission and W8/T8 acceptance remain open.
