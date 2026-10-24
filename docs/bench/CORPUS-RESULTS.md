# Recorded synthetic corpus results

Status: an offline descriptive reporter for supplied S3–S8 run artifacts. It
executes no actor, capture, sensor, oracle, subprocess or network operation, and
discovers no runs. The report has scope `synthetic-corpus-results` and literal
`measurementAccepted: false`, `w8Accepted: false`, `sourceAuthenticated: false`.
It derives no metrics, rates, oracle admission, sensor scoring or ATT&CK mapping.

```sh
node bench/corpus-results.cjs --run <recorded-run-directory> --run <another-run-directory> --as-of 2026-10-24 --out <new-output-directory>
```

`--as-of` is a calendar-valid report-generation label. It is not an execution
date or evidence of a capture. Validated manifest timestamps are separately
labelled `recordedStartedAt`. Use the repository's qualified Node runtime.

## Inputs and reconciliation

The only run inputs read are `manifest.json`, `steps.json`, `expected.ndjson`,
`fixture-outcomes.json` and `file-read-outcomes.json`. The current manifest header
uses schema version 2; step/outcome schemas use version 1. Manifest identity is
required. Missing/invalid manifests refuse the batch because no run identity can
be established. Duplicate run IDs, including copies in different directories,
also refuse the batch.

Missing non-manifest artifacts retain an explicit `incomplete` attempt with a
fixed missing-file list. Missing steps mean unknown step state, not zero steps.
A present empty catalogue means recorded-empty; it is distinct from a missing
catalogue. Invalid JSON, malformed records, unreadable files and contradictions
refuse the batch; they are never silently discarded or reclassified as absent.

Recorded step IDs, counts, expectations, status sequence and emission shapes
are reconciled. A successful non-emitting step legitimately has `emitted: null`.
Every successful emitting step must have exactly one catalogue row bound to its
step/expect/category/type/action. Failed/skipped steps emit no row. Declared
counts and `expectations.emitted` must agree with both step records and catalogue
cardinality. Private step error text is not copied to the report.

All supplied attempts remain visible, including repeated scenarios, failures and
skips. `stepState: ok` means recorded steps are all ok; `artifactState: recorded`
means the required artifact observations are present and internally reconciled.
Neither establishes whole-run or capture success. Manifests are written before
sensor startup and may exist alone after a startup refusal.
`captureAssessment: not-assessed` applies even to all-ok step sets. No observation
or capture metadata is inferred from unconsumed files.

## Separate S7 and S8 observations

S7 retains sender write facts separately from receiver count/hash/exact/reason
and cleanup facts. Successful sender write can coexist with false or unknown
receiver verification. The existing closed outcome validator is reused, with
run/step/nonce, sender/step and catalogue byte bindings checked. A fixed
`control-unavailable` record remains unavailable without invented sender facts.

S8 retains expected/returned byte counts and hashes, original/pre/post/named
identity digests, returned-progress uncertainty, fixed failure reason and closure
facts. The recorded source must be an earlier successful `write-fixture`, and
its creation catalogue row supplies the source byte/hash/fixture-label binding.
The reporter does not reread canaries or use the current source definition as
historical execution evidence. Missing source artifacts leave that relationship
explicitly unverified. Complete and failed outcomes stay separate; partial reads
are never promoted to complete reads.

A valid empty outcome array for a skipped step is `not-executed`. Empty outcomes
for an attempted step are `empty-incomplete`; a missing outcome file is
`missing`. A present outcome for a skipped/undeclared recorded step contradicts
the step record and is refused. These observations are synthetic fixture facts,
without OS oracle admission or a sensor denominator. JSON preserves nullable
facts precisely. Markdown uses `unknown` for unavailable facts and
`none-recorded` for null failure-reason fields.

## Inventory, integrity and privacy

The six current source scenarios are a separate inventory. Only safe scenario
IDs, current step counts and exact definition-byte SHA-256 values are reported;
titles, descriptions and canary contents are excluded. Unsupplied scenarios get
pending inventory rows. Recorded steps are not checked against today's mutable
scenario definition. Every `executedDefinitionMatch` remains `unverified`.

Each consumed raw artifact has an exact-byte SHA-256 and byte count, including
whitespace/BOM differences. The report separately fingerprints fixed repository
reporter, renderer, parser and reused-validator source files, and names the
reporter's Node version. These are disk bytes read during reporting, not proof
of loaded-code authentication or historical execution. Built-in Node code is not
hashed. Same inputs, report label, runtime and source bytes yield byte-identical
JSON and Markdown independent of input argument order. Attempts are sorted by
scenario/run ID/arm using lexical order; inventory/source lists have fixed order.

Projection keeps only safe IDs, fixed statuses/reasons, bounded counts, booleans,
nulls, timestamps and hashes. No raw paths, executable/command strings, content,
errors, probe source/unavailable prose or other recorded provenance is copied.
Existing metrics/oracle/ATT&CK files are not read and cannot turn literal
qualification fields true. Hashes provide integrity bindings, not anonymity or
source authentication. Keep original run directories private and intact.

## Bounds and output handling

Limits in `bench/lib/corpus-input.js` are 24 explicit runs, 64 KiB per artifact,
4 MiB total read bytes, 64 steps/events per attempt, JSON depth 16, 12,000 nodes
per JSON value, 1024 entries per container and 8192 UTF-16 units per string.
The total read budget also includes fixed current-definition and reporter-source
reads. Expected NDJSON values are individually parsed with the same depth/node
bounds and a bounded event count. No unbounded stream or directory enumeration
is used. These are implementation limits, not measured performance.

Reads inspect ordinary local ancestor directories and regular single-link files,
use fixed descriptor buffers plus a sentinel, loop over short reads, and compare
descriptor/named identity, size and modification/change timestamps before and
after reading. Growth, replacement, links/junctions, hard links, invalid UTF-8,
duplicate decoded JSON keys and uncertain descriptor close refuse reporting.
Directories must be caller-owned and non-adversarial; these checks establish
neither ownership nor containment against concurrent malicious path swaps.

All input validation and rendering happen before output creation. A fresh
directory is created exclusively, then `corpus-results.json` and
`corpus-results.md` are individually created exclusively. Each output is bounded
to 256 KiB. Existing directories/files are preserved. A write/close/create race
after directory creation leaves an honestly partial bundle and returns an error;
the tool does not erase competing files or claim success.

CLI exit codes: 0 written/help; 2 usage; 3 invalid/unreadable input or output-size
refusal; 5 output directory refusal; 6 partial output bundle. Diagnostics are
fixed codes without exception snippets or input/output paths. Failed bundles
must not be treated as published results. The reporter adds no collection,
calibration, live variance or measurement acceptance.
