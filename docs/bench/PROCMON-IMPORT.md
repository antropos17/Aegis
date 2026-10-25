# Procmon CSV offline staging

Status: offline preparation, tested with synthetic CSV. This supplies no native
capture, qualified CSV export profile, independent catalogue confirmation,
measurement result, W8 acceptance or T8 completion. The output is a staging JSON
object; it is not `oracle-procmon.ndjson` and no run, manifest or scorer consumes
it. Sysmon and Procmon remain separate future oracle columns.

The importer sets `oracle: "procmon"`, `acquisition: "offline-import"`,
`captureQualified: false`, `exportProfileQualified: false`,
`catalogueConfirmed: false`, `sensorScored: false` and `admittedToScoring: false`.
These output facts are importer-owned literals; receipt fields cannot override
them. The returned object's top level is frozen.

[Microsoft's Process Monitor page](https://learn.microsoft.com/en-us/sysinternals/downloads/procmon)
describes file system, Registry, process and thread activity, configurable columns
and preservation of full data in the native log format. It does not specify or
qualify the CSV profile below. The profile is an explicit caller contract with
synthetic parser tests. This importer cannot execute Procmon or parse PML.

## Inputs and bounds

`bench/procmon-import.cjs` accepts exactly `--csv FILE --receipt FILE --out FILE`.
The output must have a `.json` extension and must not exist. Inputs must be regular
files. Reads use a fixed buffer plus a sentinel byte so a growing input cannot
escape the byte limit. No dependencies or product sensor modules are loaded.

The limits come from `bench/lib/oracles/procmon-csv.js`: CSV 1 MiB, receipt 64 KiB,
4096 data rows, seven columns, 4096 UTF-16 code units per cell, 128 exact-path
mappings and staging output 2 MiB. The output guard reserves counter growth and
checks each event before accumulating it; it may refuse slightly below 2 MiB.
Oversized inputs, NUL, invalid UTF-8, malformed quoting, duplicate/missing/extra
headers, unsafe PIDs and malformed receipts are refused without output.

The declared profile is `procmon-csv-read-v1`. Its header order is exactly:

```text
Time of Day,Process Name,PID,Operation,Path,Result,Detail
```

CSV may contain a UTF-8 BOM, LF or CRLF record endings, quoted commas and newlines,
and doubled quotes. Bare CR outside quotes and text after a closing quote are
refused. Header names are case-sensitive. Additional columns such as command
line or user are refused. Timestamp cells must be `HH:mm:ss.fffffff`, with a
24-hour clock and exactly seven fractional digits. There is no locale inference,
AM/PM, date inference, timezone probing or daylight-saving adjustment.

## Closed receipt

All fields below are required; unknown fields are refused. Replace fixture values
with the actual capture facts. `csvSha256` hashes exact exported bytes, including
BOM and line endings. The receipt's own exact-byte SHA-256 is computed on import.
Provenance identifiers are bounded safe tokens; use neutral machine/agent labels.
The receipt is private input because its mappings contain source paths.

`evidenceLabel` accepts exactly `synthetic` for constructed fixtures or
`unvalidated-export` for an export awaiting native qualification. Labels such as
`qualified` are refused. `arm` accepts only `A` or `B`; arm `C` is sensor-alone
and cannot carry an independent oracle staging receipt.

```json
{
  "schemaVersion": 1,
  "profile": {
    "id": "procmon-csv-read-v1",
    "columns": ["Time of Day", "Process Name", "PID", "Operation", "Path", "Result", "Detail"],
    "timestampFormat": "HH:mm:ss.fffffff"
  },
  "runId": "run-1",
  "scenario": "S-read",
  "arm": "A",
  "captureId": "capture-1",
  "evidenceLabel": "synthetic",
  "csvSha256": "<exact-64-lowercase-hex-digest>",
  "timestampBasis": { "date": "2026-10-24", "utcOffset": "+00:00" },
  "window": { "start": "2026-10-24T12:00:00.000Z", "end": "2026-10-24T12:10:00.000Z" },
  "provenance": {
    "commit": "<full-40-or-64-lowercase-hex-commit>",
    "machine": "fixture-host",
    "os": "fixture-windows",
    "agentVersions": "synthetic-agent-v1",
    "sensorMode": "fixture",
    "method": "offline-import",
    "procmonVersion": { "value": null, "unavailable": "synthetic-fixture" },
    "configSha256": { "value": null, "unavailable": "synthetic-fixture" }
  },
  "pathMappings": [{ "sourcePath": "C:\\private\\canary.txt", "fixtureId": "canary-1" }],
  "loss": null,
  "completeness": null
}
```

Version facts may instead be `{ "value": "<version-token>" }` and
`{ "value": "<64-lowercase-hex-config-digest>" }`. Neither an unavailable version
nor a caller claim is native qualification. `loss` and `completeness` must remain
`null`: this format admits no independent loss measurement. JSON is parsed as a
bounded object; duplicate JSON property names, including escaped aliases, are
refused.

The UTC window uses exact ISO millisecond strings and inclusive endpoints. It
must fit within the one declared local calendar date under a fixed offset up to
14 hours. `-00:00` is refused. Captures spanning local midnight need separate
receipts and exports. Every row timestamp is validated, converted without losing
its seven-digit fraction and checked against the UTC window. Out-of-window rows
are counted and never normalized. A digest mismatch refuses the whole import.
The receipt binds every accepted row to run, scenario, arm, capture, window and
receipt digest. The importer cannot independently prove that caller-declared
capture identity, clock basis or provenance is truthful; that requires capture
qualification. It cannot distinguish a relabelled capture from a truthful one.

Mappings form a closed, case-sensitive lookup from exact source paths to unique
safe fixture IDs (`[a-z][a-z0-9-]{0,63}`). No prefix matching, path guessing or
filesystem lookup occurs. Unmapped paths are counted and omitted. Receipt maps
and process names are never copied to output; accepted paths become
`fixture:<fixtureId>`. Identifiers and provenance are caller-declared metadata,
so callers must keep secrets out of those fields too.

## Semantics and accounting

Only `ReadFile` with result `SUCCESS` and one unambiguous, positive, safe-integer
`Length` is normalized. The caller profile defines `Length: N` as a comma-space
delimited Detail field, with optional three-digit thousands separators. Missing,
malformed, duplicate, fractional, negative and unsafe Length values are counted
under `invalidLength`; zero uses `zeroLength`. A successful positive-length read
is file activity; it proves no content semantics, attribution to an agent
instance, catalogue confirmation or Kernel-File provider emission.

CreateFile does not establish file creation; deletion disposition does not
establish completed deletion. Both remain unsupported, as do WriteFile and all
process lifecycle operations in this first importer. No process correlation is
attempted. PIDs must be decimal positive uint32 values (`1..4294967295`). A PID
is a row field and is never promoted to a durable identity.

Every data row is counted once in this precedence order: `outsideWindow`,
`unsupported`, `unsuccessful`, `invalidLength`, `zeroLength`, `unmapped`,
`accepted`. Invalid timestamp or unsafe PID refuses the entire import rather
than producing partial output. `rows` equals the sum of these categories. The
logical data-row ordinal starts at one; quoted physical newlines do not change
it. Unsupported or unsuccessful rows retain counts only.

Accepted events retain ordinal, UTC timestamp, operation/result, PID, fixture ID,
neutral path, validated byte length, Detail SHA-256 and same-run binding. Raw
Detail, process names, command lines, users, environment, contents and prompts
are excluded. A digest is integrity evidence, not anonymization or encryption;
keep raw captures and receipts in private owned storage. The output includes
input sizes/digests, declared provenance, all accounting and explicit unknown
loss/completeness. It contains no hits, misses, false-alarm rate or variance
estimate. Reimporting identical inputs yields identical bytes; this is parser
determinism, not measured native variance.

## Owner actions

For an already exported, privately held CSV and a fully populated receipt, use
PowerShell from the intended checkout. These commands update the declared input
digest and import into a fresh destination; they do not capture or qualify Procmon:

```powershell
$captureCsv = 'X:\private\procmon\capture.csv'
$captureReceipt = 'X:\private\procmon\receipt.json'
$stagingOutput = 'X:\private\procmon\capture.staging.json'
$captureFacts = Get-Content -Raw -LiteralPath $captureReceipt | ConvertFrom-Json
$captureFacts.csvSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $captureCsv).Hash.ToLowerInvariant()
$captureFacts | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $captureReceipt -Encoding utf8
node bench/procmon-import.cjs --csv $captureCsv --receipt $captureReceipt --out $stagingOutput
```

Native capture/export validation on a pinned Windows image remains a separate
owner-run design and qualification task, including Procmon/config versions,
column/timestamp evidence, clock/run binding, capture loss and known read
positive/negative controls. There is no live command here that can establish it.
Future catalogue admission must independently check expected scenario events
against qualified same-run evidence before sensor scoring, retaining misses and
false alarms. This staging importer leaves that work unimplemented.
