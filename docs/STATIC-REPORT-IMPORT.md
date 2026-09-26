# External static reports (A4.2, integration slice)

AEGIS can import an explicitly selected Cisco or cfgaudit result alongside a
fresh local [static review](STATIC-ANALYSIS.md). The importer reads JSON without executing
package code, starting MCP servers, installing analyzers or making network calls.
It does not run a JavaScript/Python analysis engine or verify external detection
effectiveness. Those parts of A4.2 remain pending.

## Usage

```powershell
# Optional: record the selected files before independently running an analyzer.
node src/main/main.js --static-scan-json package "X:/reviews/skill" > "X:/reviews/before.json"

# Import an already-created external report. All report files stay outside the subject.
node src/main/main.js --static-import-json package "X:/reviews/skill" cisco-skill-json "X:/reviews/cisco.json" --baseline "X:/reviews/before.json"
node src/main/main.js --static-import-json package "X:/reviews/skill" cisco-skill-sarif "X:/reviews/cisco.sarif"
node src/main/main.js --static-import-json project "X:/work/project" cisco-mcp-json "X:/reviews/mcp-raw.json"
node src/main/main.js --static-import-json project "X:/work/project" cfgaudit-sarif "X:/reviews/cfgaudit.sarif"
```

The adapter selects the local read scope, exactly as in `--static-scan-json`.
The format selects one AEGIS compatibility contract, version `1`. It is required;
the importer does not guess the producer. A baseline is a prior AEGIS static
report, not an A3 inventory snapshot. Existing input files are never modified.

External tools must be run separately with explicitly chosen inputs, versions,
analyzers and data-sharing options. Importing an existing report says nothing
about whether its producer used local analysis, cloud APIs or a live MCP server.
No external scanner installation, copied analyzer code or dependency change is included.

## Compatibility contracts

| Format | Accepted input | Deliberate limits |
| --- | --- | --- |
| `cisco-skill-json` | One result with `skill_path`, `findings`, `findings_count`, `analyzers_used` | Aggregate `scan-all`/`results` documents are unsupported; failed analyzers are coverage issues |
| `cisco-skill-sarif` | SARIF `2.1.0`, inline runs from driver `skill-scanner`, inline results/rule metadata/locations | No external properties, URI-base resolution, indexed artifacts, code-flow or related-location reconstruction |
| `cisco-mcp-json` | `--format raw` envelope with `server_url`, `scan_results`, `requested_analyzers` | Bare `--raw` arrays, HTTP API variants and other presentation formats are unsupported; analyzer entries remain aggregates |
| `cfgaudit-sarif` | SARIF `2.1.0`, one inline run from driver `cfgaudit`, inline CFG rule catalog, results and relative file URIs | No external properties, URI bases, indexed artifacts or flow reconstruction; producer execution and scan scope are not reported |

