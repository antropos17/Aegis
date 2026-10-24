# Offline supervised resource replay

`bench/resource-session-replay.cjs` inspects one explicit supervised bundle and
recomputes its conditional resource result with the fixed current repository
evaluator. It does not capture, spawn, discover runs, execute supplied code or
repair files. The input format is the existing supervisor's three parent files
and the unchanged session's five child files under `capture/`. Standalone child
sessions are incomplete inputs to this tool.

```sh
node bench/resource-session-replay.cjs --input <supervised-directory> --out <new-report-directory>
```

Both options are required and closed. Import, help and invalid CLI input perform
no inspection. `inspectResourceReplay({input,out})` in
`bench/lib/resource-replay.js` returns `{exitCode,report}`. API accessors,
nonordinary objects and extra fields refuse before IO. Input/output equality
and overlap in either direction refuse before writes. Output's parent must
already exist. Directory paths must be ordinary local caller-owned paths;
UNC paths, root directories and linked ancestors are refused. The deliberately
restrictive output-parent policy also refuses a drive/filesystem root as parent.
These are non-adversarial ownership prerequisites, without a containment proof.

## Eight fixed inputs

| File | Maximum bytes |
| --- | ---: |
| `supervision-plan.json` | 16384 |
| `supervision-pending.json` | 4096 |
| `supervision-final.json` | 32768 |
| `capture/session-plan.json` | 16384 |
| `capture/session-pending.json` | 4096 |
| `capture/raw-samples.json` | 131073 |
| `capture/bracketed-intervals.json` | 524289 |
| `capture/session-final.json` | 16384 |

Aggregate artifact bytes are limited to 1 MiB. No other input names are inspected.
Missing fixed filenames, including a missing `capture/` directory, retain an
incomplete result. Only ENOENT is missing. A linked `capture/`, nonregular or
hard-linked artifact, permission/read/closure failure, unstable identity or
oversized input refuses. Reads use read-only descriptors, `O_NOFOLLOW` where
supported, fixed buffers plus a growth sentinel, BigInt named/descriptor/post-read
identity checks and confirmed close. These are individually verified endpoints,
without an atomic or continuously stable filesystem snapshot.

JSON decoding is fatal UTF-8 with duplicate-key refusal, including escaped
duplicate keys. Parsing limits are depth 24, 50000 values, 4096 decoded characters
per string and 1024 members per container, in addition to the byte caps. Present
malformed/contradictory data refuses even when a different artifact is missing.
Raw bytes, not reserialized objects, supply file SHA-256 and byte-length links.

## Consistency and conditional arithmetic

The checker validates closed `/1` envelopes, false acceptance flags, fixed source
rosters and byte limits, same-run IDs, the single `owned-idle` phase/grid,
parent/child option agreement, ordered confirmed predecessor files and exact-byte
hash links. A final receipt never lists or attests its own closure. Surviving
plan-hash declarations are reconciled even when the plan file is absent.

Parent lifecycle remains an untrusted declaration. Its reported predicate,
latched causes, stream count/cap/completion algebra and receipt state are checked.
Empty stream hashes can be recomputed. Nonempty stream bytes were not retained,
so their prefix hashes remain recorded claims. Kill requests and later observed
exit can coexist; snapshots do not establish their ordering or authenticate an
OS event. A reported child zero exit must agree with every present child success
fact. A parent-reported exit 6 with a parseable complete-candidate child final can
be genuine publication uncertainty and remains incomplete.

Raw schedule accounting, nullable readings, clock-observation consistency and
acquisition/cleanup reasons are preserved. Present duplicated raw views and final
facts must agree, including a retained `derived.raw` when the separate raw file
is missing. An acquired one-point schedule legitimately has zero CPU intervals.
No closing sample, tail estimate, phase metric or rate is invented.

Replay calls the fixed current `evaluateBracketedResources` with retained raw,
plan and the SHA-256 of all exact child-plan bytes, including its newline. It
compares the entire stored JSON result structurally: raw fields, schedule,
boundaries, CPU/RSS windows, reasons and rational bounds. Object-key order is
irrelevant; array order and every value remain material. A retained derived
packet can be checked using its embedded raw/plan/provenance even when external
files are missing. This basis is explicit and does not reconstruct a missing
file or verify a missing plan's original bytes.

Historical evaluator declarations retain their safe fixed filename, hash,
byte length, Node version and child-plan/parent-plan basis. Current evaluator
disk identity and Node version are separate. Hash **and byte length** determine
the labelled content comparison; version identity is not inferred. Historical
hash drift does not prevent agreement with current conditional arithmetic.
Historical code is never loaded. A fixed current implementation inventory is
read before/after inspection; endpoint change or unavailable evaluator yields
`replay-unavailable`. Disk fingerprints do not authenticate loaded code.

## Report and publication

One fresh exclusive `resource-replay.json`, at most 64 KiB, records fixed input
labels/hashes/counts, validated run ID, historical modes/states, missing files,
current implementation/evaluator identity, raw incompleteness/exclusion facts and
the full-comparison verdict. It copies no paths, PID, commands, environment,
source content, raw errors or stream text. Identical input bytes and current
implementation/Node version produce byte-identical reports across fresh output
paths. The report contains no current timestamp or measured inspection duration.

`parentFinalPublication` and `childFinalPublication` are always `unknown`.
`reportedChildPublicationSupport` separately describes support from a consistent
reported zero exit, matching close and complete pipes; it authenticates neither
OS history nor either original final descriptor closure. A killed/incomplete
child cannot become complete solely because its final JSON parses.

Classification is `consistent-for-conditional-replay`, `incomplete`, `refused` or
`replay-unavailable`. Even structural/current-arithmetic agreement is conditional
evidence with `sourceAuthenticated:false`, `measurementAccepted:false` and
`w8Accepted:false`. No acceptance flag becomes true.

| Exit | Meaning |
| --- | --- |
| 0 | Eight consistent files, declared complete acquisition/lifecycle and full current arithmetic agreement; own report closed |
| 2 | Invalid options or overlapping paths; no report creation |
| 3 | Missing or coherently incomplete/failed evidence |
| 4 | Unsafe, malformed or contradictory bundle; sanitized refusal report when possible |
| 5 | Fresh output/parent refused before ownership |
| 6 | Failure after report-directory ownership, including partial write/uncertain close |
| 7 | Current evaluator or current implementation endpoints unavailable/changed |

Own output failure takes precedence. For an inspectable output, refusal takes
precedence over replay unavailability, which takes precedence over incomplete
evidence. Partial reports and input bytes are retained; no competing file is
overwritten or deleted. `finalPublication:'not-self-attested'` acknowledges that
the report cannot prove its own write/close. A parseable file can accompany exit
6; use the module/CLI result together with bundle validation.

Tests are authored for CI: actual shortest producer-to-replay integration,
deterministic injected bundles, artifacts larger than 64 KiB, coherent hash
restamping, missing-plus-present contradictions, source-version drift, strict
parsing, descriptor stability and publication faults. Local behavioral runs,
captures and source faults were intentionally deferred under the active host
resource constraint. Authored tests are not executed evidence.
