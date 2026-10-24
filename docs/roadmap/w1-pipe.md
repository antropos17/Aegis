# W1-pipe: bounded security-event delivery

This work addresses [completion baseline Q1](completion-baseline.md) and the
W1-pipe block in [the completion plan](completion-plan.md). It starts from
master `a02ae67f989fcbe7e2aea5905486f64860a79f29`. W1a's wire contract, Rust
workspace, W1b's sensor host and native sensor qualification are separate work.

## Delivery contract

The production batcher has a security-event lane for sensitive file access,
new agent instances and outbound agent connections. Live detection consumes
the original observation. Disk replay delivers historical audit records and
does not rerun sequence detection, process attribution or risk decisions.

The lane admits a closed snapshot of approved metadata. It retains observation
time, PID, instance identity and attribution from the observation. It excludes
generic objects, command arguments, environment values, prompt text, file
contents and raw exception messages. Paths and endpoints remain sensitive
metadata subject to the existing local audit access boundary.

Each fixed sensor bucket has record and serialized-byte limits, high-water
marks and counters. Overflow uses a quota-managed store under
`userData/event-spill`. Startup replay precedes fresh admission. Only a
successful canonical JSONL append and file synchronization acknowledges a
security batch; renderer delivery and SQLite indexing do not acknowledge it.

| Production limit | Value |
| --- | ---: |
| Sensor buckets | Five fixed buckets |
| RAM records per bucket | 512 |
| Serialized RAM bytes per bucket | 1 MiB |
| Maximum projected record | 64 KiB |
| Spill directory bytes, including metadata and quarantine | 32 MiB |
| Spill directory entries | 1,024 |
| Display file-event records / serialized bytes | 1,000 / 1 MiB |

When spill cannot accept overflow, the existing RAM queue keeps custody and the
new incoming observation is rejected with counted loss. Graceful shutdown tries
delivery and spill before counting any remaining RAM it cannot persist. The
quota reserves space for bounded loss-ledger replacement.

Spilled records have stable delivery IDs. A crash after audit persistence and
before spill removal can produce another historical audit record with the same
ID. Delivery is at least once across that crash window. Consumers must not
interpret replay as a newly observed action or a newly attributed process.
Within a running process, a successful acknowledgement switches retries to
bookkeeping only; a failed segment deletion or ledger clear does not repeatedly
append the acknowledged data to audit.

Fixed-code loss bookkeeping lives outside the event queue. Known dropped
records carry a count and original time range; damaged metadata with an unknown
record count remains distinguishable. Storage failure degrades event-delivery
health. A permanently unwritable disk followed by abrupt process termination
cannot preserve an exact durable marker for volatile records or counters.

Startup-replay, projection and bucket-size rejections checkpoint their fixed-code
loss summaries before returning when the loss store accepts the replacement.
A failed checkpoint leaves `markerDurable: false` and retains the summary in
memory for a later checkpoint or flush. Rejected observation paths and contents
do not enter the ledger. Ordinary accepted pushes add no loss-ledger synchronization.
Each rejection checkpoint uses synchronous write, file synchronization and rename;
a rejection burst can therefore delay the main loop.

Spill checksums detect accidental corruption; they do not authenticate data
against another process running as the same user. Directory/file checks reject
links and unexpected storage entries and bound discovery and reads. Windows
privacy depends on inherited user-data permissions; POSIX mode bits do not
establish a Windows ACL. The restart tests model process interruption, without
claiming recovery from every filesystem or power-loss failure.

The renderer's file-event batcher retains its existing coalescing and priority
policy and gains a serialized-byte limit. Metrics retain their latest-only
policy. Display evictions and security-delivery losses are separate counters.

## Verification scope

The immediate-restart regression cases reopen the real spill directory before the
interrupted batcher can flush or destroy itself. They check exact counts, original
timestamp bounds, stable marker IDs, retained history and exclusion of rejected
observations. Rename-failure cases check non-durable memory custody followed by
an explicit successful retry. Separate bounded API controls exercised write and
file-synchronization failures while preserving the previous committed ledger.

A diagnostic Windows run on 2026-10-24 timed only 100 invalid-record `push` calls
through the real batcher and local spill store, with a refusing consumer and a
60-second flush interval. The initial and final batcher operations were excluded.
The three-checkpoint version took 287 ms in total (median 2.79 ms, p95 4.16 ms,
maximum 5.14 ms); the prior memory-only path took 0.53 ms in total and left its
marker non-durable. This small in-process diagnostic does not qualify Electron
responsiveness, rejection throughput on other storage, or the full load target.
The earlier load receipt below remains a dated qualification of its recorded inputs.