The inspected [Skill JSON model](https://github.com/cisco-ai-defense/skill-scanner/blob/431cb58a5ac333bc0bb9aaa23f7c30ac628f59f8/skill_scanner/core/models.py)
can set `is_safe: true` while lower-severity findings exist. AEGIS keeps those
findings and ignores that flag as a permission decision. Failed analyzer details
are reduced to a fixed issue code.

The inspected [Skill SARIF exporter](https://github.com/cisco-ai-defense/skill-scanner/blob/431cb58a5ac333bc0bb9aaa23f7c30ac628f59f8/skill_scanner/core/reporters/sarif_reporter.py)
contains a default producer version and reports invocation success without
carrying the JSON analyzer-failure list. Its version/success fields are claims;
they do not establish the actual build or full analyzer coverage. Suppressed and
baseline-absent results remain visible, with an issue explaining their status.

The inspected [MCP reporter](https://github.com/cisco-ai-defense/mcp-scanner/blob/16e684d8bd8faa0f0bb15e04ba2d2089dff42196/mcpscanner/core/report_generator.py)
groups findings by analyzer and includes meta-filtering information when present.
AEGIS retains each nonempty aggregate's reported count, fixed threat categories
and hashed item identity. Missing requested-analyzer results, incomplete items,
contradictory counts and meta filtering remain explicit issues. A summary count
does not become a set of reconstructed individual findings.

The inspected [cfgaudit SARIF exporter](https://github.com/cfgaudit/cfgaudit/blob/a8cd15945b09c0fa91e4c5c5eca36e63072110e8/cmd/cfgaudit/sarif.go)
emits one run, `CFG` rule IDs and `error`/`warning`/`note` levels. AEGIS projects
those levels to high/medium/low and groups registered CFG rules under the fixed
`policy_violation` category. The `static` analyzer label describes the import
contract, not observed analyzer coverage. The exporter includes neither an
invocation success record nor a source-root declaration. AEGIS records both gaps
even for an empty report. The report is selected and parsed offline; AEGIS does
not start cfgaudit. cfgaudit's own CLI may invoke other programs depending on
its options and environment, so users run it separately at their discretion.

## Result and evidence

The result has `schemaVersion: 1`, `mode: static-analysis-import`, `local` and
`external` sections. `local` is the unchanged A4.1 result, including unsupported
source-language and other coverage issues. External claims never erase local
findings, close local gaps or alter A3 baseline acceptance.

`external.source` contains the exact imported byte hash, a hash of its canonical
source path, the selected provider/encoding and `compatibilityRevision`. That
revision identifies the source used to implement the adapter; it is **not** the
revision that produced the report. Producer versions, when reported in SARIF,
retain a numeric core and a hash of the whole value. All provenance is
`authenticity: unverified`, with `execution: not-observed`.

Each imported record includes fixed severity/category/analyzer labels,
`confidence: external-unverified`, a hashed rule ID and source-array indices.
`origin.recordIndex` indexes `findings`, `results` or `scan_results`; SARIF also
includes `origin.runIndex`. `sourceIndex` is the normalized output ordinal.
Unrecognized labels become `unknown`, accompanied by an issue. Free-text titles,
descriptions, snippets, remediation, URLs, tool names and exception messages are
not copied. MCP aggregate categories use a fixed vocabulary; unknown names stay
unknown. Raw analyzer identifiers and MCP item identities are hashed.

Paths are matched only against files already read by the local scan. Relative
references can use either path separator; supported SARIF relative URIs are
decoded once. Absolute paths outside the cfgaudit rule below, traversal, URI
bases and unmatched paths remain unbound. References cannot select new filesystem
reads. A Skill JSON report whose
declared root differs from the selected canonical directory gets no file mapping.
There is no cross-machine root remapping. Cisco Skill SARIF mappings assume the caller chose
the reported `%SRCROOT%`; that relationship is not authenticated.
cfgaudit SARIF has no reported root. Its relative references and native absolute
references lexically inside the caller-selected root bind only to files already
observed under that root. An absolute reference outside it remains unbound;
traversal remains rejected. The missing root proof stays visible as
`external-reported-root-not-reported`. A matching path cannot prove that
cfgaudit analyzed the same directory or file bytes. The verified v1.14.0 Windows
release emitted absolute paths for a disposable absolute-root scan; that output
was imported without starting cfgaudit from AEGIS.

Mapped locations retain `currentSha256`, optional `baselineSha256` and a
`reportedLine`. Line numbers are bounded claims; their correspondence to actual
source lines is not verified. A reference hash is retained for unbound locations.
MCP summaries have no source-file binding, even if a local baseline was supplied.

### Optional baseline comparison

A baseline must match the static report schema, subject, adapter, scope and
limits. Duplicate paths, invalid hashes, unsafe references and oversized lists
are rejected. Incompatible scopes produce a visible issue and no hash comparison.

The comparison counts matching, changed, newly observed and unobserved files.
Unobserved does not mean deleted. Its `matching-observed-files` status concerns
only the available lists; `baselineComplete` and `currentComplete` retain their
coverage limitations. A location can be `current-path-only`,
`matched-baseline-file`, `changed-since-baseline`, `not-in-baseline` or `unbound`.

Neither the baseline nor external report is signed. Matching hashes do not prove
that the external analyzer consumed those bytes, used a stated policy, succeeded
or ran at all. A caller could provide a fabricated or stale report alongside an
unrelated baseline. This interface supplies review evidence, never trust.

## Exit codes, bounds and privacy

- Exit `2`: a report was imported and review is required, including empty results.
  `status` is `findings` when either section has findings, otherwise `incomplete`.
- Exit `1`: malformed invocation, unsupported envelope/provider, invalid baseline
  or unavailable input. Only fixed error codes leave the CLI.
- Every outcome has `safety: not-determined` and `reviewRequired: true`; imported
  results always have `complete: false`. No outcome grants execution permission.

Each explicitly selected report/baseline permits 1 MiB and JSON depth 64, with
strict UTF-8 and duplicate-key rejection. Selected files cannot be symlinks.
The existing inventory reader checks identity and size during reads; observations
remain best effort rather than atomic filesystem snapshots.

Import traversal permits 1,024 records/rules per container, 16 runs, 16 locations
per finding and 16 analyzers per container. Output permits 256 external findings
and 128 fixed issue codes. Hitting a cap produces an issue. All runs and entries
share the output finding cap. Counts in MCP aggregates are bounded integers;
unknown values are not substituted with zero. Local traversal retains A4.1 bounds.

Reports still contain locally observed relative filenames, sizes and hashes;
these can disclose private metadata. The command writes only its redacted JSON
to stdout and does not persist or transmit it itself. Unsupported SARIF external
references and `$schema` URLs are never fetched or executed. SARIF support is an
explicit subset of [OASIS SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/sarif-v2.1.0-os.html),
not a general SARIF validator.

Cisco compatibility sources were checked on 2026-09-15; cfgaudit's exporter and
[SARIF tests](https://github.com/cfgaudit/cfgaudit/blob/a8cd15945b09c0fa91e4c5c5eca36e63072110e8/cmd/cfgaudit/sarif_test.go)
were checked on 2026-09-26. Tests use authored synthetic
reports derived from those field contracts, including malformed and adversarial
variants. External scanner binaries were not installed or run, and their detection
accuracy was not evaluated.
