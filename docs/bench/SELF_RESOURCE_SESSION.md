# Retained own-Node resource sessions

Status: a bounded opt-in session for the calling Node process. It joins the
existing [sampler](../../bench/SELF_RESOURCE_SAMPLER.md), retained raw bytes and
[conditional interval evaluator](../../bench/BRACKETED_RESOURCE_INTERVALS.md).
It executes no product, workload command, child process, discovery or native
collector. Source authentication, measurement acceptance and W8 acceptance stay
explicitly false. It establishes no cohort footprint, product overhead,
calibration or reproducibility result.

```sh
node bench/self-resource-run.cjs --run-id own-node-1 --duration-ms 4000 --max-acquisition-us 1000 --max-cpu-uncertainty-us 2000 --out <new-owned-directory>
```

All five options are required. Numeric tokens are positive canonical decimal
integers, without signs, fractional parts, exponent syntax or leading zeros.
`runId` uses 1–64 ASCII letters, digits, dots, underscores and hyphens, beginning
with a letter or digit. Duration is 1000–60000 ms in whole 1000 ms steps.
Acquisition width is 1–durationUs; CPU timing uncertainty is 1–2×durationUs.
Unknown/duplicate flags, unsupported options and nonordinary programmatic
objects are refused before filesystem or sampling activity. No bounds are
selected implicitly as measurement promises.

The fixed plan has one declared `owned-idle` steady idle phase over
`[0,durationUs]`. The activity label means this driver adds no workload and waits
between acquisitions. It does not establish that the OS or Node process was
quiescent. The unchanged sampler uses a 1-second start-inclusive, end-exclusive
grid, finishing after its last acquisition. A 1000 ms plan has one point and no
CPU interval. It does not wait an unused final second, add a closing sample, or
fill an unobserved tail. Raw `plannedDurationUs` remains the declared window.

## Retained bundle and ordering

The output parent must already exist. The output directory is created fresh;
existing directories are refused. Paths must be ordinary local caller-owned
non-adversarial directories; UNC paths, linked ancestors and linked source files
are refused. These checks do not establish adversarial containment or filesystem
ownership. No output path or user-provided error text is copied into receipts.

The fixed roster and serialized UTF-8 byte caps are:

| File | Maximum bytes | Meaning |
| --- | ---: | --- |
| `session-plan.json` | 16384 | Frozen session parameters, evaluator plan, source/configuration inventory and limits |
| `session-pending.json` | 4096 | Pre-acquisition declaration binding exact plan-file SHA-256 and roster |
| `raw-samples.json` | 131073 | Unchanged sampler packet, retained before evaluation |
| `bracketed-intervals.json` | 524289 | Unchanged existing evaluator output |
| `session-final.json` | 16384 | Safe observed outcome, prior-file hashes, cleanup and source endpoint facts |

The per-bundle quota is 1 MiB. New files use exclusive descriptor creation and
bounded complete writes, followed by confirmed descriptor close. No file is
overwritten, retried or deleted. A race or IO failure may retain a partial file
or competing file; no replacement or cleanup hides that fact. Quotas bound this
driver's writes, without limiting files written by another actor. One fresh
directory is required per attempt. The owner chooses retention and removes only
confirmed disposable owned bundles; the driver performs no discovery or pruning.

The plan and pending declaration are written and closed before calling the
sampler. The exact raw-file SHA-256 is recorded separately in the final receipt.
The evaluator's existing `provenance.sourceSha256` binds **all exact bytes of
`session-plan.json`, including its trailing newline**: this file retains the
source/configuration inventory. No field is silently added to the evaluator's
format. A reader can independently rehash the raw and plan files, then rerun the
existing evaluator with their parsed values.

The fixed inventory names this CLI, session/storage helper, sampler and evaluator.
It hashes exact repository disk bytes, with bounded stable descriptor reads,
BigInt filesystem identity/timestamp checks and confirmed closure. It also names
the Node version. Each source is limited to 64 KiB. This fingerprints disk bytes
read at an endpoint, rather than authenticating loaded code or proving the
dependency/runtime implementation. The inventory is inspected again after
acquisition/derivation; `unchanged`, `changed` or `unavailable` describes that
comparison. Equal endpoints cannot rule out an intermediate change/restoration.