The [load method](../bench/w1-pipe-method.md) runs synthetic observations through
the real batcher and spill store with an independent delivery oracle. Its
consumer models synchronous acknowledgement. It measures this isolated Node
process; it does not establish native sensor recall, audit/index throughput or
the Electron application's memory budget.

Focused runtime tests cover the real audit acknowledgement and fault paths.
Writer-run negative controls must demonstrate that removing spill or relevant
assertions makes the qualification fail. Independent reviewers assess storage
safety, test quality and documentation against the final revision.

## Recorded qualification

Qualification candidate: `b3b546387f763721d27f6fc5788c3f03bfe03fee`, Windows x64,
Node 24.20.0, Intel Core Ultra 9 185H. The
[portable load receipt](../bench/w1-pipe-20261019.json) preserves the complete
measurements, source/harness hashes, scheduling histogram and configured bounds.

| Workload | Delivered / replayed | Offering duration | Actual offered rate | Sampled heap peak | Physical spill peak |
| --- | ---: | ---: | ---: | ---: | ---: |
| 20,000/s requested for 30 seconds | 600,000 / 488,960 | 30,010.599 ms | 19,992.936/s | 79,445,272 B | 3,435,188 B |
| 2,000/s requested for five seconds | 10,000 / 2,560 | 5,009.532 ms | 1,996.194/s | 68,280,320 B | 853,677 B |

Both workloads had zero loss, duplicate or skipped observations, preserved
global order and payload identity, recovered healthy delivery and drained to
zero spill files/bytes. Maximum scheduler lateness was 126.097 / 20.998 ms;
the respective final drains took 3.136 / 0.516 ms.
Passing uses the method's explicit 98% average-rate threshold; these measured
rates are the supported claim. Sampled maxima do not establish every transient
allocation or an application-wide budget.

The receipt used the integration checkout's harness and runtime. Source and
harness hashes matched before and after the run. The final drain clock includes
the initial synchronous flush, subsequent polling and the final sample; passing
requires that whole interval to remain within five seconds. Later changes record
documentation and the receipt, and align existing IPC-statistics and trace-mutation
tests with the added lane and ingress ordering. Production runtime stays unchanged.

The restored focused suite passed **424 tests with four platform skips across
eight files**. It covers the actual watcher/main/scan-loop ingress, original
file/process/network metadata, display byte policies, disk privacy, restart
ordering, quota/ENOSPC conservation, corrupted-segment continuation, durable
loss checkpoints, immutable marker generations, partial audit writes, failed
rollback and complete JSON missing its final newline. Twenty repeated cleanup
failures produce one delivery per acknowledged batch/marker and bounded fault
reporting in the same process; separate restart tests preserve the at-least-once
boundary.

The existing IPC-statistics and orchestration-drift files also pass all 15 tests.
Their copied-source dropped-step control still fails the declared sequence
comparison. This verifies the static orchestration contract, not live execution.

The writer ran these fourteen controls; each failed through an assertion and
the original source bytes were restored and hash-verified:

| Removed or broken protection | Result |
| --- | --- |
| Spill append; privacy allowlist | Both killed |
| Corruption checkpoint; immutable loss generation | Both killed |
| Display byte eviction; sensitive admission; watcher bypass | All three killed |
| Audit fsync; legacy chain invalidation; final-newline validation | All three killed |
| Preserve-old/reject-new RAM custody | Killed |
| Segment ACK memory; deletion-fault coalescing; marker ACK memory | All three killed |

The independent oracle's ordering-check removal was also killed. The unchanged
load harness rejected an isolated production copy with spill disabled through
`admission-required: false !== true`. The copy was restored and removed; original
source hashes remained unchanged. The initial missing-API test failure was a
setup failure and is not counted as behavioral RED evidence.

Independent security and test-quality reviewers accepted this runtime candidate
after the fault fixes. They inspected source, assertions and recorded mutation
results; they did not run the mutations themselves. Required hosted CI and the
merged-master result are recorded in GitHub and the external completion tracker
before the workstream is marked complete.

Local evidence root: `X:/tmp/aegis-w1-pipe-20261019/`. Retain these receipts:

- `qualification/event-pipeline-qLue3d/receipt.json` (copied to the portable receipt).
- `qualification/no-spill-control-W9CsHR/mutation-receipt.json`.
- `qualification/oracle-mutant-bg2ivJ/mutation-receipt.json`.
- `reports/pipeline-final-restored-v3.json` and `reports/pipeline-mutations.json`.
- `reports/ci989-regressions-restored.json` and `reports/ci989-drift-mutation.json`.

The local checks used an isolated worktree and its own `npm ci` dependencies.
Rust was not installed. The original dirty checkout, lockfile, workflows and
Codex configuration were preserved. Full-suite gates run in hosted CI; local
diagnostics use bounded files on X:. A transient C: free-space drop recovered
without cleanup, and its precise allocation source remains unconfirmed.
