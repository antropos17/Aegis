# Linux SELF CPU API reference

This opt-in driver corroborates the calling Node process's aggregate CPU API
units against fixed `/proc/self/stat` observations under a declared floor model.
It does not qualify product/cohort footprint, instrumentation overhead, RSS,
clock accuracy, calibration or W8 acceptance. `sourceAuthenticated`,
`measurementAccepted`, `calibrationAccepted` and `w8Accepted` remain false.

```sh
node bench/linux-own-cpu-qualify.cjs --run-id cpu-self-1 --out <new-owned-directory>
```

The two flags are mandatory. No caller PID, command, proc path, workload,
duration, tolerance or platform override is accepted by the CLI. The exported
`runLinuxOwnCpuReference({runId,out,signal?}, deps?)` accepts a genuine optional
AbortSignal and a closed test seam. Input accessors, nonordinary prototypes,
extra keys and nonfunction dependencies refuse before any IO or preflight.
Windows and other unsupported platforms return 7 before getconf or observation.

## Fixed acquisition and sources

The unchanged sampler runs two scheduled points over 2000 ms. Its CPU seam reads
SELF proc counters, calls `process.cpuUsage()` without a previous value, then
reads SELF proc counters again. The sampler retains its original format and
`readingMode:'injected'`: wrapping an API is still instrumentation. The separate
`collectionMode` distinguishes `linux-own-defaults` from `injected-test-seams`.
Mandatory sampler RSS readings remain raw data with `rssAssessment:'not-qualified'`;
no RSS corroboration or monotonicity assumption is introduced.

