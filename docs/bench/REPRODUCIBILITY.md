# Offline three-run reproducibility arithmetic

Status: bounded offline preparation with synthetic tests and one composition test
using actual resource-interval evaluator output. This implements the declared
variance arithmetic in [METHOD.md](METHOD.md#estimation-variance-and-refusal).
It collects no observations and establishes no native measurement, calibration,
source authentication, W8 acceptance or T8 completion. Every result explicitly
sets `sourceAuthenticated`, `collectionQualified` and `measurementAccepted` to
`false`, including results within the declared bound.

## Declaration contract

`bench/lib/reproducibility.js` exports `hashPlan(plan)` and
`evaluateReproducibility(input)`. Objects are closed, noncoercing JSON data:
unknown/missing fields, wrong types and malformed identities are refused with
the fixed error `reproducibility-input-invalid`. Strings are safe IDs or hashes,
not free-form prose. Keep rationale prose privately under its declared digest.

The envelope has exactly these fields:

| Field | Meaning |
| --- | --- |
| `schema` | `reproducibility-input` |
| `schemaVersion` | Integer `1` |
| `planSha256` | `hashPlan(plan)`, over recursively sorted object keys and JSON.stringify values; array order retained |
| `plan` | The closed plan below |
| `runs` | Exactly the declared three runs, each retained in output |

The plan has `id`, positive integer `version`, `frozenAt`, `identity`, `runIds`
and `cells`. `runIds` contains exactly three unique IDs. Each run has `runId`,
`startedAt`, `identity` and `cells`; no missing, duplicate, extra or replacement
run is admitted. Run and cell input ordering may vary; estimates are emitted in
the plan's run order. All supplied run records retain their original array order
in the output. Replacement runs require a later reviewed contract extension.

Each identity has exactly the following fields:

```text
commit
sourceSha256 harnessSha256 binarySha256 configSha256 inputSha256
agentVersionsSha256 providerVersionsSha256 osImageSha256 calibrationSha256
machine os agentVersions sensorMode method privileges
```

The commit is full lowercase hex of length 40 or 64. SHA-256 fields are exactly
64 lowercase hex characters. Label fields and IDs use
`[A-Za-z0-9][A-Za-z0-9_.-]{0,63}`. The labels identify the declared machine, OS
build, agent versions, sensor mode, method and privileges; hashes bind the exact
declared source, binaries, harness, configuration, inputs, agent/provider
versions, controlled image and calibration evidence. Unavailable comparison
identity facts are unsupported in v1; they cannot be replaced with invented
hashes. A run identity differing from the plan makes its cells ineligible and
is retained as supplied. Hash agreement does not authenticate the declarations
or show that any file was checked before and after capture.

Dates use `YYYY-MM-DDTHH:mm:ss.sssZ` with calendar validation. Eligibility requires
the declared `frozenAt` strictly before every declared `startedAt`. Equal
millisecond timestamps are ineligible. A run whose cells are all `not-started`
uses `startedAt: null`. These declarations do not prove that a plan was actually
frozen before collection or that unreported attempts do not exist.

## Cells, populations and incomplete attempts

Each planned cell contains `metric`, `phase`, `cohort`, `percentile`, `unit`,
`plannedCount`, `A`, `R`, `rationaleId`, `rationaleSha256` and
`calibrationUncertainty`. The first five are safe IDs; percentile is `p50` or
`p95`. The first four uniquely identify a cell; units must match every run row.
`plannedCount` is a positive integer at most one billion. V1 requires that same
planned population count in every repetition. Legitimately varying planned
populations require a later extension and are ineligible here.

`A` and `R` must be explicitly supplied finite nonnegative JSON numbers; there
are no defaults and no additional upper bound on finite `R`. `A` is in metric
units; `R` is a dimensionless fraction. The rationale is a safe ID plus exact
SHA-256. `calibrationUncertainty` is `{ "value": NUMBER, "reason": null }` for a
finite nonnegative magnitude in metric units, or
`{ "value": null, "reason": "unavailable" }` / `"not-calibrated"`. Unknown
uncertainty makes the cell ineligible. Its magnitude is retained and is never
silently added to `A` or `R`.

Each run must contain exactly one row for every planned cell. A row contains the
same five key/unit fields plus `status`, `estimate`, `reason` and `counts`.
Missing or extra cell rows, duplicate keys and unit/key mismatches refuse the
envelope rather than selecting a convenient subset.

| Status | Estimate | Reason |
| --- | --- | --- |
| `complete` | Finite number, including signed values | `null` |
| `incomplete` | `null` | `incomplete-population` |
| `failed` | `null` | `run-failed` |
| `refused` | `null` | `run-refused` |
| `timed-out` | `null` | `run-timed-out` |
| `not-started` | `null` | `not-started` |

`counts` has exactly `planned`, `valid`, `excluded`, `missing` and `failed`, each
an integer from zero through one billion. A complete declaration is eligible
only when `planned` matches the plan's `plannedCount`, `valid === planned` and
all other counts are zero. Contradictory counts never become eligible because
`status` says `complete`. Excluded samples remain explicit; v1 conservatively
refuses reproducibility for such populations. Incomplete attempts stay in the
run records with their null estimates and reasons. A structurally valid row
claiming complete with contradictory counts retains its supplied estimate,
while its cell summary remains null and ineligible.

Each input estimate must already be the declared per-run phase/cohort/percentile
estimate. This tool cannot verify how it was estimated or whether raw samples
and excluded/missing populations are truthful. It does not pool sample
populations, derive sample p95 from three run averages, or authenticate upstream
evaluator output. The resource-interval composition test only establishes the
offline data handoff on synthetic input.

## Exact arithmetic and output

For three eligible per-run estimates, compute minimum, maximum, median and range,
then test exactly:

```text
range <= A + R * abs(median)
```

Zero median gives a zero relative term and still requires explicit `A`. Signed
change estimates are supported. Estimates are interpreted as the decimal values
of their canonical JSON.stringify representation, rather than their underlying
IEEE binary expansion. This is a representable contract, not arbitrary-precision
JSON input: the CLI refuses numeric tokens that would be rounded or rewritten
by JSON.parse/JSON.stringify. Examples refused include `1.0`, `1e0`, `-0`,
uppercase exponent spellings and integers whose spelling changes on parsing.
Programmatic callers already supply JS numbers; negative zero is canonically
zero at that boundary. JSON.stringify-produced finite numeric values are accepted.

Finite canonical numbers span decimal exponents through 308 and down to -324.
Each value is represented as an integer at scale `10^324`; the bound calculation
uses scale `10^648`. Sorting, subtraction, multiplication and comparison use
BigInt, with bounded input populations and bounded decimal expansion. No epsilon,
floating subtraction or overflowing Number multiplication determines a verdict.
Statistics and bound are emitted as exact plain decimal strings, allowing a
range or product beyond Number's finite range to remain visible. Supplied
per-run estimates remain JSON numbers in `estimates` and the retained rows.

Each output cell carries its key/unit fields, all three estimates, statistics,
bound, `verdict` and reason codes. Verdicts are `within-declared-bound`,
`outside-declared-bound` or `ineligible`. Ineligible statistics/bounds are null;
reason codes distinguish `planned-count-mismatch`, `incomplete-repetition`,
`incomplete-population`, `comparison-identity-mismatch`, `plan-not-before-start`
and `unknown-calibration-uncertainty`. All applicable reasons are emitted.

The output preserves the full declared plan, run records and plan digest, plus
an SHA-256 of canonical input declarations. The CLI also hashes exact input bytes,
so whitespace and BOM differences are distinguishable from normalized content.
These are integrity bindings, not authentication. Repeating identical inputs
yields identical bytes and conditional arithmetic; it proves no live variance,
collection completeness, prefreezing, calibration quality or measurement acceptance.

## Bounded CLI

```powershell
node bench/reproducibility.cjs --input X:\private\bench\repetitions.json --output X:\private\bench\reproducibility-new.json
node bench/reproducibility.cjs --help
```

Use task-owned ordinary local files with existing ordinary parent directories.
Input is at most 1 MiB with at most 64 planned cells, exactly three runs,
nesting depth 12, 20,000 JSON nodes, 1024 items per container and 1024 UTF-16 code
units per string. These are parser/input limits, not measured performance.
Strict UTF-8 permits an optional BOM. Duplicate decoded keys (including escaped
aliases), invalid UTF-8, malformed JSON and noncanonical numbers are refused.
The library also bounds direct JSON-object input before arithmetic.

Links/junction ancestors, nonregular files, multiply linked inputs, network paths
and alternate data streams are refused. Reads use a bounded buffer and compare
descriptor/named identity, size and nanosecond modification/change timestamps
before and after reading. This detects observed growth/replacement; it is not
an adversarial filesystem snapshot or ownership verifier. Output is limited to
4 MiB and opened exclusively, never overwriting an existing file. Filesystem
write failures may leave an incomplete newly created file; such a file is not a
successful result. No child processes, native collectors or network calls run.

Exit 0 means a result was written (including outside-bound/ineligible results)
or help was shown. Fixed diagnostics and exit codes: usage 2, input path/read 3,
invalid declarations 4, output path/collision 5, output write 6. Errors contain
no raw input, paths, rationale prose or exception snippets.

## Owner actions

After independently preparing and freezing a real plan and retaining every
planned attempt, populate its closed envelope and compute `planSha256` with
`hashPlan(plan)`. Run the CLI above into a fresh private destination. Native
collection, actual prefreezing, independent calibration, population completeness,
provider versions and publication admission remain separate owner evidence.
No VM installation or native operation is performed by this block.