## States, cleanup and publication

`session-final.json` separates `acquisition` (including the raw completeness
flag and reading mode), `derivation`, sampler `cleanup`, source endpoint state and
the confirmed closed `files` preceding the final receipt. Missing raw acquisition
does not become an empty successful packet. Cancelled/incomplete raw schedules,
missed points, unattempted tails, null readings and closed reasons survive in the
raw packet and evaluator output. Derivation refusal preserves raw evidence.

`priorArtifactState` covers only the four preceding files. A
`state: 'complete-candidate'` receipt means acquisition and derivation conditions
were observed before publishing that receipt. Its literal
`finalPublication: 'not-self-attested'` acknowledges that a file cannot certify
its own final write or descriptor closure. A parseable final file can still
accompany exit 6. Successful publication requires the returned module result or
CLI exit code together with validation of the retained bundle. A final receipt
does not list or hash itself.

| Exit | Meaning |
| --- | --- |
| 0 | Complete raw acquisition, written conditional result, clean sampler state and unchanged source endpoints; final publication closed successfully |
| 2 | Invalid required options; no acquisition or output creation |
| 3 | Incomplete/cancelled/failed acquisition, derivation refusal or unconfirmed sampler cleanup; retained evidence remains |
| 4 | Initial source inventory unavailable, or final inventory changed/unavailable |
| 5 | Fresh output refused before a bundle was created |
| 6 | Partial bundle or persistence failure, including uncertain final closure |

Persistence failure takes precedence over source refusal, which takes precedence
over acquisition/derivation incompleteness. Abrupt termination can leave the plan
and pending receipt with no final receipt. An existing file never supplies
evidence for the new attempt. CLI messages use fixed diagnostic codes and omit
raw errors, paths, reader values and arbitrary prose.

Exit 0 does not mean every interval passed admission: tight acquisition or CPU
uncertainty bounds can retain refused intervals normally. It does not qualify a
measurement. Raw API observations, conditional arithmetic and persisted evidence
remain separate from product/cohort/overhead claims.

`SIGINT` and `SIGTERM` request cooperative cancellation; handlers are removed when
the exported `main` finishes. Timers cannot preempt synchronous APIs or a blocked
event loop. There is no hard wall deadline, external supervisor or ability to
terminate arbitrary work; those require a separately reviewed extension.

The optional [fixed-child supervisor](RESOURCE_SUPERVISOR.md) runs this CLI in
an owned Node child and observes it from a separate parent event loop. It adds
termination requests and bounded exit/pipe confirmation while preserving this
session's five-file contract. The parent remains subject to its own scheduler
and filesystem; supervision supplies no product/cohort measurement acceptance.

The separate [offline resource replay checker](RESOURCE_REPLAY.md) checks a
supervised bundle's retained hashes, declarations and current-evaluator replay.
It preserves missing or contradictory artifacts and the final file's publication
uncertainty; it does not execute or repair the supplied bundle.

## Programmatic and CI use

`runSelfResourceSession(options, samplerDeps?)` in
`bench/lib/self-resource-session.js` returns `{exitCode, receipt}`. It accepts the
five camel-case options `runId`, `durationMs`, `maxAcquisitionUs`,
`maxCpuUncertaintyUs`, `out`, plus an optional `AbortSignal`. The optional closed
second argument forwards only the existing sampler's synchronous test seam.
Injected dependencies retain `readingMode: 'injected'` and receive no native
authority. The CLI always uses the real production API defaults.

Session and CLI tests are authored for CI, including actual sampler/evaluator
composition, immutable pre-declaration ordering, raw-before-derivation ordering,
hashes, refusal/cancellation, ownership races, partial closure and privacy. Local
heavy tests and capture were intentionally deferred for this implementation under
the active resource constraint. Authored checks are not executed evidence.
