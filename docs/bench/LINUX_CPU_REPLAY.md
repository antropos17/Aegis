# Offline Linux SELF CPU replay

`node bench/linux-cpu-replay.cjs --input DIR --out NEWDIR` validates the fixed
five-file [Linux SELF CPU reference](LINUX_OWN_CPU_REFERENCE.md) bundle and
recomputes its complete comparison using the current `evaluateCpuReference`.
It reads fixed files only. It does not collect, run getconf, sample a process,
execute the inert workload, load historical code or supply an external oracle.

The module exports `replayLinuxCpu({input,out}) -> Promise<{exitCode,report}>`.
Options must be an ordinary closed data object with two enumerable string data
properties. Accessors, extra keys, linked directories, root/UNC input paths and
overlapping input/output paths refuse. Both directories belong to the caller and
must be non-adversarial; these checks provide no filesystem containment guarantee.

## Fixed input and checks

| File | Byte cap |
| --- | ---: |
| `cpu-reference-plan.json` | 16384 |
| `cpu-reference-pending.json` | 4096 |
| `raw-samples.json` | 16385 |
| `cpu-reference-windows.json` | 32768 |
| `cpu-reference-final.json` | 16384 |

The aggregate cap is 131072 bytes. Only ENOENT at a fixed filename is missing
evidence. Unsafe/unreadable files refuse. The reader checks ordinary ancestors,
regular single-link artifacts, read-only/NOFOLLOW where available, BigInt named
and descriptor identity at the bounded read endpoints, exact size, a growth
sentinel, legitimate short reads and confirmed close. These are individually
verified reads, without an atomic or continuous snapshot claim. Input is preserved.

Strict UTF-8 and JSON admission reject duplicate/dangerous object keys,
non-finite or unsafe numbers, excessive strings, depth, array/object entries and
node count. Closed `/1` schemas enforce run/mode/platform/HZ bindings, the fixed
sampler/model/work/source rosters and false acceptance flags. Exact serialized
byte hashes and lengths are checked against every surviving declaration. Missing
files never suppress a present contradiction.

Raw sampler CPU values bind to normalized window ordinals. Sampler-relative
microseconds and absolute arbitrary-domain nanoseconds retain distinct origins;
no clock offset is inferred. Raw RSS is retained by the input packet but remains
unqualified and is omitted from the report. CPU comparisons do not depend on
RSS monotonicity. Work checksums are verified by logarithmic affine composition
modulo 2^32 for the declared actual iteration count, without executing LCG work.
Partial work, missing second references, failed acquisition and refused/low
resolution comparisons remain nonpassing evidence.

The entire current result, including bounds, reasons and qualification flags,
must structurally equal the stored window comparison; the final comparison must
also agree when present. Replay still checks retained windows if plan/raw files
are missing. `replay.comparison` always retains the pure current model result.
The producer's sticky clock can latch a failure after the second normalized
window; retained raw/acquisition clock-failure declarations can support its
recorded refusal even when the pure comparison is consistent. In that case only
state/reason change in `replay.producerComparison`, and
`producerClockOverride:'compatible-recorded-clock-regression'` explicitly labels
the compatible producer projection. Otherwise the override label is `none`.
The entire projected comparison must match the stored comparison. This preserves
the distinction between arithmetic and reported clock-failure evidence without
authenticating an unrecorded historical clock event.

Plan and final historical eight-source declarations remain unauthenticated.
`sources.state` must agree with the before/after declarations. The report separately
records the current fixed checker/model dependency roster's exact disk hashes and
lengths at both endpoints plus the current Node version. The historical model
hash/length and Node version are displayed separately. A historical/current model
identity difference is labelled `different`; it does not by itself forbid
conditional replay. Neither endpoint hashing authenticates loaded code nor rules
out intermediate changes.

## Publication and interpretation

The fresh output contains one `linux-cpu-replay.json`, capped at 65536 bytes.
The report has version `linux-cpu-replay/1`, fixed scope, deterministic input
digests/missing labels, sanitized recorded/replay summaries and current-source
identity. It excludes input paths, proc text, PIDs, arbitrary errors and private
strings. Same inputs, current implementation and Node version produce identical
bytes in different fresh output directories. No current time, inode metadata or
output path is published.

`originalFinalPublication:'unknown'` is unconditional. Safely reading a final
receipt cannot prove its original close succeeded. Reported predecessor closure
is labelled `reported-only`. A producer persistence failure can omit a parseable
close-uncertain raw/window file from its confirmed roster and leave a null hash;
claimed complete candidates require all four confirmed predecessors. Present
bytes and reported original closure are distinct facts.

`finalPublication:'not-self-attested'` applies to this checker report. Successful
module/CLI return plus bundle validation supplies the publication result; a
parseable report after a failed close does not. Exclusive file/directory creation
refuses competitors; partial writes are preserved without repair or deletion.

| Exit | Meaning |
| --- | --- |
| 0 | All five files consistent for conditional current-model replay |
| 2 | Invalid options or overlapping paths |
| 3 | Missing or coherently recorded nonpassing evidence |
| 4 | Malformed, unsafe or contradictory bundle; comparison mismatch |
| 5 | Fresh output refused |
| 6 | Own report publication failure, including uncertain close |
| 7 | Current checker/model identity or replay unavailable |

Own publication failure dominates an already computed classification. Present
input contradictions precede missing/current-unavailable classification. CLI
diagnostics are fixed labels, success is silent, and `--help`/import do no IO.
No `sourceAuthenticated`, `measurementAccepted`, `calibrationAccepted` or
`w8Accepted` value becomes true. Code 0 establishes conditional structural and
arithmetic agreement, without source authentication, physical calibration,
product overhead, RSS qualification or W8 acceptance.

Tests are authored for CI: fabricated coherent bundles and restamped negative
controls, descriptor/JSON/publication boundaries, private copied-source controls,
and one actual Linux producer followed by two deterministic offline replays.
Local behavior/capture/workload execution is intentionally deferred under the
active host resource constraint; syntax checks do not establish test success.
