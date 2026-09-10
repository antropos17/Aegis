# Backend collection efficiency — 2026-09-10

Resource sampling now permits one in-flight CPU/RAM/GPU collection per scan loop.
Process batches continue while the collector is busy. Busy ticks skip the resource
sample; the next idle tick supplies fresh PID/instance pairs. No backlog of aging
process snapshots is retained. Stopping intervals or reinjecting dependencies
invalidates late results; an already-running process scan cannot start a resource
query after the stop. The OS query itself finishes under the existing provider
timeouts. Under sustained slow collection, resource updates can therefore be less
frequent than process updates.

Token collection retains each process's agent family. Adapters can declare exact
scanner display names in `agentNames`; Claude Code opts in. Known other families
no longer trigger Claude session-registry reads. Unlabelled legacy callers and
adapters without a family restriction retain the previous behavior. Birth-time
validation, transcript offsets, message deduplication and instance accounting are
unchanged.

## Reproduce the operation counts

Run `node bench/collection-efficiency.js`. The fixture uses injected providers,
100 synthetic processes (two Claude Code), missing session-registry files and
20 requests issued while resource collection is blocked. It reads no user logs.

| Operation | Previous behavior | Current behavior |
| --- | ---: | ---: |
| Claude registry read attempts for the mixed batch | 100 | 2 |
| Resource provider calls during the blocked burst | 20 | 1 |
| Peak concurrent resource provider calls | 20 | 1 |

These are operation counts for controlled fixtures, not a measurement of total
application CPU, memory or latency. Normal scan cadence may already avoid overlap.
The work does not change process enumeration, network/DNS collection, file sensing,
or make transcript parsing asynchronous.

Regression coverage exercises busy ticks, fresh identities after PID reuse,
unstamped PIDs, synchronous/asynchronous provider errors, pause/resume, late process
scans, continued process delivery and mixed-family token accounting.