Node documents current-process user/system values in microseconds, including
CPU work across cores. See [Node 24.20 process.cpuUsage](https://nodejs.org/download/release/v24.20.0/docs/api/process.html#processcpuusagepreviousvalue).
The reference parses fields 14, 15 and 22 (user/system/start ticks), using the last
closing parenthesis because the private comm field can contain spaces and
parentheses. PID is checked internally against the current process and discarded.
Selected unsigned counters retain exact decimal BigInt strings. See
[proc_pid_stat](https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html).

Only `/proc/self/stat` is opened, read-only with NOFOLLOW where supported. A
regular descriptor, a 16 KiB cap plus growth sentinel, legitimate short-read
looping and successful closure are required. Proc `st_size:0` and changing stat
metadata are normal; artifact-file stability assumptions are not applied to this
pseudofile. Raw proc text, PID, comm and filesystem errors are not published.
Retained selected fields include exact input hash/length and acquisition brackets.
`closed:true` is supplied by the fixed default reader's return-after-close
contract; an arbitrary injected reader has `closed:null` and no native closure
authority. Pure parsing alone makes no descriptor-closure claim.

CLK_TCK is discovered before observation using only `/usr/bin/getconf ['CLK_TCK']`,
with a 1000 ms timeout, 128-byte output cap and minimal `LC_ALL=C` environment.
There is no shell, caller command, inherited preload environment or 100 Hz
fallback. Noncanonical, high-bit, zero and unsupported values refuse. The model
requires the discovered positive integer to divide 1000000000 exactly.

The pinned Linux v6.14 implementation converts user/system values separately in
[fs/proc/array.c](https://github.com/torvalds/linux/blob/v6.14/fs/proc/array.c), and
[nsec_to_clock_t](https://github.com/torvalds/linux/blob/v6.14/kernel/time/time.c)
uses integer division for the divisible USER_HZ branch. Other branches can use
approximations, so no guessed epsilon extends this model to them. Actual kernel
release, architecture and Node version are separately retained. These metadata
do not establish that a running kernel implements the pinned source;
`kernelModelQualified:false` remains explicit. General proc context is in
[the Linux v6.14 proc documentation](https://www.kernel.org/doc/html/v6.14/filesystems/proc.html).

## Declared exact enclosure

Let `H` be discovered ticks/second, `B` and `A` the aggregate user+system ticks
before/after an API read, and `U` the API aggregate microseconds. Separately
floored tick fields require two tick quanta. The API components can each truncate
one microsecond. Proposed endpoint intervals are:

```text
API:       [U, U+2) microseconds
reference: [B*1000000/H, (A+2)*1000000/H) microseconds
```

They must overlap strictly at the upper boundaries. BigInt cross-products are
used; no floating percentage, midpoint, epsilon or tuned tolerance is emitted.
User/system counters must each be monotone within/across both records, and all
four proc reads must retain the same nonzero start ticks. Start ticks are an
opaque same-instance check, without cached birth authority or a clock-offset
conversion. Every retained monotonic bracket must remain ordered.

For baseline 0 and post-work 1, reference delta bounds are
`[max(0,B1-A0-2)*1000000/H, (A1+2-B0)*1000000/H)`. The API delta enclosure is
`[max(0,U1-U0-2), U1-U0+2)`. Thus both acquisition endpoints contribute uncertainty.
Exact rational numerators/denominators are retained. Sufficient resolution requires
the reference delta lower numerator to be strictly greater than `4*H`, plus
positive API progress. This follows the two-endpoint API allowance and avoids a
machine-tuned tick threshold. Zero or unresolved progress is an explicit nonpass.
The pure `evaluateCpuReference({clockTicksPerSecond,windows})` can re-evaluate
retained observations without collecting again.

## Fixed inert work and retention

One synchronous LCG32 burst follows the first proc/API/proc bracket, before that
sampler CPU wrapper returns. Constants are multiplier 1664525, increment
1013904223, seed 1 and 67108864 iterations. Chunks of 65536 iterations check the
monotonic soft 2-second budget and already-observed cancellation. Actual count,
32-bit checksum and completed/partial outcome are retained. The CI checksum oracle
uses independent BigInt affine jumping. No CPU API is called inside the work loop.

The outer sampler CPU bracket includes instrumentation and work. It must not be
read as native API latency or overhead. Signal handlers cannot preempt synchronous
work; chunk checks do not create a hard wall deadline or guarantee delivery of a
queued signal during the burst. A budget/clock/cancellation stop or missing second
point preserves partial evidence and cannot pass. The end-exclusive sampler adds
no closing point or invented tail.

The fresh ordinary local directory contains five fixed artifacts:

| File | Maximum bytes |
| --- | ---: |
| `cpu-reference-plan.json` | 16384 |
| `cpu-reference-pending.json` | 4096 |
| `raw-samples.json` | 16385 |
| `cpu-reference-windows.json` | 32768 |
| `cpu-reference-final.json` | 16384 |

Total driver writes are capped at 128 KiB. The plan/model/source inventory and
pending declaration are closed before observation. Raw sampler bytes are retained
before the reference-window artifact. Plan/raw/window hashes bind exact serialized
bytes, including newlines. A fixed eight-module disk inventory, read with bounded
stable BigInt descriptor checks and confirmed close, is compared at endpoints.
It fingerprints disk bytes, without authenticating loaded code or ruling out
intermediate source changes. Fresh exclusive artifact writes confirm close before
attesting hashes; partial or competing files are preserved and never overwritten.
Output parents and ancestors must be ordinary local caller-owned directories;
UNC/reparse paths refuse. There is no adversarial containment or pruning policy.

The final receipt lists only confirmed predecessor files and has
`finalPublication:'not-self-attested'`. A parseable final file can accompany exit
6; publication requires the CLI/module result together with validation of the
retained bundle. Raw proc/getconf output, private errors, PID/comm and caller paths
never enter a public receipt. Fixed source/API labels remain explicit.

| Exit | Meaning |
| --- | --- |
| 0 | Conditional model agreement, sufficient progress, complete fixed work and clean complete sampler acquisition, unchanged sources, own final close confirmed |
| 2 | Invalid caller options |
| 3 | Incomplete/cancelled observation or work, unavailable reading or insufficient resolution |
| 4 | Identity/counter/clock/model refusal |
| 5 | Fresh output refused |
| 6 | Partial bundle or artifact/publication failure |
| 7 | Unsupported platform, preflight/quantization model unavailable, or changed/unavailable sources |

Persistence failure dominates source refusal, then model refusal, then incomplete
evidence. Unsupported/preflight failures can return before any bundle exists.
CI includes a real Linux subprocess, retained exact arithmetic and scaled-unit
negative controls, independent checksum verification, parser/IO limits and failure
fixtures. Local tests, native preflight, workload and captures were intentionally
deferred under the active host resource constraint. Authored tests are not
executed evidence, and corroboration supplies no absolute physical accuracy or
measurement acceptance.
