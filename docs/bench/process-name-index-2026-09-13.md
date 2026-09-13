# Process-name lookup index — 2026-09-13

`process-scanner.js` builds a lowercase name-to-agent map once per scan. Previously
each observed process traversed the catalog and normalized candidate patterns.
The map preserves first ownership, bundled precedence, custom-ID validation,
exact case-insensitive matches, exclusions and first detected PID ordering.
It is rebuilt after each fresh provider observation, including in-place catalog
edits. Process observation, scan cadence and session identity are unchanged.

## Controlled measurement

Run from the repository root with an unused output filename:

```powershell
node scripts/bench-process-matching.cjs --baseline=607faa2efd6f5cb79ac208b13f47f1bd89246f86 --report=X:/tmp/process-name-index.json
```

The script loads the actual baseline and current scanner into separate CommonJS
instances with the current dependencies. Both use the same deterministic process
provider and bundled/custom catalog. After 20 warm-up scans per arm, 30 interleaved
samples each contain five complete scanner calls. It checks equal results, unchanged
input rows and exactly 150 measured provider calls per arm. It never invokes OS
enumeration, monitoring timers or UAC. Only use trusted baseline commits.

Windows x64, Node v24.11.1; elapsed milliseconds per scan:

| Processes | Detected agents | Previous median | Indexed median | Previous p95 | Indexed p95 |
| --- | --- | --- | --- | --- | --- |
| 128 | 8 | 0.60422 | 0.09428 | 1.15956 | 0.15674 |
| 512 | 32 | 2.21670 | 0.26592 | 2.50812 | 0.39926 |
| 2,048 | 128 | 8.88254 | 0.78510 | 12.23326 | 1.12730 |

Raw samples are summarized with CPU counters and source/input hashes in
[the report](process-name-index-2026-09-13.json). Timing has no pass/fail threshold.
These results cover JavaScript matching and scanner bookkeeping over a stubbed
provider. They do not establish total application CPU savings, OS query latency
or live ETW throughput. The script compares scanner source, not complete historical
dependency trees.

## Regression coverage

The normalization-work regression failed on the baseline: 1,000 unrelated
processes caused 1,000 normalizations of the sentinel catalog pattern, against
a limit of 12 derived from the ten-process fixture. The index makes this work
independent of process count. Other tests cover name conflicts, exclusions,
duplicate PIDs, immediate catalog edits, process arrivals/exits and fresh shared
maps. An unavailable observation remains unreliable; a valid snapshot containing
only ordinary processes confirms an empty agent fleet.
